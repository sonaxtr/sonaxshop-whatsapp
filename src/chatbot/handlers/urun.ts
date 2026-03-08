import { whatsappApi } from '../../whatsapp/api';
import { soapClient } from '../../ticimax/soap-client';
import { xmlParser } from '../../ticimax/xml-parser';
import { updateSession } from '../session';
import { logger } from '../../utils/logger';
import { UrunResult } from '../../ticimax/xml-parser';

export async function handleUrunAction(from: string, input: string, menuState: string): Promise<void> {
  if (!input || input.trim() === '') {
    await whatsappApi.sendText(from, '❌ Lütfen barkod veya stok kodu yazınız.');
    return;
  }

  try {
    await whatsappApi.sendText(from, '🔍 Ürün aranıyor...');

    let urunler: UrunResult[] = [];

    // Try barcode search first
    try {
      const xml = await soapClient.selectUrunByBarkod(input.trim());
      urunler = await xmlParser.parseUrunler(xml);
    } catch (err: any) {
      logger.warn('Barcode search failed', { input, error: err.message });
    }

    // If no results, try stock code search
    if (urunler.length === 0) {
      try {
        const xml = await soapClient.selectUrunByStokKodu(input.trim());
        urunler = await xmlParser.parseUrunler(xml);
      } catch (err: any) {
        logger.warn('Stock code search failed', { input, error: err.message });
      }
    }

    if (urunler.length === 0) {
      // No results — provide website search link
      const searchUrl = `https://sonaxshop.com.tr/Arama?q=${encodeURIComponent(input.trim())}`;
      await whatsappApi.sendText(from,
        `❌ "${input}" ile eşleşen ürün bulunamadı.\n\n` +
        `💡 Ürün adıyla arama yapmak için:\n🔗 ${searchUrl}\n\n` +
        `📌 Bu bot barkod veya stok kodu ile arama yapabilir.`
      );
    } else {
      // Show up to 5 results
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
        text += `\n\n📌 Toplam ${urunler.length} ürün bulundu. Daha fazlası için sonaxshop.com.tr'yi ziyaret edin.`;
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
