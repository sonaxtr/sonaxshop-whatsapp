import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // WhatsApp Cloud API
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'sonax_webhook_verify_2024',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
  },

  // Ticimax SOAP
  ticimax: {
    uyeKodu: process.env.TICIMAX_UYE_KODU || '',
    baseUrl: process.env.TICIMAX_BASE_URL || 'https://sonaxshop.com.tr/Servis',
    adminUrl: process.env.TICIMAX_ADMIN_URL || 'https://sonaxshop.com.tr',
    adminUser: process.env.TICIMAX_ADMIN_USER || '',
    adminPass: process.env.TICIMAX_ADMIN_PASS || '',
    endpoints: {
      urun: '/UrunServis.svc',
      uye: '/UyeServis.svc',
      siparis: '/SiparisServis.svc',
      custom: '/CustomServis.svc',
    },
  },

  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  baseUrl: process.env.BASE_URL || '',
};
