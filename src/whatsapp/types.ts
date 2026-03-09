// WhatsApp Cloud API Types

export interface WebhookBody {
  object: string;
  entry: WebhookEntry[];
}

export interface WebhookEntry {
  id: string;
  changes: WebhookChange[];
}

export interface WebhookChange {
  value: {
    messaging_product: string;
    metadata: {
      display_phone_number: string;
      phone_number_id: string;
    };
    contacts?: WebhookContact[];
    messages?: WebhookMessage[];
    statuses?: WebhookStatus[];
  };
  field: string;
}

export interface WebhookContact {
  profile: { name: string };
  wa_id: string;
}

export interface WebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'interactive' | 'image' | 'document' | 'location' | 'button';
  text?: { body: string };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  button?: { payload: string; text: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
}

export interface WebhookStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
}

// Outgoing message types
export interface TextMessage {
  messaging_product: 'whatsapp';
  to: string;
  type: 'text';
  text: { body: string; preview_url?: boolean };
}

export interface InteractiveListMessage {
  messaging_product: 'whatsapp';
  to: string;
  type: 'interactive';
  interactive: {
    type: 'list';
    header?: { type: 'text'; text: string };
    body: { text: string };
    footer?: { text: string };
    action: {
      button: string;
      sections: ListSection[];
    };
  };
}

export interface ListSection {
  title: string;
  rows: ListRow[];
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface InteractiveButtonMessage {
  messaging_product: 'whatsapp';
  to: string;
  type: 'interactive';
  interactive: {
    type: 'button';
    header?: { type: 'text'; text: string };
    body: { text: string };
    footer?: { text: string };
    action: {
      buttons: ReplyButton[];
    };
  };
}

export interface ReplyButton {
  type: 'reply';
  reply: {
    id: string;
    title: string;
  };
}

export interface LocationMessage {
  messaging_product: 'whatsapp';
  to: string;
  type: 'location';
  location: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
}
