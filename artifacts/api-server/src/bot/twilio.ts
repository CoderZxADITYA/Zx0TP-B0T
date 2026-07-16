/**
 * Twilio voice call service.
 * Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER in secrets.
 */

import Twilio from 'twilio';
import { logger } from '../lib/logger.js';

function getClient() {
  const sid = process.env['TWILIO_ACCOUNT_SID'];
  const token = process.env['TWILIO_AUTH_TOKEN'];
  if (!sid || !token) {
    throw new Error('Twilio credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)');
  }
  return Twilio(sid, token);
}

/**
 * Initiate an outbound call.
 * @param to         E.164 phone number e.g. +14155552671
 * @param voiceUrl   Full URL Twilio POSTs to when the call is answered
 * @param callerId   Optional spoof caller ID (E.164) — must be a Twilio-verified number
 *                   or a Twilio number in your account. Falls back to TWILIO_FROM_NUMBER.
 * @returns Twilio CallSid
 */
export async function makeCall(
  to: string,
  voiceUrl: string,
  callerId?: string,
): Promise<string> {
  const from = callerId || process.env['TWILIO_FROM_NUMBER'];
  if (!from) throw new Error('TWILIO_FROM_NUMBER is not configured');

  // Derive status-callback URL from voiceUrl (replace trailing path with /status)
  const statusCallbackUrl = voiceUrl.replace(/\/[^/]+$/, '/status');

  const client = getClient();
  const call = await client.calls.create({
    to,
    from,
    url: voiceUrl,
    statusCallback: statusCallbackUrl,
    statusCallbackMethod: 'POST',
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
  });

  logger.info({ callSid: call.sid, to, from }, 'Twilio call created');
  return call.sid;
}

/**
 * Hang up an active call programmatically.
 */
export async function hangupCall(callSid: string): Promise<void> {
  const client = getClient();
  await client.calls(callSid).update({ status: 'completed' });
  logger.info({ callSid }, 'Twilio call terminated');
}
