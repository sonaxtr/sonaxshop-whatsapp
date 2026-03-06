import axios from 'axios';
import { whatsappApi } from '../../whatsapp/api';
import { updateSession } from '../session';
import { logger } from '../../utils/logger';

interface MagazaInfo {
  id: number;
  ad: string;
  adres: string;
  telefon: string;
  il: string;
  ilce: string;
  latitude: string;
  longitude: string;
  aktif: boolean;
}

// Cache for store data (refreshed every hour)
let magazaCache: MagazaInfo[] = [];
let cacheTime = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

/**
 * Fetch stores from sonaxshop.com.tr REST API
 * (SOAP GetMagazalar does NOT exist in Ticimax CustomServis WSDL)
 */
async function getMagazalar(): Promise<MagazaInfo[]> {
  if (magazaCache.length > 0 && Date.now() - cacheTime < CACHE_DURATION) {
    return magazaCache;
  }

  try {
    const response = await axios.get(
      'https://sonaxshop.com.tr/api/Store/GetStoriesLite',
      {
        params: {
          CountryID: -1,
          CityID: null,
          PageNo: 1,
          PageSize: 150,
        },
        timeout: 15000,
      }
    );

    const data = response.data;

    if (data.isError || !data.magazalar) {
      logger.error('GetStoriesLite error response', { errorMessage: data.errorMessage });
      return magazaCache;
    }

    magazaCache = data.magazalar.map((m: any) => ({
      id: m.id || 0,
      ad: m.tanim || '',
      adres: m.adres || '',
      telefon: m.telefon || '',
      il: m.il || '',
      ilce: m.ilce || '',
      latitude: m.latitude || '',
      longitude: m.longitude || '',
      aktif: m.aktif === true,
    }));

    cacheTime = Date.now();
    logger.info('Magazalar cache refreshed (REST API)', { count: magazaCache.length });
    return magazaCache;
  } catch (error: any) {
    logger.error('GetStoriesLite error', { error: error.message });
    return magazaCache; // Return stale cache on error
  }
}

/**
 * Normalize Turkish characters for case-insensitive search
 */
function normalizeTurkish(text: string): string {
  return text
    .toLowerCase()
    .replace(/i̇/g, 'i')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g');
}

export async function handleMagazaAction(from: string, input: string, menuState: string): Promise<void> {
  if (menuState === 'magaza_listesi') {
    // Show all stores
    try {
      await whatsappApi.sendText(from, '🔍 Uygulama merkezleri yükleniyor...');

      const magazalar = await getMagazalar();
      const aktivMagazalar = magazalar.filter(m => m.aktif);

      if (aktivMagazalar.length === 0) {
        await whatsappApi.sendText(from,
          `🏪 *Uygulama Merkezleri*\n\n` +
          `Uygulama merkezleri bilgisi şu an için mevcut değil.\n\n` +
          `📞 Bilgi için: 0850 307 7930\n` +
          `🔗 https://sonaxshop.com.tr/magazalarimiz`
        );
      } else {
        // Send stores in batches to avoid WhatsApp message size limits
        const batchSize = 5;
        const batches = [];
        for (let i = 0; i < aktivMagazalar.length; i += batchSize) {
          batches.push(aktivMagazalar.slice(i, i + batchSize));
        }

        // First message with count
        let firstText = `🏪 *Uygulama Merkezlerimiz (${aktivMagazalar.length} adet)*\n`;
        for (const magaza of batches[0]) {
          firstText += `\n━━━━━━━━━━━━━━━\n`;
          firstText += formatMagaza(magaza);
        }
        await whatsappApi.sendText(from, firstText);

        // Remaining batches
        for (let i = 1; i < batches.length; i++) {
          let text = '';
          for (const magaza of batches[i]) {
            text += `━━━━━━━━━━━━━━━\n`;
            text += formatMagaza(magaza);
          }
          await whatsappApi.sendText(from, text.trim());
        }
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
      const searchTerm = normalizeTurkish(input.trim());

      const filteredMagazalar = magazalar.filter(m =>
        m.aktif && (
          normalizeTurkish(m.il).includes(searchTerm) ||
          normalizeTurkish(m.ilce).includes(searchTerm) ||
          normalizeTurkish(m.ad).includes(searchTerm) ||
          normalizeTurkish(m.adres).includes(searchTerm)
        )
      );

      if (filteredMagazalar.length === 0) {
        await whatsappApi.sendText(from,
          `❌ "${input}" bölgesinde uygulama merkezi bulunamadı.\n\n` +
          `Tüm merkezlerimizi görmek için "Uygulama Merkezleri" seçeneğini kullanabilirsiniz.`
        );
      } else {
        let text = `📍 *"${input}" bölgesinde ${filteredMagazalar.length} merkez bulundu:*\n`;

        for (const magaza of filteredMagazalar.slice(0, 10)) {
          text += `\n━━━━━━━━━━━━━━━\n`;
          text += formatMagaza(magaza);
        }

        if (filteredMagazalar.length > 10) {
          text += `\n... ve ${filteredMagazalar.length - 10} merkez daha.`;
          text += `\n🔗 https://sonaxshop.com.tr/magazalarimiz`;
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

function formatMagaza(magaza: MagazaInfo): string {
  let text = `📍 *${magaza.ad}*\n`;
  if (magaza.il) text += `🏙 ${magaza.il}${magaza.ilce ? ` / ${magaza.ilce}` : ''}\n`;
  if (magaza.adres) text += `📮 ${magaza.adres}\n`;
  if (magaza.telefon) text += `📞 ${magaza.telefon}\n`;
  if (magaza.latitude && magaza.longitude) {
    text += `🗺 https://maps.google.com/?q=${magaza.latitude},${magaza.longitude}\n`;
  }
  return text;
}
