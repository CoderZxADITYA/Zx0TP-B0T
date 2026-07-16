# ZxOTP Bot — Complete Command Reference

> Every command is described with its purpose, how to use it, and what happens step-by-step.

---

## 🔑 Access & Licensing

| Command | Usage | Description |
|---------|-------|-------------|
| `/start` | `/start` | Shows the welcome screen with quick-action buttons. Also registers you as a user. |
| `/info` | `/info` | Opens the main menu with all major sections as clickable buttons. |
| `/help` | `/help` | Displays this full command guide inside Telegram. |
| `/subscribe` | `/subscribe` | Shows subscription tiers, durations, and prices. |
| `/PURCHASE` | `/PURCHASE` | Shows the BTC and USDT wallet addresses for buying a license. |
| `/redeem` | `/redeem XXXX-XXXX-XXXX-XXXX` | Activates a license key. The key unlocks call features for its duration (1 day / 3 days / 7 days / 30 days / lifetime). |
| `/license` | `/license` | Displays your current license status and exactly how much time is left. |

---

## 📞 Call Modes — Full Flow

All call modes (unless marked "Quick") follow this interactive flow:

```
1. /command              → bot asks for TARGET phone number  (+1xxxxxxxxxx)
2. Enter target number   → bot asks for CALLER ID (spoof)    (or auto-fills if /setspoof is set)
3. Enter caller ID       → bot asks for BANK / INSTITUTION name
4. Enter bank name       → bot asks for VICTIM'S name
5. Enter victim name     → bot asks for LAST 4 DIGITS of card/account
6. Enter last 4          → bot shows REVIEW SCREEN
7. /accept  OR  /Decline → call goes out OR is cancelled
```

> **Shortcut:** Use `/setspoof +1xxxxxxxxxx` once — step 2 is skipped automatically from then on.

---

## 📱 Call Mode Commands

### Generic / Flexible Calls

| Command | Mode | Auto-Script | Description |
|---------|------|-------------|-------------|
| `/call` | Speech | None | Fully manual — you pick target, spoof, bank, name, card. Best for testing custom scripts. |
| `/otp` | Speech (Quick) | Your active script | **Fastest mode.** Only asks for the target phone number then calls immediately. No setup questions. Perfect for rapid-fire OTP grabs. |
| `/dtmf` | DTMF Keypad | Your active script | Calls the target and plays a prompt asking them to **enter digits on their keypad**. You receive the exact digits they press. Ideal for PIN / card number capture. |
| `/speed` | Speech | None | One-step speed call entry. |

### Bank / Financial

| Command | Mode | Auto-Script | Description |
|---------|------|-------------|-------------|
| `/bank` | Speech | `us_chase` (Chase Bank) | Plays a Chase Bank fraud alert script. Callee is asked to state their OTP. |
| `/bank2` | Speech | `us_boa` (Bank of America) | Bank of America account number capture script. |
| `/transfer` | Speech | `us_chase` | Wire transfer authorization call. Script sounds like the bank's wire department calling to confirm an unusual outgoing transfer. |
| `/vbv` | Speech | `card_visa` (Visa) | Verified-By-Visa 3D Secure script. Sounds like Visa's fraud prevention line calling before a large online purchase. |
| `/card3d` | DTMF | `card_visa` | 3D Secure card verification — DTMF mode. Target enters their card verification code on the keypad instead of speaking it. |
| `/pin` | DTMF | `us_wells` (Wells Fargo) | PIN capture. Bot plays a bank IVR prompt and captures the digits pressed. |
| `/pin2` | DTMF | `us_wells` | Double-PIN confirmation (target must enter PIN twice). Good for catching typos. |
| `/zelle` | Speech | `pay_zelle` | Zelle payment OTP — sounds like a Zelle fraud alert about a suspicious payment request. |

### Digital Wallets & Payments

| Command | Mode | Auto-Script | Description |
|---------|------|-------------|-------------|
| `/paypal` | Speech | `pay_paypal` | PayPal security verification. Script mimics PayPal's fraud prevention team. |
| `/venmo` | Speech | `pay_venmo` | Venmo fraud alert — someone is claiming to send money to a different account. |
| `/cashapp` | Speech | `pay_cashapp` | Cash App unusual activity alert. |
| `/wallet` | Speech | `pay_paypal` | Generic digital wallet OTP — no brand name spoken, suitable for any wallet service. |
| `/applepay` | Speech | `tec_apple` (Apple) | Apple Pay authorization call — sounds like Apple Security verifying a new device trying to add a card. |
| `/googlepay` | Speech | `pay_gpay` (Google Pay) | Google Pay fraud alert — unusual payment detected on Google account. |
| `/samsung` | Speech | `tec_apple` | Samsung Pay verification. |

### Crypto Exchanges

| Command | Mode | Auto-Script | Description |
|---------|------|-------------|-------------|
| `/coinbase` | Speech | `cry_coinbase` | Coinbase 2FA security call — suspicious sign-in from unrecognized device. Asks for the 2FA code. |
| `/crypto` | Speech | `cry_binance` (Binance) | Generic crypto exchange fraud call. Suspicious withdrawal request flagged. |

### Big Tech / Social Media

| Command | Mode | Auto-Script | Description |
|---------|------|-------------|-------------|
| `/amazon` | Speech | `ret_amazon` | Amazon account security — purchase attempted from unrecognized device. |
| `/icloud` | Speech | `tec_apple` | iCloud / Apple ID OTP — someone is trying to access iCloud from a new device. |
| `/microsoft` | Speech | `tec_microsoft` | Microsoft account security alert — unauthorized access attempt. |
| `/whatsapp` | Speech | `tec_whatsapp` | WhatsApp re-registration call — a request to register your number on a new device. Asks for the 6-digit registration code. |

### Telecom / SIM

| Command | Mode | Auto-Script | Description |
|---------|------|-------------|-------------|
| `/sim` | Speech | `tel_att` (AT&T) | SIM swap / carrier port-out verification. Sounds like AT&T fraud prevention calling to confirm a SIM transfer request. |

### IVR Control (During Active Call)

| Command | Description |
|---------|-------------|
| `/IVRpass` | Opens the IVR control panel while a call is active. Buttons: **Hold** (plays hold music), **Transfer** (simulates being transferred), **Hang Up**. |
| `/cancel` | Immediately ends the active call and clears the session. |
| `/accept` | Shown at the review screen — places the call. |
| `/Decline` | Shown at the review screen — cancels without calling. |

---

## 🔧 Call Helpers

| Command | Usage | Description |
|---------|-------|-------------|
| `/recall` | `/recall` | Shows details of your **last call** (target, spoof, bank, script, voice) with a "Call Again" button. Repeats it with one tap — no re-entering anything. |
| `/setspoof` | `/setspoof +12025551234` | Saves a **default caller ID**. Once set, all call modes skip the "Caller ID" prompt and use this number automatically. `/setspoof clear` removes it. `/setspoof` with no argument shows the current saved number. |
| `/mystats` | `/mystats` | Shows your personal statistics: total calls made, active script, selected voice, saved spoof number, license time remaining. |

---

## 📜 Scripts & Voices

| Command | Usage | Description |
|---------|-------|-------------|
| `/scripts` | `/scripts` | Opens the script browser. Scripts are organized into categories (US Banks, UK Banks, Crypto, Payment, Tech, Govt, etc.). Tap a category → tap a script → it becomes your active script for the next call. |
| `/newscript` | `/newscript` | Create a custom TTS script in 2 steps: ① send the name, ② send the message text. Your script is saved to your personal library. |
| `/editscript` | `/editscript` | Lists your custom scripts with an Edit button for each. Opens a 2-step update flow. |
| `/deletescript` | `/deletescript` | Lists your custom scripts with a Delete button and confirmation. |
| `/myscripts` | `/myscripts` | Shows all your saved custom scripts with activate/edit/delete buttons. |
| `/voices` | `/voices` | Opens the voice selector. 18 voices across US, UK, Australian, Indian, and European accents. Select one and it's used for all future calls. Preview button plays a sample sentence. |

### Available Script Categories
| Category | Count | Voices Used |
|----------|-------|-------------|
| US Banks | 30 | Joanna, Kendra, Salli, Kimberly, Matthew, Joey |
| UK/EU Banks | 15 | Amy, Emma, Brian |
| Canadian Banks | 8 | Joanna, Matthew |
| Australian Banks | 8 | Nicole, Russell, Aria |
| Asian/ME/African Banks | 15 | Aditi, Raveena, Joanna |
| Latin American Banks | 8 | Conchita, Joanna |
| Crypto Exchanges | 18 | Matthew, Joey, Brian |
| Card Networks | 6 | Joanna, Matthew |
| Payment Platforms | 14 | Joanna, Salli, Amy |
| Telecom / ISP | 20 | Mixed per country |
| Insurance | 12 | Kendra, Brian, Matthew |
| Retail / E-Commerce | 16 | Joanna, Salli, Amy |
| Tech & Social Media | 27 | Kimberly, Matthew, Joey |
| Government | 12 | Matthew, Brian |
| Custom (yours) | Unlimited | Your selected voice |

---

## 🔑 License Key Types

| Key Type | Duration | Generated by |
|----------|----------|-------------|
| 1-Day | 24 hours | Admin panel |
| 3-Day | 72 hours | Admin panel |
| Weekly | 7 days | Admin panel |
| Monthly | 30 days | Admin panel |
| VIP Lifetime | Forever | Admin panel |

---

## 👑 Admin Commands (Admin ID only)

Admin features are accessed via `/admin` which opens the admin panel. No slash commands needed for most.

| Feature | How | Description |
|---------|-----|-------------|
| Generate Key | Admin panel → Key buttons | Generates a redemption key of the chosen duration. Key is shown once — copy it. |
| Active Keys | Admin panel → Active Keys | Lists all currently valid license keys with expiry times. |
| All Users | Admin panel → All Users | Shows every user who has ever messaged the bot. |
| Stats | Admin panel → Stats | Total users, active licenses, call count. |
| Call Logs | Admin panel → Call Logs | Recent call records (phone, mode, timestamp). |
| Revoke User | Admin panel → Revoke User | Removes a user's license immediately. |
| Ban User | Admin panel → Ban User | Permanently blocks a user from using the bot. |
| Unban User | Admin panel → Unban User | Lifts a ban. |
| Banned List | Admin panel → Banned List | Lists all banned user IDs. |
| Search User | Admin panel → Search User | Look up any user by their Telegram ID. |
| Broadcast | Admin panel → Broadcast | Sends a message to ALL registered users. |
| Toggle Maintenance | Admin panel → Toggle Maint | Puts the bot in maintenance mode — non-admins see a maintenance message. |
| **Change Bot Token** | Admin panel → Change Token | Opens a prompt — send the new @BotFather token. It's saved to the database and applied on next restart. |

> **Web alternative for token:** Visit `/admin/token` in a browser — no Telegram needed.
