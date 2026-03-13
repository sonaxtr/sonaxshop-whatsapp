import { Router, Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';
import { WebhookBody, WebhookMessage } from '../whatsapp/types';
import { chatbotRouter } from '../chatbot/router';
import { getSession, updateSession } from '../chatbot/session';
import { closeConversation } from '../chatbot/live-agent';

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
 * POST /api/live-chat/close — Called by dashboard when agent closes conversation
 */
webhookRoutes.post('/api/live-chat/close', async (req: Request, res: Response) => {
  // Auth: bearer token
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.CHATBOT_API_SECRET || process.env.API_PROXY_SECRET || '';
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { phone, conversationId } = req.body;
  if (!phone) {
    res.status(400).json({ error: 'phone required' });
    return;
  }

  logger.info('Live chat close received', { phone, conversationId });

  // Check if customer is in live_agent mode and close it
  const session = getSession(phone);
  if (session && session.currentMenu === 'live_agent') {
    const convId = conversationId || session.data?.conversationId;
    if (convId) {
      await closeConversation(convId).catch(() => {});
    }
    // Reset session back to main menu
    updateSession(phone, { currentMenu: 'main' });
  }

  res.json({ success: true });
});

/**
 * POST /api/cart-report — SOAP-based cart report for dashboard
 * Uses paginated SelectSepet(uyeId=-1, sayfaSayisi=N) to fetch all carts,
 * filters UyeID > 0 (registered members only).
 * Dashboard enriches with phone/permit data from its own contacts DB.
 */
webhookRoutes.post('/api/cart-report', async (_req: Request, res: Response) => {
  try {
    const { soapClient } = await import('../ticimax/soap-client');
    const { xmlParser } = await import('../ticimax/xml-parser');

    // Fetch ALL carts via paginated SelectSepet (uyeId=-1, all members)
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // tomorrow, to include today's carts

    logger.info('Cart report: fetching all carts via pagination...', { startDate, endDate });

    // Load product URL cache in parallel with cart fetch
    const [{ xmlPages, totalPages }, urlCache] = await Promise.all([
      soapClient.selectAllSepetler(startDate, endDate),
      getProductUrlCache(),
    ]);

    // Parse all pages and collect carts with UyeID > 0
    const rows: any[] = [];
    let totalCarts = 0;
    let memberCarts = 0;

    for (const pageXml of xmlPages) {
      const { sepetler } = await xmlParser.parseSepetPage(pageXml);
      totalCarts += sepetler.length;

      for (const cart of sepetler) {
        // Only include registered member carts (UyeID > 0)
        if (cart.uyeId <= 0) continue;
        // Only include carts with products
        if (cart.urunler.length === 0) continue;

        memberCarts++;

        const products = cart.urunler.map(u => ({
          urunAdi: u.urunAdi,
          urunId: u.urunId || 0,
          urunKartiId: u.urunKartiId || 0,
          stokKodu: u.stokKodu,
          spotResim: u.resimUrl,
          fiyat: u.fiyat + u.kdvTutari,
          adet: u.adet,
          paraBirimi: 'TRY',
          productUrl: urlCache.get(u.urunKartiId || 0) || '',
        }));

        let cartDate = '';
        try {
          const d = new Date(cart.sepetTarihi);
          if (!isNaN(d.getTime())) {
            cartDate = `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
          } else {
            cartDate = cart.sepetTarihi;
          }
        } catch { cartDate = cart.sepetTarihi; }

        rows.push({
          uyeId: cart.uyeId,
          uyeName: cart.uyeAdi || '',
          email: cart.uyeMail || '',
          productCount: cart.urunler.length,
          products,
          cartDate,
          cartGuid: cart.guidSepetId,
        });
      }
    }

    logger.info('Cart report complete', {
      pagesScanned: totalPages,
      totalCarts,
      memberCarts,
      withProducts: rows.length,
    });

    res.json({
      rows,
      totalRecords: rows.length,
      totalPages: 1,
      currentPage: 1,
    });
  } catch (e: any) {
    logger.error('Cart report error', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/cart-reminder/status — Cart reminder service status
 */
webhookRoutes.get('/api/cart-reminder/status', (_req: Request, res: Response) => {
  const { cartReminderService } = require('../cart-reminder/cart-reminder');
  res.json(cartReminderService.getStatus());
});

/**
 * POST /api/cart-reminder/trigger — Manually trigger a cart reminder cycle
 */
webhookRoutes.post('/api/cart-reminder/trigger', async (_req: Request, res: Response) => {
  const { cartReminderService } = require('../cart-reminder/cart-reminder');
  const result = await cartReminderService.triggerManual();
  res.json(result);
});

/**
 * Product URL cache — loads all products from SOAP SelectUrun once,
 * caches Map<urunKartiId, url> for 30 minutes.
 * ~1500 products, single SOAP call, avoids per-request queries.
 */
let productUrlCache: Map<number, string> = new Map();
let productUrlCacheTime = 0;
const PRODUCT_URL_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
let productUrlCacheLoading = false;

async function getProductUrlCache(): Promise<Map<number, string>> {
  if (productUrlCache.size > 0 && Date.now() - productUrlCacheTime < PRODUCT_URL_CACHE_TTL) {
    return productUrlCache;
  }
  if (productUrlCacheLoading) {
    // Another request is already loading, return current cache (may be empty on first call)
    return productUrlCache;
  }
  productUrlCacheLoading = true;
  try {
    const { soapClient } = await import('../ticimax/soap-client');
    const { xmlParser } = await import('../ticimax/xml-parser');
    const xml = await soapClient.selectAllUrunlerForUrls();
    const urunler = await xmlParser.parseUrunler(xml);

    const newCache = new Map<number, string>();
    for (const u of urunler) {
      if (u.id > 0 && u.url) {
        newCache.set(u.id, u.url);
      }
    }

    productUrlCache = newCache;
    productUrlCacheTime = Date.now();
    logger.info('Product URL cache loaded', { products: newCache.size });
    return newCache;
  } catch (err: any) {
    logger.error('Product URL cache load failed', { error: err.message });
    return productUrlCache; // return stale cache on error
  } finally {
    productUrlCacheLoading = false;
  }
}

/**
 * GET /api/product-url — Get product URL by UrunKartiID
 * Uses cached product list from SOAP SelectUrun (all products loaded once).
 * Fallback: slug-based URL generation from product name + ID.
 */
webhookRoutes.get('/api/product-url', async (req: Request, res: Response) => {
  // Auth: bearer token
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.CHATBOT_API_SECRET || process.env.API_PROXY_SECRET || '';
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const urunKartiId = parseInt(req.query.urunKartiId as string);
  const urunAdi = (req.query.urunAdi as string) || '';

  if (!urunKartiId || urunKartiId <= 0) {
    res.status(400).json({ error: 'urunKartiId required' });
    return;
  }

  // Look up from cached product list
  let url = '';
  try {
    const cache = await getProductUrlCache();
    url = cache.get(urunKartiId) || '';
    if (url) {
      logger.info('Product URL from cache', { urunKartiId, url });
    }
  } catch (err: any) {
    logger.warn('Product URL cache lookup failed', { urunKartiId, error: err.message });
  }

  // Fallback: generate URL slug from product name + ID (Ticimax convention)
  if (!url && urunAdi) {
    const slug = slugifyTurkish(urunAdi);
    url = `/${slug}-${urunKartiId}`;
    logger.info('Product URL from slug fallback', { urunKartiId, url });
  }

  res.json({ urunKartiId, url });
});

/**
 * Generate a Turkish-safe URL slug
 * Converts Turkish chars, lowercases, replaces spaces/special chars with hyphens
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
 * GET / — Health check
 */
webhookRoutes.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'Sonax WhatsApp Chatbot',
    timestamp: new Date().toISOString(),
  });
});
