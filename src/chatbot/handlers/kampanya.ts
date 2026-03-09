import { whatsappApi } from '../../whatsapp/api';
import { soapClient } from '../../ticimax/soap-client';
import { xmlParser } from '../../ticimax/xml-parser';
import { updateSession } from '../session';
import { logger } from '../../utils/logger';

export async function handleKampanyaAction(from: string, input: string, menuState: string): Promise<void> {
  if (menuState === 'kampanya_guncel') {
    // Show current campaigns info
    await whatsappApi.sendText(from,
      `🎁 *Güncel Kampanyalar*\n\n` +
      `Güncel kampanyalarımız için:\n` +
      `🔗 https://sonax.com.tr/kampanyalar`
    );

    await whatsappApi.sendCTAUrl(
      from,
      'Instagram\'dan da takip edebilirsiniz:',
      '📸 Instagram\'da Takip Et',
      'https://www.instagram.com/sonaxturkiye'
    );

    await whatsappApi.sendButtons(from, 'Başka bir konuda yardımcı olabilir miyim?', [
      { type: 'reply', reply: { id: 'menu_ust', title: 'Üst Menü ⬆️' } },
      { type: 'reply', reply: { id: 'menu_ana', title: 'Ana Menü 🏠' } },
    ]);
    updateSession(from, { currentMenu: 'online_menu' });
    return;
  }

  if (menuState === 'kampanya_hediye_input') {
    if (!input || input.trim() === '') {
      await whatsappApi.sendText(from, '❌ Lütfen hediye çeki kodunuzu yazınız.');
      return;
    }

    try {
      await whatsappApi.sendText(from, '🔍 Hediye çeki sorgulanıyor...');

      const xml = await soapClient.selectHediyeCeki(input.trim().toUpperCase());
      const hediyeCeki = await xmlParser.parseHediyeCeki(xml);

      if (!hediyeCeki) {
        await whatsappApi.sendText(from,
          `❌ "${input}" kodlu hediye çeki bulunamadı.\n\n` +
          `Lütfen kodunuzu kontrol edip tekrar deneyin.`
        );
      } else {
        let text = `🎁 *Hediye Çeki Bilgisi*\n\n`;
        text += `🏷 Kod: ${hediyeCeki.code}\n`;
        text += `💰 Değer: ${hediyeCeki.discountValue} ${hediyeCeki.discountType === 'Percentage' ? '%' : 'TL'}\n`;
        text += `📊 Durum: ${hediyeCeki.isActive ? '✅ Aktif' : '❌ Pasif'}\n`;

        if (hediyeCeki.minOrderAmount > 0) {
          text += `🛒 Min. Sipariş: ${hediyeCeki.minOrderAmount.toFixed(2)} TL\n`;
        }
        if (hediyeCeki.endDate) {
          text += `📅 Son Kullanım: ${formatDate(hediyeCeki.endDate)}\n`;
        }
        text += `🔢 Kullanım: ${hediyeCeki.usageCount}/${hediyeCeki.maxUsageCount || '∞'}`;

        await whatsappApi.sendText(from, text);
      }
    } catch (error: any) {
      logger.error('Hediye ceki query error', { from, input, error: error.message });
      await whatsappApi.sendText(from, '❌ Hediye çeki sorgulanırken bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
    }

    await whatsappApi.sendButtons(from, 'Başka bir konuda yardımcı olabilir miyim?', [
      { type: 'reply', reply: { id: 'menu_ust', title: 'Üst Menü ⬆️' } },
      { type: 'reply', reply: { id: 'menu_ana', title: 'Ana Menü 🏠' } },
    ]);
    updateSession(from, { currentMenu: 'online_menu' });
  }
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return dateStr;
  }
}
