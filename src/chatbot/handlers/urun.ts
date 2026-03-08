import { whatsappApi } from '../../whatsapp/api';
import { soapClient } from '../../ticimax/soap-client';
import { xmlParser } from '../../ticimax/xml-parser';
import { productCache } from '../../ticimax/product-cache';
import { updateSession } from '../session';
import { logger } from '../../utils/logger';
import { UrunResult } from '../../ticimax/xml-parser';

export async function handleUrunAction(from: string, input: string, menuState: string): Promise<void> {
  if (!input || input.trim() === '') {
    await whatsappApi.sendText(from, '❌ Lütfen ürün adı, barkod veya stok kodu yazınız.');
    return;
  }

  try {
    await whatsappApi.sendText(from, '🔍 Ürün aranıyor...');

    let urunler: UrunResult[] = [];
    const query = input.trim();

    if (productCache.isCodeQuery(query)) {
      // Looks like a barcode or stock code — try exact SOAP search
      try {
        const xml = await soapClient.selectUrunByBarkod(query);
        urunler = await xmlParser.parseUrunler(xml);
      } catch (err: any) {
        logger.warn('Barcode search failed', { input, error: err.message });
      }

      if (urunler.length === 0) {
        try {
          const xml = await soapClient.selectUrunByStokKodu(query);
          urunler = await xmlParser.parseUrunler(xml);
        } catch (err: any) {
          logger.warn('Stock code search failed', { input, error: err.message });
        }
      }
    }

    // If code search didn't find anything (or query is text), try text search from cache
    if (urunler.length === 0) {
      urunler = await productCache.searchByText(query, 5);
    }

    if (urunler.length === 0) {
      await whatsappApi.sendText(from,
        `❌ "${input}" ile eşleşen ürün bulunamadı.\n\n` +
        `💡 Ürün adı, barkod veya stok kodu ile arama yapabilirsiniz.\n` +
        `📌 Örnek: "hızlı cila", "4064700207202", "101207200"`
      );
    } else {
      const results = urunler.slice(0, 5);
      let text = `🔍 *${results.length} ürün bulundu:*\n`;

      for (const urun of results) {
        text += `\n━━━━━━━━━━━━━━━\n`;
        text += `📦 *${urun.urunAdi}*\n`;
        text += `💰 Fiyat: ${urun.fiyat.toFixed(2)} TL\n`;
        text += `📊 Stok: ${urun.stokAdedi > 0 ? `✅ ${urun.stokAdedi} adet` : '❌ Tükendi'}\n`;
        if (urun.stokKodu) text += `🏷 Kod: ${urun.stokKodu}\n`;
        if (urun.barkod) text += `📋 Barkod: ${urun.barkod}\n`;
        if (urun.url) text += `🔗 https://sonaxshop.com.tr${urun.url}\n`;
      }

      if (urunler.length > 5) {
        text += `\n\n📌 Toplam ${urunler.length} ürün bulundu, ilk 5 tanesi gösteriliyor.`;
      }

      await whatsappApi.sendText(from, text);
    }
  } catch (error: any) {
    logger.error('Urun search error', { from, input, error: error.message });
    await whatsappApi.sendText(from,
      '❌ Ürün araması sırasında bir hata oluştu. Lütfen daha sonra tekrar deneyin.'
    );
  }

  // Show back buttons
  await whatsappApi.sendButtons(from, 'Başka bir konuda yardımcı olabilir miyim?', [
    { type: 'reply', reply: { id: 'menu_ust', title: 'Üst Menü ⬆️' } },
    { type: 'reply', reply: { id: 'menu_ana', title: 'Ana Menü 🏠' } },
  ]);
  updateSession(from, { currentMenu: 'online_menu' });
}
