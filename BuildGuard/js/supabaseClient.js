/*
  supabaseClient.js — lazily creates the Supabase client.

  The supabase-js library is only downloaded in PRODUCTION MODE, so demo
  mode stays a zero-dependency static site. It's loaded as an ES module
  straight from a CDN — no build step, consistent with the rest of the app.
*/

import { SUPABASE_URL, SUPABASE_ANON_KEY, IS_PRODUCTION } from './config.js';

let client = null;
let loading = null;

export async function getSupabase() {
  if (!IS_PRODUCTION) return null;
  if (client) return client;
  if (!loading) {
    loading = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
      .then(({ createClient }) => {
        client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
        return client;
      });
  }
  return loading;
}
