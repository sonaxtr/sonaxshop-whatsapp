/**
 * Simple in-memory session store for chatbot state
 * In production, replace with Redis for persistence
 */

export interface UserSession {
  phone: string;
  name: string;
  currentMenu: string;
  lastActivity: number;
  data: Record<string, any>;
}

const sessions = new Map<string, UserSession>();
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

export function getSession(phone: string): UserSession | undefined {
  const session = sessions.get(phone);
  if (session && Date.now() - session.lastActivity > SESSION_TIMEOUT) {
    sessions.delete(phone);
    return undefined;
  }
  return session;
}

export function createSession(phone: string, name: string): UserSession {
  const session: UserSession = {
    phone,
    name,
    currentMenu: 'welcome',
    lastActivity: Date.now(),
    data: {},
  };
  sessions.set(phone, session);
  return session;
}

export function updateSession(phone: string, updates: Partial<UserSession>): UserSession {
  const session = sessions.get(phone);
  if (!session) {
    return createSession(phone, updates.name || 'Müşteri');
  }
  Object.assign(session, updates, { lastActivity: Date.now() });
  return session;
}

export function clearSession(phone: string): void {
  sessions.delete(phone);
}

// Cleanup expired sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [phone, session] of sessions.entries()) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      sessions.delete(phone);
    }
  }
}, 10 * 60 * 1000);
