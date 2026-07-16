/**
 * Admin web panel — /admin
 *
 * Provides a browser-accessible form for:
 *   • Setting / changing the Telegram bot token
 *   • Viewing bot status
 *
 * Protected by a simple password (SESSION_SECRET env var, or "admin" fallback).
 * Access: GET /admin/token  → renders the form
 *         POST /admin/token → saves token to DB settings, optionally restarts bot
 */

import { Router, type Request, type Response } from 'express';
import { dbGetSetting, dbSetSetting } from '../bot/persist.js';
import { startBot }                   from '../bot/bot.js';
import { logger }                     from '../lib/logger.js';

const router = Router();

// ── Simple password gate ───────────────────────────────────────────────────────
function checkPassword(req: Request): boolean {
  const expected = process.env['SESSION_SECRET'] ?? 'admin';
  const supplied  = (req.headers['x-admin-password'] as string | undefined) ||
                    (req.body as Record<string, string>)['password'] || '';
  return supplied === expected;
}

// ── HTML helpers ───────────────────────────────────────────────────────────────
const PAGE = (content: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ZxOTP Admin — Bot Token</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:      #0d0d0f;
      --surface: #16181d;
      --card:    #1e2128;
      --border:  #2e3140;
      --accent:  #5b73ff;
      --accent2: #4dffb4;
      --danger:  #ff4d6d;
      --warn:    #ffb84d;
      --text:    #e8eaf0;
      --muted:   #7a7f94;
      --radius:  12px;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
      font-size: 15px;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .container { width: 100%; max-width: 520px; }

    .logo {
      text-align: center;
      margin-bottom: 32px;
    }
    .logo-icon {
      width: 64px; height: 64px;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      border-radius: 18px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 30px;
      margin-bottom: 14px;
    }
    .logo h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
    .logo p  { color: var(--muted); font-size: 13px; margin-top: 4px; }

    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 28px;
      margin-bottom: 16px;
    }

    .card h2 {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 18px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .card h2 span.badge {
      font-size: 11px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 2px 10px;
      color: var(--muted);
      font-weight: 500;
    }

    label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 8px;
    }

    input[type="text"],
    input[type="password"] {
      width: 100%;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 14px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      padding: 11px 14px;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(91,115,255,0.15);
    }
    input::placeholder { color: var(--muted); opacity: 0.6; }

    .hint {
      font-size: 12px;
      color: var(--muted);
      margin-top: 8px;
      line-height: 1.5;
    }
    .hint a { color: var(--accent2); text-decoration: none; }
    .hint a:hover { text-decoration: underline; }

    .field { margin-bottom: 20px; }

    .row { display: flex; gap: 10px; }

    button {
      flex: 1;
      padding: 12px 18px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s, transform 0.1s;
    }
    button:active { transform: scale(0.97); }

    .btn-primary {
      background: linear-gradient(135deg, var(--accent), #7b5fff);
      color: #fff;
    }
    .btn-secondary {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
    }
    .btn-danger {
      background: var(--danger);
      color: #fff;
    }

    .status {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 20px;
    }
    .status.ok      { background: rgba(77,255,180,0.08); border: 1px solid rgba(77,255,180,0.2); color: var(--accent2); }
    .status.warn    { background: rgba(255,184,77,0.08); border: 1px solid rgba(255,184,77,0.2); color: var(--warn); }
    .status.err     { background: rgba(255,77,109,0.08); border: 1px solid rgba(255,77,109,0.2); color: var(--danger); }
    .status .dot    { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex-shrink: 0; }

    .flash {
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 20px;
      font-weight: 500;
    }
    .flash.success { background: rgba(77,255,180,0.1); border: 1px solid rgba(77,255,180,0.25); color: var(--accent2); }
    .flash.error   { background: rgba(255,77,109,0.1); border: 1px solid rgba(255,77,109,0.25); color: var(--danger); }

    .divider {
      border: none;
      border-top: 1px solid var(--border);
      margin: 20px 0;
    }

    .footer {
      text-align: center;
      font-size: 12px;
      color: var(--muted);
      margin-top: 8px;
    }

    .token-preview {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 12px;
      color: var(--muted);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      word-break: break-all;
    }

    .steps {
      list-style: none;
      counter-reset: steps;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .steps li {
      counter-increment: steps;
      display: flex;
      gap: 12px;
      font-size: 13px;
      color: var(--muted);
      line-height: 1.4;
    }
    .steps li::before {
      content: counter(steps);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--surface);
      border: 1px solid var(--border);
      font-size: 11px;
      font-weight: 700;
      color: var(--accent);
      flex-shrink: 0;
      margin-top: 1px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <div class="logo-icon">🤖</div>
      <h1>ZxOTP Bot Admin</h1>
      <p>Bot Token Configuration</p>
    </div>
    ${content}
    <p class="footer">ZxOTP Bot &nbsp;•&nbsp; Admin Panel</p>
  </div>
</body>
</html>`;

// ── GET /admin/token — show form ──────────────────────────────────────────────
router.get('/token', async (_req: Request, res: Response) => {
  const stored   = await dbGetSetting('bot_token_override');
  const envToken = process.env['TELEGRAM_BOT_TOKEN'];
  const active   = stored || envToken;

  const tokenStatus = active
    ? `<div class="status ok"><span class="dot"></span> Token is set — bot is active</div>`
    : `<div class="status err"><span class="dot"></span> No token configured — bot is offline</div>`;

  const preview = active
    ? `<div class="token-preview">${maskToken(active)}</div>`
    : '';

  const source = stored
    ? `<p class="hint">Source: <strong>Database override</strong> (set via this panel)</p>`
    : envToken
    ? `<p class="hint">Source: <strong>Environment variable</strong> TELEGRAM_BOT_TOKEN</p>`
    : '';

  res.send(PAGE(`
    <!-- Current status -->
    <div class="card">
      <h2>🔑 Current Token <span class="badge">STATUS</span></h2>
      ${tokenStatus}
      ${preview}
      ${source}
    </div>

    <!-- Token form -->
    <div class="card">
      <h2>✏️ Set New Token <span class="badge">FROM @BOTFATHER</span></h2>

      <form method="POST" action="/api/admin/token" autocomplete="off">
        <div class="field">
          <label>Admin Password</label>
          <input type="password" name="password" placeholder="Enter admin password" required />
          <p class="hint">Default password is your SESSION_SECRET env var.</p>
        </div>

        <div class="field">
          <label>New Bot Token</label>
          <input
            type="text"
            name="token"
            placeholder="1234567890:ABCDEFghijklMNOpqrsTUVwxyz123"
            pattern="\\d{8,12}:[A-Za-z0-9_\\-]{30,50}"
            title="Must be a valid Telegram bot token"
            autocomplete="off"
            spellcheck="false"
            required
          />
          <p class="hint">
            Get your token from
            <a href="https://t.me/BotFather" target="_blank">@BotFather</a>
            → /newbot or /mybots → API Token.
          </p>
        </div>

        <hr class="divider" />

        <div class="row">
          <button type="submit" name="action" value="save" class="btn-primary">💾 Save Token</button>
          <button type="submit" name="action" value="save_restart" class="btn-secondary">💾 Save &amp; Restart Bot</button>
        </div>
      </form>
    </div>

    <!-- How to get a token -->
    <div class="card">
      <h2>📖 How to get a token</h2>
      <ol class="steps">
        <li>Open Telegram and search for <strong>@BotFather</strong></li>
        <li>Send <code>/newbot</code> and follow the prompts to create your bot</li>
        <li>BotFather will give you a token like <code>1234567890:ABC...</code></li>
        <li>Paste it above and click Save Token</li>
        <li>Restart the API server for changes to take effect</li>
      </ol>
    </div>
  `));
});

// ── POST /admin/token — save token ───────────────────────────────────────────
router.post('/token', async (req: Request, res: Response) => {
  const body   = req.body as Record<string, string>;
  const action = body['action'] ?? 'save';

  // Password check
  if (!checkPassword(req)) {
    const html = PAGE(`
      <div class="card">
        <div class="flash error">❌ Incorrect password. <a href="/api/admin/token">Try again</a>.</div>
      </div>
    `);
    res.status(403).send(html);
    return;
  }

  const newToken = (body['token'] ?? '').trim();

  // Validate token format
  if (!/^\d{8,12}:[A-Za-z0-9_\-]{30,50}$/.test(newToken)) {
    const html = PAGE(`
      <div class="card">
        <div class="flash error">❌ Invalid token format. Expected: <code>1234567890:ABCDEFghijklMNOpqrsTUVwxyz123</code></div>
        <a href="/admin/token">← Go back</a>
      </div>
    `);
    res.status(400).send(html);
    return;
  }

  // Save to DB
  await dbSetSetting('bot_token_override', newToken);
  logger.info('Bot token updated via admin web panel');

  // Attempt hot-restart if requested
  let restartNote = `
    <p class="hint" style="margin-top:12px;">
      ⚠️ <strong>Restart the API server</strong> to apply the new token.
      The token is saved — it will be loaded on next startup.
    </p>`;

  if (action === 'save_restart') {
    try {
      // Restart in background (allow response to send first)
      setTimeout(async () => {
        try {
          await startBot();
          logger.info('Bot restarted with new token (hot reload)');
        } catch (e) {
          logger.error({ e }, 'Bot hot-restart failed');
        }
      }, 800);
      restartNote = `
        <p class="hint" style="margin-top:12px; color:var(--accent2);">
          ✅ Bot restart initiated. The new token is being applied.
        </p>`;
    } catch (e) {
      logger.error({ e }, 'Bot restart error');
    }
  }

  const html = PAGE(`
    <div class="card">
      <div class="flash success">✅ Token saved successfully!</div>

      <div class="status ok">
        <span class="dot"></span>
        New token stored in database: <strong>${maskToken(newToken)}</strong>
      </div>

      ${restartNote}

      <hr class="divider" />

      <div class="row" style="margin-top:4px;">
        <a href="/api/admin/token" style="flex:1; text-decoration:none;">
          <button type="button" class="btn-secondary" style="width:100%;">← Back to Token Panel</button>
        </a>
      </div>
    </div>

    <div class="card">
      <h2>📖 What happens next?</h2>
      <ol class="steps">
        <li>The new token is stored in the database and will survive server restarts</li>
        <li>Restart the API server workflow — the bot will automatically connect with the new token</li>
        <li>Send <strong>/start</strong> to your bot on Telegram to confirm it responds</li>
      </ol>
    </div>
  `);

  res.send(html);
});

// ── DELETE token (clear override) ─────────────────────────────────────────────
router.post('/token/clear', async (req: Request, res: Response) => {
  if (!checkPassword(req)) { res.status(403).json({ error: 'Unauthorized' }); return; }
  await dbSetSetting('bot_token_override', '');
  logger.info('Bot token override cleared via admin web panel');
  res.redirect('/api/admin/token');
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function maskToken(token: string): string {
  const [id, secret] = token.split(':');
  if (!secret) return token;
  const visible = secret.slice(0, 6);
  return `${id}:${visible}${'•'.repeat(Math.max(0, secret.length - 6))}`;
}

export default router;
