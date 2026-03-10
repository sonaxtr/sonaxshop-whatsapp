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
 * POST /api/cart-report-v2 — Scrape UyeSepetRapor.aspx for full cart data
 * Returns 700+ records (vs 100 from SOAP SelectSepet)
 * All records have member info (name, email, phone, SMS/mail permissions)
 */
webhookRoutes.post('/api/cart-report-v2', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.API_PROXY_SECRET || 'sonax-proxy-2024';
  if (authHeader !== `Bearer ${expectedToken}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const { getAdminScraper } = await import('../ticimax/admin-scraper');
    const scraper = getAdminScraper();

    // maxPages from request body (0 = all pages, default)
    const maxPages = req.body?.maxPages || 0;

    const result = await scraper.getCartReport(maxPages);

    res.json({
      rows: result.rows,
      totalRecords: result.totalRecords,
      source: 'admin-scraper',
    });
  } catch (error: any) {
    logger.error('Cart report v2 scraper error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});
