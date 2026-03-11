import axios from 'axios';
import { logger } from '../utils/logger';

const DASHBOARD_API_URL = process.env.DASHBOARD_API_URL || '';
const DASHBOARD_API_SECRET = process.env.DASHBOARD_API_SECRET || '';

const client = axios.create({
  baseURL: DASHBOARD_API_URL,
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${DASHBOARD_API_SECRET}`,
  },
  timeout: 10000,
});

export interface CreateConversationResult {
  conversationId: string;
  status: string;
}

/**
 * Create a new conversation in the dashboard
 */
export async function createConversation(
  customerPhone: string,
  customerName: string,
  department: string
): Promise<CreateConversationResult> {
  const resp = await client.post('/api/live-chat/conversations', {
    customerPhone,
    customerName,
    department,
  });
  return resp.data;
}

/**
 * Forward a customer message to an existing conversation
 */
export async function forwardMessage(
  conversationId: string,
  content: string,
  customerName: string,
  messageType: string = 'text'
): Promise<void> {
  await client.post(`/api/live-chat/conversations/${conversationId}/messages`, {
    direction: 'inbound',
    senderType: 'customer',
    senderName: customerName,
    content,
    messageType,
  });
}

/**
 * Check conversation status (is it still active or has agent closed it?)
 */
export async function getConversationStatus(
  conversationId: string
): Promise<{ status: string }> {
  const resp = await client.get(`/api/live-chat/conversations/${conversationId}/status`);
  return resp.data;
}

/**
 * Notify dashboard that customer closed the conversation
 */
export async function closeConversation(conversationId: string): Promise<void> {
  try {
    await client.post(`/api/live-chat/conversations/${conversationId}/close`, {
      closedBy: 'customer',
    });
  } catch (err: any) {
    logger.warn('Failed to close conversation on dashboard', { conversationId, error: err.message });
  }
}
