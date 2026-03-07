import { whatsappApi } from '../../whatsapp/api';
import { soapClient } from '../../ticimax/soap-client';
import { xmlParser } from '../../ticimax/xml-parser';
import { getSession, updateSession } from '../session';
import { logger } from '../../utils/logger';
import { ListSection } from '../../whatsapp/types';

export async function handleKategoriAction(from: string, input: string, menuState: string): Promise<void> {
  try {
    if (menuState === 'kategori_menu') {
      if (input === 'root') {
        // Show top-level categories
        await showKategoriler(from, 0);
      } else if (input === 'kategori_geri') {
        // Go back to parent category
        const session = getSession(from);
        const parentId = session?.data?.parentKategoriId || 0;
        await showKategoriler(from, parentId);
      } else if (input.startsWith('kat_')) {
        // Category selected - show sub-categories or products
        const kategoriId = parseInt(input.replace('kat_', ''));
        if (isNaN(kategoriId)) return;

        // Check for sub-categories
        const subXml = await soapClient.selectKategoriler(kategoriId);
        const subKategoriler = await xmlParser.parseKategoriler(subXml);

        if (subKategoriler.length > 0) {
          // Has sub-categories, show them
          const session = getSession(from);
          updateSession(from, {
            data: {
              ...session?.data,
              parentKategoriId: session?.data?.currentKategoriId || 0,
              currentKategoriId: kategoriId,
            },
          });
          await showKategoriler(from, kategoriId);
        } else {
          // No sub-categories, show products
          updateSession(from, {
            currentMenu: 'kategori_urunler',
            data: {
              ...getSession(from)?.data,
              currentKategoriId: kategoriId,
            },
          });
          await showKategoriUrunler(from, kategoriId);
        }
      } else {
        await showKategoriler(from, 0);
      }
    } else if (menuState === 'kategori_urunler') {
      // Handle product selection or navigation in category products view
      if (input === 'kategori_geri') {
        const session = getSession(from);
        const parentId = session?.data?.parentKategoriId || 0;
        await showKategoriler(from, parentId);
      } else {
        // Treat as new category browse from root
        await showKategoriler(from, 0);
      }
    }
  } catch (error: any) {
    logger.error('Kategori action error', { from, input, error: error.message });
    await whatsappApi.sendText(from, '❌ Kategori bilgisi alınırken hata oluştu. Lütfen tekrar deneyin.');
    await showBackButtons(from);
  }
}

async function showKategoriler(from: string, ustKategoriId: number): Promise<void> {
  await whatsappApi.sendText(from, '📂 Kategoriler yükleniyor...');

  const xml = await soapClient.selectKategoriler(ustKategoriId);
  const kategoriler = await xmlParser.parseKategoriler(xml);

  if (kategoriler.length === 0) {
    await whatsappApi.sendText(from, 'Bu kategoride alt kategori bulunmamaktadır.');
    await showBackButtons(from);
    return;
  }

  // WhatsApp list max 10 rows per section
  const rows = kategoriler.slice(0, 10).map((k) => ({
    id: `kat_${k.id}`,
    title: k.kategoriAdi.substring(0, 24),
    description: k.url ? `sonaxshop.com.tr${k.url}` : '',
  }));

  // Add navigation rows
  if (ustKategoriId > 0) {
    rows.push({ id: 'kategori_geri', title: '⬅️ Geri Dön', description: 'Üst kategoriye dön' });
  }
  rows.push({ id: 'menu_ust', title: 'Üst Menü ⬆️', description: 'Online menüye dön' });
  rows.push({ id: 'menu_ana', title: 'Ana Menü 🏠', description: 'Ana menüye dön' });

  const sections: ListSection[] = [
    {
      title: 'Kategoriler',
      rows,
    },
  ];

  await whatsappApi.sendList(
    from,
    ustKategoriId === 0
      ? 'Ürün kategorilerinden birini seçiniz:'
      : 'Alt kategorilerden birini seçiniz:',
    'Kategoriler',
    sections,
    '📂 Kategoriler'
  );

  updateSession(from, {
    currentMenu: 'kategori_menu',
    data: {
      ...getSession(from)?.data,
      currentKategoriId: ustKategoriId,
    },
  });
}

async function showKategoriUrunler(from: string, kategoriId: number): Promise<void> {
  await whatsappApi.sendText(from, '🔍 Ürünler yükleniyor...');

  const xml = await soapClient.selectUrunlerByKategori(kategoriId);
  const urunler = await xmlParser.parseUrunler(xml);

  if (urunler.length === 0) {
    await whatsappApi.sendText(from, 'Bu kategoride ürün bulunmamaktadır.');
  } else {
    let text = `🛒 *${urunler.length} ürün bulundu:*\n`;

    for (const urun of urunler.slice(0, 5)) {
      text += `\n━━━━━━━━━━━━━━━\n`;
      text += `📦 *${urun.urunAdi}*\n`;
      text += `💰 Fiyat: ${urun.fiyat.toFixed(2)} TL\n`;
      text += `📊 Stok: ${urun.stokAdedi > 0 ? `✅ ${urun.stokAdedi} adet` : '❌ Tükendi'}\n`;
      if (urun.url) text += `🔗 https://sonaxshop.com.tr${urun.url}\n`;
    }

    if (urunler.length > 5) {
      text += `\n\n📌 Daha fazlası için sonaxshop.com.tr'yi ziyaret edin.`;
    }

    await whatsappApi.sendText(from, text);
  }

  await showBackButtons(from);
}

async function showBackButtons(from: string): Promise<void> {
  await whatsappApi.sendButtons(from, 'Başka bir konuda yardımcı olabilir miyim?', [
    { type: 'reply', reply: { id: 'menu_ust', title: 'Üst Menü ⬆️' } },
    { type: 'reply', reply: { id: 'menu_ana', title: 'Ana Menü 🏠' } },
  ]);
  updateSession(from, { currentMenu: 'online_menu' });
}
