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

    // Fetch ALL carts via paginated SelectSepet
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // tomorrow to include today's carts

    logger.info('Cart report: fetching all carts via pagination...', { startDate, endDate });
    const { xmlPages, totalPages } = await soapClient.selectAllSepetler(startDate, endDate);

    // Parse all pages, filter UyeID > 0, collect rows
    const rows: any[] = [];
    let totalCarts = 0;

    for (const pageXml of xmlPages) {
      const sepetMatches = pageXml.match(/<a:WebSepet>([\s\S]*?)<\/a:WebSepet>/g) || [];
      totalCarts += sepetMatches.length;

      for (const block of sepetMatches) {
        const extractTag = (tag: string) => {
          const m = block.match(new RegExp(`<a:${tag}>([^<]*)<`));
          return m ? m[1] : '';
        };

        const uyeId = parseInt(extractTag('UyeID')) || 0;
        if (uyeId <= 0) continue; // Skip guest carts

        const productBlocks = block.match(/<a:WebSepetUrun>([\s\S]*?)<\/a:WebSepetUrun>/g) || [];
        if (productBlocks.length === 0) continue; // Skip empty carts

        const products = productBlocks.map((pBlock: string) => {
          const pTag = (tag: string) => {
            const pm = pBlock.match(new RegExp(`<a:${tag}>([^<]*)<`));
            return pm ? pm[1] : '';
          };
          return {
            urunAdi: pTag('UrunAdi'),
            urunId: parseInt(pTag('UrunID')) || 0,
            urunKartiId: parseInt(pTag('UrunKartiID')) || 0,
            stokKodu: pTag('StokKodu'),
            spotResim: pTag('SpotResim'),
            fiyat: (parseFloat(pTag('UrunSepetFiyati')) || 0) + (parseFloat(pTag('KDVTutari')) || 0),
            adet: parseInt(pTag('Adet')) || 1,
            paraBirimi: pTag('ParaBirimi') || 'TRY',
          };
        });

        // Format date to Turkish locale
        let cartDate = extractTag('SepetTarihi');
        try {
          const d = new Date(cartDate);
          if (!isNaN(d.getTime())) {
            cartDate = d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
          }
        } catch { /* keep original */ }

        rows.push({
          uyeId,
          uyeName: extractTag('UyeAdi'),
          email: extractTag('UyeMail'),
          cartDate,
          cartGuid: extractTag('GuidSepetID'),
          productCount: products.length,
          products,
        });
      }
    }

    logger.info(`Cart report: ${totalPages} pages, ${totalCarts} total carts, ${rows.length} member carts with products`);
    res.json({ rows, totalRecords: rows.length });
  } catch (error: any) {
    logger.error('Cart report proxy error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/product-url — Get product URL by UrunKartiID + product name
 * Generates Ticimax-style URL slug from product name + ID
 * (e.g., "Sonax Hızlı Cila 500 ml" + ID 115 → /sonax-hizli-cila-500-ml-115)
 */
webhookRoutes.get('/api/product-url', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.API_PROXY_SECRET || 'sonax-proxy-2024';
  if (authHeader !== `Bearer ${expectedToken}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const urunKartiId = parseInt(req.query.urunKartiId as string);
  const urunAdi = (req.query.urunAdi as string) || '';

  if (!urunKartiId) {
    res.status(400).json({ error: 'urunKartiId required' });
    return;
  }

  let url = '';
  if (urunAdi) {
    const slug = slugifyTurkish(urunAdi);
    url = `/${slug}-${urunKartiId}`;
  }

  logger.info('Product URL lookup', { urunKartiId, urunAdi, url: url || '(empty)' });
  res.json({ urunKartiId, url });
});

/**
 * Generate a Turkish-safe URL slug
 */
function slugifyTurkish(text: string): string {
  const charMap: Record<string, string> = {
    'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'İ': 'i',
    'ö': 'o', 'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u',
  };
  return text
    .split('')
    .map(c => charMap[c] || c)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Debug: Show raw WebSepetUrun XML fields from first cart
 */
webhookRoutes.get('/api/cart-debug-products', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.API_PROXY_SECRET || 'sonax-proxy-2024';
  if (authHeader !== `Bearer ${expectedToken}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const { soapClient } = await import('../ticimax/soap-client');
    const cartXml = await soapClient.request(
      config.ticimax.endpoints.siparis,
      'SelectSepet',
      `<tem:SelectSepet>
        <tem:UyeKodu>${config.ticimax.uyeKodu}</tem:UyeKodu>
        <tem:filtre></tem:filtre>
        <tem:sayfalama>
          <ns:BaslangicIndex>0</ns:BaslangicIndex>
          <ns:KayitSayisi>5</ns:KayitSayisi>
          <ns:SiralamaDegeri>ID</ns:SiralamaDegeri>
          <ns:SiralamaYonu>DESC</ns:SiralamaYonu>
        </tem:sayfalama>
      </tem:SelectSepet>`
    );

    // Extract first WebSepetUrun block to see all available fields
    const firstSepet = cartXml.match(/<a:WebSepet>([\s\S]*?)<\/a:WebSepet>/);
    const urunBlocks = firstSepet
      ? (firstSepet[1].match(/<a:WebSepetUrun>([\s\S]*?)<\/a:WebSepetUrun>/g) || [])
      : [];

    res.json({
      totalSepet: (cartXml.match(/<a:WebSepet>/g) || []).length,
      firstSepetUrunCount: urunBlocks.length,
      rawUrunBlocks: urunBlocks.slice(0, 3), // first 3 product blocks
    });
  } catch (error: any) {
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

// ============================
// LIVE CHAT — Dashboard notifies chatbot when agent closes conversation
// ============================

import { whatsappApi } from '../whatsapp/api';
import { getSession, updateSession } from '../chatbot/session';

/**
 * POST /api/live-chat/close — Dashboard agent closed conversation
 * Notifies the customer, sends rating prompt, and updates chatbot session
 */
webhookRoutes.post('/api/live-chat/close', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.DASHBOARD_API_SECRET || '';
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const { phone, conversationId } = req.body;
    if (!phone) {
      res.status(400).json({ error: 'phone required' });
      return;
    }

    // Reset chatbot session to rating mode (not welcome yet)
    await chatbotRouter.endLiveAgent(phone);

    // Send closing message
    await whatsappApi.sendText(phone,
      'Görüşmeniz sonlandırıldı. Tekrar yardım almak için "menü" yazabilirsiniz. 😊'
    );

    // Send rating prompt with 3 buttons
    if (conversationId) {
      try {
        await whatsappApi.sendButtons(phone,
          'Hizmetimizi puanlar mısınız? Geri bildiriminiz bizim için değerli.',
          [
            { type: 'reply', reply: { id: 'rating_bad', title: '😞 Kötü' } },
            { type: 'reply', reply: { id: 'rating_ok', title: '😐 Orta' } },
            { type: 'reply', reply: { id: 'rating_great', title: '😊 Mükemmel' } },
          ],
          '⭐ Puanlama'
        );

        // Set session to rating_pending so router handles the response
        const session = getSession(phone);
        updateSession(phone, {
          currentMenu: 'rating_pending',
          data: {
            ...(session?.data || {}),
            ratingConversationId: conversationId,
          },
        });
      } catch (ratingErr: any) {
        logger.error('Failed to send rating prompt', { phone, error: ratingErr.message });
        // Don't fail the close if rating prompt fails
      }
    }

    logger.info('Live chat closed by agent', { phone, conversationId });
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Live chat close error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ============================
// MEMBER SYNC — Cache-based multi-page SOAP + individual phone lookups
// ============================

interface MemberCacheEntry {
  uyeId: number;
  name: string;
  email: string;
  phone: string;
  smsPermit: boolean;
  mailPermit: boolean;
  city: string;
}

interface MemberCacheData {
  members: MemberCacheEntry[];
  totalInSystem: number;
  syncedAt: Date;
  pagesScanned: number;
  individualLookups: number;
  phonesFoundViaLookup: number;
}

let memberCache: MemberCacheData | null = null;
let memberSyncInProgress = false;
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Background full member sync — runs on Render with no timeout limit
 *
 * Strategy:
 * 1. Multi-page SOAP fetch with SmsIzin=1 (only SMS-permitted members)
 * 2. Individual selectUyelerById lookups for members without phone data
 *    (bulk query often omits CepTelefonu, but individual lookup returns it)
 * 3. Store results in in-memory cache for fast dashboard access
 */
async function doFullMemberSync(): Promise<void> {
  if (memberSyncInProgress) {
    logger.info('Full member sync already in progress, skipping');
    return;
  }
  memberSyncInProgress = true;

  try {
    const { soapClient } = await import('../ticimax/soap-client');
    const { xmlParser } = await import('../ticimax/xml-parser');

    logger.info('=== Starting FULL member sync (background) ===');

    const memberMap = new Map<number, MemberCacheEntry>();
    const RECORD_LIMIT = 25000; // KayitSayisi = total record limit

    // Step 1a: Fetch SMS-permitted members (SmsIzin=1)
    logger.info(`Fetching SMS-permitted members (KayitSayisi=${RECORD_LIMIT})...`);
    const smsXml = await soapClient.selectAllUyeler(1, RECORD_LIMIT, 1, -1);
    const smsMembers = await xmlParser.parseUyeler(smsXml);
    logger.info(`SMS-permitted: ${smsMembers.length} members returned`);

    for (const m of smsMembers) {
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

    logger.info(`After SMS fetch: ${memberMap.size} unique members`);

    // Step 1b: Fetch Mail-permitted members (MailIzin=1)
    logger.info(`Fetching Mail-permitted members (KayitSayisi=${RECORD_LIMIT})...`);
    const mailXml = await soapClient.selectAllUyeler(1, RECORD_LIMIT, -1, 1);
    const mailMembers = await xmlParser.parseUyeler(mailXml);
    logger.info(`Mail-permitted: ${mailMembers.length} members returned`);

    let newFromMail = 0;
    for (const m of mailMembers) {
      if (memberMap.has(m.id)) {
        // Already have this member from SMS query — update mailPermit if needed
        const existing = memberMap.get(m.id)!;
        if (m.mailIzin && !existing.mailPermit) {
          existing.mailPermit = true;
          memberMap.set(m.id, existing);
        }
        continue;
      }
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
      newFromMail++;
    }

    logger.info(`After Mail fetch: ${memberMap.size} unique members (+${newFromMail} new from mail query)`);

    const withPhoneCount = [...memberMap.values()].filter(m => m.phone).length;
    const withoutPhone = [...memberMap.values()].filter(m => !m.phone);

    logger.info(`Total: ${memberMap.size} unique members, ${withPhoneCount} with phone, ${withoutPhone.length} without`);

    // Step 2: Individual phone lookups for ALL members without phones
    // No limit! The bulk query often omits CepTelefonu, but selectUyelerById returns it
    let phonesFoundViaLookup = 0;

    if (withoutPhone.length > 0) {
      logger.info(`Starting individual phone lookups for ${withoutPhone.length} members (concurrency: 20)`);

      const CONCURRENCY = 20;
      const startTime = Date.now();
      const MAX_LOOKUP_TIME = 10 * 60 * 1000; // 10 minutes max
      let lookupsDone = 0;

      for (let i = 0; i < withoutPhone.length; i += CONCURRENCY) {
        // Time limit check
        if (Date.now() - startTime > MAX_LOOKUP_TIME) {
          logger.warn(`Individual lookups time limit reached (${MAX_LOOKUP_TIME / 1000}s). Done ${lookupsDone}/${withoutPhone.length}`);
          break;
        }

        const batch = withoutPhone.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (member) => {
          try {
            const memberXml = await soapClient.selectUyelerById(member.uyeId);
            const cepMatch = memberXml.match(/<a:CepTelefonu>([^<]*)<\//);
            const telMatch = memberXml.match(/<a:Telefon>([^<]*)<\//);
            const rawPhone = (cepMatch ? cepMatch[1] : '') || (telMatch ? telMatch[1] : '');
            const phone = normalizePhoneForMembers(rawPhone);

            if (phone) {
              member.phone = phone;
              memberMap.set(member.uyeId, member);
              phonesFoundViaLookup++;
            }

            // Also update SmsIzin/MailIzin from individual lookup
            const smsMatch = memberXml.match(/<a:SmsIzin>([^<]*)<\//);
            const mailMatch = memberXml.match(/<a:MailIzin>([^<]*)<\//);
            if (smsMatch) member.smsPermit = smsMatch[1] === 'true';
            if (mailMatch) member.mailPermit = mailMatch[1] === 'true';
          } catch {
            // Skip failed lookups silently
          }
        }));

        lookupsDone += batch.length;

        // Log progress every 500 members
        if (lookupsDone % 500 < CONCURRENCY || lookupsDone >= withoutPhone.length) {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          logger.info(`Individual lookups: ${lookupsDone}/${withoutPhone.length} done, ${phonesFoundViaLookup} phones found (${elapsed}s elapsed)`);
        }
      }

      const totalElapsed = Math.round((Date.now() - startTime) / 1000);
      logger.info(`Individual lookups complete: ${phonesFoundViaLookup} additional phones found in ${totalElapsed}s`);
    }

    // Keep ALL members with SMS or mail permission (not just phone holders)
    const allPermittedMembers = [...memberMap.values()];
    const membersWithPhone = allPermittedMembers.filter(m => m.phone);

    // Update cache
    memberCache = {
      members: allPermittedMembers,
      totalInSystem: memberMap.size,
      syncedAt: new Date(),
      pagesScanned: 2, // Two queries: SMS + Mail
      individualLookups: withoutPhone.length,
      phonesFoundViaLookup,
    };

    logger.info(`=== Full member sync COMPLETE: ${allPermittedMembers.length} total members (${membersWithPhone.length} with phones, ${memberMap.size} in system) ===`);

  } catch (error: any) {
    logger.error('Full member sync error', { error: error.message, stack: error.stack });
  } finally {
    memberSyncInProgress = false;
  }
}

/**
 * POST /api/members — Fetch ALL active Ticimax members via SOAP API
 * Used by campaign dashboard to sync contacts
 *
 * Strategy:
 * - Returns cached data if available (fast response for Vercel 60s limit)
 * - Triggers background full sync if cache is stale/missing
 * - First call without cache does a quick page-1 bulk fetch
 */
webhookRoutes.post('/api/members', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.API_PROXY_SECRET || 'sonax-proxy-2024';
  if (authHeader !== `Bearer ${expectedToken}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    // Case 1: Fresh cache available → return immediately
    if (memberCache && (Date.now() - memberCache.syncedAt.getTime()) < CACHE_TTL) {
      logger.info(`Returning cached member data (${memberCache.members.length} members, cached ${Math.round((Date.now() - memberCache.syncedAt.getTime()) / 60000)}min ago)`);
      return res.json({
        members: memberCache.members,
        totalRecords: memberCache.members.length,
        totalInSystem: memberCache.totalInSystem,
        pagesScanned: memberCache.pagesScanned,
        individualLookups: memberCache.individualLookups,
        phonesFoundViaLookup: memberCache.phonesFoundViaLookup,
        source: 'cache',
        cachedAt: memberCache.syncedAt.toISOString(),
      });
    }

    // Case 2: Stale cache → return stale data + trigger background refresh
    if (memberCache) {
      logger.info(`Returning stale cache (${memberCache.members.length} members), triggering background refresh`);
      doFullMemberSync(); // Fire and forget
      return res.json({
        members: memberCache.members,
        totalRecords: memberCache.members.length,
        totalInSystem: memberCache.totalInSystem,
        source: 'stale-cache',
        cachedAt: memberCache.syncedAt.toISOString(),
        syncInProgress: true,
      });
    }

    // Case 3: No cache at all → quick SMS-permitted fetch + trigger full sync (SMS+Mail)
    logger.info('No cache available, doing quick SMS-permitted fetch');

    const { soapClient } = await import('../ticimax/soap-client');
    const { xmlParser } = await import('../ticimax/xml-parser');

    const xml = await soapClient.selectAllUyeler(1, 25000, 1, -1); // SmsIzin=1 quick fetch
    const members = await xmlParser.parseUyeler(xml);

    const quickMembers: MemberCacheEntry[] = [];
    const seen = new Set<number>();

    for (const m of members) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const rawPhone = m.cepTelefonu || m.telefon || '';
      const phone = normalizePhoneForMembers(rawPhone);
      if (!phone) continue; // Skip phoneless in quick mode

      quickMembers.push({
        uyeId: m.id,
        name: `${m.isim} ${m.soyisim}`.trim(),
        email: m.mail || '',
        phone,
        smsPermit: m.smsIzin,
        mailPermit: m.mailIzin,
        city: m.il || '',
      });
    }

    logger.info(`Quick page-1 fetch: ${members.length} total, ${quickMembers.length} with phones`);

    // Trigger full sync in background
    doFullMemberSync();

    res.json({
      members: quickMembers,
      totalRecords: quickMembers.length,
      totalInSystem: members.length,
      source: 'quick-bulk',
      syncInProgress: true,
      message: 'Arka planda tam senkronizasyon başlatıldı. 2-5 dakika sonra tekrar senkronize edin.',
    });
  } catch (error: any) {
    logger.error('Members API error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/members/force-sync — Force a fresh full member sync
 * Waits for sync to complete (may take several minutes)
 */
webhookRoutes.post('/api/members/force-sync', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.API_PROXY_SECRET || 'sonax-proxy-2024';
  if (authHeader !== `Bearer ${expectedToken}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    // Clear cache to force fresh sync
    memberCache = null;
    await doFullMemberSync();

    // Re-read cache (doFullMemberSync updates it)
    const cache = memberCache as MemberCacheData | null;
    if (cache) {
      res.json({
        members: cache.members,
        totalRecords: cache.members.length,
        totalInSystem: cache.totalInSystem,
        pagesScanned: cache.pagesScanned,
        individualLookups: cache.individualLookups,
        phonesFoundViaLookup: cache.phonesFoundViaLookup,
        source: 'fresh-sync',
        cachedAt: cache.syncedAt.toISOString(),
      });
    } else {
      res.status(500).json({ error: 'Sync failed — check logs' });
    }
  } catch (error: any) {
    logger.error('Force sync error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/members/status — Check member cache status
 */
webhookRoutes.get('/api/members/status', (req: Request, res: Response) => {
  res.json({
    hasCachedData: !!memberCache,
    memberCount: memberCache?.members.length || 0,
    totalInSystem: memberCache?.totalInSystem || 0,
    syncedAt: memberCache?.syncedAt?.toISOString() || null,
    pagesScanned: memberCache?.pagesScanned || 0,
    individualLookups: memberCache?.individualLookups || 0,
    phonesFoundViaLookup: memberCache?.phonesFoundViaLookup || 0,
    syncInProgress: memberSyncInProgress,
    cacheAgeMins: memberCache ? Math.round((Date.now() - memberCache.syncedAt.getTime()) / 60000) : null,
  });
});

// ============================
// BULK ORDER QUERY (for conversion tracking)
// ============================

/**
 * POST /api/orders/bulk — Query orders for multiple uyeIds
 * Used by Dashboard conversion-check cron to match orders with sent messages
 */
webhookRoutes.post('/api/orders/bulk', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.DASHBOARD_API_SECRET || process.env.API_PROXY_SECRET || '';
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { uyeIds } = req.body;
  if (!Array.isArray(uyeIds) || uyeIds.length === 0) {
    res.status(400).json({ error: 'uyeIds array required' });
    return;
  }

  const ids = uyeIds.slice(0, 100); // max 100 per request

  try {
    const { soapClient } = await import('../ticimax/soap-client');
    const { xmlParser } = await import('../ticimax/xml-parser');

    const orders: any[] = [];
    const CONCURRENCY = 5;

    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const batch = ids.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (uyeId: number) => {
          const xml = await soapClient.selectSiparisByUyeId(uyeId);
          const siparisler = await xmlParser.parseSiparisler(xml);
          return siparisler.map((s: any) => ({
            uyeId,
            siparisNo: s.siparisNo,
            siparisTarihi: s.tarih,
            tutar: s.toplamTutar,
            durum: s.durum,
            siparisId: s.id,
          }));
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          orders.push(...result.value);
        }
      }
    }

    logger.info('Bulk order query completed', { requestedUyeIds: ids.length, ordersFound: orders.length });
    res.json({ orders });
  } catch (error: any) {
    logger.error('Bulk order query failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Normalize Turkish phone to 905XXXXXXXXX format
 */
function normalizePhoneForMembers(phone: string): string {
  if (!phone) return '';
  let cleaned = phone.replace(/\D/g, '');

  // Handle various Turkish formats
  if (cleaned.startsWith('00905')) {
    cleaned = cleaned.substring(2); // 00905... -> 905...
  } else if (cleaned.startsWith('05') && cleaned.length === 11) {
    cleaned = '9' + cleaned; // 05XXXXXXXXX -> 905XXXXXXXXX
  } else if (cleaned.startsWith('5') && cleaned.length === 10) {
    cleaned = '90' + cleaned; // 5XXXXXXXXX -> 905XXXXXXXXX
  }

  if (cleaned.length < 7) return ''; // Truly invalid
  return cleaned;
}
