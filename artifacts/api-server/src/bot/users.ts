/**
 * In-memory registry of every chat that has ever messaged the bot.
 * Used for admin stats, broadcast, ban enforcement, and call logs.
 */

export interface KnownUser {
  chatId:    number;
  username?: string;
  firstSeen: number;
  lastSeen:  number;
}

const users  = new Map<number, KnownUser>();
const banned = new Set<number>();

export function touchUser(chatId: number, username?: string): void {
  const existing = users.get(chatId);
  if (existing) {
    existing.lastSeen = Date.now();
    if (username) existing.username = username;
  } else {
    users.set(chatId, { chatId, username, firstSeen: Date.now(), lastSeen: Date.now() });
  }
}

export function allUsers(): KnownUser[] { return [...users.values()]; }
export function userCount(): number     { return users.size; }
export function getUser(chatId: number): KnownUser | undefined { return users.get(chatId); }

// ── Ban management ─────────────────────────────────────────────────────────────
export function banUser(chatId: number): void   { banned.add(chatId);    }
export function unbanUser(chatId: number): void { banned.delete(chatId); }
export function isBanned(chatId: number): boolean { return banned.has(chatId); }
export function allBanned(): number[]           { return [...banned]; }
