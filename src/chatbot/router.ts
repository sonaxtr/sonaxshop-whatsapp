import { WebhookMessage } from '../whatsapp/types';
import { whatsappApi } from '../whatsapp/api';
import { logger } from '../utils/logger';
import { getSession, createSession, updateSession } from './session';
import * as menus from './menus';
import { handleSiparisAction } from './handlers/siparis';
import { handleUrunAction } from './handlers/urun';
import { handleKampanyaAction } from './handlers/kampanya';
import { handleMagazaAction } from './handlers/magaza';

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
    }

    // Extract user input
    const input = this.extractInput(message);
    logger.info('Processing', { from, menu: session.currentMenu, input });

    // Check for global commands
    if (this.isResetCommand(input)) {
      updateSession(from, { currentMenu: 'welcome', data: {} });
      await this.showWelcome(from, name);
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
      updateSession(from, { currentMenu: 'welcome', data: {} });
      await this.showWelcome(from, name);
      return;
    }
    if (input === 'menu_ust') {
      updateSession(from, { currentMenu: 'online_menu', data: {} });
      await this.showOnlineMenu(from);
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

      case 'siparis_sorgula_input':
      case 'siparis_kargo_input':
        await handleSiparisAction(from, input, currentMenu);
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

      case 'magaza_secim':
        await handleMagazaAction(from, input, 'magaza_secim');
        break;

      default:
        // Unknown state, show welcome
        updateSession(from, { currentMenu: 'welcome' });
        await this.showWelcome(from, name);
        break;
    }
  }

  // ============================
  // WELCOME & CHANNEL
  // ============================

  async showWelcome(from: string, name: string): Promise<void> {
    const welcomeText = menus.WELCOME_TEXT.replace('SonaxShop', 'SonaxShop');
    await whatsappApi.sendButtons(from, welcomeText, menus.CHANNEL_BUTTONS);
    updateSession(from, { currentMenu: 'channel_select' });
  }

  private async handleWelcome(from: string, name: string, input: string): Promise<void> {
    await this.showWelcome(from, name);
  }

  private async handleChannelSelect(from: string, name: string, input: string): Promise<void> {
    if (input === 'channel_online') {
      await this.showOnlineMenu(from);
    } else if (input === 'channel_magaza') {
      await this.showMagazaMenu(from);
    } else {
      await this.showWelcome(from, name);
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
        await whatsappApi.sendList(from, menus.SIPARIS_MENU_TEXT, 'Seçenekler', menus.SIPARIS_MENU_SECTIONS, '📦 Sipariş');
        updateSession(from, { currentMenu: 'siparis_menu' });
        break;
      case 'menu_iade':
        await whatsappApi.sendList(from, menus.IADE_MENU_TEXT, 'Seçenekler', menus.IADE_MENU_SECTIONS, '🔄 İade ve Değişim');
        updateSession(from, { currentMenu: 'iade_menu' });
        break;
      case 'menu_urun':
        await whatsappApi.sendList(from, menus.URUN_MENU_TEXT, 'Seçenekler', menus.URUN_MENU_SECTIONS, '📦 Ürün Bilgisi');
        updateSession(from, { currentMenu: 'urun_menu' });
        break;
      case 'menu_kampanya':
        await whatsappApi.sendList(from, menus.KAMPANYA_MENU_TEXT, 'Seçenekler', menus.KAMPANYA_MENU_SECTIONS, '🎁 Kampanyalar');
        updateSession(from, { currentMenu: 'kampanya_menu' });
        break;
      case 'menu_odeme':
        await whatsappApi.sendList(from, menus.ODEME_MENU_TEXT, 'Seçenekler', menus.ODEME_MENU_SECTIONS, '💳 Ödeme');
        updateSession(from, { currentMenu: 'odeme_menu' });
        break;
      case 'menu_uyelik':
        await whatsappApi.sendText(from, '👤 Üyelik bilgileriniz için sonaxshop.com.tr adresinden giriş yapabilirsiniz.\n\nHesabım > Üyelik Bilgilerim bölümünden bilgilerinizi görüntüleyebilir ve düzenleyebilirsiniz.');
        await this.showBackButtons(from);
        break;
      case 'menu_diger':
        await whatsappApi.sendText(from, menus.TEMSILCI_TEXT);
        await this.showBackButtons(from);
        break;
      default:
        await this.showOnlineMenu(from);
        break;
    }
  }

  // ============================
  // SİPARİŞ MENU
  // ============================

  private async handleSiparisMenu(from: string, input: string, message: WebhookMessage): Promise<void> {
    switch (input) {
      case 'siparis_sorgula':
        await whatsappApi.sendText(from, '🔍 Sipariş numaranızı yazınız:\n\n_(Örnek: 12345)_');
        updateSession(from, { currentMenu: 'siparis_sorgula_input' });
        break;
      case 'siparis_kargo':
        await whatsappApi.sendText(from, '🚚 Sipariş numaranızı yazınız:\n\n_(Kargo takip bilgisi getirilecektir)_');
        updateSession(from, { currentMenu: 'siparis_kargo_input' });
        break;
      case 'siparis_adres':
        await whatsappApi.sendText(from, menus.ADRES_DEGISIKLIGI_TEXT);
        await this.showBackButtons(from);
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
  // İADE MENU
  // ============================

  private async handleIadeMenu(from: string, input: string): Promise<void> {
    switch (input) {
      case 'iade_surec':
        await whatsappApi.sendText(from, menus.IADE_SUREC_TEXT);
        await this.showBackButtons(from);
        break;
      case 'iade_inceleme':
        await whatsappApi.sendText(from,
          '🔎 *İnceleme Süreci*\n\n' +
          'İade talebiniz oluşturulduktan sonra ürünün tarafımıza ulaşması ve incelenmesi gerekmektedir.\n\n' +
          '⏱ İnceleme süresi: Ürünün tarafımıza ulaşmasından itibaren 3-5 iş günü\n' +
          '💰 İade onaylandıktan sonra ödemeniz 2-10 iş günü içinde iade edilir.\n\n' +
          '📞 Detaylı bilgi: 0850 307 7930'
        );
        await this.showBackButtons(from);
        break;
      default:
        await whatsappApi.sendList(from, menus.IADE_MENU_TEXT, 'Seçenekler', menus.IADE_MENU_SECTIONS, '🔄 İade');
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
      '🏪 Mağaza'
    );
    updateSession(from, { currentMenu: 'magaza_menu' });
  }

  private async handleMagazaMenu(from: string, input: string, message: WebhookMessage): Promise<void> {
    switch (input) {
      case 'magaza_listesi':
        await handleMagazaAction(from, input, 'magaza_listesi');
        break;
      case 'magaza_sorgula':
        await whatsappApi.sendText(from, '📍 Hangi il için mağaza aramak istiyorsunuz?\n\n_(Örnek: İstanbul)_');
        updateSession(from, { currentMenu: 'magaza_sorgula_input' });
        break;
      case 'magaza_temsilci':
        await whatsappApi.sendText(from, menus.TEMSILCI_TEXT);
        await this.showBackButtons(from);
        break;
      default:
        await this.showMagazaMenu(from);
        break;
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
}

export const chatbotRouter = new ChatbotRouter();
