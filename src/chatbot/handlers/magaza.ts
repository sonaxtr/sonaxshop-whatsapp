import { whatsappApi } from '../../whatsapp/api';
import { soapClient } from '../../ticimax/soap-client';
import { xmlParser } from '../../ticimax/xml-parser';
import { updateSession } from '../session';
import { logger } from '../../utils/logger';

// Cache for store data (refreshed every hour)
let magazaCache: any[] = [];
let cacheTime = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

async function getMagazalar(): Promise<any[]> {
  if (magazaCache.length > 0 && Date.now() - cacheTime < CACHE_DURATION) {
    return magazaCache;
  }

  try {
    const xml = await soapClient.getMagazalar();
    magazaCache = await xmlParser.parseMagazalar(xml);
    cacheTime = Date.now();
    logger.info('Magazalar cache refreshed', { count: magazaCache.length });
    return magazaCache;
  } catch (error: any) {
    logger.error('GetMagazalar error', { error: error.message });
    return magazaCache; // Return stale cache on error
  }
}

export async function handleMagazaAction(from: string, input: string, menuState: string): Promise<void> {
  if (menuState === 'magaza_listesi') {
    // Show all stores
    try {
      await whatsappApi.sendText(from, '🔍 Uygulama merkezleri yükleniyor...');

      const magazalar = await getMagazalar();

      if (magazalar.length === 0) {
        await whatsappApi.sendText(from,
          `🏪 *Uygulama Merkezleri*\n\n` +
          `Uygulama merkezleri bilgisi şu an için mevcut değil.\n\n` +
          `📞 Bilgi için: 0850 307 7930\n` +
          `🔗 https://sonaxshop.com.tr/magazalarimiz`
        );
      } else {
        let text = `🏪 *Uygulama Merkezlerimiz (${magazalar.filter(m => m.aktif).length} adet)*\n`;

        for (const magaza of magazalar.filter(m => m.aktif).slice(0, 10)) {
          text += `\n━━━━━━━━━━━━━━━\n`;
          text += `📍 *${magaza.ad}*\n`;
          if (magaza.il) text += `🏙 ${magaza.il}${magaza.ilce ? ` / ${magaza.ilce}` : ''}\n`;
          if (magaza.adres) text += `📮 ${magaza.adres}\n`;
          if (magaza.telefon) text += `📞 ${magaza.telefon}\n`;
          if (magaza.calismaSaatleri) text += `🕐 ${magaza.calismaSaatleri}\n`;
          if (magaza.latitude && magaza.longitude) {
            text += `🗺 https://maps.google.com/?q=${magaza.latitude},${magaza.longitude}\n`;
          }
        }

        await whatsappApi.sendText(from, text);
      }
    } catch (error: any) {
      logger.error('Magaza list error', { from, error: error.message });
      await whatsappApi.sendText(from, '❌ Mağaza bilgileri yüklenirken bir hata oluştu.');
    }

    await whatsappApi.sendButtons(from, 'Başka bir konuda yardımcı olabilir miyim?', [
      { type: 'reply', reply: { id: 'menu_ust', title: 'Üst Menü ⬆️' } },
      { type: 'reply', reply: { id: 'menu_ana', title: 'Ana Menü 🏠' } },
    ]);
    updateSession(from, { currentMenu: 'magaza_menu' });
    return;
  }

  if (menuState === 'magaza_sorgula_input') {
    if (!input || input.trim() === '') {
      await whatsappApi.sendText(from, '❌ Lütfen bir il adı yazınız. (Örnek: İstanbul)');
      return;
    }

    try {
      const magazalar = await getMagazalar();
      const searchTerm = input.toLowerCase().replace(/i̇/g, 'i');

      const filteredMagazalar = magazalar.filter(m =>
        m.aktif && (
          m.il.toLowerCase().replace(/i̇/g, 'i').includes(searchTerm) ||
          m.ilce.toLowerCase().replace(/i̇/g, 'i').includes(searchTerm) ||
          m.ad.toLowerCase().replace(/i̇/g, 'i').includes(searchTerm)
        )
      );

      if (filteredMagazalar.length === 0) {
        await whatsappApi.sendText(from,
          `❌ "${input}" bölgesinde uygulama merkezi bulunamadı.\n\n` +
          `Tüm merkezlerimizi görmek için "Uygulama Merkezleri" seçeneğini kullanabilirsiniz.`
        );
      } else {
        let text = `📍 *"${input}" bölgesinde ${filteredMagazalar.length} merkez bulundu:*\n`;

        for (const magaza of filteredMagazalar.slice(0, 5)) {
          text += `\n━━━━━━━━━━━━━━━\n`;
          text += `📍 *${magaza.ad}*\n`;
          if (magaza.il) text += `🏙 ${magaza.il}${magaza.ilce ? ` / ${magaza.ilce}` : ''}\n`;
          if (magaza.adres) text += `📮 ${magaza.adres}\n`;
          if (magaza.telefon) text += `📞 ${magaza.telefon}\n`;
          if (magaza.calismaSaatleri) text += `🕐 ${magaza.calismaSaatleri}\n`;
          if (magaza.latitude && magaza.longitude) {
            text += `🗺 https://maps.google.com/?q=${magaza.latitude},${magaza.longitude}\n`;
          }
        }

        await whatsappApi.sendText(from, text);
      }
    } catch (error: any) {
      logger.error('Magaza search error', { from, input, error: error.message });
      await whatsappApi.sendText(from, '❌ Mağaza araması sırasında bir hata oluştu.');
    }

    await whatsappApi.sendButtons(from, 'Başka bir konuda yardımcı olabilir miyim?', [
      { type: 'reply', reply: { id: 'menu_ust', title: 'Üst Menü ⬆️' } },
      { type: 'reply', reply: { id: 'menu_ana', title: 'Ana Menü 🏠' } },
    ]);
    updateSession(from, { currentMenu: 'magaza_menu' });
  }
}
