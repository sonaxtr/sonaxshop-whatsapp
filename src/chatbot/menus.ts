import { ListSection, ReplyButton } from '../whatsapp/types';

/**
 * AVVA tarzı menü tanımları
 * Her menü: list message veya button message olarak gönderilir
 */

// ============================
// ANA MENÜ — Kanal Seçimi
// ============================
export const WELCOME_TEXT =
  `Merhaba, Sonax Türkiye'ye hoş geldiniz. 😊 Dijital asistanınız olarak, size ben yardımcı olacağım. ` +
  `Güvenliğiniz için görüşmelerinizin kayıt altına alındığını hatırlatmak isteriz. ` +
  `Kişisel verilerinizin korunması kapsamında KVKK aydınlatma metnimizi linke tıklayarak okuyabilirsiniz. ` +
  `https://www.sonaxshop.com.tr/kisisel-verilerin-korunmasi-kvkk`;

export const CHANNEL_SELECT_TEXT =
  `Size destek olabilmem için yardım almak istediğiniz alışveriş kanalını seçiniz. 👇`;

export const CHANNEL_BUTTONS: ReplyButton[] = [
  { type: 'reply', reply: { id: 'channel_online', title: 'Online' } },
  { type: 'reply', reply: { id: 'channel_magaza', title: 'Mağaza' } },
];

// ============================
// ONLINE MENÜ
// ============================
export const ONLINE_MENU_TEXT =
  `Online alışveriş desteği için aşağıdaki konulardan birini seçiniz:`;

export const ONLINE_MENU_SECTIONS: ListSection[] = [
  {
    title: 'Destek Konuları',
    rows: [
      { id: 'menu_siparis', title: 'Sipariş Hakkında', description: 'Sipariş sorgulama ve takip' },
      { id: 'menu_iade', title: 'İade ve Değişim', description: 'İade süreci bilgilendirme' },
      { id: 'menu_urun', title: 'Ürün Bilgisi', description: 'Ürün arama, stok ve fiyat' },
      { id: 'menu_kategori', title: 'Kategoriler', description: 'Kategorilere göre ürün gezinme' },
      { id: 'menu_kampanya', title: 'Kampanyalar', description: 'Güncel kampanyalar ve hediye çeki' },
      { id: 'menu_odeme', title: 'Ödeme ve Taksitlendirme', description: 'Ödeme yöntemleri ve IBAN' },
      { id: 'menu_uyelik', title: 'Üyelik', description: 'Üyelik bilgileri' },
      { id: 'menu_diger', title: 'Diğer', description: 'Temsilciye bağlanma' },
      { id: 'menu_ana', title: 'Ana Menüye Dön 🏠', description: 'Kanal seçimine geri dön' },
    ],
  },
];

// ============================
// SİPARİŞ ALT MENÜ
// ============================
export const SIPARIS_MENU_TEXT = `Sipariş hakkında ne yapmak istiyorsunuz?`;

export const SIPARIS_MENU_SECTIONS: ListSection[] = [
  {
    title: 'Sipariş İşlemleri',
    rows: [
      { id: 'siparis_sorgula', title: 'Sipariş Sorgulama', description: 'Sipariş numarası ile sorgulama' },
      { id: 'siparis_kargo', title: 'Kargo Takibi', description: 'Kargo durumu öğrenme' },
      { id: 'siparis_adres', title: 'Adres Değişikliği', description: 'Sipariş adres güncelleme' },
      { id: 'siparis_iptal', title: 'Sipariş İptali', description: 'Sipariş iptal talebi' },
      { id: 'menu_ust', title: 'Üst Menüye Dön ⬆️', description: 'Online menüye geri dön' },
      { id: 'menu_ana', title: 'Ana Menüye Dön 🏠', description: 'Kanal seçimine geri dön' },
    ],
  },
];

// ============================
// İADE ALT MENÜ
// ============================
export const IADE_MENU_TEXT = `İade ve değişim hakkında bilgi almak için seçiniz:`;

export const IADE_MENU_SECTIONS: ListSection[] = [
  {
    title: 'İade İşlemleri',
    rows: [
      { id: 'iade_surec', title: 'İade Süreci', description: 'İade nasıl yapılır?' },
      { id: 'iade_inceleme', title: 'İnceleme Süreci', description: 'İade inceleme durumu' },
      { id: 'menu_ust', title: 'Üst Menüye Dön ⬆️', description: 'Online menüye geri dön' },
      { id: 'menu_ana', title: 'Ana Menüye Dön 🏠', description: 'Kanal seçimine geri dön' },
    ],
  },
];

// ============================
// ÜRÜN ALT MENÜ
// ============================
export const URUN_MENU_TEXT = `Ürün bilgisi için seçiniz:`;

export const URUN_MENU_SECTIONS: ListSection[] = [
  {
    title: 'Ürün İşlemleri',
    rows: [
      { id: 'urun_arama', title: 'Ürün Arama', description: 'İsim veya barkod ile arama' },
      { id: 'urun_stok', title: 'Stok Sorgulama', description: 'Ürün stok durumu' },
      { id: 'menu_ust', title: 'Üst Menüye Dön ⬆️', description: 'Online menüye geri dön' },
      { id: 'menu_ana', title: 'Ana Menüye Dön 🏠', description: 'Kanal seçimine geri dön' },
    ],
  },
];

// ============================
// KAMPANYA ALT MENÜ
// ============================
export const KAMPANYA_MENU_TEXT = `Kampanyalar hakkında seçiniz:`;

export const KAMPANYA_MENU_SECTIONS: ListSection[] = [
  {
    title: 'Kampanya İşlemleri',
    rows: [
      { id: 'kampanya_guncel', title: 'Güncel Kampanyalar', description: 'Aktif kampanyaları gör' },
      { id: 'kampanya_hediye', title: 'Hediye Çeki Sorgula', description: 'Hediye çeki kodu ile sorgulama' },
      { id: 'menu_ust', title: 'Üst Menüye Dön ⬆️', description: 'Online menüye geri dön' },
      { id: 'menu_ana', title: 'Ana Menüye Dön 🏠', description: 'Kanal seçimine geri dön' },
    ],
  },
];

// ============================
// ÖDEME ALT MENÜ
// ============================
export const ODEME_MENU_TEXT = `Ödeme hakkında seçiniz:`;

export const ODEME_MENU_SECTIONS: ListSection[] = [
  {
    title: 'Ödeme Bilgileri',
    rows: [
      { id: 'odeme_yontem', title: 'Ödeme Yöntemleri', description: 'Kabul edilen ödeme tipleri' },
      { id: 'odeme_iban', title: 'Havale/EFT Bilgileri', description: 'IBAN ve hesap bilgileri' },
      { id: 'menu_ust', title: 'Üst Menüye Dön ⬆️', description: 'Online menüye geri dön' },
      { id: 'menu_ana', title: 'Ana Menüye Dön 🏠', description: 'Kanal seçimine geri dön' },
    ],
  },
];

// ============================
// MAĞAZA MENÜ
// ============================
export const MAGAZA_MENU_TEXT =
  `Mağaza desteği için aşağıdaki konulardan birini seçiniz:`;

export const MAGAZA_MENU_SECTIONS: ListSection[] = [
  {
    title: 'Mağaza İşlemleri',
    rows: [
      { id: 'magaza_listesi', title: 'Uygulama Merkezleri', description: 'Tüm uygulama merkezlerimiz' },
      { id: 'magaza_sorgula', title: 'Mağaza Sorgulama', description: 'İl bazlı mağaza arama' },
      { id: 'magaza_temsilci', title: 'Temsilciye Bağlan', description: 'Canlı destek' },
      { id: 'menu_ana', title: 'Ana Menüye Dön 🏠', description: 'Kanal seçimine geri dön' },
    ],
  },
];

// ============================
// SABİT METİNLER
// ============================
export const IADE_SUREC_TEXT =
  `📦 *İade Süreci*\n\n` +
  `1. sonaxshop.com.tr adresinden üye girişi yapın\n` +
  `2. Hesabım > Siparişlerim bölümüne gidin\n` +
  `3. İade etmek istediğiniz siparişin yanındaki "İade Talebi" butonuna tıklayın\n` +
  `4. İade nedenini seçin ve onaylayın\n` +
  `5. Kargo kodunuz tarafınıza iletilecektir\n\n` +
  `⏱ İade süresi: Ürün teslim tarihinden itibaren 14 gün\n` +
  `📞 Detaylı bilgi için: 0850 307 7930`;

export const ODEME_YONTEM_TEXT =
  `💳 *Ödeme Yöntemleri*\n\n` +
  `✅ Kredi Kartı (Tüm bankalar)\n` +
  `✅ Banka Kartı (Debit)\n` +
  `✅ Havale / EFT\n\n` +
  `Taksit seçenekleri ödeme sayfasında gösterilmektedir.`;

export const ODEME_IBAN_TEXT =
  `🏦 *Havale / EFT Bilgileri*\n\n` +
  `*Banka:* Garanti BBVA\n` +
  `*Hesap Sahibi:* Auton Otomotiv San. ve Tic. A.Ş.\n` +
  `*IBAN:* TR95 0006 2000 4760 0006 2987 21\n\n` +
  `⚠️ Havale açıklamasına sipariş numaranızı yazmayı unutmayın.`;

export const TEMSILCI_TEXT =
  `👤 *Temsilciye Bağlanma*\n\n` +
  `Bir temsilcimiz en kısa sürede size dönüş yapacaktır.\n\n` +
  `📞 Telefon: 0850 307 7930\n` +
  `📧 E-posta: info@sonaxshop.com.tr\n` +
  `🕐 Çalışma Saatleri: Hafta içi 09:00 - 18:00`;

export const ADRES_DEGISIKLIGI_TEXT =
  `📍 *Adres Değişikliği*\n\n` +
  `Siparişiniz "Siparişiniz Alındı" veya "Hazırlanıyor" durumundaysa:\n` +
  `1. sonaxshop.com.tr'den üye girişi yapın\n` +
  `2. Hesabım > Siparişlerim bölümüne gidin\n` +
  `3. İlgili siparişte fatura adresi değişikliği yapabilirsiniz\n\n` +
  `⚠️ Kargoya verilen siparişlerde adres değişikliği yapılamaz.`;

export const SIPARIS_IPTAL_TEXT =
  `❌ *Sipariş İptali*\n\n` +
  `Siparişiniz henüz kargoya verilmediyse iptal talebinde bulunabilirsiniz.\n\n` +
  `📞 İptal için lütfen bizi arayın: 0850 307 7930\n` +
  `📧 Veya e-posta gönderin: info@sonaxshop.com.tr\n\n` +
  `⚠️ Kargoya verilen siparişler iptal edilemez, iade süreci başlatılması gerekmektedir.`;
