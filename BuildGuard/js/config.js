/*
  config.js — the ONE file you edit to take BuildGuard live.

  Leave both values empty and the app runs in DEMO MODE (sample data in the
  browser, no server). Paste your Supabase project's URL and anon key and it
  switches to PRODUCTION MODE automatically: real logins, shared data, and
  Row Level Security enforced on the server.

  Where to find these: Supabase dashboard -> your project -> Project Settings
  -> API. Copy "Project URL" and the "anon public" key.

  SECURITY: the anon key is safe to ship in frontend code — that is what it
  is for. It only grants what your Row Level Security policies allow. NEVER
  put the "service_role" key here; that key bypasses every security rule.
*/

export const SUPABASE_URL = 'https://kilticbtcbijfhfszvga.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpbHRpY2J0Y2JpamZoZnN6dmdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NjYwMTIsImV4cCI6MjEwNTI0MjAxMn0.YcSGcTDliUL0A73YFeJ5M_f8aJ_EpF88el904JORZbE';

/**
 * Opening the live app with `?demo` in the address (e.g. app.buildguard.co.za/?demo)
 * runs the sample-data walkthrough instead of the real login — handy for
 * sales demos on a customer's own screen. Nothing in demo mode touches the
 * server; it lives entirely in that browser's local storage.
 */
const FORCE_DEMO = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');

/** True when real Supabase credentials are present (and demo isn't forced). */
export const IS_PRODUCTION = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY) && !FORCE_DEMO;

export const MODE = IS_PRODUCTION ? 'production' : 'demo';
