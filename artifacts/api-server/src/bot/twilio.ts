/**
 * SignalWire voice call service  (Twilio-compatible REST API — same SDK, 60-80% cheaper)
 *
 * Required secrets:
 *   SIGNALWIRE_PROJECT_ID   — your SignalWire Project ID (acts as Account SID)
 *   SIGNALWIRE_API_TOKEN    — your SignalWire API token  (acts as Auth Token)
 *   SIGNALWIRE_SPACE_URL    — e.g. "yourspace.signalwire.com"
 *   SIGNALWIRE_FROM_NUMBER  — your purchased SignalWire DID in E.164 format
 *
 * Optional:
 *   SIGNALWIRE_SPOOF_NUMBER — default caller-ID override if not set per-user
 *
 * SignalWire uses the exact same REST API and TwiML (LaML) format as Twilio.
 * The Twilio SDK works against SignalWire by passing a custom lamlBaseUrl.
 */

import Twilio from 'twilio';
import { logger } from '../lib/logger.js';

// ── Build a SignalWire-pointing Twilio SDK client ─────────────────────────────
function getClient() {
  const projectId = process.env['SIGNALWIRE_PROJECT_ID'];
  const apiToken  = process.env['SIGNALWIRE_API_TOKEN'];
  const spaceUrl  = process.env['SIGNALWIRE_SPACE_URL'];

  if (!projectId || !apiToken) {
    throw new Error(
      'SignalWire credentials not configured. ' +
      'Set SIGNALWIRE_PROJECT_ID and SIGNALWIRE_API_TOKEN in Secrets.',
    );
  }

  const clientOpts: any = {};
  if (spaceUrl) {
    // Point the Twilio REST client at the SignalWire LaML/REST endpoint
    clientOpts.lamlBaseUrl = `https://${spaceUrl.replace(/^https?:\/\//, '')}`;
  }

  return Twilio(projectId, apiToken, clientOpts);
}

// ── Outbound call ─────────────────────────────────────────────────────────────
/**
 * Place an outbound call via SignalWire.
 *
 * @param to        Target phone number (E.164, e.g. +14155552671)
 * @param voiceUrl  Public URL SignalWire will POST to when the call is answered
 * @param callerId  Caller-ID to display (E.164).  Must be verified in your
 *                  SignalWire space.  Falls back to SIGNALWIRE_FROM_NUMBER.
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

  // Derive status-callback URL: replace last path segment with /status
  const statusCallbackUrl = voiceUrl.replace(/\/[^/]+(\?.*)?$/, '/status');

  const client = getClient();
  const call   = await client.calls.create({
    to,
    from,
    url:                  voiceUrl,
    statusCallback:       statusCallbackUrl,
    statusCallbackMethod: 'POST',
    statusCallbackEvent:  ['initiated', 'ringing', 'answered', 'completed'],
  });

  logger.info({ callSid: call.sid, to, from }, 'SignalWire call created');
  return call.sid;
}

// ── Hang up ───────────────────────────────────────────────────────────────────
/**
 * Terminate an active call by SID.
 */
export async function hangupCall(callSid: string): Promise<void> {
  const client = getClient();
  await client.calls(callSid).update({ status: 'completed' });
  logger.info({ callSid }, 'SignalWire call terminated');
}

// ── Hold / unhold via call-redirect ──────────────────────────────────────────
/**
 * Redirect a live call to the /hold webhook (plays music + TTS).
 * Requires the hold webhook to be registered in your routes.
 */
export async function holdCall(callSid: string, holdUrl: string): Promise<void> {
  const client = getClient();
  await client.calls(callSid).update({ url: holdUrl, method: 'POST' });
  logger.info({ callSid, holdUrl }, 'SignalWire call redirected to hold');
}

/**
 * Resume a held call by redirecting back to the voice webhook.
 */
export async function resumeCall(callSid: string, voiceUrl: string): Promise<void> {
  const client = getClient();
  await client.calls(callSid).update({ url: voiceUrl, method: 'POST' });
  logger.info({ callSid }, 'SignalWire call resumed');
}
