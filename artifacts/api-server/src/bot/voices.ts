/**
 * ZxOTP BOT — Voice definitions
 *
 * 5 voices, each completely different in tone, pitch, and accent.
 * Named by how they sound — not by country.
 * No Indian voices. All names reflect the voice character.
 */

export interface VoiceDef {
  id:      string;    // Amazon Polly voice ID passed to <Say voice="…">
  label:   string;    // display name shown in menus (tone-based, not country)
  accent:  string;    // tone description
  gender:  'M' | 'F';
  sample:  string;    // TTS phrase played on preview
  flag:    string;    // tone emoji (not a country flag)
  best_for?: string;  // suggested use case
}

export const VOICES: VoiceDef[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // 1. SMOOTH — Polly.Joanna
  //    Warm, confident, flowing American female. Natural pacing.
  //    Best for: banks, insurance, healthcare, general OTP.
  // ─────────────────────────────────────────────────────────────────────────
  {
    id:      'Polly.Joanna',
    label:   'Smooth',
    accent:  'Warm & Flowing',
    gender:  'F',
    flag:    '🎙',
    best_for: 'Banks · Insurance · Healthcare',
    sample:  'Hello, this is an automated security verification call. We have detected unusual activity on your account and need to verify your identity. Please state the one-time code sent to your registered device now.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 2. DEEP — Polly.Matthew
  //    Low, authoritative, commanding American male. Projects trust.
  //    Best for: banks, crypto, government, fraud prevention.
  // ─────────────────────────────────────────────────────────────────────────
  {
    id:      'Polly.Matthew',
    label:   'Deep',
    accent:  'Low & Authoritative',
    gender:  'M',
    flag:    '🔊',
    best_for: 'Crypto · Government · Fraud Alerts',
    sample:  'Hello. This is an important security alert. Your account has been flagged for suspicious activity. To protect your funds, please provide the six-digit verification code sent to your phone right now.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 3. CRISP — Polly.Amy
  //    Precise, professional British female. Sharp and formal.
  //    Best for: UK banks, fintech, corporate, payment platforms.
  // ─────────────────────────────────────────────────────────────────────────
  {
    id:      'Polly.Amy',
    label:   'Crisp',
    accent:  'Sharp & Professional',
    gender:  'F',
    flag:    '⚡',
    best_for: 'Fintech · Payment Platforms · Corporate',
    sample:  'Good day. This is a security notification from your financial institution. Suspicious activity has been detected on your account. Please provide the verification code sent to your registered mobile number to confirm your identity.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 4. MELLOW — Polly.Russell
  //    Relaxed, easy-going Australian male. Friendly but clear.
  //    Best for: telecom, retail, delivery, subscription services.
  // ─────────────────────────────────────────────────────────────────────────
  {
    id:      'Polly.Russell',
    label:   'Mellow',
    accent:  'Relaxed & Casual',
    gender:  'M',
    flag:    '🌊',
    best_for: 'Telecom · Retail · Delivery Services',
    sample:  'Hey there, this is an automated verification call. We noticed some unusual activity on your account and just need to confirm it is you. Please go ahead and enter your one-time verification code now.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 5. SHARP — Polly.Aria
  //    Clear, distinct, slightly edgy New Zealand female. Stands out.
  //    Best for: tech companies, social media platforms, 2FA alerts.
  // ─────────────────────────────────────────────────────────────────────────
  {
    id:      'Polly.Aria',
    label:   'Sharp',
    accent:  'Clear & Distinct',
    gender:  'F',
    flag:    '🎯',
    best_for: 'Tech · Social Media · 2FA Alerts',
    sample:  'Hello. This is an automated security alert. A sign-in attempt was detected from an unrecognised device. Please state your verification code to confirm it was you, or stay on the line to speak with our security team.',
  },
];

export const DEFAULT_VOICE = VOICES[0]!; // Smooth (Polly.Joanna)

export function getVoice(id: string): VoiceDef {
  return VOICES.find(v => v.id === id) ?? DEFAULT_VOICE;
}

// ── Per-user selected voice ───────────────────────────────────────────────────
const userVoice = new Map<number, string>();

export function getUserVoice(chatId: number): string {
  return userVoice.get(chatId) ?? DEFAULT_VOICE.id;
}

export function setUserVoice(chatId: number, voiceId: string): void {
  if (VOICES.some(v => v.id === voiceId)) userVoice.set(chatId, voiceId);
}
