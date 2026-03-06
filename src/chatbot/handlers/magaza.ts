import axios from 'axios';
import { whatsappApi } from '../../whatsapp/api';
import { updateSession } from '../session';
import { logger } from '../../utils/logger';
import { ListSection } from '../../whatsapp/types';

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
 */
async function getMagazalar(): Promise<MagazaInfo[]> {
  if (magazaCache.length > 0 && Date.now() - cacheTime < CACHE_DURATION) {
    return magazaCache;
  }

  try {
    logger.info('Fetching stores from REST API...');
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
    logger.info('REST API response', { isError: data.isError, count: data.magazalar?.length });

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
    logger.info('Magazalar cache refreshed', { count: magazaCache.length });
    return magazaCache;
  } catch (error: any) {
    logger.error('GetStoriesLite fetch error', { error: error.message, stack: error.stack });
    return magazaCache;
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

/**
 * Truncate string to max length
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 1) + '…';
}

/**
 * Build WhatsApp interactive list sections from stores.
 * Groups by city, max 10 rows per section, max 10 sections.
 */
function buildMagazaListSections(magazalar: MagazaInfo[]): ListSection[] {
  // Group by city
  const byCity = new Map<string, MagazaInfo[]>();
  for (const m of magazalar) {
    const city = m.il || 'Diğer';
    if (!byCity.has(city)) byCity.set(city, []);
    byCity.get(city)!.push(m);
  }

  // Sort cities alphabetically (Turkish locale)
  const sortedCities = [...byCity.keys()].sort((a, b) => a.localeCompare(b, 'tr'));

  const sections: ListSection[] = [];
  for (const city of sortedCities) {
    if (sections.length >= 10) break; // WhatsApp max 10 sections
    const stores = byCity.get(city)!;
    sections.push({
      title: city,
      rows: stores.slice(0, 10).map(m => ({
        id: `magaza_detay_${m.id}`,
        title: truncate(m.ad, 24),
        description: truncate(
          `${m.ilce}${m.telefon ? ' • ' + m.telefon : ''}`,
          72
        ),
      })),
    });
  }

  return sections;
}

/**
 * Format store detail message
 */
function formatMagazaDetay(m: MagazaInfo): string {
  let text = `📍 *${m.ad}*\n\n`;
  if (m.il) text += `🏙 *İl/İlçe:* ${m.il}${m.ilce ? ` / ${m.ilce}` : ''}\n`;
  if (m.adres) text += `📮 *Adres:* ${m.adres}\n`;
  if (m.telefon) text += `📞 *Telefon:* ${m.telefon}\n`;
  if (m.latitude && m.longitude) {
    text += `\n🗺 *Haritada Göster:*\nhttps://maps.google.com/?q=${m.latitude},${m.longitude}`;
  }
  return text;
}

async function showBackButtons(from: string): Promise<void> {
  await whatsappApi.sendButtons(from, 'Başka bir konuda yardımcı olabilir miyim?', [
    { type: 'reply', reply: { id: 'menu_ust', title: 'Üst Menü ⬆️' } },
    { type: 'reply', reply: { id: 'menu_ana', title: 'Ana Menü 🏠' } },
  ]);
}

export async function handleMagazaAction(from: string, input: string, menuState: string): Promise<void> {

  // ================================
  // ALL STORES — Interactive list
  // ================================
  if (menuState === 'magaza_listesi') {
    try {
      const magazalar = await getMagazalar();
      const aktivMagazalar = magazalar.filter(m => m.aktif);

      logger.info('Magaza listesi', { total: magazalar.length, aktif: aktivMagazalar.length });

      if (aktivMagazalar.length === 0) {
        await whatsappApi.sendText(from,
          '🏪 *Uygulama Merkezleri*\n\n' +
          'Uygulama merkezleri bilgisi şu an için mevcut değil.\n\n' +
          '📞 Bilgi için: 0850 307 7930\n' +
          '🔗 https://sonaxshop.com.tr/magazalarimiz'
        );
        await showBackButtons(from);
        updateSession(from, { currentMenu: 'magaza_menu' });
        return;
      }

      const sections = buildMagazaListSections(aktivMagazalar);

      await whatsappApi.sendList(
        from,
        `${aktivMagazalar.length} uygulama merkezimiz bulunmaktadır.\nDetay görmek istediğiniz merkezi seçiniz:`,
        'Merkezleri Gör',
        sections,
        '🏪 Uygulama Merkezleri'
      );
      updateSession(from, { currentMenu: 'magaza_secim' });
    } catch (error: any) {
      logger.error('Magaza list error', { from, error: error.message });
      await whatsappApi.sendText(from, '❌ Mağaza bilgileri yüklenirken bir hata oluştu.');
      await showBackButtons(from);
      updateSession(from, { currentMenu: 'magaza_menu' });
    }
    return;
  }

  // ================================
  // SEARCH BY CITY — Interactive list
  // ================================
  if (menuState === 'magaza_sorgula_input') {
    if (!input || input.trim() === '') {
      await whatsappApi.sendText(from, '❌ Lütfen bir il adı yazınız. (Örnek: İstanbul)');
      return;
    }

    try {
      const magazalar = await getMagazalar();
      const searchTerm = normalizeTurkish(input.trim());

      logger.info('Magaza search', { searchTerm, totalStores: magazalar.length });

      const filtered = magazalar.filter(m =>
        m.aktif && (
          normalizeTurkish(m.il).includes(searchTerm) ||
          normalizeTurkish(m.ilce).includes(searchTerm) ||
          normalizeTurkish(m.ad).includes(searchTerm)
        )
      );

      logger.info('Magaza search results', { searchTerm, found: filtered.length });

      if (filtered.length === 0) {
        await whatsappApi.sendText(from,
          `❌ "${input}" bölgesinde uygulama merkezi bulunamadı.\n\n` +
          `Tüm merkezlerimizi görmek için Ana Menü > Mağaza > Uygulama Merkezleri seçeneğini kullanabilirsiniz.`
        );
        await showBackButtons(from);
        updateSession(from, { currentMenu: 'magaza_menu' });
        return;
      }

      const sections = buildMagazaListSections(filtered);

      await whatsappApi.sendList(
        from,
        `"${input}" bölgesinde ${filtered.length} merkez bulundu.\nDetay görmek istediğiniz merkezi seçiniz:`,
        'Merkezleri Gör',
        sections,
        `📍 ${input} Merkezleri`
      );
      updateSession(from, { currentMenu: 'magaza_secim' });
    } catch (error: any) {
      logger.error('Magaza search error', { from, input, error: error.message });
      await whatsappApi.sendText(from, '❌ Mağaza araması sırasında bir hata oluştu.');
      await showBackButtons(from);
      updateSession(from, { currentMenu: 'magaza_menu' });
    }
    return;
  }

  // ================================
  // STORE SELECTED — Show details
  // ================================
  if (menuState === 'magaza_secim') {
    const match = input.match(/^magaza_detay_(\d+)$/);
    if (!match) {
      // Not a store selection — go back to magaza menu
      await showBackButtons(from);
      updateSession(from, { currentMenu: 'magaza_menu' });
      return;
    }

    const storeId = parseInt(match[1]);
    try {
      const magazalar = await getMagazalar();
      const store = magazalar.find(m => m.id === storeId);

      if (!store) {
        await whatsappApi.sendText(from, '❌ Mağaza bilgisi bulunamadı.');
      } else {
        await whatsappApi.sendText(from, formatMagazaDetay(store));
      }
    } catch (error: any) {
      logger.error('Magaza detail error', { from, storeId, error: error.message });
      await whatsappApi.sendText(from, '❌ Mağaza bilgisi yüklenirken bir hata oluştu.');
    }

    await showBackButtons(from);
    updateSession(from, { currentMenu: 'magaza_menu' });
    return;
  }
}
