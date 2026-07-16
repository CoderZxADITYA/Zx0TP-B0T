/**
 * License-key based premium gating.
 *
 * Flow:
 *  1. Admin generates a key for a fixed duration from the admin panel.
 *     Keys are not tied to a user until redeemed.
 *  2. Any user runs /redeem <key> to activate it for their own account.
 *  3. Once redeemed, the user is "premium" until the key's expiresAt.
 *  4. A background interval sweeps expired licenses and messages the user.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface License {
  key:             string;
  durationMs:      number;
  createdBy:       number;
  createdAt:       number;
  redeemedBy?:     number;
  redeemedAt?:     number;
  expiresAt?:      number;
  active:          boolean;
  notifiedExpiry?: boolean;
}

const licensesByKey   = new Map<string, License>();
const activeKeyByUser = new Map<number, string>();

function randomSegment(len: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function generateLicense(adminId: number, days = 1): License {
  const key = `ZX-${randomSegment(4)}-${randomSegment(4)}-${randomSegment(4)}`;
  const license: License = {
    key,
    durationMs: days * DAY_MS,
    createdBy:  adminId,
    createdAt:  Date.now(),
    active:     true,
  };
  licensesByKey.set(key, license);
  return license;
}

export type RedeemResult =
  | { ok: true;  license: License }
  | { ok: false; reason: 'not_found' | 'already_redeemed' | 'expired' };

export function redeemLicense(userId: number, rawKey: string): RedeemResult {
  const key     = rawKey.trim().toUpperCase();
  const license = licensesByKey.get(key);
  if (!license)              return { ok: false, reason: 'not_found' };
  if (license.redeemedBy)    return { ok: false, reason: 'already_redeemed' };

  const now         = Date.now();
  license.redeemedBy  = userId;
  license.redeemedAt  = now;
  license.expiresAt   = now + license.durationMs;
  license.active      = true;
  activeKeyByUser.set(userId, key);
  return { ok: true, license };
}

export function getUserLicense(userId: number): License | undefined {
  const key = activeKeyByUser.get(userId);
  return key ? licensesByKey.get(key) : undefined;
}

export function isPremium(userId: number): boolean {
  const l = getUserLicense(userId);
  return !!(l?.active && l.expiresAt && l.expiresAt > Date.now());
}

export function timeLeftMs(userId: number): number | undefined {
  const l = getUserLicense(userId);
  if (!l?.expiresAt) return undefined;
  return Math.max(0, l.expiresAt - Date.now());
}

export function revokeUser(userId: number): boolean {
  const key = activeKeyByUser.get(userId);
  if (!key) return false;
  const l = licensesByKey.get(key);
  if (l) l.active = false;
  activeKeyByUser.delete(userId);
  return true;
}

export function listActiveLicenses(): License[] {
  return [...licensesByKey.values()].filter(l => l.active && l.expiresAt && l.expiresAt > Date.now());
}

export function listAllLicenses(): License[] {
  return [...licensesByKey.values()];
}

/** Hydrate from DB on startup */
export function hydrateLicense(l: License): void {
  licensesByKey.set(l.key, l);
  if (l.redeemedBy && l.active && l.expiresAt && l.expiresAt > Date.now()) {
    activeKeyByUser.set(l.redeemedBy, l.key);
  }
}

export function sweepExpired(notify: (userId: number) => void): void {
  const now = Date.now();
  for (const l of licensesByKey.values()) {
    if (l.active && l.redeemedBy && l.expiresAt && l.expiresAt <= now && !l.notifiedExpiry) {
      l.active         = false;
      l.notifiedExpiry = true;
      activeKeyByUser.delete(l.redeemedBy);
      notify(l.redeemedBy);
    }
  }
}

export function formatDuration(ms: number): string {
  const totalMin = Math.ceil(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0)       return `${m}m`;
  if (h < 24)       return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}
