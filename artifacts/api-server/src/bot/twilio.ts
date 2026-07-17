/**
 * SignalWire voice call service — uses the SignalWire REST API directly via
 * native fetch (no Twilio SDK in this file).
 *
 * Why native fetch and not the Twilio SDK?
 *   Twilio SDK v4 validates that accountSid starts with "AC".
 *   SignalWire Project IDs don't start with "AC" so the SDK throws immediately.
 *   The REST API itself is 100% compatible — we just call it ourselves.
 *
 * Required secrets:
 *   SIGNALWIRE_PROJECT_ID   — your SignalWire Project ID
 *   SIGNALWIRE_API_TOKEN    — your SignalWire API token
 *   SIGNALWIRE_SPACE_URL    — e.g. "yourspace.signalwire.com"
 *   SIGNALWIRE_FROM_NUMBER  — your purchased SignalWire DID in E.164 format
 *
 * Optional:
 *   SIGNALWIRE_SPOOF_NUMBER — default caller-ID override if not set per-user
 */

import { logger } from '../lib/logger.js';

// ── Credentials helper ────────────────────────────────────────────────────────
function getCreds() {
  const projectId = process.env['SIGNALWIRE_PROJECT_ID'];
  const apiToken  = process.env['SIGNALWIRE_API_TOKEN'];
  const spaceUrl  = (process.env['SIGNALWIRE_SPACE_URL'] ?? '').replace(/^https?:\/\//, '');

  if (!projectId || !apiToken || !spaceUrl) {
    throw new Error(
      'SignalWire credentials not configured. ' +
      'Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_API_TOKEN and SIGNALWIRE_SPACE_URL in Secrets.',
    );
  }

  // Basic auth header
  const auth = Buffer.from(`${projectId}:${apiToken}`).toString('base64');

  // Base REST URL — SignalWire LaML-compatible REST API
  const baseUrl = `https://${spaceUrl}/api/laml/2010-04-01/Accounts/${projectId}`;

  return { projectId, auth, baseUrl };
}

// ── Low-level REST call helper ────────────────────────────────────────────────
async function swFetch(
  method: 'POST',
  url: string,
  auth: string,
  body: Record<string, string>,
): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization:  `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept:         'application/json',
    },
    body: new URLSearchParams(body).toString(),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`SignalWire API ${res.status}: ${text.slice(0, 300)}`);
  }

  try { return JSON.parse(text); } catch { return text; }
}

// ── Outbound call ─────────────────────────────────────────────────────────────
/**
 * Place an outbound call via SignalWire.
 *
 * @param to        Target phone number (E.164)
 * @param voiceUrl  Public URL SignalWire will POST to when the call is answered
 * @param callerId  Caller-ID to show (E.164). Verified number in your SW space.
 *                  Falls back to SIGNALWIRE_SPOOF_NUMBER then SIGNALWIRE_FROM_NUMBER.
 * @returns         SignalWire Call SID
 */
export async function makeCall(
  to: string,
  voiceUrl: string,
  callerId?: string,
): Promise<string> {
  const from = callerId
    || process.env['SIGNALWIRE_SPOOF_NUMBER']
    || process.env['SIGNALWIRE_FROM_NUMBER'];

  if (!from) {
    throw new Error(
      'No caller-ID configured. Set SIGNALWIRE_FROM_NUMBER in Secrets.',
    );
  }

  const { auth, baseUrl } = getCreds();

  // Status-callback: replace last path segment with /status
  const statusCallbackUrl = voiceUrl.replace(/\/[^/]+(\?.*)?$/, '/status');

  const data = await swFetch('POST', `${baseUrl}/Calls.json`, auth, {
    To:                   to,
    From:                 from,
    Url:                  voiceUrl,
    StatusCallback:       statusCallbackUrl,
    StatusCallbackMethod: 'POST',
    StatusCallbackEvent:  'initiated ringing answered completed',
  });

  const sid: string = data?.sid ?? data?.Sid ?? '';
  logger.info({ callSid: sid, to, from }, 'SignalWire call created');
  return sid;
}

// ── Hang up ───────────────────────────────────────────────────────────────────
/**
 * Terminate an active call by SID.
 */
export async function hangupCall(callSid: string): Promise<void> {
  const { auth, baseUrl } = getCreds();
  await swFetch('POST', `${baseUrl}/Calls/${callSid}.json`, auth, {
    Status: 'completed',
  });
  logger.info({ callSid }, 'SignalWire call terminated');
}

// ── Hold / unhold via call-redirect ──────────────────────────────────────────
/**
 * Redirect a live call to a different webhook (e.g. /hold for music).
 */
export async function holdCall(callSid: string, holdUrl: string): Promise<void> {
  const { auth, baseUrl } = getCreds();
  await swFetch('POST', `${baseUrl}/Calls/${callSid}.json`, auth, {
    Url:    holdUrl,
    Method: 'POST',
  });
  logger.info({ callSid, holdUrl }, 'SignalWire call redirected');
}

/**
 * Resume a held call by redirecting back to the voice webhook.
 */
export async function resumeCall(callSid: string, voiceUrl: string): Promise<void> {
  const { auth, baseUrl } = getCreds();
  await swFetch('POST', `${baseUrl}/Calls/${callSid}.json`, auth, {
    Url:    voiceUrl,
    Method: 'POST',
  });
  logger.info({ callSid }, 'SignalWire call resumed');
}
