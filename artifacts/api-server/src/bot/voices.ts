/**
 * ZxOTP BOT — Voice definitions
 *
 * All voices are Amazon Polly voices delivered via Twilio <Say>.
 * Each script category has its own curated voice to sound authentic.
 * The preview sample is spoken aloud when the user clicks "Preview Voice".
 */

export interface VoiceDef {
  id:      string;    // Polly voice ID passed to <Say voice="…">
  label:   string;    // display name shown in menus
  accent:  string;    // short accent description
  gender:  'M' | 'F';
  sample:  string;    // TTS phrase played as preview
  flag:    string;    // emoji flag
  best_for?: string;  // suggested use case
}

export const VOICES: VoiceDef[] = [
  // ── US English (Female) ───────────────────────────────────────────────────
  {
    id:      'Polly.Joanna',
    label:   'Joanna',
    accent:  'US English',
    gender:  'F',
    flag:    '🇺🇸',
    best_for: 'Banks, General',
    sample:  'Hello, this is an automated security verification call from your financial institution. Please state the one-time code sent to your registered mobile number.',
  },
  {
    id:      'Polly.Salli',
    label:   'Salli',
    accent:  'US English',
    gender:  'F',
    flag:    '🇺🇸',
    best_for: 'Retail, E-Commerce',
    sample:  'Hi there, this is a security alert from your account. We noticed unusual activity and need to verify your identity. Please provide your verification code now.',
  },
  {
    id:      'Polly.Kendra',
    label:   'Kendra',
    accent:  'US English',
    gender:  'F',
    flag:    '🇺🇸',
    best_for: 'Insurance, Finance',
    sample:  'Good day. This is an automated call regarding your account security. Suspicious activity has been detected. Please enter the six-digit verification code sent to your device.',
  },
  {
    id:      'Polly.Kimberly',
    label:   'Kimberly',
    accent:  'US English',
    gender:  'F',
    flag:    '🇺🇸',
    best_for: 'Tech, Social Media',
    sample:  'Hello. This is an important security notification. We have detected a login attempt from an unrecognized location. Please confirm your one-time passcode to secure your account.',
  },
  // ── US English (Male) ─────────────────────────────────────────────────────
  {
    id:      'Polly.Matthew',
    label:   'Matthew',
    accent:  'US English',
    gender:  'M',
    flag:    '🇺🇸',
    best_for: 'Banks, Crypto, Govt',
    sample:  'Hello, this is an important security alert from your financial institution. Your immediate attention is required. Please state the six-digit code sent to your phone.',
  },
  {
    id:      'Polly.Joey',
    label:   'Joey',
    accent:  'US English',
    gender:  'M',
    flag:    '🇺🇸',
    best_for: 'Crypto, Tech',
    sample:  'This is an urgent security notification. We have detected suspicious access to your account from an unrecognized device. Provide the verification code to continue.',
  },
  {
    id:      'Polly.Justin',
    label:   'Justin',
    accent:  'US English',
    gender:  'M',
    flag:    '🇺🇸',
    best_for: 'General, Telecom',
    sample:  'Hello, you have received an automated security call. Unusual activity has been flagged on your account. Please state your one-time passcode to verify your identity.',
  },
  // ── British English ───────────────────────────────────────────────────────
  {
    id:      'Polly.Amy',
    label:   'Amy',
    accent:  'British English',
    gender:  'F',
    flag:    '🇬🇧',
    best_for: 'UK Banks, Payment Platforms',
    sample:  'Hello, this is a security notification from your bank. We have detected unusual activity on your account and require your immediate verification. Please provide the code sent to your registered mobile.',
  },
  {
    id:      'Polly.Emma',
    label:   'Emma',
    accent:  'British English',
    gender:  'F',
    flag:    '🇬🇧',
    best_for: 'UK Banks, Insurance',
    sample:  'Good day. This is an automated security alert. Suspicious activity has been flagged on your account. To protect your funds, please state the one-time verification code we sent you.',
  },
  {
    id:      'Polly.Brian',
    label:   'Brian',
    accent:  'British English',
    gender:  'M',
    flag:    '🇬🇧',
    best_for: 'UK Banks, Government',
    sample:  'Hello, this is an important security call. We need to verify your identity before proceeding with this transaction. Please state the verification code sent to your registered number.',
  },
  // ── Australian English ─────────────────────────────────────────────────────
  {
    id:      'Polly.Nicole',
    label:   'Nicole',
    accent:  'Australian English',
    gender:  'F',
    flag:    '🇦🇺',
    best_for: 'AU Banks',
    sample:  'Hello, this is an automated security call. We have detected suspicious activity on your account and need to verify your identity. Please confirm your one-time passcode.',
  },
  {
    id:      'Polly.Russell',
    label:   'Russell',
    accent:  'Australian English',
    gender:  'M',
    flag:    '🇦🇺',
    best_for: 'AU Banks, Telecom',
    sample:  'G day. This is a security verification call from your financial institution. We have detected unusual login activity. Please enter your one-time code to confirm your identity.',
  },
  // ── New Zealand English ────────────────────────────────────────────────────
  {
    id:      'Polly.Aria',
    label:   'Aria',
    accent:  'New Zealand English',
    gender:  'F',
    flag:    '🇳🇿',
    best_for: 'AU/NZ Banks',
    sample:  'Hello, this is a security alert from your bank. Unusual activity has been detected on your account. Please provide the verification code sent to your registered mobile number.',
  },
  // ── Indian English ─────────────────────────────────────────────────────────
  {
    id:      'Polly.Aditi',
    label:   'Aditi',
    accent:  'Indian English',
    gender:  'F',
    flag:    '🇮🇳',
    best_for: 'Indian Banks, Asian',
    sample:  'Hello, this is an automated security alert. We have detected unusual activity and require your verification. Please provide the one-time password sent to your registered mobile number.',
  },
  {
    id:      'Polly.Raveena',
    label:   'Raveena',
    accent:  'Indian English',
    gender:  'F',
    flag:    '🇮🇳',
    best_for: 'South Asian Banks',
    sample:  'Hello, this is a security notification. Please provide the one-time password sent to your registered mobile number to verify your identity and protect your account.',
  },
  // ── European ──────────────────────────────────────────────────────────────
  {
    id:      'Polly.Celine',
    label:   'Céline',
    accent:  'French',
    gender:  'F',
    flag:    '🇫🇷',
    best_for: 'EU Banks, French',
    sample:  'Hello, this is an automated security call from your bank. We have detected suspicious activity on your account. Please provide your one-time verification code.',
  },
  {
    id:      'Polly.Vicki',
    label:   'Vicki',
    accent:  'German',
    gender:  'F',
    flag:    '🇩🇪',
    best_for: 'EU Banks, German',
    sample:  'Hello, this is an important security notification from your financial institution. Unusual activity has been detected. Please confirm your identity with the code sent to your mobile.',
  },
  {
    id:      'Polly.Conchita',
    label:   'Conchita',
    accent:  'Spanish',
    gender:  'F',
    flag:    '🇪🇸',
    best_for: 'Latin American Banks',
    sample:  'Hello, this is a security verification call. We have detected suspicious activity on your account. Please provide the one-time code sent to your registered phone number.',
  },
];

export const DEFAULT_VOICE = VOICES[0]!;

export function getVoice(id: string): VoiceDef {
  return VOICES.find(v => v.id === id) ?? DEFAULT_VOICE;
}

// ── Per-user selected voice ────────────────────────────────────────────────────
const userVoice = new Map<number, string>();

export function getUserVoice(chatId: number): string {
  return userVoice.get(chatId) ?? DEFAULT_VOICE.id;
}

export function setUserVoice(chatId: number, voiceId: string): void {
  if (VOICES.some(v => v.id === voiceId)) userVoice.set(chatId, voiceId);
}
