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
