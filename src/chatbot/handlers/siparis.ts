import { whatsappApi } from '../../whatsapp/api';
import { soapClient } from '../../ticimax/soap-client';
import { xmlParser } from '../../ticimax/xml-parser';
import { updateSession } from '../session';
import { logger } from '../../utils/logger';

export async function handleSiparisAction(from: string, input: string, menuState: string): Promise<void> {
  if (!input || input.trim() === '') {
    await whatsappApi.sendText(from, '❌ Lütfen sipariş numaranızı yazınız.');
    return;
  }

  try {
    // Try to parse as order ID
    const siparisId = parseInt(input);

    await whatsappApi.sendText(from, '🔍 Sipariş sorgulanıyor...');

    const xml = await soapClient.selectSiparis(
      !isNaN(siparisId) ? siparisId : undefined,
      isNaN(siparisId) ? input : undefined
    );

    const siparisler = await xmlParser.parseSiparisler(xml);

    if (siparisler.length === 0) {
      await whatsappApi.sendText(from,
        `❌ "${input}" ile eşleşen sipariş bulunamadı.\n\n` +
        `Lütfen sipariş numaranızı kontrol edip tekrar deneyin veya 0850 307 7930'u arayın.`
      );
    } else {
      for (const siparis of siparisler.slice(0, 3)) {
        let text = `📦 *Sipariş #${siparis.siparisNo}*\n\n`;
        text += `📅 Tarih: ${formatDate(siparis.tarih)}\n`;
        text += `📊 Durum: ${siparis.durum}\n`;
        text += `💰 Tutar: ${siparis.toplamTutar.toFixed(2)} TL\n`;

        if (menuState === 'siparis_kargo_input' && siparis.kargoTakipNo) {
          text += `\n🚚 *Kargo Bilgisi*\n`;
          text += `Firma: ${siparis.kargoFirma}\n`;
          text += `Takip No: ${siparis.kargoTakipNo}\n`;
          if (siparis.kargoTakipUrl) {
            text += `🔗 Takip: ${siparis.kargoTakipUrl}\n`;
          }
        } else if (menuState === 'siparis_kargo_input' && !siparis.kargoTakipNo) {
          text += `\n🚚 Kargo bilgisi henüz mevcut değil. Sipariş durumu: ${siparis.durum}`;
        }

        await whatsappApi.sendText(from, text);
      }
    }
  } catch (error: any) {
    logger.error('Siparis query error', { from, input, error: error.message });
    await whatsappApi.sendText(from,
      '❌ Sipariş sorgulanırken bir hata oluştu. Lütfen daha sonra tekrar deneyin veya 0850 307 7930\'u arayın.'
    );
  }

  // Show back buttons
  await whatsappApi.sendButtons(from, 'Başka bir konuda yardımcı olabilir miyim?', [
    { type: 'reply', reply: { id: 'menu_ust', title: 'Üst Menü ⬆️' } },
    { type: 'reply', reply: { id: 'menu_ana', title: 'Ana Menü 🏠' } },
  ]);
  updateSession(from, { currentMenu: 'online_menu' });
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return dateStr;
  }
}
