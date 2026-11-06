# Deploy checklist: DM Automation (internal preview)

Date: 2026-11-05  Commit: none (the folder is not a git repo of its own; deploy goes from the Vercel CLI)  Go from user: yes, as an **internal preview**, invite-only

**Live URL: https://tr-dm-automation.vercel.app** (Vercel project `tr-dm-automation`, personal scope `ivanbragatto-3280s-projects`, first production deploy 2026-11-05). Checked: `/` redirects to `/login` (307), `/login` answers 200.

## Preflight

| check | result |
| --- | --- |
| e2e suite | **none exists** (no Playwright suite written) |
| open S1/S2 bugs | none known, but nothing was formally tested |
| parity: must-haves | **21 of 50 done**, score 50.2 / 100. The script says "not shippable" |
| rebrand sweep (`sweep.py`) | **clean**, exit 0 (no original name or domain in `app/`) |
| production build | **passes** |
| privacy policy and terms pages | **missing** |
| account deletion | built, **not tested live** |
| favicon, OG image | not made |
| live isolation test (`npm run db:test`) | **22 / 22 pass** on the Supabase project |

Why it ships anyway: the user chose an internal preview for the team, invite-only. It is a demo of the flow builder and sign-in, not a live Meta automation. Contacts, inbox and the flow engine are still fake data in each person's browser. Do not give the URL to anyone outside the invite list, and do not connect real Instagram or Facebook accounts to it.

## Production

- Database: the same Supabase project as development (there is no separate production project yet). Acceptable for a preview with fake content only; make a separate project before real Meta traffic.
- Migrations: run by hand with `npm run db:migrate` (0001 to 0003 applied). Not part of the deploy.
- Backups: check Project Settings > Database > Backups.
- Sign-in is an **e-mail allowlist** (no passwords, no e-mails): only addresses in `allowed_emails` get in. See backend.md. Turn off "Allow new users to sign up" in Supabase as well.
- First person in from a company e-mail domain creates the workspace and owns it. Everyone invited from the same domain joins that workspace as an editor (migration 0003). Gmail, Outlook and similar never auto-join.

## Vercel, step by step

Run in a terminal inside `replica/app`. Account steps are yours; nothing here buys or pays for anything.

1. `npx vercel login` and confirm in the browser.
2. `npx vercel link --yes --project tr-dm-automation` creates the project.
3. In the Vercel dashboard, project **Settings > Environment Variables** (Production, Preview and Development), add:

| name | value | sensitive |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | from `.env.local` | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from `.env.local` | no |
| `SUPABASE_SERVICE_ROLE_KEY` | from `.env.local` | **yes** |
| `NEXT_PUBLIC_SITE_URL` | the Vercel URL, `https://<project>.vercel.app` (after step 4) | no |
| `NEXT_PUBLIC_SIGNUP_ENABLED` | `false` | no |

`DATABASE_URL` does **not** go to Vercel (only the local migration script uses it).

4. `npx vercel deploy --prod` prints the URL. Set `NEXT_PUBLIC_SITE_URL` to it and deploy again, so e-mail links point to the right place (`NEXT_PUBLIC_*` values are baked in at build time).

## Supabase settings for the live URL

- Authentication > URL Configuration: no redirect URLs are needed any more (sign-in is the e-mail allowlist; the e-mail callback route was removed). Keep **Allow new users to sign up** off.
- Authentication > Sign In / Providers: turn **off** "Allow new users to sign up".
- Authentication > Users > **Invite user** for each person. They get an e-mail; after the link they can use "Forgot your password?" on the login page to set one.
- Authentication > Emails: replace the default sender with a TR SMTP sender (the default is limited to a few e-mails an hour and often lands in spam).
- Confirm "Confirm email" stays on.

## Watch

- [ ] Vercel logs and the Supabase auth log checked the first day
- [ ] error tracking: none yet
- [ ] uptime check: none yet
- [ ] core flow done on the live site, desktop and phone (sign in, create automation, reload, still there)

## Not done, on purpose

Custom domain (not asked), Stripe (not used), OAuth providers (not used), mobile app (none), store listing (none), analytics and cookie banner (no analytics; only the session cookie).
