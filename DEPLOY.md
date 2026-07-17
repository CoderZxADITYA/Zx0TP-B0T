# 🚀 Deployment Guide — ZxOTP Bot

Simple step-by-step guide to deploy your bot on **Render** (free hosting) with **Railway** (free database) and **SignalWire** (cheap calls).

---

## What You Need

| Thing | Where | Cost |
|---|---|---|
| **Render** account | render.com | Free |
| **Railway** account | railway.app | Free (500 hrs/month) |
| **SignalWire** account | signalwire.com | Free ($5 credit given on signup) |
| **GitHub** repo | github.com | Free |
| **cron-job.org** account | cron-job.org | Free |

---

## Step 1 — Push Code to GitHub

You need your code on GitHub so Render can deploy it automatically.

Run these commands in your **Replit shell**:

```bash
# First time only — add your GitHub repo as remote
git remote add origin https://github.com/YOURNAME/YOURREPO.git

# Push your code
git push -u origin main
```

> If you get a permission error, create a **Personal Access Token** on GitHub:
> Settings → Developer Settings → Personal Access Tokens → Generate new token (classic)
> Give it `repo` scope. Use it as your password when git asks.

---

## Step 2 — Set Up Railway Database

Railway gives you a free PostgreSQL database. Your bot auto-creates all tables on startup — you don't need to do anything else.

1. Go to **railway.app** → sign up
2. Click **New Project** → **Deploy PostgreSQL**
3. Once it's created, click the **PostgreSQL** service
4. Go to the **Connect** tab
5. Copy the **Public URL** — it looks like:
   ```
   postgresql://postgres:PASSWORD@roundhouse.proxy.rlwy.net:PORT/railway
   ```
6. **Save this URL** — you'll need it in Step 3.

> 💡 Free plan gives 500 hours/month and 1 GB storage — more than enough for this bot.

---

## Step 3 — Get a Free SignalWire Number

SignalWire gives you **$5.00 free credit** on signup. A US number costs **$1/month**, so you get 5 months free.

### Sign up and get credentials:

1. Go to **signalwire.com** → Create account
2. Pick a **Space name** (e.g. `myzxotp`) — this becomes your Space URL:
   `myzxotp.signalwire.com`
3. Go to **Phone Numbers** → **Get a Number**
4. Search by area code → pick any number → **Buy** (uses $1 from your free credit)
5. The number you bought (e.g. `+12025551234`) → this is `SIGNALWIRE_FROM_NUMBER`

### Get your API credentials:

1. In your SignalWire dashboard → left sidebar → **API**
2. Copy your **Project ID** → this is `SIGNALWIRE_PROJECT_ID`
3. Create a new **API Token** → copy it → this is `SIGNALWIRE_API_TOKEN`
4. Your Space URL (e.g. `myzxotp.signalwire.com`) → this is `SIGNALWIRE_SPACE_URL`

### Point the number at your bot:

*(Do this after Step 4 so you have your Render URL)*

1. Click your phone number → **Edit**
2. Under **Voice & Fax** → set **Handle Calls Using** → `LaML Webhooks`
3. Set **When a call comes in** (POST) to:
   ```
   https://YOUR-APP.onrender.com/api/twilio/voice
   ```
4. Save

---

## Step 4 — Deploy on Render

### Create the Web Service:

1. Go to **render.com** → sign up → **New** → **Web Service**
2. Connect your GitHub account → select your repo
3. Fill in these settings:

| Setting | Value |
|---|---|
| **Root Directory** | `artifacts/api-server` |
| **Runtime** | Node |
| **Build Command** | `npm install -g pnpm && pnpm install && pnpm --filter @workspace/db run build && pnpm --filter @workspace/api-server run build` |
| **Start Command** | `node --enable-source-maps ./dist/index.mjs` |
| **Plan** | Free |

### Add Environment Variables:

Go to **Environment** tab and add all of these:

```
BOT_TOKEN               = your Telegram bot token (from @BotFather)
SESSION_SECRET          = any random string of 32+ characters
DATABASE_URL            = the Railway URL you copied in Step 2
SIGNALWIRE_PROJECT_ID   = from SignalWire API page
SIGNALWIRE_API_TOKEN    = from SignalWire API page
SIGNALWIRE_SPACE_URL    = e.g. myzxotp.signalwire.com
SIGNALWIRE_FROM_NUMBER  = your SignalWire number e.g. +12025551234
NODE_ENV                = production
PUBLIC_URL              = https://YOUR-APP-NAME.onrender.com
```

> ⚠️ **`PUBLIC_URL` is critical** — SignalWire sends call events to this URL. Get your Render app URL from the top of the service page and paste it here **before** deploying.

Click **Create Web Service** → Render will build and deploy automatically.

> ✅ The bot creates all database tables automatically on first startup. No manual SQL needed.

---

## Step 5 — Keep the Bot Awake (Cron Job)

Render's free plan **pauses your app** after 15 minutes of no traffic. This would stop your bot. Fix it for free using **cron-job.org**.

1. Go to **cron-job.org** → sign up → **Create Cronjob**
2. Set **URL** to:
   ```
   https://YOUR-APP-NAME.onrender.com/
   ```
3. Set schedule to **every 10 minutes**:
   - Select "Every day" → set interval to 10 minutes
4. Enable → **Create**

That's it — the pinger keeps your app awake 24/7 for free.

---

## Step 6 — After First Deploy: Point SignalWire at Your URL

Now that you have your Render URL, go back to your SignalWire number settings (Step 3 → "Point the number") and set the webhook URL to:

```
https://YOUR-APP-NAME.onrender.com/api/twilio/voice
```

---

## ✅ Everything Should Work Now

Your bot flow end-to-end:

```
Telegram operator sends /call command
       ↓
Render server places call via SignalWire REST API
       ↓
Target's phone rings (shows your SignalWire number or spoof number)
       ↓
Target answers → SignalWire calls your webhook at /api/twilio/voice
       ↓
Bot plays TTS script, gathers OTP via voice or keypad
       ↓
Result sent back to Telegram operator
       ↓
Operator presses IVR buttons to hold / transfer / hang up
```

---

## 🔁 Updating the Bot

Every time you push code to GitHub, Render auto-deploys:

```bash
git add -A
git commit -m "your change description"
git push
```

Render builds and redeploys in ~2 minutes. Bot stays live with zero downtime.

---

## 🛠️ Troubleshooting

| Problem | Fix |
|---|---|
| Bot not responding in Telegram | Check Render logs → look for startup errors |
| Calls not going through | Make sure all 4 SIGNALWIRE_* env vars are set correctly |
| Calls going through but no webhook received | Check PUBLIC_URL is set to your exact Render URL (no trailing slash) |
| Database errors on startup | Check DATABASE_URL is the Railway **public** URL, not the internal one |
| App keeps sleeping | Make sure cron-job.org is pinging every 10 minutes |
| SignalWire number not working | Check the number's webhook URL is pointing to your Render URL |

---

## 📋 Environment Variables Quick Reference

```
BOT_TOKEN               → @BotFather in Telegram
SESSION_SECRET          → any random string (e.g. generate at randomkeygen.com)
DATABASE_URL            → Railway → PostgreSQL → Connect → Public URL
SIGNALWIRE_PROJECT_ID   → SignalWire → API → Project ID
SIGNALWIRE_API_TOKEN    → SignalWire → API → Create Token
SIGNALWIRE_SPACE_URL    → yourspace.signalwire.com (no https://)
SIGNALWIRE_FROM_NUMBER  → your SignalWire DID in E.164 e.g. +12025551234
SIGNALWIRE_SPOOF_NUMBER → optional — default spoof caller ID
NODE_ENV                → production
PUBLIC_URL              → https://your-app-name.onrender.com
```
