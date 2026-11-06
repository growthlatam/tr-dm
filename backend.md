# Backend status

Updated 2026-11-05. Scope of this pass: **database + sign-in + automations saved on the server.** The comment/DM engine, Meta connection, e-mail and billing are not built.

## What exists

| area | state | where |
| --- | --- | --- |
| Schema | written, 26 tables, RLS on every tenant table | `app/supabase/migrations/0001_init.sql` (copy of `schema.sql`), `0002_app.sql` |
| Migrations runner | **applied to the live project on 2026-11-05** (0001, 0002) | `npm run db:migrate` (needs `DATABASE_URL`) |
| Sign-up / sign-in | e-mail + password, magic link, forgot / reset password, global sign-out | `src/app/login`, `src/app/reset-password`, `src/app/auth/*` |
| Route protection | middleware redirects signed-out visitors to `/login`; verifies the token with Supabase on every request | `src/middleware.ts` |
| Workspace | created on first sign-in via `create_org()`; the person becomes owner | `0002_app.sql`, `lib/remote.ts` |
| Automations | create / rename / pause / draft autosave (debounced) / discard / publish saved to Supabase; publish makes an immutable version | `lib/remote.ts`, hooks in `lib/store.ts`, `publish_automation()` |
| Account deletion | button in Settings; deletes the user and any workspace they were the only member of | `src/app/api/account/delete/route.ts` |
| Demo mode | no keys in `.env.local` = old behaviour, in-browser fake data, no sign-in | `remoteEnabled` in `lib/supabase/client.ts` |
| Seed | one fake demo automation for a given user | `npm run db:seed` |
| Isolation test | second-user / viewer / token-column checks | `npm run db:test`: **19/19 pass on the live project** |

## Still fake (stays in the browser)

Contacts, tags, inbox conversations, posts list, the flow engine and the test panel. Per-automation stats and per-node hit counts are zero for server-loaded automations. These need the webhook engine (next phase): Meta webhook route with signature check, job runner (Inngest or similar), `runs` / `messages` / `events` tables written by the server.

## This machine: corporate TLS certificate

Node does not trust the company network certificate, so any Node process that calls Supabase fails with `UNABLE_TO_GET_ISSUER_CERT` (`curl` works because it uses the macOS keychain). Export the keychain once and point Node at it:

```
security find-certificate -a -p /Library/Keychains/System.keychain /System/Library/Keychains/SystemRootCertificates.keychain > ~/ca-bundle.pem
NODE_EXTRA_CA_CERTS=~/ca-bundle.pem npm run dev      # same prefix for db:migrate, db:test, db:seed
```

Without it, `npm run dev` in signed-in mode redirects everything to /login (the middleware cannot reach Supabase). Not needed on a deployed host.

## You need to do

1. ~~Keys in `.env.local`, `db:migrate`, `db:test`~~ done. The database password was pasted in a chat while setting this up: reset it in Project Settings > Database and update `DATABASE_URL`.
3. In Supabase Auth settings: keep "Confirm email" on, set Site URL to `NEXT_PUBLIC_SITE_URL`, add `<site>/auth/callback` to the redirect allow-list, and set the SMTP sender to a TR address (the built-in sender is rate-limited and for testing only).
4. Check daily backups are enabled (Project Settings > Database > Backups; depends on plan).
5. Meta (next phase): a developer app, Instagram and Messenger products, a professional test account. Business Verification and App Review are the long pole; start them early.

## Checked

- Migrations 0001 and 0002 apply cleanly, and 19 isolation checks pass on a local in-process Postgres (PGlite) with Supabase's `auth.uid()` and roles stubbed: second user sees / updates / deletes / inserts / publishes nothing; cannot add themselves as a member; viewer can read but not write; channel token column is unreadable by clients; signed-out sees nothing; one workspace per user. **This is not Supabase itself.** Run `npm run db:test` against the real project to close it.
- With dummy keys set, `/` and `/automations` redirect to `/login`, `/login` serves the form, the callback refuses an off-site `next` (`//evil.com`), sign-out is POST only (GET gives 405).
- Demo mode still works with no keys. `tsc` and `next build` pass.
- **Live project:** `npm run db:migrate` applied both migrations and `npm run db:test` passed 19/19 against Supabase itself (throwaway users, deleted afterwards). The three keys were checked with a 200 from the auth API.
- **Not checked:** an actual sign-in, sign-up e-mail, magic link, password reset, account deletion and the server sync round trip. They need your project.

## Security checklist

- [x] secrets only in env vars; `.env*` ignored (except `.env.example`); service role key used only in server routes and scripts, never `NEXT_PUBLIC_`
- [x] input validated on the server where a server route takes input (account delete uses zod); other writes go through RLS-guarded Supabase calls
- [x] authorisation by RLS on every tenant table; second-user test written and passing on the local engine
- [x] authorisation test run against the live project (19/19)
- [~] rate limits on auth: Supabase's built-in limits apply; no custom limits yet
- [x] sign-out everywhere; sessions in http-only cookies via `@supabase/ssr`
- [x] open-redirect guard on the auth callback
- [ ] webhooks verify signatures (no webhook route yet)
- [ ] uploads: no upload route yet (PDFs are metadata only)
- [x] no user data in URLs or logs (sync errors log the error object only)
- [~] `npm audit`: 2 findings, both the PostCSS copy bundled inside Next 15 (build-time CSS processing of our own files). The fix is a major Next upgrade (16); not done here.
- [ ] privacy policy listing processors (Supabase, host, Meta)

## Known gaps in this pass

- Realtime is not wired: two browser tabs do not see each other's edits until reload, and the last write wins.
- Roles are enforced by the database but the UI does not hide buttons by role; a viewer's edit just fails and shows the sync banner.
- Settings > Team is still demo data; invites are not real.
- Deleting the user does not yet remove files (none exist).
- `automations.channels` and `languages` columns are written minimally (`languages` = default language only).

## Sign-in changed on 2026-11-05: e-mail allowlist, no passwords, no e-mails

The login page has one field. `POST /api/login` checks the address against `allowed_emails` (migration 0004), creates the account if needed, asks Supabase for a one-time token (no e-mail is sent) and redeems it at once to set the session cookies. Removed: sign-up, password, magic link, reset password. Kept: sign out everywhere, account deletion.

- **Add or remove people:** `cd app && NODE_EXTRA_CA_CERTS=.ca-bundle.pem npm run db:allow -- add name@thomsonreuters.com` (also `remove`, `list`). Or edit the `allowed_emails` table in the Supabase table editor (lowercase addresses only).
- **Security trade-off, by design:** anyone who knows or guesses an allowed address can sign in as that person. It is an access list, not strong authentication. Acceptable for an internal preview with fake data; not acceptable once real contacts or Meta tokens are inside. Before that, move to Microsoft sign-in (Entra ID / SSO).
- **Defence in depth:** `create_org()` refuses an address that is not on the list, so a session obtained any other way (for example a self sign-up through the public Supabase auth API) gets no workspace and sees nothing. Still turn **Allow new users to sign up** off in Supabase.
- **Brake:** 20 tries a minute per caller and 6 per caller and address, in memory per server instance (hard cap of 5000 keys, oldest evicted first; only the platform-set `x-real-ip` is trusted). There is deliberately no bucket on the address alone, so nobody can lock a colleague out; the price is that someone who is not rate-limited by caller can still test which addresses are on the list one by one. Both findings of the automated review pull in opposite directions; the real answer is real authentication (Microsoft SSO or an e-mailed link) and a shared-store limiter, not a better in-memory counter.
- **Tested live (22 + 3 checks):** not on list 403, bad input 400, on list 200 with a session cookie that opens the app, no cookie redirects to /login; the allowlist is unreadable and unwritable from the browser. Throwaway users were deleted.

## Meta webhook (2026-11-05)

`GET/POST /api/webhooks/meta` (`app/src/app/api/webhooks/meta/route.ts`, helpers in `src/lib/meta.ts`). GET answers Meta's handshake with `META_VERIFY_TOKEN`. POST checks `X-Hub-Signature-256` against `META_APP_SECRET`, splits the body into one event per comment, message or postback, and stores each once in `webhook_events` (unique on provider + event id, so Meta retries are ignored). It answers 200 fast; **nothing processes the events yet** (no channel accounts, no trigger matching, no sends).

- Offline tests: `node scripts/test-meta.mjs` (10 pass: signature valid / wrong secret / tampered / missing / garbage, event splitting, stable ids, page feed).
- Live: handshake with the right token returns the challenge, wrong token 403. POST returns 501 until `META_APP_SECRET` is set, then 401 for unsigned bodies.
- `META_VERIFY_TOKEN` is set in Vercel (production) and `.env.local`. `META_APP_SECRET` and `META_APP_ID` come from the Meta app dashboard and are set by the owner.
- Callback URL for the Meta dashboard: `https://tr-dm-automation.vercel.app/api/webhooks/meta`.
- Next build steps: channel connection (OAuth, encrypted Page token), trigger router (webhook event -> trigger row -> run), the Graph API sender (private reply, send API, 24h window and tag rules), a job runner for waits and retries.

## Engine (2026-11-05): built and tested without Meta

What happens to an event: webhook stores it (`webhook_events`) → answers 200 → `after()` processes it (`lib/engine/process.ts`) → `normalize.ts` reads the Meta shape → the connected channel account is found → the contact and conversation are created or updated → stop / start words are honoured → the oldest **live** automation whose trigger matches wins → the pure engine (`lib/engine/run.ts`) walks the published graph → results are written as `runs`, `run_steps`, `events`, tags, and **queued** `messages`. `/api/jobs/tick` (daily on Vercel Hobby, protected by `CRON_SECRET`) retries unprocessed events (3 attempts) and resumes runs whose wait is over.

**Nothing is sent to Meta.** Every reply stays `queued`. A sender needs a real access token, which comes with the "connect account" step.

Rules the server enforces: first comment per person per post (unique constraint); one private reply per comment, none outside the 24h window except that one, and never a document before a tap; a tap works once per person per button; writing to us opens the 24h window, commenting does not; "parar / stop / baja / sair / cancelar…" unsubscribes and queues a confirmation, "iniciar / start / suscribir" resubscribes; unsubscribed, blocked and paused conversations get nothing; own comments, echoes and receipts are ignored; more than 5 runs per person per hour are ignored; over 600 private replies per account per hour (placeholder, Meta's real limit is [verify]) are held for the next hour; public replies only on comment triggers; the default reply yields to a matching keyword automation and respects its frequency.

Known limits: "next post" comment triggers never fire on the server (post dates are not known); several matching automations do not all fire, the oldest wins; a failed run is not replayed automatically after 3 attempts (reset `webhook_events.status` to `received` to replay); `assign` only works with a real user id; `notify` records a handover event but notifies nobody; on Vercel Hobby the job runs once a day, so waits shorter than a day are late (Pro allows every minute); the browser demo still has its own copy of the engine rules.

Tests: `npx tsx scripts/test-engine.ts` (15 pure engine checks), `node scripts/test-meta.mjs` (10), `npx tsx --env-file=.env.local scripts/test-live-engine.mts` (38 checks against the real database with a throwaway workspace), `npx tsx --env-file=.env.local scripts/test-prod-webhook.mts <url>` (9 checks through the deployed webhook with a signed event). All pass.

Privacy: `/privacy` and `/data-deletion` (English and Portuguese, public, drafts for TR Legal). Set `NEXT_PUBLIC_PRIVACY_CONTACT` to the contact e-mail shown on them. `npm run db:forget -- <id or @username>` deletes one person (contact, conversations, messages, tags, runs and their stored raw events) for a deletion request.

## Connect account and sending (2026-11-05, Unified Login)

The Meta app uses **Unified Login** (Facebook Login for Business with Instagram assets). Connect: Settings > Connect an Instagram account → `/api/channels/instagram/start` (signed state + cookie, CSRF safe) → `https://www.facebook.com/dialog/oauth` with `client_id` = Meta app id and `config_id` → `/api/channels/instagram/callback` → `GET graph.facebook.com/v27.0/oauth/access_token` (client id, secret, code) → a **business integration system user token** → `GET /me/assigned_instagram_accounts?fields=id,username` (every account shared in the login is connected) → token encrypted with AES-256-GCM (`CHANNEL_TOKEN_KEY`) into `channel_accounts` (the Instagram professional account id is the webhook `entry.id`; both id columns hold it) → `POST /<ig id>/subscribed_apps` for comments, messages and messaging_postbacks. Refused when the account belongs to another workspace. Disconnect wipes the token. The token column is unreadable from browsers.

**Settings the Meta owner must have:** `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID` (the configuration id shown at API setup with Unified login), and the callback `https://tr-dm-automation.vercel.app/api/channels/instagram/callback` **registered as the configuration's redirect URL and selected** (a webhook URL there will not work). The token's lifetime is whatever the configuration says; the docs show no refresh call for these tokens, so an account past its expiry is marked "reconnect needed" by the tick job.

**Sending** (`lib/engine/sender.ts`): **off** until `META_SEND_ENABLED=true`. Host `graph.facebook.com` v27.0 with the system-user token: public reply `POST /<comment id>/replies`; private reply and DMs `POST /<ig id>/messages` (`recipient.comment_id` or `recipient.id`); text cut to 1000 bytes; private replies refused after 7 days; other messages refused when the 24h window is closed; automation messages dropped for people who opted out; 5xx and 429 retried every 2 minutes for an hour; Meta error 190 marks the account as needing a reconnect. **The button template (postback) and plain text sends are documented only for Instagram Login, not for Unified Login; the payload is assumed identical and must be checked against the first real send.** PDFs: the API accepts `file` attachments by URL (PDF, up to 25 MB), but file storage is not built, so document messages fail with a clear reason.

**Not verified against real Meta:** nothing in connect or send has run against Meta itself. Both are tested against a fake Meta (`scripts/test-sender.mts`) and the real database. The per-hour limits and the human-agent tag were not found. Delivery and read receipts are not tracked (messages stay `sent`). Messenger sending is not built. Comments and live comments need Advanced Access (App Review and Business Verification) for anyone without a role on the app.

### Verified against real Meta (2026-11-05, 20:25)

`the test account` (id `<instagram account id>`, the same id the Meta dashboard shows) was connected with the "Instagram account" button. Checked with the stored, decrypted token: `me/assigned_instagram_accounts` answers 200 with that account; `subscribed_apps` lists app `<meta app id>` with `comments, messages, messaging_postbacks`; `debug_token` says `SYSTEM_USER`, valid, **no expiry**, scopes `instagram_basic, instagram_manage_comments, instagram_manage_messages, instagram_content_publish, ads_management, ads_read, public_profile`. The token is stored encrypted (never read back by browsers). So connect, token storage and webhook subscription work for real. **Sending is still unproven:** it needs a comment or message from a person with a role on the app, and `META_SEND_ENABLED` is off.

## Real inbox and contacts (2026-11-05)

Signed in, the Inbox, Contacts, Home and the automation list read the **database**, not demo data. `lib/remote.ts` `loadInbox()` fetches the latest 200 conversations, 500 contacts, their tags, up to 1500 messages and the notes, plus the team (`org_team()` RPC, because browsers cannot read `auth.users`) and per-automation numbers (`automation_stats()` RPC: runs, people, sent, button taps, documents). `lib/inbox-map.ts` turns rows into what the screens already use. Updates arrive by **polling every 10 s and on window focus** (not Realtime), skipped for 4 s after a local change so it cannot undo it. Real people's messages are never written to the browser's storage.

Actions write through to the database: reply (queued as a message from the agent, automations for that person pause for 7 days, then `/api/messages/flush` sends it right away **if** `META_SEND_ENABLED=true`), note, close/reopen, assign, reminder, mark read, add/remove tag, pause automations, unsubscribe. Roles are enforced by the database (a viewer's writes fail and show the red banner). Queued and failed messages show a small label under the bubble with Meta's reason.

The Test tab in the flow editor still runs on demo people in the browser only (ids that are not UUIDs); they are filtered out of the real screens. `npm run db:demo-inbox -- <your e-mail>` adds three clearly fake conversations to your workspace (remove with `... clean`).

Checks: `npx tsx scripts/test-inbox-map.ts` (14), live isolation test now 30+ checks including team list, notes, agent replies and stats across workspaces.

Not done: Realtime (a new message can take up to 10 s to show), search across all history (only the latest 200 conversations load), delivery and read receipts, unread counts for conversations opened on another device until the next poll, assignee shown by e-mail prefix.

### First real send (2026-11-05, ~20:42)

`META_SEND_ENABLED=true` is now set in Vercel production. The two queued replies to the real comment from `a test account` went out through the real API: the public reply (`/<comment id>/replies`) and the direct message with a button (button template with a postback) were both **accepted by Meta**, each with a Meta message id stored. Still to check by eye: that the reply shows under the comment, that the DM shows the button, and that tapping the button arrives as a postback and continues the flow (the next step is the PDF, which will fail with "file storage is not built yet").

Confirmed by the owner at 20:48: the public reply and the direct message **appeared on Instagram**. Comment → webhook → engine → queue → send is now proven end to end with real accounts. Still unproven: the button tap coming back as a postback, and anything outside accounts that have a role on the app.

## Document storage (2026-11-05)

PDFs live in a **private** Supabase Storage bucket `assets` (migration 0007): PDF only, 25 MB, path `<org id>/<uuid>.pdf`, read by workspace members, written by owners, admins and editors, never public. The flow editor and the quick wizard upload the file in the browser (the real `%PDF` header is checked, not only the name), store `{name, size, path}` in the message step and add a row in `assets`. When the engine queues a document message it copies the path; when the sender sends it, it makes a **signed link that lasts one hour** and gives Meta that link (`attachment: {type: "file", payload: {url}}`). In the editor, a document saved before storage existed (no path) blocks publishing with "Upload this document again"; a queued document with no stored file fails with the same advice.

Checked: 11 storage checks in the live isolation test (upload allowed only for own workspace, wrong folder, non-PDF, other workspace, viewer, signed-out and public URL all refused) and 4 in the sender test (signed link made, serves the file, missing file handled). **Not yet seen on a real phone:** Meta fetching the signed link and showing the PDF in the chat. Demo mode (no keys) still keeps only the file name.

## Fixes after the first real PDF test (2026-11-05, ~21:15)

Found in the real data: (1) **button taps were limited to one per person per step**, so after a first tap failed (the PDF had not been uploaded yet) later taps were dropped as "already used". Now the button payload is `tap:<automation>:<step>:<run>`: each message has its own button, a new comment gets a new working button, and the same message's button works once. Buttons already sent (no run id) keep the one-tap rule; the one stuck tap of the test contact was released by hand. (2) **Public comments that start nothing were stored** as contacts, conversations and messages. Now a comment is stored only if an automation will answer it: no matching automation, an opted-out person, or a repeat on the same post are dropped before anything is written (the raw webhook event is still kept). Comments that do start a flow are labelled "Commented on a post" in the inbox.

Note for whoever configures automations: the live "Whitepaper" automation uses **all posts + any word**, so every comment by a new person on any post starts it. Use a specific post or keywords to narrow it.

**Confirmed by the owner (21:13): the PDF arrived on Instagram.** The full loop now works with real accounts: public comment → webhook → engine → public reply and button message → button tap (postback) → document sent from private storage as a signed link. Remaining before going beyond accounts with a role on the app: App Review (Advanced Access for comments and messaging) and Business Verification.
