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

  // ── Verified premium IDs (new set from user) ──────────────────────────────
  FIRE:     { char: '🔥', id: '5893185207355315979' },
  SPIDER:   { char: '🕷', id: '5893293174243201165' },
  CHECK2:   { char: '✅', id: '5902002809573740949' },
  GLOBE:    { char: '🌐', id: '6039450035152753195' },
  SOON:     { char: '🔜', id: '5893368370530621889' },
  MONEYMOUTH: { char: '🤑', id: '6235277570070286919' },
  CARD:     { char: '💳', id: '5852440446051028724' },
  MONEY:    { char: '💰', id: '6318864007381911770' },
  SUIT:     { char: '🤵', id: '5264950350875490328' },

  // ── Plain emoji (no verified premium ID — safe fallback) ──────────────────
  CROSS:    { char: '❌' },
  ROCKET:   { char: '🚀' },
  LOCK:     { char: '🔐' },
  SHIELD:   { char: '🛡' },
  TOOLS:    { char: '⚙️' },
  KEY:      { char: '🗝' },
  BELL:     { char: '🔔' },
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
