import { whatsappApi } from '../../whatsapp/api';
import { productCache } from '../../ticimax/product-cache';
import { updateSession } from '../session';
import { logger } from '../../utils/logger';

export async function handleUrunAction(from: string, input: string, menuState: string): Promise<void> {
  if (!input || input.trim() === '') {
    await whatsappApi.sendText(from, '❌ Lütfen ürün adı, barkod veya stok kodu yazınız.');
    return;
  }

  try {
    await whatsappApi.sendText(from, '🔍 Ürün aranıyor...');

    // All searches go through cache (text search + code match)
    const urunler = await productCache.search(input.trim(), 5);

    if (urunler.length === 0) {
      await whatsappApi.sendText(from,
        `❌ "${input}" ile eşleşen ürün bulunamadı.\n\n` +
        `💡 Ürün adı, barkod veya stok kodu ile arama yapabilirsiniz.\n` +
        `📌 Örnek: "hızlı cila", "4064700207202", "101207200"`
      );
    } else {
      let text = `🔍 *${urunler.length} ürün bulundu:*\n`;

      for (const urun of urunler) {
        text += `\n━━━━━━━━━━━━━━━\n`;
        text += `📦 *${urun.urunAdi}*\n`;
        text += `💰 Fiyat: ${urun.fiyat.toFixed(2)} TL\n`;
        text += `📊 Stok: ${urun.stokAdedi > 0 ? `✅ ${urun.stokAdedi} adet` : '❌ Tükendi'}\n`;
        if (urun.stokKodu) text += `🏷 Kod: ${urun.stokKodu}\n`;
        if (urun.barkod) text += `📋 Barkod: ${urun.barkod}\n`;
        if (urun.url) text += `🔗 https://sonaxshop.com.tr${urun.url}\n`;
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
