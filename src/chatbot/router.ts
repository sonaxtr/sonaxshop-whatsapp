import { WebhookMessage } from '../whatsapp/types';
import { whatsappApi } from '../whatsapp/api';
import { logger } from '../utils/logger';
import { getSession, createSession, updateSession } from './session';
import { soapClient } from '../ticimax/soap-client';
import { xmlParser } from '../ticimax/xml-parser';
import * as menus from './menus';
import { handleUrunAction } from './handlers/urun';
import { handleKampanyaAction } from './handlers/kampanya';
import { handleMagazaAction } from './handlers/magaza';
import { handleKategoriAction } from './handlers/kategori';
import { createConversation, forwardMessage, getConversationStatus, closeConversation } from './live-agent';

/**
 * Chatbot message router — State machine that manages menu navigation
 */
class ChatbotRouter {
  /**
   * Main entry point for all incoming messages
   */
  async handleMessage(from: string, name: string, message: WebhookMessage): Promise<void> {
    // Mark as read
    await whatsappApi.markAsRead(message.id);

    // Get or create session
    let session = getSession(from);
    if (!session) {
      session = createSession(from, name);
      // Look up member by phone number
      await this.lookupMember(from);
    }

    // Extract user input
    const input = this.extractInput(message);
    logger.info('Processing', { from, menu: session.currentMenu, input });

    // Check for global commands
    if (this.isResetCommand(input)) {
      // If in live_agent mode, notify dashboard
      if (session?.currentMenu === 'live_agent' && session?.data?.conversationId) {
        closeConversation(session.data.conversationId).catch(() => {});
      }
      // Preserve member data (uyeId, isim, soyisim, mail) across resets
      const memberData = {
        uyeId: session?.data?.uyeId,
        isim: session?.data?.isim,
        soyisim: session?.data?.soyisim,
        mail: session?.data?.mail,
      };
      updateSession(from, { currentMenu: 'welcome', data: memberData });
      await this.showWelcome(from);
      return;
    }

    // Route based on current menu state
    try {
      await this.route(from, name, session.currentMenu, input, message);
    } catch (error: any) {
      logger.error('Router error', { from, error: error.message });
      await whatsappApi.sendText(from, 'Bir hata oluştu. Lütfen tekrar deneyin veya "merhaba" yazın.');
    }
  }

  /**
   * Look up member by WhatsApp phone number and store in session
   */
  private async lookupMember(from: string): Promise<void> {
    try {
      const variants = this.getPhoneVariants(from);

      for (const phone of variants) {
        try {
          const xml = await soapClient.selectUyeler(phone);
          // Debug: log raw response snippet
          logger.info('SelectUyeler response', { phone, length: xml.length, snippet: xml.substring(0, 800) });
          const uyeler = await xmlParser.parseUyeler(xml);
          logger.info('SelectUyeler parsed', { phone, count: uyeler.length, uyeler: uyeler.slice(0, 2) });

          if (uyeler.length > 0) {
            const uye = uyeler[0];
            updateSession(from, {
              data: {
                uyeId: uye.id,
                isim: uye.isim,
                soyisim: uye.soyisim,
                mail: uye.mail,
              },
            });
            logger.info('Member found', { from, phone, uyeId: uye.id, isim: uye.isim });
            return;
          }
        } catch (err: any) {
          logger.warn('Member lookup attempt failed', { phone, error: err.message });
        }
      }

      logger.info('Member not found', { from });
    } catch (error: any) {
      logger.error('Member lookup error', { from, error: error.message });
    }
  }

  /**
   * Generate phone number variants for lookup
   * WhatsApp: 905321234567 -> try 05321234567, 5321234567, 905321234567
   */
  private getPhoneVariants(phone: string): string[] {
    const variants: string[] = [];
    const cleaned = phone.replace(/\D/g, '');

    if (cleaned.startsWith('90') && cleaned.length >= 12) {
      const local = cleaned.substring(2); // 5321234567
      variants.push(`0${local}`);  // 05321234567
      variants.push(local);        // 5321234567
      variants.push(cleaned);      // 905321234567
    } else {
      variants.push(cleaned);
      if (!cleaned.startsWith('0')) variants.push(`0${cleaned}`);
    }

    return variants;
  }

  /**
   * Extract text input from different message types
   */
  private extractInput(message: WebhookMessage): string {
    switch (message.type) {
      case 'text':
        return message.text?.body?.trim().toLowerCase() || '';
      case 'interactive':
        if (message.interactive?.type === 'button_reply') {
          return message.interactive.button_reply?.id || '';
        }
        if (message.interactive?.type === 'list_reply') {
          return message.interactive.list_reply?.id || '';
        }
        return '';
      case 'button':
        return message.button?.payload || '';
      default:
        return '';
    }
  }

  /**
   * Check if input is a reset/start command
   */
  private isResetCommand(input: string): boolean {
    const resetWords = ['merhaba', 'selam', 'hi', 'hello', 'başla', 'start', 'menu', 'menü', 'ana menü'];
    return resetWords.includes(input);
  }

  /**
   * Route to correct handler based on menu state
   */
  private async route(from: string, name: string, currentMenu: string, input: string, message: WebhookMessage): Promise<void> {
    // Handle navigation shortcuts
    if (input === 'menu_ana') {
      updateSession(from, { currentMenu: 'welcome' });
      await this.showWelcome(from);
      return;
    }
    if (input === 'menu_temsilci') {
      // Determine department from current menu context
      const sess = getSession(from);
      const magazaStates = ['magaza_menu', 'magaza_sorgula_input', 'magaza_konum_bekle', 'magaza_secim'];
      let dept = 'online';
      if (sess && magazaStates.includes(sess.currentMenu)) {
        dept = 'uygulama';
      }
      await this.startLiveAgent(from, name, dept);
      return;
    }
    if (input === 'menu_ust') {
      const magazaStates = ['magaza_menu', 'magaza_sorgula_input', 'magaza_konum_bekle', 'magaza_secim'];
      if (magazaStates.includes(currentMenu)) {
        await this.showMagazaMenu(from);
      } else {
        await this.showOnlineMenu(from);
      }
      return;
    }

    // Live agent mode — forward all messages to dashboard
    if (currentMenu === 'live_agent') {
      await this.handleLiveAgentMessage(from, name, input, message);
      return;
    }

    switch (currentMenu) {
      case 'welcome':
        await this.handleWelcome(from, name, input);
        break;

      case 'channel_select':
        await this.handleChannelSelect(from, name, input);
        break;

      case 'online_menu':
        await this.handleOnlineMenu(from, input);
        break;

      case 'siparis_menu':
        await this.handleSiparisMenu(from, input, message);
        break;

      case 'iade_menu':
        await this.handleIadeMenu(from, input);
        break;

      case 'urun_menu':
        await this.handleUrunMenu(from, input, message);
        break;

      case 'urun_arama_input':
        await handleUrunAction(from, input, 'urun_arama_input');
        break;

      case 'kampanya_menu':
        await this.handleKampanyaMenu(from, input, message);
        break;

      case 'kampanya_hediye_input':
        await handleKampanyaAction(from, input, 'kampanya_hediye_input');
        break;

      case 'odeme_menu':
        await this.handleOdemeMenu(from, input);
        break;

      case 'magaza_menu':
        await this.handleMagazaMenu(from, input, message);
        break;

      case 'magaza_sorgula_input':
        await handleMagazaAction(from, input, 'magaza_sorgula_input');
        break;

      case 'magaza_konum_bekle':
        if (message.type === 'location' && message.location) {
          await handleMagazaAction(from, input, 'magaza_konum_bekle', message.location);
        } else {
          await whatsappApi.sendText(from, '📍 Lütfen konumunuzu gönderin.\n\n💡 WhatsApp\'ta 📎 (ataç) simgesine tıklayıp "Konum" seçeneğini kullanabilirsiniz.');
        }
        break;

      case 'magaza_secim':
        await handleMagazaAction(from, input, 'magaza_secim');
        break;

      case 'kategori_menu':
        await handleKategoriAction(from, input, 'kategori_menu');
        break;

      case 'kategori_urunler':
        await handleKategoriAction(from, input, 'kategori_urunler');
        break;

      default:
        // Unknown state, show welcome
        updateSession(from, { currentMenu: 'welcome' });
        await this.showWelcome(from);
        break;
    }
  }

  // ============================
  // WELCOME & CHANNEL
  // ============================

  async showWelcome(from: string): Promise<void> {
    const session = getSession(from);
    const isim = session?.data?.isim;
    logger.info('showWelcome', { from, isim, uyeId: session?.data?.uyeId, hasData: !!session?.data });

    let welcomeText: string;
    if (isim) {
      const soyisim = session?.data?.soyisim || '';
      welcomeText =
        `Merhaba ${isim} ${soyisim}, Sonax Türkiye'ye hoş geldiniz. ✨🚗\n\n` +
        `Dijital asistanınız olarak, size ben yardımcı olacağım.\n\n` +
        `Güvenliğiniz için görüşmelerinizin kayıt altına alındığını hatırlatmak isteriz.\n\n` +
        `Kişisel verilerinizin korunması kapsamında KVKK aydınlatma metnimizi linke tıklayarak okuyabilirsiniz.\n` +
        `https://www.sonaxshop.com.tr/kisisel-verilerin-korunmasi-kvkk`;
    } else {
      welcomeText = menus.WELCOME_TEXT;
    }

    // First message: KVKK welcome text
    await whatsappApi.sendText(from, welcomeText);
    // Second message: channel selection buttons
    await whatsappApi.sendButtons(from, menus.CHANNEL_SELECT_TEXT, menus.CHANNEL_BUTTONS);
    updateSession(from, { currentMenu: 'channel_select' });
  }

  private async handleWelcome(from: string, name: string, input: string): Promise<void> {
    await this.showWelcome(from);
  }

  private async handleChannelSelect(from: string, name: string, input: string): Promise<void> {
    if (input === 'channel_online') {
      await this.showOnlineMenu(from);
    } else if (input === 'channel_magaza') {
      await this.showMagazaMenu(from);
    } else {
      await this.showWelcome(from);
    }
  }

  // ============================
  // ONLINE MENU
  // ============================

  private async showOnlineMenu(from: string): Promise<void> {
    await whatsappApi.sendList(
      from,
      menus.ONLINE_MENU_TEXT,
      'Seçenekler',
      menus.ONLINE_MENU_SECTIONS,
      '🛒 Online Destek'
    );
    updateSession(from, { currentMenu: 'online_menu' });
  }

  private async handleOnlineMenu(from: string, input: string): Promise<void> {
    switch (input) {
      case 'menu_siparis':
        await this.handleSiparisEntry(from);
        break;
      case 'menu_iade':
        await whatsappApi.sendText(from, menus.IADE_TEXT);
        await this.showBackButtonsWithTemsilci(from);
        break;
      case 'menu_kampanya':
        await whatsappApi.sendText(from,
          '🎁 *Güncel Kampanyalar*\n\n' +
          'Güncel kampanyalarımız için:\n' +
          '🔗 https://sonax.com.tr/kampanyalar'
        );
        await whatsappApi.sendCTAUrl(
          from,
          'Instagramdan da takip edebilirsiniz:',
          'Instagramda Takip Et',
          'https://www.instagram.com/sonax.turkiye'
        );
        await this.showBackButtons(from);
        break;
      case 'menu_odeme':
        await whatsappApi.sendList(from, menus.ODEME_MENU_TEXT, 'Seçenekler', menus.ODEME_MENU_SECTIONS, '💳 Ödeme');
        updateSession(from, { currentMenu: 'odeme_menu' });
        break;
      case 'menu_uyelik':
        await whatsappApi.sendText(from, '👤 Üyelik bilgileriniz için https://www.sonaxshop.com.tr/Hesabim#/Uyelik-Bilgilerim adresinden giriş yapabilirsiniz.\n\nHesabım > Üyelik Bilgilerim bölümünden bilgilerinizi görüntüleyebilir ve düzenleyebilirsiniz.');
        await this.showBackButtons(from);
        break;
      case 'menu_diger':
        await this.startLiveAgent(from, '', 'online');
        break;
      default:
        await this.showOnlineMenu(from);
        break;
    }
  }

  // ============================
  // SİPARİŞ — AUTO QUERY BY MEMBER
  // ============================

  /**
   * If member is known, auto-fetch their recent orders. Otherwise show manual menu.
   */
  private async handleSiparisEntry(from: string): Promise<void> {
    const session = getSession(from);
    const uyeId = session?.data?.uyeId;

    if (uyeId) {
      // Member found — auto-fetch recent orders
      await whatsappApi.sendText(from, '🔍 Siparişleriniz sorgulanıyor...');
      logger.info('Auto siparis query', { from, uyeId });

      try {
        const xml = await soapClient.selectSiparisByUyeId(uyeId);
        logger.info('SelectSiparisByUyeId response', { from, uyeId, xmlLength: xml.length, snippet: xml.substring(0, 500) });
        const siparisler = await xmlParser.parseSiparisler(xml);
        logger.info('Parsed siparisler', { from, count: siparisler.length, siparisler: siparisler.slice(0, 3) });

        if (siparisler.length === 0) {
          await whatsappApi.sendText(from, 'Henüz bir siparişiniz bulunmamaktadır.');
        } else {
          const isim = session?.data?.isim || '';
          const soyisim = session?.data?.soyisim || '';
          let header = `📦 *${isim} ${soyisim}, son siparişleriniz:*\n`;

          for (const siparis of siparisler.slice(0, 3)) {
            header += `\n━━━━━━━━━━━━━━━\n`;
            header += `📦 *Sipariş #${siparis.siparisNo}*\n`;
            header += `📅 Tarih: ${formatDate(siparis.tarih)}\n`;
            header += `📊 Durum: ${siparis.durum}\n`;
            header += `💰 Tutar: ${siparis.toplamTutar.toFixed(2)} TL\n`;
            if (siparis.kargoTakipNo) {
              header += `🚚 Kargo: ${siparis.kargoFirma} - ${siparis.kargoTakipNo}\n`;
              if (siparis.kargoTakipUrl) {
                header += `🔗 Takip: ${siparis.kargoTakipUrl}\n`;
              }
            }
          }

          await whatsappApi.sendText(from, header);
        }
      } catch (error: any) {
        logger.error('Auto siparis query error', { from, uyeId, error: error.message });
        await whatsappApi.sendText(from, '❌ Siparişler sorgulanırken hata oluştu.');
      }

      // Show siparis sub-menu for further actions
      await whatsappApi.sendList(from, 'Başka bir sipariş işlemi yapmak ister misiniz?', 'Seçenekler', menus.SIPARIS_MENU_SECTIONS, '📦 Sipariş');
      updateSession(from, { currentMenu: 'siparis_menu' });
    } else {
      // Member not found — show manual menu
      await whatsappApi.sendList(from, menus.SIPARIS_MENU_TEXT, 'Seçenekler', menus.SIPARIS_MENU_SECTIONS, '📦 Sipariş');
      updateSession(from, { currentMenu: 'siparis_menu' });
    }
  }

  private async handleSiparisMenu(from: string, input: string, message: WebhookMessage): Promise<void> {
    switch (input) {
      case 'siparis_adres':
        await whatsappApi.sendText(from, menus.ADRES_DEGISIKLIGI_TEXT);
        await this.showBackButtonsWithTemsilci(from);
        break;
      case 'siparis_iptal':
        await whatsappApi.sendText(from, menus.SIPARIS_IPTAL_TEXT);
        await this.showBackButtons(from);
        break;
      default:
        await whatsappApi.sendList(from, menus.SIPARIS_MENU_TEXT, 'Seçenekler', menus.SIPARIS_MENU_SECTIONS, '📦 Sipariş');
        break;
    }
  }

  // ============================
  // İADE (artık submenu yok, sadece placeholder)
  // ============================

  private async handleIadeMenu(from: string, input: string): Promise<void> {
    // İade artık tek mesaj, buraya düşmemeli
    switch (input) {
      default:
        await whatsappApi.sendText(from, menus.IADE_TEXT);
        await this.showBackButtons(from);
        break;
    }
  }

  // ============================
  // ÜRÜN MENU
  // ============================

  private async handleUrunMenu(from: string, input: string, message: WebhookMessage): Promise<void> {
    switch (input) {
      case 'urun_arama':
        await whatsappApi.sendText(from, '🔍 Ürün adı, barkod veya stok kodunu yazınız:\n\n_(Örnek: "Sonax Xtreme" veya barkod numarası)_');
        updateSession(from, { currentMenu: 'urun_arama_input' });
        break;
      case 'urun_stok':
        await whatsappApi.sendText(from, '📦 Stok sorgulamak istediğiniz ürünün adını veya kodunu yazınız:');
        updateSession(from, { currentMenu: 'urun_arama_input' });
        break;
      default:
        await whatsappApi.sendList(from, menus.URUN_MENU_TEXT, 'Seçenekler', menus.URUN_MENU_SECTIONS, '📦 Ürün');
        break;
    }
  }

  // ============================
  // KAMPANYA MENU
  // ============================

  private async handleKampanyaMenu(from: string, input: string, message: WebhookMessage): Promise<void> {
    switch (input) {
      case 'kampanya_guncel':
        await handleKampanyaAction(from, input, 'kampanya_guncel');
        break;
      case 'kampanya_hediye':
        await whatsappApi.sendText(from, '🎁 Hediye çeki kodunuzu yazınız:');
        updateSession(from, { currentMenu: 'kampanya_hediye_input' });
        break;
      default:
        await whatsappApi.sendList(from, menus.KAMPANYA_MENU_TEXT, 'Seçenekler', menus.KAMPANYA_MENU_SECTIONS, '🎁 Kampanyalar');
        break;
    }
  }

  // ============================
  // ÖDEME MENU
  // ============================

  private async handleOdemeMenu(from: string, input: string): Promise<void> {
    switch (input) {
      case 'odeme_yontem':
        await whatsappApi.sendText(from, menus.ODEME_YONTEM_TEXT);
        await this.showBackButtons(from);
        break;
      case 'odeme_iban':
        await whatsappApi.sendText(from, menus.ODEME_IBAN_TEXT);
        await this.showBackButtons(from);
        break;
      default:
        await whatsappApi.sendList(from, menus.ODEME_MENU_TEXT, 'Seçenekler', menus.ODEME_MENU_SECTIONS, '💳 Ödeme');
        break;
    }
  }

  // ============================
  // MAĞAZA MENU
  // ============================

  private async showMagazaMenu(from: string): Promise<void> {
    await whatsappApi.sendList(
      from,
      menus.MAGAZA_MENU_TEXT,
      'Seçenekler',
      menus.MAGAZA_MENU_SECTIONS,
      '🏪 Uygulama Merkezleri'
    );
    updateSession(from, { currentMenu: 'magaza_menu' });
  }

  private async handleMagazaMenu(from: string, input: string, message: WebhookMessage): Promise<void> {
    switch (input) {
      case 'magaza_fiyat':
        await whatsappApi.sendText(from, '📋 *Sonax Uygulama Hizmetleri Fiyat Listesi*');
        await new Promise(r => setTimeout(r, 1000));
        await whatsappApi.sendImage(from, 'https://sonax.com.tr/wp-content/uploads/2026/01/FIYAT-LISTESI-SUM-OCAK-2026-a4-03-1-scaled.jpg', 'Boya Koruma ve Cam Filmi Hizmetleri');
        await new Promise(r => setTimeout(r, 1500));
        await whatsappApi.sendImage(from, 'https://sonax.com.tr/wp-content/uploads/2026/01/FIYAT-LISTESI-SUM-OCAK-2026-a4-01-1-scaled.jpg', 'Sonax Uygulama Hizmetleri');
        await new Promise(r => setTimeout(r, 1500));
        await whatsappApi.sendImage(from, 'https://sonax.com.tr/wp-content/uploads/2026/01/FIYAT-LISTESI-SUM-OCAK-2026-a4-02-scaled.jpg', 'Sonax Özel Uygulama Paketleri');
        await new Promise(r => setTimeout(r, 2000));
        await this.showBackButtons(from);
        break;
      case 'magaza_en_yakin':
        await whatsappApi.sendText(from, '📍 Lütfen konumunuzu gönderin.\n\n💡 WhatsApp\'ta 📎 (ataç) simgesine tıklayıp "Konum" seçeneğini kullanabilirsiniz.');
        updateSession(from, { currentMenu: 'magaza_konum_bekle' });
        break;
      case 'magaza_sorgula':
        await whatsappApi.sendText(from, '📍 Hangi il için uygulama merkezi aramak istiyorsunuz?\n\n_(Örnek: İstanbul)_');
        updateSession(from, { currentMenu: 'magaza_sorgula_input' });
        break;
      case 'magaza_kampanya':
        await whatsappApi.sendText(from,
          '🎁 *Güncel Kampanyalar*\n\n' +
          'Güncel kampanyalarımız için:\n' +
          '🔗 https://sonax.com.tr/kampanyalar'
        );
        await whatsappApi.sendCTAUrl(
          from,
          'Instagramdan da takip edebilirsiniz:',
          'Instagramda Takip Et',
          'https://www.instagram.com/sonax.turkiye'
        );
        await this.showBackButtons(from);
        break;
      case 'magaza_temsilci':
        await this.startLiveAgent(from, '', 'uygulama');
        break;
      default:
        await this.showMagazaMenu(from);
        break;
    }
  }

  // ============================
  // LIVE AGENT
  // ============================

  /**
   * Start live agent mode: create conversation in dashboard
   */
  private async startLiveAgent(from: string, name: string, department: string): Promise<void> {
    try {
      const session = getSession(from);

      // Already in a conversation?
      if (session?.data?.conversationId) {
        await whatsappApi.sendText(from,
          'Temsilci baglantiniz zaten aktif. Mesajinizi yazabilirsiniz. 💬'
        );
        updateSession(from, { currentMenu: 'live_agent' });
        return;
      }

      const customerName = session?.data?.isim
        ? `${session.data.isim} ${session.data.soyisim || ''}`.trim()
        : (name || 'Musteri');

      const result = await createConversation(from, customerName, department);

      updateSession(from, {
        currentMenu: 'live_agent',
        data: {
          ...(session?.data || {}),
          conversationId: result.conversationId,
          department,
        },
      });

      const deptLabel = department === 'uygulama' ? 'Uygulama Merkezleri' :
                        department === 'genel' ? 'Genel Destek' : 'Online Destek';

      await whatsappApi.sendText(from,
        `👤 *Temsilciye Baglaniyorsunuz*\n\n` +
        `Birim: ${deptLabel}\n\n` +
        `Bir temsilci en kisa surede size donecektir. ` +
        `Lutfen mesajinizi yazin, temsilcimiz gorecektir.\n\n` +
        `_Ana menuye donmek icin "merhaba" yazabilirsiniz._`
      );

      logger.info('Live agent started', { from, department, conversationId: result.conversationId });
    } catch (error: any) {
      logger.error('Failed to start live agent', { from, department, error: error.message });
      // Fallback to static text
      await whatsappApi.sendText(from, menus.TEMSILCI_TEXT);
      await this.showBackButtons(from);
    }
  }

  /**
   * Handle messages while in live_agent mode — forward to dashboard
   */
  private async handleLiveAgentMessage(from: string, name: string, input: string, message: WebhookMessage): Promise<void> {
    const session = getSession(from);
    const conversationId = session?.data?.conversationId;

    if (!conversationId) {
      // Lost conversation reference — reset
      updateSession(from, { currentMenu: 'welcome' });
      await this.showWelcome(from);
      return;
    }

    // Check if agent has closed the conversation
    try {
      const statusResult = await getConversationStatus(conversationId);
      if (statusResult.status === 'closed') {
        const memberData = {
          uyeId: session?.data?.uyeId,
          isim: session?.data?.isim,
          soyisim: session?.data?.soyisim,
          mail: session?.data?.mail,
        };
        updateSession(from, { currentMenu: 'welcome', data: memberData });
        await whatsappApi.sendText(from, 'Gorusme sonlandirildi. Tekrar yardimci olabilir miyim? 😊');
        await this.showWelcome(from);
        return;
      }
    } catch {
      // Status check failed — continue forwarding
    }

    // Extract content
    let content = '';
    let messageType = 'text';

    if (message.type === 'text') {
      content = message.text?.body || input;
    } else if (message.type === 'interactive') {
      content = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || input;
    } else if (message.type === 'image') {
      content = '[Gorsel gonderildi]';
      messageType = 'image';
    } else if (message.type === 'document') {
      content = '[Belge gonderildi]';
      messageType = 'document';
    } else if (message.type === 'location') {
      content = `[Konum: ${message.location?.latitude}, ${message.location?.longitude}]`;
    } else {
      content = input || '[Mesaj]';
    }

    // Forward to dashboard
    try {
      const customerName = session?.data?.isim
        ? `${session.data.isim} ${session.data.soyisim || ''}`.trim()
        : (name || 'Musteri');
      await forwardMessage(conversationId, content, customerName, messageType);
    } catch (error: any) {
      logger.error('Failed to forward message', { from, conversationId, error: error.message });
    }
  }

  /**
   * Called when dashboard closes the conversation
   */
  async endLiveAgent(from: string): Promise<void> {
    const session = getSession(from);
    if (session) {
      const memberData = {
        uyeId: session.data?.uyeId,
        isim: session.data?.isim,
        soyisim: session.data?.soyisim,
        mail: session.data?.mail,
      };
      updateSession(from, { currentMenu: 'welcome', data: memberData });
    }
  }

  // ============================
  // HELPERS
  // ============================

  private async showBackButtons(from: string): Promise<void> {
    await whatsappApi.sendButtons(from, 'Başka bir konuda yardımcı olabilir miyim?', [
      { type: 'reply', reply: { id: 'menu_ust', title: 'Üst Menü ⬆️' } },
      { type: 'reply', reply: { id: 'menu_ana', title: 'Ana Menü 🏠' } },
    ]);
  }

  private async showBackButtonsWithTemsilci(from: string): Promise<void> {
    await whatsappApi.sendButtons(from, 'Başka bir konuda yardımcı olabilir miyim?', [
      { type: 'reply', reply: { id: 'menu_temsilci', title: 'Temsilciye Bağlan 👤' } },
      { type: 'reply', reply: { id: 'menu_ust', title: 'Üst Menü ⬆️' } },
      { type: 'reply', reply: { id: 'menu_ana', title: 'Ana Menü 🏠' } },
    ]);
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

export const chatbotRouter = new ChatbotRouter();
