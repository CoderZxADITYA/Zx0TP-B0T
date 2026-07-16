/**
 * Optional DB persistence layer for bot state.
 * If DATABASE_URL is not set every function silently no-ops.
 * All functions are safe to call from sync contexts (fire-and-forget).
 *
 * Circuit-breaker: after the first "table not found" (42P01) error the
 * module sets tablesReady=false and logs ONE human-readable hint.
 * Every subsequent call short-circuits silently — no more log spam.
 */

import { getDb }                 from '@workspace/db';
import { botUsers, botLicenses, botSettings, botCallLogs } from '@workspace/db';
import { eq, desc }              from 'drizzle-orm';
import { logger }                from '../lib/logger.js';
import type { License }          from './licenses.js';
import type { KnownUser }        from './users.js';

// ── Circuit-breaker ────────────────────────────────────────────────────────────

// null = not yet tested, true = tables OK, false = tables missing
let tablesReady: boolean | null = null;

function db() { return getDb(); }

function isReady(): boolean {
  if (!db()) return false;           // no DATABASE_URL
  if (tablesReady === false) return false; // already failed
  return true;
}

function handleError(e: unknown, label: string): void {
  const code = (e as any)?.cause?.code ?? (e as any)?.code;
  if (code === '42P01') {
    // Undefined table — only log once
    if (tablesReady !== false) {
      tablesReady = false;
      logger.warn(
        'DB tables not found — run `pnpm --filter @workspace/db run push` to create them. ' +
        'Bot is running in in-memory mode until tables exist.',
      );
    }
    return;
  }
  logger.warn({ e }, label);
}

// ── Users ──────────────────────────────────────────────────────────────────────

export async function dbLoadAllUsers(): Promise<KnownUser[]> {
  const d = db(); if (!d) return [];
  try {
    const rows = await d.select().from(botUsers);
    tablesReady = true;
    return rows.map(r => ({
      chatId:    r.chatId,
      username:  r.username ?? undefined,
      firstSeen: r.firstSeen.getTime(),
      lastSeen:  r.lastSeen.getTime(),
    }));
  } catch (e) { handleError(e, 'dbLoadAllUsers failed'); return []; }
}

export async function dbLoadBanned(): Promise<number[]> {
  if (!isReady()) return [];
  try {
    const rows = await db()!.select().from(botUsers).where(eq(botUsers.banned, true));
    return rows.map(r => r.chatId);
  } catch (e) { handleError(e, 'dbLoadBanned failed'); return []; }
}

export function dbUpsertUser(u: KnownUser, banned = false): void {
  if (!isReady()) return;
  db()!.insert(botUsers)
    .values({
      chatId:    u.chatId,
      username:  u.username,
      firstSeen: new Date(u.firstSeen),
      lastSeen:  new Date(u.lastSeen),
      banned,
    })
    .onConflictDoUpdate({
      target: botUsers.chatId,
      set:    { lastSeen: new Date(u.lastSeen), username: u.username },
    })
    .catch(e => handleError(e, 'dbUpsertUser failed'));
}

export function dbSetBanned(chatId: number, value: boolean): void {
  if (!isReady()) return;
  // Upsert so ban works even if user hasn't been seen yet
  db()!.insert(botUsers)
    .values({ chatId, firstSeen: new Date(), lastSeen: new Date(), banned: value })
    .onConflictDoUpdate({ target: botUsers.chatId, set: { banned: value } })
    .catch(e => handleError(e, 'dbSetBanned failed'));
}

// ── Licenses ───────────────────────────────────────────────────────────────────

export async function dbLoadAllLicenses(): Promise<License[]> {
  const d = db(); if (!d) return [];
  try {
    const rows = await d.select().from(botLicenses);
    tablesReady = true;
    return rows.map(r => ({
      key:            r.key,
      durationMs:     r.durationMs,
      createdBy:      r.createdBy,
      createdAt:      r.createdAt.getTime(),
      redeemedBy:     r.redeemedBy ?? undefined,
      redeemedAt:     r.redeemedAt?.getTime(),
      expiresAt:      r.expiresAt?.getTime(),
      active:         r.active,
      notifiedExpiry: r.notifiedExpiry,
    }));
  } catch (e) { handleError(e, 'dbLoadAllLicenses failed'); return []; }
}

export function dbUpsertLicense(l: License): void {
  if (!isReady()) return;
  db()!.insert(botLicenses)
    .values({
      key:            l.key,
      durationMs:     l.durationMs,
      createdBy:      l.createdBy,
      createdAt:      new Date(l.createdAt),
      redeemedBy:     l.redeemedBy,
      redeemedAt:     l.redeemedAt ? new Date(l.redeemedAt) : undefined,
      expiresAt:      l.expiresAt  ? new Date(l.expiresAt)  : undefined,
      active:         l.active,
      notifiedExpiry: l.notifiedExpiry ?? false,
    })
    .onConflictDoUpdate({
      target: botLicenses.key,
      set: {
        redeemedBy:     l.redeemedBy,
        redeemedAt:     l.redeemedAt ? new Date(l.redeemedAt) : undefined,
        expiresAt:      l.expiresAt  ? new Date(l.expiresAt)  : undefined,
        active:         l.active,
        notifiedExpiry: l.notifiedExpiry ?? false,
      },
    })
    .catch(e => handleError(e, 'dbUpsertLicense failed'));
}

// ── Settings ───────────────────────────────────────────────────────────────────

export async function dbGetSetting(key: string): Promise<string | null> {
  const d = db(); if (!d) return null;
  try {
    const rows = await d.select().from(botSettings).where(eq(botSettings.key, key));
    tablesReady = true;
    return rows[0]?.value ?? null;
  } catch (e) { handleError(e, 'dbGetSetting failed'); return null; }
}

export async function dbSetSetting(key: string, value: string): Promise<void> {
  if (!isReady()) return;
  await db()!.insert(botSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: botSettings.key, set: { value, updatedAt: new Date() } })
    .catch(e => handleError(e, 'dbSetSetting failed'));
}

// ── Call logs ──────────────────────────────────────────────────────────────────

export function dbLogCall(entry: {
  chatId:   number;
  username?: string;
  mode:     string;
  phone:    string;
  callSid?: string;
  status:   string;
}): void {
  if (!isReady()) return;
  db()!.insert(botCallLogs)
    .values({ ...entry, createdAt: new Date() })
    .catch(e => handleError(e, 'dbLogCall failed'));
}

export async function dbRecentCallLogs(limit = 20) {
  if (!isReady()) return [];
  try {
    return await db()!.select().from(botCallLogs).orderBy(desc(botCallLogs.createdAt)).limit(limit);
  } catch (e) { handleError(e, 'dbRecentCallLogs failed'); return []; }
}
