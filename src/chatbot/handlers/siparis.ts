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
    await whatsappApi.sendText(from, '🔍 Sipariş sorgulanıyor...');

    // Search by SiparisKodu (alphanumeric order number like "247KD2449V")
    const xml = await soapClient.selectSiparis(input.trim());
    const siparisler = await xmlParser.parseSiparisler(xml);

    if (siparisler.length === 0) {
      await whatsappApi.sendText(from,
        `❌ "${input}" ile eşleşen sipariş bulunamadı.\n\n` +
        `Lütfen sipariş numaranızı kontrol edip tekrar deneyin.`
      );
    } else {
      for (const siparis of siparisler.slice(0, 3)) {
        let text = `📦 *Sipariş #${siparis.siparisNo}*\n\n`;
        text += `📅 Tarih: ${formatDate(siparis.tarih)}\n`;
        text += `📊 Durum: ${siparis.durum}\n`;
        text += `💰 Tutar: ${siparis.toplamTutar.toFixed(2)} TL\n`;

        if (siparis.kargoTakipNo) {
          text += `\n🚚 *Kargo Bilgisi*\n`;
          text += `Firma: ${siparis.kargoFirma}\n`;
          text += `Takip No: ${siparis.kargoTakipNo}\n`;
          if (siparis.kargoTakipUrl) {
            text += `🔗 Takip: ${siparis.kargoTakipUrl}\n`;
          }
        }

        await whatsappApi.sendText(from, text);
      }
    }
  } catch (error: any) {
    logger.error('Siparis query error', { from, input, error: error.message });
    await whatsappApi.sendText(from,
      '❌ Sipariş sorgulanırken bir hata oluştu. Lütfen daha sonra tekrar deneyin.'
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
