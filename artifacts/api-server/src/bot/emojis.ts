/**
 * Emoji constants for ZxOTP BOT.
 *
 * Entries with `id` — verified Telegram custom_emoji_ids. The Msg builder
 * sends these as `custom_emoji` entities so premium subscribers see the
 * animated version.
 *
 * Entries without `id` — plain Unicode emoji. The Msg builder appends them
 * as ordinary text. They still look great; they just aren't animated.
 *
 * NEVER add an unverified `id` — Telegram returns DOCUMENT_INVALID and
 * crashes the bot process.
 */

export const E: Record<string, { char: string; id?: string }> = {
  // ── Verified premium IDs (original set) ───────────────────────────────────
  CROWN:     { char: '👑', id: '6294100961119966181' },
  DIAMOND:   { char: '💎', id: '6294040926067101259' },
  PHONE:     { char: '📱', id: '6057891250332241964' },
  CHECK:     { char: '✅', id: '5217615164118936274' },
  CANCEL:    { char: '🚫', id: '5240241223632954241' },
  LIGHTNING: { char: '⚡', id: '6060078591276749279' },
  STAR:      { char: '🌟', id: '5064709487953183440' },
  ANNOUNCE:  { char: '📣', id: '6059631768649077274' },
  RED:       { char: '🔴', id: '5197611929463433785' },
  HOURGLASS: { char: '⌛', id: '6293821461828211185' },

  // ── Plain emoji (no premium ID — safe fallback) ───────────────────────────
  CROSS:    { char: '❌' },
  FIRE:     { char: '🔥' },
  ROCKET:   { char: '🚀' },
  MONEY:    { char: '💰' },
  LOCK:     { char: '🔐' },
  GLOBE:    { char: '🌍' },
  SHIELD:   { char: '🛡' },
  TOOLS:    { char: '⚙️' },
  KEY:      { char: '🗝' },
  BELL:     { char: '🔔' },
  CARD:     { char: '💳' },
  BANK:     { char: '🏦' },
  WARNING:  { char: '⚠️' },
  QUESTION: { char: '❓' },
  SATELLITE:{ char: '🛰️' },
  ENVELOPE: { char: '📩' },
  RECEIPT:  { char: '🧾' },
  SPEAK:    { char: '🗣' },
  ROBOT:    { char: '🤖' },
  TROPHY:   { char: '🏆' },
  FIST:     { char: '👊' },
};

// ── Legacy buildMsg helper (kept for any direct callers) ──────────────────────

type EmojiEntry = { char: string; id?: string };

interface MessageWithEntities {
  text: string;
  entities: { type: 'custom_emoji'; offset: number; length: number; custom_emoji_id: string }[];
}

export function buildMsg(parts: (string | EmojiEntry)[]): MessageWithEntities {
  let text = '';
  const entities: MessageWithEntities['entities'] = [];

  for (const part of parts) {
    if (typeof part === 'string') {
      text += part;
    } else {
      if (part.id) {
        entities.push({
          type: 'custom_emoji',
          offset: text.length,
          length: part.char.length,
          custom_emoji_id: part.id,
        });
      }
      text += part.char;
    }
  }

  return { text, entities };
}
