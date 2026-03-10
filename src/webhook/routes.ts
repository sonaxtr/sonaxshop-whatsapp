import { Router, Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';
import { WebhookBody, WebhookMessage } from '../whatsapp/types';
import { chatbotRouter } from '../chatbot/router';

export const webhookRoutes = Router();

// Message deduplication — prevent processing same message on webhook retries
const processedMessages = new Set<string>();
const MESSAGE_DEDUP_TTL = 120_000; // 2 minutes

function isAlreadyProcessed(messageId: string): boolean {
  if (processedMessages.has(messageId)) {
    return true;
  }
  processedMessages.add(messageId);
  setTimeout(() => processedMessages.delete(messageId), MESSAGE_DEDUP_TTL);
  return false;
}

/**
 * GET /webhook — Meta verification endpoint
 * Meta sends a GET request to verify the webhook URL
 */
webhookRoutes.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'] as string;
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    logger.info('Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    logger.warn('Webhook verification failed', { mode, token });
    res.sendStatus(403);
  }
});

/**
 * POST /webhook — Incoming messages from WhatsApp
 */
webhookRoutes.post('/webhook', async (req: Request, res: Response) => {
  // Always respond 200 immediately (WhatsApp requires fast response)
  res.sendStatus(200);

  try {
    const body: WebhookBody = req.body;

    if (body.object !== 'whatsapp_business_account') {
      return;
    }

    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        const messages = value.messages;
        const contacts = value.contacts;

        if (!messages || messages.length === 0) continue;

        for (const message of messages) {
          // Skip duplicate messages (webhook retries)
          if (isAlreadyProcessed(message.id)) {
            logger.info('Skipping duplicate message', { id: message.id });
            continue;
          }

          const from = message.from;
          const contactName = contacts?.find(c => c.wa_id === from)?.profile?.name || 'Müşteri';

          logger.info('Incoming message', {
            from,
            name: contactName,
            type: message.type,
            text: message.text?.body || message.interactive?.list_reply?.title || message.interactive?.button_reply?.title || '',
          });

          // Route to chatbot
          await chatbotRouter.handleMessage(from, contactName, message);
        }
      }
    }
  } catch (error: any) {
    logger.error('Webhook processing error', { error: error.message, stack: error.stack });
  }
});

/**
 * GET / — Health check
 */
webhookRoutes.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'SonaxShop WhatsApp Chatbot',
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /api/cart-report — Proxy for dashboard to fetch cart data via SOAP
 * Used by campaign dashboard on Vercel (SOAP is IP-restricted)
 */
webhookRoutes.post('/api/cart-report', async (req: Request, res: Response) => {
  // Simple auth check
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.API_PROXY_SECRET || 'sonax-proxy-2024';
  if (authHeader !== `Bearer ${expectedToken}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const { soapClient } = await import('../ticimax/soap-client');

    // Step 1: Fetch all carts via SelectSepet
    const cartXml = await soapClient.request(
      config.ticimax.endpoints.siparis,
      'SelectSepet',
      `<tem:SelectSepet>
        <tem:UyeKodu>${config.ticimax.uyeKodu}</tem:UyeKodu>
        <tem:filtre></tem:filtre>
        <tem:sayfalama>
          <ns:BaslangicIndex>0</ns:BaslangicIndex>
          <ns:KayitSayisi>200</ns:KayitSayisi>
          <ns:SiralamaDegeri>ID</ns:SiralamaDegeri>
          <ns:SiralamaYonu>DESC</ns:SiralamaYonu>
        </tem:sayfalama>
      </tem:SelectSepet>`
    );

    // Parse cart XML
    const carts: any[] = [];
    const sepetMatches = cartXml.match(/<a:WebSepet>([\s\S]*?)<\/a:WebSepet>/g) || [];

    for (const block of sepetMatches) {
      const extractTag = (tag: string) => {
        const m = block.match(new RegExp(`<a:${tag}>([^<]*)<`));
        return m ? m[1] : '';
      };

      const productBlocks = block.match(/<a:WebSepetUrun>/g) || [];

      carts.push({
        uyeId: parseInt(extractTag('UyeID')) || 0,
        uyeName: extractTag('UyeAdi'),
        email: extractTag('UyeMail'),
        cartDate: extractTag('SepetTarihi'),
        cartGuid: extractTag('GuidSepetID'),
        productCount: productBlocks.length,
      });
    }

    // Step 2: Lookup member phone/SMS for unique UyeIDs
    const uyeIds = [...new Set(carts.filter(c => c.uyeId > 0).map(c => c.uyeId))];
    const memberInfo: Record<number, { phone: string; smsPermit: boolean; mailPermit: boolean }> = {};

    const BATCH = 5;
    for (let i = 0; i < uyeIds.length; i += BATCH) {
      const batch = uyeIds.slice(i, i + BATCH);
      await Promise.all(batch.map(async (uyeId) => {
        try {
          const memberXml = await soapClient.selectUyelerById(uyeId);
          const phoneMatch = memberXml.match(/<a:Telefon>([^<]*)</);
          const smsMatch = memberXml.match(/<a:SmsIzin>([^<]*)</);
          const mailMatch = memberXml.match(/<a:MailIzin>([^<]*)</);

          memberInfo[uyeId] = {
            phone: phoneMatch ? phoneMatch[1] : '',
            smsPermit: smsMatch ? smsMatch[1] === 'true' : false,
            mailPermit: mailMatch ? mailMatch[1] === 'true' : false,
          };
        } catch (err) {
          logger.error(`Failed to lookup member ${uyeId}`, { error: (err as any).message });
        }
      }));
    }

    // Step 3: Merge cart + member data
    const rows = carts.map(cart => {
      const member = memberInfo[cart.uyeId];
      let formattedDate = cart.cartDate;
      try {
        const d = new Date(cart.cartDate);
        formattedDate = d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
      } catch { /* keep original */ }

      return {
        uyeId: cart.uyeId,
        uyeName: cart.uyeName,
        email: cart.email,
        phone: member?.phone || '',
        smsPermit: member?.smsPermit || false,
        mailPermit: member?.mailPermit || false,
        productCount: cart.productCount,
        cartDate: formattedDate,
        cartGuid: cart.cartGuid,
      };
    });

    res.json({ rows, totalRecords: rows.length });
  } catch (error: any) {
    logger.error('Cart report proxy error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Cart data cache — stores data synced from local scraper
 * Local script scrapes admin panel (no Cloudflare from residential IP)
 * and POSTs the data here for dashboard consumption.
 */
let cartDataCache: {
  rows: any[];
  totalRecords: number;
  syncedAt: string;
  source: string;
} | null = null;

/**
 * POST /api/cart-report-v2 — Return cached admin panel data
 * Data is populated by local sync script via POST /api/cart-data-sync
 * Falls through to Puppeteer scraper if no cached data available
 */
webhookRoutes.post('/api/cart-report-v2', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.API_PROXY_SECRET || 'sonax-proxy-2024';
  if (authHeader !== `Bearer ${expectedToken}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    // Return cached synced data if available (from local scraper)
    if (cartDataCache && cartDataCache.rows.length > 0) {
      logger.info('Returning synced cart data from cache', {
        rows: cartDataCache.rows.length,
        syncedAt: cartDataCache.syncedAt,
      });
      res.json(cartDataCache);
      return;
    }

    // Fallback: try Puppeteer scraper (may fail due to Cloudflare)
    const { getAdminScraper } = await import('../ticimax/admin-scraper');
    const scraper = getAdminScraper();
    const maxPages = req.body?.maxPages || 0;
    const result = await scraper.getCartReport(maxPages);

    res.json({
      rows: result.rows,
      totalRecords: result.totalRecords,
      source: 'admin-scraper',
    });
  } catch (error: any) {
    logger.error('Cart report v2 error', { error: error.message });
    // If scraper fails but we have stale cache, return it with warning
    if (cartDataCache && cartDataCache.rows.length > 0) {
      logger.info('Returning stale cached data after scraper failure');
      res.json({ ...cartDataCache, stale: true });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/cart-data-sync — Receive cart data from local sync script
 * The local script runs on user's PC (residential IP = no Cloudflare),
 * scrapes UyeSepetRapor.aspx, and POSTs the data here.
 *
 * Body: { rows: CartReportRow[], totalRecords: number }
 */
webhookRoutes.post('/api/cart-data-sync', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.API_PROXY_SECRET || 'sonax-proxy-2024';
  if (authHeader !== `Bearer ${expectedToken}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const { rows, totalRecords } = req.body;

    if (!rows || !Array.isArray(rows)) {
      res.status(400).json({ error: 'Missing rows array in request body' });
      return;
    }

    cartDataCache = {
      rows,
      totalRecords: totalRecords || rows.length,
      syncedAt: new Date().toISOString(),
      source: 'local-sync',
    };

    logger.info('Cart data synced from local scraper', {
      rows: rows.length,
      totalRecords: cartDataCache.totalRecords,
    });

    res.json({
      success: true,
      message: `Synced ${rows.length} cart records`,
      syncedAt: cartDataCache.syncedAt,
    });
  } catch (error: any) {
    logger.error('Cart data sync error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/cart-data-status — Check sync status
 */
webhookRoutes.get('/api/cart-data-status', async (_req: Request, res: Response) => {
  res.json({
    hasCachedData: !!cartDataCache,
    rowCount: cartDataCache?.rows.length || 0,
    syncedAt: cartDataCache?.syncedAt || null,
    source: cartDataCache?.source || null,
  });
});

/**
 * POST /api/members — Fetch ALL active Ticimax members via SOAP API
 * Used by campaign dashboard to sync contacts (not just cart report)
 *
 * Strategy:
 * 1. Bulk SelectUyeler (KayitSayisi=10000) — gets all member records
 * 2. For members without phone, individual selectUyelerById lookups
 *    (individual lookups often return phone data that bulk doesn't)
 */
webhookRoutes.post('/api/members', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.API_PROXY_SECRET || 'sonax-proxy-2024';
  if (authHeader !== `Bearer ${expectedToken}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const { soapClient } = await import('../ticimax/soap-client');
    const { xmlParser } = await import('../ticimax/xml-parser');

    // Step 1: Bulk fetch with large page size to get ALL members at once
    logger.info('Starting full member sync via SOAP API');

    const xml = await soapClient.selectAllUyeler(1, 10000);
    const members = await xmlParser.parseUyeler(xml);

    logger.info(`Bulk SelectUyeler returned ${members.length} members`);

    // Deduplicate by ID
    const memberMap = new Map<number, any>();
    for (const m of members) {
      if (memberMap.has(m.id)) continue;
      const rawPhone = m.cepTelefonu || m.telefon || '';
      const phone = normalizePhoneForMembers(rawPhone);

      memberMap.set(m.id, {
        uyeId: m.id,
        name: `${m.isim} ${m.soyisim}`.trim(),
        email: m.mail || '',
        phone: phone || '',
        smsPermit: m.smsIzin,
        mailPermit: m.mailIzin,
        city: m.il || '',
      });
    }

    const withPhone = [...memberMap.values()].filter(m => m.phone).length;
    const withoutPhone = [...memberMap.values()].filter(m => !m.phone);

    logger.info(`Bulk query: ${memberMap.size} unique, ${withPhone} with phone, ${withoutPhone.length} without`);

    // Step 2: Individual phone lookups for members without phones
    // (selectUyelerById often returns phone data that bulk query doesn't)
    if (withoutPhone.length > 0 && withoutPhone.length <= 200) {
      logger.info(`Looking up phones for ${withoutPhone.length} members individually`);

      const BATCH = 5;
      let phonesFound = 0;

      for (let i = 0; i < withoutPhone.length; i += BATCH) {
        const batch = withoutPhone.slice(i, i + BATCH);
        await Promise.all(batch.map(async (member) => {
          try {
            const memberXml = await soapClient.selectUyelerById(member.uyeId);
            // Extract phone from individual lookup XML
            const cepMatch = memberXml.match(/<a:CepTelefonu>([^<]*)</);
            const telMatch = memberXml.match(/<a:Telefon>([^<]*)</);
            const rawPhone = (cepMatch ? cepMatch[1] : '') || (telMatch ? telMatch[1] : '');
            const phone = normalizePhoneForMembers(rawPhone);

            if (phone) {
              member.phone = phone;
              memberMap.set(member.uyeId, member);
              phonesFound++;
            }

            // Also extract SmsIzin/MailIzin from individual lookup
            const smsMatch = memberXml.match(/<a:SmsIzin>([^<]*)</);
            const mailMatch = memberXml.match(/<a:MailIzin>([^<]*)</);
            if (smsMatch) member.smsPermit = smsMatch[1] === 'true';
            if (mailMatch) member.mailPermit = mailMatch[1] === 'true';
          } catch {
            // Skip failed lookups silently
          }
        }));
      }

      logger.info(`Individual lookups found ${phonesFound} additional phones`);
    }

    const allMembers = [...memberMap.values()];
    const finalWithPhone = allMembers.filter(m => m.phone).length;

    logger.info(`Member sync complete: ${allMembers.length} total, ${finalWithPhone} with phones`);

    res.json({
      members: allMembers,
      totalRecords: allMembers.length,
      withPhone: finalWithPhone,
      source: 'soap-api',
    });
  } catch (error: any) {
    logger.error('Members API error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Normalize Turkish phone to 905XXXXXXXXX format
 */
function normalizePhoneForMembers(phone: string): string {
  if (!phone) return '';
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('05')) cleaned = '9' + cleaned;
  if (cleaned.startsWith('5') && cleaned.length === 10) cleaned = '90' + cleaned;
  if (cleaned.length < 10) return '';
  return cleaned;
}
