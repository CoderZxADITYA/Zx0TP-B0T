# ZxOTP Bot — Bug-Fix Audit Log

> Full exhaustive audit pass. No new features or logic changes — pure hardening.
> Files changed: `src/bot/bot.ts`, `src/bot/licenses.ts`, `src/routes/twilio.ts`.

---

## Critical Bugs

**Bug 1 — `editOrSend`: no Telegram 4096-char message length guard**
*File:* `src/bot/bot.ts`  
*Symptom:* Any message whose rendered text exceeds 4 096 chars causes `editMessageText` to throw "message is too long" and the fallback `sendMessage` also fails, silently dropping the message.  
*Fix:* Added `tgTruncate()` helper; both `editMessageText` and `sendMessage` paths now truncate to 4 095 chars + `…`. Entity list is re-filtered to only include entities whose ranges fall inside the (possibly shorter) text.

**Bug 2 — `editOrSend`: "message is not modified" triggers a duplicate send**
*File:* `src/bot/bot.ts`  
*Symptom:* When a button is pressed twice with identical content, the edit fails with "message is not modified". The catch block sent a brand-new message, producing duplicates.  
*Fix:* Inspect `err.description`; if it contains "message is not modified", return early without sending a second message.

**Bug 3 — `gateCommand` silently swallows async callback errors**
*File:* `src/bot/bot.ts`  
*Symptom:* `gateCommand` takes `fn: () => void` but callers pass `async () => {}`. The returned Promise is discarded, so any thrown error vanishes with no log and no user feedback.  
*Fix:* Changed signature to `fn: () => void | Promise<void>` and wrapped the call in `Promise.resolve(fn()).catch(logger.error)` so all errors surface through the bot's error logger.

**Bug 4 — `startBot()` creates duplicate polling loops on hot-reload**
*File:* `src/bot/bot.ts`  
*Symptom:* When an admin changes the bot token (which calls `startBot()` again), a second `Telegraf` instance starts polling in parallel, causing duplicate messages and conflicting session state.  
*Fix:* Check for an existing `bot` instance before creating a new one; call `bot.stop('REINIT')` and `null`-clear the reference before constructing the new instance.

**Bug 5 — `sweepExpired` callback receives `userId` after `activeKeyByUser` is cleared**
*File:* `src/bot/licenses.ts`  
*Symptom:* `sweepExpired` deletes `activeKeyByUser.get(userId)` before calling `notify(userId)`. The notify callback in `startBot` called `getUserLicense(userId)` which queries `activeKeyByUser` — now empty — returning `undefined`. The DB upsert was therefore never executed, so the `notifiedExpiry` flag was never persisted. On next restart, the same user would be notified again.  
*Fix:* Changed `sweepExpired` signature to `notify(userId: number, license: License)`, capturing the license reference before deletion. The call site in `startBot` now receives the license directly and persists it without re-querying.

**Bug 6 — `start_otp` action: `answerCbQuery()` called twice**
*File:* `src/bot/bot.ts`  
*Symptom:* The handler called `await ctx.answerCbQuery()` unconditionally, then inside the premium check called `await ctx.answerCbQuery(premiumMsg, { show_alert: true })`. Telegram only allows one answer per callback query; the second call fails silently with "query is too old".  
*Fix:* Moved the premium check before the first `answerCbQuery` call. Non-premium users get the alert; premium users get the silent acknowledge — each path calls `answerCbQuery` exactly once.

**Bug 7 — `script_preview` action: `answerCbQuery()` called twice**
*File:* `src/bot/bot.ts`  
*Symptom:* `answerCbQuery()` was called at the top of the handler, then inside `gateAction`'s callback a second `answerCbQuery('Script not found', { show_alert: true })` was attempted when the script ID was invalid.  
*Fix:* Replaced the second `answerCbQuery` with a `b.telegram.sendMessage` call, keeping the first acknowledge intact.

**Bug 8 — `voice_preview` action: premium gate checked after `answerCbQuery`**
*File:* `src/bot/bot.ts`  
*Symptom:* `answerCbQuery('Generating voice preview…')` ran before `gateAction`. If the user lacked premium, `gateAction` tried to call `answerCbQuery(premiumMsg, { show_alert: true })` on an already-answered query.  
*Fix:* Moved `await ctx.answerCbQuery(…)` inside the `gateAction` callback so it only runs when the user has passed the gate.

**Bug 9 — `deny` retry: original caller ID (spoofNum) not passed to `makeCall`**
*File:* `src/bot/bot.ts`  
*Symptom:* The deny-retry call used `makeCall(session.phone, voiceUrl)` without the third `callerId` argument. The retry called with a different caller ID than the original call, breaking the social-engineering scenario.  
*Fix:* Passed `session.spoofNum` as the third argument to `makeCall`. Also passed `session.callMode` and `session.spoofNum` to `createSession` for the new session, so the retry inherits all original call parameters.

**Bug 10 — `deny` retry: fire-and-forget `sendMessage` calls with no error handling**
*File:* `src/bot/bot.ts`  
*Symptom:* The two `b.telegram.sendMessage(...)` calls in the deny retry handler were unawaited with no `.catch()`. Any error (e.g. user blocked the bot) would surface as an unhandled Promise rejection and could crash the process under some Node.js configurations.  
*Fix:* Added `.catch(() => { /* user may have blocked */ })` to both calls.

**Bug 11 — `notifyUser`: transcription has no length guard**
*File:* `src/bot/bot.ts`  
*Symptom:* A long speech transcription embedded in the message could push the total above Telegram's 4 096-char limit, causing the notify to fail and the operator to miss the callee's response entirely.  
*Fix:* Added a `MAX_TRANSCRIPTION = 1800` guard; transcriptions are truncated with `…` before being embedded.

**Bug 12 — `broadcast`: no rate limiting between sends**
*File:* `src/bot/bot.ts`  
*Symptom:* The broadcast loop sent messages to all users in a tight `for…of` loop. Telegram enforces ~30 messages/second to different chats; exceeding this triggers FloodWait errors (429) which were silently swallowed, causing many users to never receive the broadcast.  
*Fix:* Added `await new Promise(r => setTimeout(r, 35))` between sends, keeping throughput at ~28 msg/s — just under Telegram's limit.

**Bug 13 — Maintenance middleware: missing `return` after `ctx.reply`**
*File:* `src/bot/bot.ts`  
*Symptom:* After replying with the maintenance message, the middleware fell off the end of the async function without returning. Depending on the Telegraf version, this could allow `next()` to be called implicitly, processing the request anyway.  
*Fix:* Added explicit `return;` after the `ctx.reply` try/catch block.

---

## High-Severity Bugs

**Bug 14 — Step 0 (phone number): invalid number silently ignored**
*File:* `src/bot/bot.ts`  
*Symptom:* When `flow.callCount === 0` and the user sends an invalid phone number, `checkNumber` returned false, the `if` block didn't execute, and none of the subsequent `callCount` checks matched. The user's message was silently discarded with no feedback.  
*Fix:* Added a preceding guard that detects an invalid number at step 0 and replies with a clear format-error message, then returns — so the user knows to try again.

**Bug 15 — `routes/twilio.ts /gather`: `displayInput` not truncated before `notifyUser`**
*File:* `src/routes/twilio.ts`  
*Symptom:* A long speech transcription from SignalWire could create a `displayInput` string well over 4 096 chars, which then hit `notifyUser` (and ultimately `editOrSend`) without truncation, causing the Telegram send to fail.  
*Fix:* Added `MAX_INPUT_LEN = 1800` truncation before `notifyUser` is called.

**Bug 16 — `/cancel` command: `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Symptom:* Any Telegram error (rate limit, blocked bot) thrown by `msgSend` inside the cancel handler would become an unhandled Promise rejection, silently discarded or crashing the process.  
*Fix:* Made the handler `async` and added `await`.

**Bug 17 — `/IVRpass` command: `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Symptom:* Same unhandled-rejection hazard as Bug 16.  
*Fix:* Made the handler `async`, added `await`.

**Bug 18 — `/pgp` command: `msgSend` not awaited inside `gateCommand` callback**
*File:* `src/bot/bot.ts`  
*Symptom:* `gateCommand` callback was sync `() => {}` containing `msgSend` — the async send was fire-and-forget with no error propagation.  
*Fix:* Changed callback to `async () => {}` and added `await`.

**Bug 19 — `/dpgp` command: `msgSend` not awaited inside `gateCommand` callback**
*File:* `src/bot/bot.ts`  
*Symptom:* Same as Bug 18.  
*Fix:* Same as Bug 18.

**Bug 20 — `/redeem` command: all three `msgSend` calls not awaited in sync callback**
*File:* `src/bot/bot.ts`  
*Symptom:* `b.command('redeem', (ctx) => {` was a sync callback containing three separate `await msgSend(...)` calls — TypeScript error TS1308 ("await only in async functions") and actual runtime fire-and-forget.  
*Fix:* Made the callback `async (ctx) => {`.

**Bug 21 — `/license` command: `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Symptom:* Non-async callback, fire-and-forget `msgSend`.  
*Fix:* Made callback `async`, added `await`.

**Bug 22 — `/proceed` command: `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Symptom:* Non-async callback, fire-and-forget.  
*Fix:* Made callback `async`, added `await`.

**Bug 23 — `/admin` (non-admin branch): `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Symptom:* Inside the already-async `/admin` handler, the else-branch `msgSend` was unawaited.  
*Fix:* Added `await`.

**Bug 24 — `/more` command: `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Symptom:* `b.command('more', (ctx) => { msgSend(...) })` — sync handler, fire-and-forget.  
*Fix:* Made callback `async`, added `await`.

**Bug 25 — Stub commands (`deletescript`, `myscripts`, etc.): `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Symptom:* Inner `gateCommand` callback was sync `() => {}` with an `await` inside — TypeScript error TS1308 and runtime fire-and-forget.  
*Fix:* Changed callback to `async () => {}`.

**Bug 26 — `/decline` flow at step 6: `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Symptom:* `msgSend(b, chatId, ...)` inside the `/decline` text-message handler was not awaited.  
*Fix:* Added `await`.

**Bug 27 — `placeCallNow` (not-configured path): `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Symptom:* When SignalWire credentials are missing, the error message was sent fire-and-forget.  
*Fix:* Added `await`.

**Bug 28 — `placeCallNow` (success path): `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Symptom:* The "Calling…" confirmation message with live-control buttons was sent fire-and-forget.  
*Fix:* Added `await`.

**Bug 29 — `placeCallNow` (error path): `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Symptom:* The "Call failed to connect" error message was sent fire-and-forget.  
*Fix:* Added `await`.

---

## Medium-Severity Bugs

**Bug 30 — `handleAdminPromptReply` `revoke` branch: `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Fix:* Added `await`.

**Bug 31 — `handleAdminPromptReply` `ban` branch (invalid ID): `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Fix:* Added `await`.

**Bug 32 — `handleAdminPromptReply` `ban` branch (success): `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Fix:* Added `await`.

**Bug 33 — `handleAdminPromptReply` `unban` branch (invalid ID): `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Fix:* Added `await`.

**Bug 34 — `handleAdminPromptReply` `unban` branch (success): `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Fix:* Added `await`.

**Bug 35 — `handleAdminPromptReply` `search` branch (invalid ID): `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Fix:* Added `await`.

**Bug 36 — `handleAdminPromptReply` `search` branch (result): `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Fix:* Added `await`.

**Bug 37 — `handleAdminPromptReply` `token` branch (invalid format): `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Fix:* Added `await`.

**Bug 38 — `handleAdminPromptReply` `token` branch (confirmation prompt): `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Fix:* Added `await`.

**Bug 39 — `handleAdminPromptReply` `token_confirm` branch (cancelled): `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Fix:* Added `await`.

**Bug 40 — `handleAdminPromptReply` `token_confirm` branch (saved): `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Fix:* Added `await`.

**Bug 41 — `handleAdminPromptReply` `setspoof_admin` branch (invalid): `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Fix:* Added `await`.

**Bug 42 — `handleAdminPromptReply` `setspoof_admin` branch (success): `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Fix:* Added `await`.

**Bug 43 — `handleAdminPromptReply` `broadcast` branch: `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Fix:* Added `await`.

**Bug 44 — `[support|language|setvoice]` command: `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Symptom:* Non-async callback with fire-and-forget `msgSend`.  
*Fix:* Made callback `async`, added `await`.

**Bug 45 — `redeem` command `/redeem` (missing key path): `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Symptom:* Inside a now-async handler, this path was fire-and-forget before the async fix.  
*Fix:* Added `await` (covered by Bug 20 async promotion).

**Bug 46 — `redeem` command (fail path): `msgSend` not awaited**
*File:* `src/bot/bot.ts`  
*Fix:* Added `await` (covered by Bug 20 async promotion).

---

## Low-Severity / Correctness Bugs

**Bug 47 — `editOrSend`: entity list not re-filtered after text truncation**
*File:* `src/bot/bot.ts`  
*Symptom:* After truncation, Telegram entities whose `offset + length` exceeded the new text length would cause "Bad Request: can't parse entities" errors.  
*Fix:* Added `entities.filter(e => e.offset + e.length <= text.length)` before the send.

**Bug 48 — `deny` retry: `createSession` not given `callMode`**
*File:* `src/bot/bot.ts`  
*Symptom:* The retry session always defaulted to `callMode = undefined` (both), even if the original call was DTMF-only, causing the `/voice` TwiML to be played instead of `/dtmf`.  
*Fix:* Passed `session.callMode` as the fifth argument to `createSession`.

**Bug 49 — `sweepExpired` call site: `getUserLicense` returned `undefined`**
*File:* `src/bot/bot.ts`  
*Symptom:* The `dbUpsertLicense` guarded by `if (expiredLic)` was never executed because `getUserLicense(userId)` always returned `undefined` at that point (see Bug 5). The license's `notifiedExpiry: true` was never persisted, so on process restart the expiry notification would be sent again.  
*Fix:* Now uses the `license` argument passed directly by the updated `sweepExpired` (see Bug 5).

**Bug 50 — `voice_preview` sends message body twice via two `m.build()` calls**
*File:* `src/bot/bot.ts`  
*Symptom:* In the TTS fallback branch, `m.build()` was called twice (`m.build().text` and `m.build().entities`), causing the `Msg` builder to accumulate and potentially double entities internally if `build()` is not idempotent.  
*Fix:* Captured `const built = m.build()` once and used `built.text` / `built.entities`.

---

## Summary Table

| # | File | Category | Status |
|---|------|----------|--------|
| 1 | bot.ts | editOrSend 4096 truncation | ✅ Fixed |
| 2 | bot.ts | editOrSend "not modified" duplicate | ✅ Fixed |
| 3 | bot.ts | gateCommand async swallow | ✅ Fixed |
| 4 | bot.ts | startBot duplicate polling | ✅ Fixed |
| 5 | licenses.ts | sweepExpired reference lost | ✅ Fixed |
| 6 | bot.ts | start_otp double answerCbQuery | ✅ Fixed |
| 7 | bot.ts | script_preview double answerCbQuery | ✅ Fixed |
| 8 | bot.ts | voice_preview gate after answer | ✅ Fixed |
| 9 | bot.ts | deny retry missing spoofNum | ✅ Fixed |
| 10 | bot.ts | deny retry fire-and-forget sends | ✅ Fixed |
| 11 | bot.ts | notifyUser transcription length | ✅ Fixed |
| 12 | bot.ts | broadcast no rate limiting | ✅ Fixed |
| 13 | bot.ts | maintenance middleware missing return | ✅ Fixed |
| 14 | bot.ts | step-0 invalid number silent fail | ✅ Fixed |
| 15 | routes/twilio.ts | displayInput not truncated | ✅ Fixed |
| 16–29 | bot.ts | missing await on msgSend (14 call sites) | ✅ Fixed |
| 30–46 | bot.ts | missing await in handleAdminPromptReply | ✅ Fixed |
| 47 | bot.ts | entity re-filter after truncation | ✅ Fixed |
| 48 | bot.ts | deny retry missing callMode | ✅ Fixed |
| 49 | bot.ts | sweepExpired call site | ✅ Fixed |
| 50 | bot.ts | voice_preview double m.build() | ✅ Fixed |

**Total bugs identified and fixed: 50**
