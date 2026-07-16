# ZxOTP BOT — Deployment Guide

Complete guide: Render free plan + Railway PostgreSQL + cron job for 24/7 uptime.

---

## 1. Set up the Database on Railway

### Steps
1. Go to [railway.app](https://railway.app) → **New Project** → **Provision PostgreSQL**
2. Click the **PostgreSQL** service → **Variables** tab
3. Copy the value of **DATABASE_URL** (starts with `postgresql://`)
4. Keep this tab open — you'll paste it into Render in the next step

> Railway free tier gives 500 MB storage and 5 GB outbound data/month — enough for the bot.

---

## 2. Deploy the API Server on Render

### Steps
1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect your GitHub repo: `CoderZxADITYA/Zx0TP-B0T`
3. Fill in the settings:

| Field | Value |
|---|---|
| **Name** | `zxotp-bot` |
| **Region** | Oregon (US West) or Frankfurt |
| **Branch** | `main` |
| **Root Directory** | `artifacts/api-server` |
| **Runtime** | Node |
| **Build Command** | `npm install -g pnpm && pnpm install --frozen-lockfile && pnpm run build` |
| **Start Command** | `node dist/index.mjs` |
| **Plan** | Free |

4. Click **Environment** → **Add Environment Variable** for each:

| Key | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Your token from @BotFather |
| `DATABASE_URL` | Paste the Railway URL from Step 1 |
| `SESSION_SECRET` | Any long random string (32+ chars) |
| `TWILIO_ACCOUNT_SID` | Your Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Your Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Your Twilio phone number e.g. `+15005550006` |
| `NODE_ENV` | `production` |

5. Click **Create Web Service** → wait for the first deploy to finish (~3-5 min)
6. Copy your Render URL e.g. `https://zxotp-bot.onrender.com`

### DB tables are created automatically
The bot runs `CREATE TABLE IF NOT EXISTS` at startup — no manual migration needed.

---

## 3. Configure the Twilio Webhook

After the first successful deploy, set the Twilio webhook URLs:

1. Go to [twilio.com/console](https://twilio.com/console) → **Phone Numbers**
2. Click your number → **Voice Configuration**
3. Set **A call comes in** → **Webhook** → `https://zxotp-bot.onrender.com/api/twilio/voice`
4. Save

All Twilio sub-routes are handled automatically:
- `/api/twilio/voice` — incoming call TwiML
- `/api/twilio/gather` — OTP transcript
- `/api/twilio/dtmf` — keypad input
- `/api/twilio/status` — call status callbacks
- `/api/twilio/hold` — hold music
- `/api/twilio/transfer` — live transfer

---

## 4. Keep the Bot Running 24/7 (cron job)

Render free plan **spins down** the server after 15 minutes of inactivity. A cron job pings it every 10 minutes to prevent sleep.

### Option A — cron-job.org (recommended, free)
1. Go to [cron-job.org](https://cron-job.org) → **Sign up free**
2. Click **Create Cronjob**
3. Fill in:
   - **URL:** `https://zxotp-bot.onrender.com/health`
   - **Schedule:** Every 10 minutes (`*/10 * * * *`)
   - **Request method:** GET
4. Save → Enable

### Option B — UptimeRobot (free)
1. Go to [uptimerobot.com](https://uptimerobot.com) → **New Monitor**
2. **Monitor Type:** HTTP(s)
3. **URL:** `https://zxotp-bot.onrender.com/health`
4. **Monitoring Interval:** 5 minutes
5. Save → the bot stays alive indefinitely

> The `/health` route is already registered and returns `{"status":"ok"}`.

---

## 5. Verify Everything Works

After deploy + cron setup:

```
# Check server health
curl https://zxotp-bot.onrender.com/health

# Expected: {"status":"ok","uptime":...}
```

Then in Telegram:
1. Open your bot
2. Send `/start` — you should see the welcome screen
3. Send `/admin` — you should see the admin panel (owner only)

---

## 6. Set the Bot Token via Telegram (in-bot secure box)

You can change the bot token without touching Render:

1. Send `/admin` in Telegram (as the owner)
2. Tap **🔑 Change Token**
3. Paste the new token from @BotFather
4. Bot will show the masked token — type `YES` to confirm
5. **Restart the Render service** (Dashboard → Manual Deploy or click Restart)

---

## 7. Update the Bot (push new code)

```bash
git push origin main
```

Render auto-deploys on every push to `main`. You can also trigger a manual deploy from the Render dashboard.

---

## Architecture Summary

```
Telegram ──► Render (Node.js API server)
                ├── Telegraf bot (long polling)
                ├── Twilio webhooks (Express routes)
                └── PostgreSQL on Railway (optional — in-memory fallback)

cron-job.org ──► GET /health every 10 min ──► keeps Render awake
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Bot not responding | Check Render logs — is `TELEGRAM_BOT_TOKEN` set? |
| Calls not working | Check `TWILIO_*` env vars + webhook URL in Twilio console |
| DB errors in logs | Check `DATABASE_URL` is the full Railway connection string |
| Render spins down | Make sure cron-job.org / UptimeRobot is pinging `/health` |
| "Tables not found" | Delete and re-add `DATABASE_URL` in Render — bot auto-creates tables |
| New token not active | After saving token in Telegram, restart the Render service |
