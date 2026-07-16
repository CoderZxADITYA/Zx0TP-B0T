# Deploying ZxOTP Bot — Render (Free) + Railway (PostgreSQL) + Cron Job

This guide deploys the bot for free using:
- **Render** — runs the Node.js API server + Telegram bot
- **Railway** — provides a free PostgreSQL database
- **cron-job.org** — pings the server every 14 min to keep it awake (Render free plan sleeps after 15 min)

---

## Part 1 — Railway PostgreSQL (do this first)

### 1. Create a Railway account
1. Go to [railway.app](https://railway.app) and sign up (GitHub login recommended)
2. Click **New Project** → **Deploy PostgreSQL**
3. Railway creates a Postgres instance automatically

### 2. Get the connection string
1. Click on your Postgres service
2. Go to the **Variables** tab
3. Copy the value of **`DATABASE_URL`** — it looks like:
   ```
   postgresql://postgres:AbCdEfGhIj123@monorail.proxy.rlwy.net:12345/railway
   ```
4. **Save this string** — you'll paste it into Render in Part 2.

### 3. Notes on Railway free tier
- **500 hours/month** of compute included on the free Hobby plan
- PostgreSQL storage: **1 GB** free
- The database stays alive even when Render sleeps — no data is lost

---

## Part 2 — Render Web Service

### 1. Push code to GitHub first
If you haven't already:
```bash
git init
git add .
git commit -m "Initial deploy"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 2. Create a Render account
Go to [render.com](https://render.com) and sign up (GitHub login recommended)

### 3. Create a new Web Service
1. Click **New +** → **Web Service**
2. Connect your GitHub repo
3. Fill in the settings:

| Setting | Value |
|---------|-------|
| **Name** | `zxotp-bot` (or anything) |
| **Region** | Pick closest to you |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Root Directory** | *(leave blank)* |
| **Build Command** | `npm install -g pnpm && pnpm install && pnpm --filter @workspace/api-server run build` |
| **Start Command** | `node artifacts/api-server/dist/index.mjs` |
| **Instance Type** | **Free** |

> ⚠️ If Render auto-detects a different build command, **override it** with the one above.

### 4. Add Environment Variables
Click **Environment** → **Add Environment Variable** for each:

| Key | Value |
|-----|-------|
| `TELEGRAM_BOT_TOKEN` | Your bot token from @BotFather |
| `DATABASE_URL` | The Railway connection string from Part 1 |
| `SESSION_SECRET` | Any random long string (e.g. `mySuperSecret123!`) — used to protect the `/admin/token` page |
| `TWILIO_ACCOUNT_SID` | Your Twilio Account SID *(optional — calls won't work without it)* |
| `TWILIO_AUTH_TOKEN` | Your Twilio Auth Token *(optional)* |
| `TWILIO_FROM_NUMBER` | Your Twilio phone number e.g. `+12025551234` *(optional)* |
| `NODE_ENV` | `production` |

> **Tip:** Mark sensitive values (tokens, secrets) as **Secret** in Render's UI.

### 5. Deploy
Click **Create Web Service**. Render will:
1. Clone your repo
2. Run the build command (~2 minutes)
3. Start the server
4. Assign a URL like `https://zxotp-bot.onrender.com`

**Check the logs** — you should see:
```
Server listening  port: 10000
DB state loaded   users: 0  licenses: 0
Telegram bot started (long polling)
```

If you see `Telegram bot started` — **the bot is live**.

### 6. Initialize the database tables
After deploy, the bot runs in in-memory mode until tables are created. Push the schema once:

**Option A — Render Shell** (easiest)
1. In Render dashboard → your service → **Shell** tab
2. Run:
   ```bash
   pnpm --filter @workspace/db run push
   ```
3. You should see `Tables created` or `Schema up to date`

**Option B — add to build command** (runs automatically on every deploy)
Change Build Command to:
```
npm install -g pnpm && pnpm install && pnpm --filter @workspace/api-server run build && pnpm --filter @workspace/db run push
```

---

## Part 3 — Cron Job (Keep Render Alive 24/7)

Render's free plan **sleeps your service after 15 minutes of no HTTP traffic**. A cron job pings it every 14 minutes to keep it awake.

### Option A — cron-job.org (recommended, totally free)
1. Go to [cron-job.org](https://cron-job.org) and create a free account
2. Click **Create Cronjob**
3. Fill in:

| Setting | Value |
|---------|-------|
| **Title** | `ZxOTP Bot Keepalive` |
| **URL** | `https://YOUR-APP.onrender.com/api/healthz` |
| **Execution schedule** | Every **14 minutes** |
| **Request method** | GET |

4. Click **Create** and make sure it shows **Active**

### Option B — UptimeRobot (also free)
1. Go to [uptimerobot.com](https://uptimerobot.com) — free tier: 50 monitors
2. **New Monitor** → **HTTP(s)** monitor
3. URL: `https://YOUR-APP.onrender.com/api/healthz`
4. Monitoring interval: **5 minutes** (more aggressive, keeps it reliably awake)
5. It also **alerts you if the bot goes down** — bonus!

### Option C — GitHub Actions (no third-party needed)
Create `.github/workflows/keepalive.yml`:
```yaml
name: Keep Render Alive
on:
  schedule:
    - cron: '*/14 * * * *'   # every 14 minutes
  workflow_dispatch:          # allows manual trigger

jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping health endpoint
        run: curl -s https://YOUR-APP.onrender.com/api/healthz
```
Push this file to your repo — GitHub Actions runs it for free on public repos.

---

## Part 4 — Twilio Webhook URL

For the bot to receive spoken OTPs from callees, Twilio must be able to reach your server. After Render deploys:

1. Note your Render URL: `https://zxotp-bot.onrender.com`
2. In your Twilio console → Phone Numbers → your number → Voice & Fax:
   - **A call comes in:** `https://zxotp-bot.onrender.com/api/twilio/voice`
   - **Status callback:** `https://zxotp-bot.onrender.com/api/twilio/status`

The bot auto-configures these URLs from `REPLIT_DEV_DOMAIN` locally, or from the server's hostname in production.

---

## Part 5 — Verify Everything Works

1. **Visit** `https://YOUR-APP.onrender.com/api/healthz` — should return `{"status":"ok"}`
2. **Open** `https://YOUR-APP.onrender.com/admin/token` — should show the admin token panel
3. **Open Telegram**, find your bot (`@ZxOTP_bot` or whatever you named it)
4. Send `/start` — the welcome message should appear
5. Send `/license` — should show "no active license"
6. Go to Telegram, talk to yourself as admin: `/admin` → `Generate 1-Day Key` → copy the key → `/redeem KEY`
7. Try `/otp`, enter a phone number — if Twilio is configured, the call goes out

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Telegram bot failed to start` in logs | Check `TELEGRAM_BOT_TOKEN` is set correctly in Render env vars |
| Bot responds but calls fail | Add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| Database errors in logs | Run `pnpm --filter @workspace/db run push` via Render Shell |
| Bot goes offline after ~15 min | Set up the cron job in Part 3 |
| Build fails | Make sure Build Command starts with `npm install -g pnpm &&` |
| `/admin/token` says wrong password | The password is your `SESSION_SECRET` env var |

---

## Summary — All URLs

| URL | Purpose |
|-----|---------|
| `https://YOUR-APP.onrender.com/api/healthz` | Health check (ping this with cron) |
| `https://YOUR-APP.onrender.com/api/twilio/voice` | Twilio voice webhook |
| `https://YOUR-APP.onrender.com/api/twilio/gather` | Twilio gather webhook |
| `https://YOUR-APP.onrender.com/api/twilio/status` | Twilio status callback |
| `https://YOUR-APP.onrender.com/admin/token` | Web UI to change bot token |

---

## Cost Summary

| Service | Cost |
|---------|------|
| Render Web Service | **Free** (750 hrs/month — enough for 24/7 with cron) |
| Railway PostgreSQL | **Free** (500 hrs/month, 1 GB storage) |
| cron-job.org | **Free** |
| UptimeRobot | **Free** (50 monitors) |
| Twilio (calls) | ~$0.013/min outbound + $1/month per number |
| **Total (no calls)** | **$0/month** |
