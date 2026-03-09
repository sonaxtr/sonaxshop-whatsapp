import express from 'express';
import path from 'path';
import { config } from './config';
import { logger } from './utils/logger';
import { webhookRoutes } from './webhook/routes';
import { productCache } from './ticimax/product-cache';

const app = express();

// Parse JSON body (WhatsApp sends JSON)
app.use(express.json());

// Serve static files (price list images etc.)
app.use('/images', express.static(path.join(__dirname, '..', 'public', 'images')));

// Request logging
app.use((req, res, next) => {
  if (req.path !== '/') { // Don't log health checks
    logger.info(`${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent')?.substring(0, 50),
    });
  }
  next();
});

// Routes
app.use('/', webhookRoutes);

// Start server
app.listen(config.port, () => {
  logger.info(`🚀 SonaxShop WhatsApp Chatbot started`, {
    port: config.port,
    env: config.nodeEnv,
    webhookUrl: `http://localhost:${config.port}/webhook`,
  });

  if (!config.whatsapp.token) {
    logger.warn('⚠️ WHATSAPP_TOKEN is not set! Set it in .env file.');
  }
  if (!config.whatsapp.phoneNumberId) {
    logger.warn('⚠️ WHATSAPP_PHONE_NUMBER_ID is not set! Set it in .env file.');
  }

  // Initialize product cache for text search (non-blocking)
  productCache.initialize().catch(err => {
    logger.error('Product cache init error', { error: err.message });
  });
});

export default app;
