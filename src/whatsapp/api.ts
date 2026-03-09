import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  TextMessage,
  InteractiveListMessage,
  InteractiveButtonMessage,
  InteractiveCTAUrlMessage,
  ImageMessage,
  LocationMessage,
  ListSection,
  ReplyButton,
} from './types';

const GRAPH_API_URL = 'https://graph.facebook.com/v21.0';

/**
 * WhatsApp Cloud API client
 */
export class WhatsAppAPI {
  private phoneNumberId: string;
  private token: string;

  constructor() {
    this.phoneNumberId = config.whatsapp.phoneNumberId;
    this.token = config.whatsapp.token;
  }

  private get url(): string {
    return `${GRAPH_API_URL}/${this.phoneNumberId}/messages`;
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Send raw message payload
   */
  async send(payload: TextMessage | InteractiveListMessage | InteractiveButtonMessage | InteractiveCTAUrlMessage | ImageMessage | LocationMessage): Promise<void> {
    try {
      const response = await axios.post(this.url, payload, { headers: this.headers });
      logger.info('Message sent', { to: payload.to, messageId: response.data?.messages?.[0]?.id });
    } catch (error: any) {
      logger.error('Failed to send message', {
        to: payload.to,
        error: error.response?.data || error.message,
      });
      throw error;
    }
  }

  /**
   * Send a simple text message
   */
  async sendText(to: string, text: string): Promise<void> {
    await this.send({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    });
  }

  /**
   * Send a list message (up to 10 options in dropdown)
   */
  async sendList(
    to: string,
    bodyText: string,
    buttonText: string,
    sections: ListSection[],
    headerText?: string,
    footerText?: string
  ): Promise<void> {
    const message: InteractiveListMessage = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: bodyText },
        action: {
          button: buttonText,
          sections,
        },
      },
    };

    if (headerText) {
      message.interactive.header = { type: 'text', text: headerText };
    }
    if (footerText) {
      message.interactive.footer = { text: footerText };
    }

    await this.send(message);
  }

  /**
   * Send reply buttons (up to 3 buttons)
   */
  async sendButtons(
    to: string,
    bodyText: string,
    buttons: ReplyButton[],
    headerText?: string,
    footerText?: string
  ): Promise<void> {
    const message: InteractiveButtonMessage = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: { buttons },
      },
    };

    if (headerText) {
      message.interactive.header = { type: 'text', text: headerText };
    }
    if (footerText) {
      message.interactive.footer = { text: footerText };
    }

    await this.send(message);
  }

  /**
   * Send a location message
   */
  async sendLocation(
    to: string,
    latitude: number,
    longitude: number,
    name?: string,
    address?: string
  ): Promise<void> {
    await this.send({
      messaging_product: 'whatsapp',
      to,
      type: 'location',
      location: { latitude, longitude, name, address },
    });
  }

  /**
   * Send an image message
   */
  async sendImage(to: string, imageUrl: string, caption?: string): Promise<void> {
    await this.send({
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image: { link: imageUrl, ...(caption ? { caption } : {}) },
    });
  }

  /**
   * Send a CTA URL button (clickable link button)
   */
  async sendCTAUrl(
    to: string,
    bodyText: string,
    displayText: string,
    url: string
  ): Promise<void> {
    await this.send({
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        body: { text: bodyText },
        action: {
          name: 'cta_url',
          parameters: { display_text: displayText, url },
        },
      },
    });
  }

  /**
   * Mark message as read
   */
  async markAsRead(messageId: string): Promise<void> {
    try {
      await axios.post(
        this.url,
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        },
        { headers: this.headers }
      );
    } catch (error: any) {
      logger.warn('Failed to mark message as read', { messageId, error: error.message });
    }
  }
}

export const whatsappApi = new WhatsAppAPI();
