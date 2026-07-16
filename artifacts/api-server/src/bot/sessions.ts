/**
 * In-memory session store.
 * Maps Telegram chatId ↔ active call session ↔ Twilio callSid.
 * Both the bot handlers and Twilio webhook routes share this store
 * because they run in the same process.
 *
 * Sessions include a createdAt timestamp.  sweepStaleSessions() (called
 * every 15 min from bot.ts) removes any session older than SESSION_TTL_MS
 * so abandoned calls can never leak memory indefinitely.
 */

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface Session {
  chatId:        number;
  phone:         string;
  callSid:       string;
  status:        'calling' | 'awaiting_decision' | 'completed';
  transcription?: string;
  scriptId?:     string;   // which script is playing on this call
  callMode?:     'speech' | 'dtmf' | 'both'; // input capture mode
  spoofNum?:     string;   // caller ID used for this call
  createdAt:     number;   // Date.now() — used by TTL sweeper
}

const byChat = new Map<number, Session>();
const byCall = new Map<string, Session>();

export function createSession(
  chatId:   number,
  phone:    string,
  callSid:  string,
  scriptId?: string,
  callMode?: Session['callMode'],
  spoofNum?: string,
): Session {
  // Clean up any old session for this chat
  const old = byChat.get(chatId);
  if (old) byCall.delete(old.callSid);

  const session: Session = {
    chatId, phone, callSid,
    status: 'calling',
    scriptId,
    callMode,
    spoofNum,
    createdAt: Date.now(),
  };
  byChat.set(chatId, session);
  byCall.set(callSid, session);
  return session;
}

/** Remove sessions older than SESSION_TTL_MS. Returns count cleared. */
export function sweepStaleSessions(): number {
  const now = Date.now();
  let count = 0;
  for (const [chatId, session] of byChat) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      byCall.delete(session.callSid);
      byChat.delete(chatId);
      count++;
    }
  }
  return count;
}

export function getByChat(chatId: number): Session | undefined {
  return byChat.get(chatId);
}

export function getByCall(callSid: string): Session | undefined {
  return byCall.get(callSid);
}

export function updateSession(callSid: string, updates: Partial<Session>): void {
  const session = byCall.get(callSid);
  if (!session) return;
  Object.assign(session, updates);
}

export function clearSession(chatId: number): void {
  const session = byChat.get(chatId);
  if (session) {
    byCall.delete(session.callSid);
    byChat.delete(chatId);
  }
}
