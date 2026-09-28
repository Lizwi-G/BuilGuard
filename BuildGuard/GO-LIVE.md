# Taking BuildGuard live — step by step

This takes about 30 minutes. At the end, real companies can register, invite their team, and everyone sees the same shared data with server-enforced security.

There are no code changes required beyond pasting two values into one file.

---

## 1. Create the Supabase project (10 min)

1. Go to **https://supabase.com** → sign up (free) → **New project**.
2. Name it `buildguard`, choose a strong database password (save it somewhere safe — you rarely need it, but you can't recover it), and pick the region closest to your customers. There is no South African region yet; **Frankfurt (eu-central-1)** or **London** give the best latency to SA.
3. Wait ~2 minutes for it to provision.

## 2. Create the database tables (5 min)

1. In the Supabase dashboard, open **SQL Editor** → **New query**.
2. Open `sql/schema.sql` from this project, copy the **entire file**, paste it in, and click **Run**.
3. You should see "Success. No rows returned." Open **Table Editor** — you'll see 16 tables. Every one has Row Level Security enabled (the little shield icon).

> **What RLS does for you:** one construction company can never read another's records — even if someone tampers with the app in their browser — because the *database* refuses to return rows that don't belong to the logged-in user's company. This is the security guarantee that makes it safe to put multiple customers on one system.

## 3. Turn off email confirmation for now (2 min)

For a smooth first onboarding, let people log in immediately after registering:

1. **Authentication** → **Providers** → **Email** → switch **"Confirm email"** OFF → Save.

You can switch this back on later once you've set up a sending domain. With confirmation on, the app tells the person to check their inbox, and finishes creating their company automatically the moment they confirm and sign in — from any device, not just the one they registered on.

## 4. Connect the app (2 min)

1. **Project Settings** (gear icon, bottom-left) → under CONFIGURATION click **API Keys**.
2. Copy the **`anon` `public`** key. (If the page shows "Publishable" and "Legacy" tabs, either key works — the newer `sb_publishable_...` or the legacy `eyJhbGci...`.) **Never copy `service_role` / secret.**
3. Your **Project URL** is `https://<Project ID>.supabase.co` — the Project ID is on the **General** settings page (e.g. `https://kilticbtcbijfhfszvga.supabase.co`).
4. Open `js/config.js` and paste them:

```js
export const SUPABASE_URL = 'https://xxxxxxxxxxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

That's it. The app detects the keys and switches from DEMO to PRODUCTION mode automatically — the demo ribbon disappears and the login screen becomes a real email/password form.

> ⚠️ **Only ever paste the `anon` key.** The `service_role` key on the same page bypasses every security rule. It must never appear in this file or anywhere in the frontend.

## 5. Host it (5 min)

BuildGuard is static files — any web host works. Two free, no-server options:

**Netlify (easiest):** drag the whole `BuildGuard` folder onto https://app.netlify.com/drop. Done — you get a URL like `https://buildguard-xyz.netlify.app`.

**GitHub Pages:** push the folder to a repo → Settings → Pages → deploy from `main`.

Either way, afterwards go back to Supabase → **Authentication** → **URL Configuration** and set **Site URL** to your new address. This is what password-reset emails link back to.

For a custom domain (e.g. `app.buildguard.co.za`), both hosts support it in their dashboard.

## 6. Onboard your first company (the test that proves it works)

1. Open your hosted URL. You should see the email/password login (no demo ribbon).
2. Click **➕ Create Company Account** → fill in the company and your details → **CREATE COMPANY**. You land on the Owner dashboard with a **"Get set up"** checklist at the top.
3. Work through the checklist — it's the minimum a company needs before the site team can do anything:
   - **Add your first project** (Projects → + Add Project): budget, dates, who manages it. The forecasting engine starts working the moment there's a budget and a start date.
   - **Add materials** (Settings → Materials): what sites are allowed to request. Nobody can raise a Buy Material request until at least one exists.
   - **Add vehicles & equipment** (Settings → Vehicles): the *normal consumption* you enter is what every fuel fill-up gets compared against to catch anomalies.
   - **Invite your team** (Team → + Invite User) — see step 4 below.
4. Go to **Team → + Invite User** → add a Project Manager with their email.
5. Now open the app **in a private/incognito window** (so you're a different person) → click **✉️ I was invited — set up my login** → use the *same email* → choose a password → **Join My Company**. That person lands on the Project Manager dashboard *of your company*.
6. Back in your Owner window, refresh — the invited user now shows 🟢 Active under Team.

If step 5 works, the multi-user, multi-company, server-secured system is live.

### Showing the product to a prospect

Add `?demo` to your live address (e.g. `https://buildguard-xyz.netlify.app/?demo`). That opens the sample-data walkthrough — three SA construction companies, requests mid-pipeline, money leaks to find — entirely in that browser's local storage. Nothing reaches your Supabase project, and your real customers' data is never involved.

### Running it locally while you develop

Use `python dev-server.py` instead of `python -m http.server` — it's the same thing but tells the browser not to cache, so you always see your latest code. (The VS Code **F5** task already uses it.)

---

## How invitations work (no email server needed)

BuildGuard doesn't send emails yet. When an Owner invites someone, a placeholder record is created for that email. The invitee opens the app, taps *"I was invited — set up my login"*, and creates a password with that exact email — the app matches the two and links them. Tell invitees which email you used.

## What happens if the internet drops on site

Nothing is lost. Writes go to the phone's memory instantly (screens never freeze), are queued in the browser's IndexedDB, and are pushed to Supabase automatically when the connection returns. The user sees a small **⏳ pending** badge in the top bar until then.

## Costs

Supabase free tier covers roughly 50,000 monthly active users and 500 MB of data — comfortably several construction companies. The paid tier is about **$25/month** and mainly buys daily backups and no project pausing after inactivity. Netlify/GitHub Pages hosting is free.

## What is NOT yet done for production (be honest with early customers)

- **No email sending** — invitations and password resets rely on Supabase's built-in mailer, which is rate-limited to a handful per hour on the free tier. Set up a custom SMTP provider (Resend, Postmark) in Supabase → Authentication → SMTP before onboarding more than a couple of companies.
- **Photos aren't stored** — receipt/delivery photos show "attached" but the image isn't uploaded. Wiring Supabase Storage is the next backend task.
- **Alerts are computed on the phone**, not the server, so they refresh when a user opens the app rather than in real time.
- **Test with one friendly customer first.** The Supabase path (registration, invites, RLS isolation, project/material/vehicle setup) has been exercised against a live project, but only with test accounts — a real customer will surface things a test never does.
