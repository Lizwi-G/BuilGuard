/*
  storage.js — persistence, in both modes.

  The whole app reads and writes data through the synchronous get/set API
  below. That API is deliberately UNCHANGED between modes so that none of the
  screens have to know where the data lives:

    DEMO MODE        in-memory cache <-> localStorage
    PRODUCTION MODE  in-memory cache <-> Supabase (Postgres + Row Level Security)

  In production the cache is hydrated from Supabase once, after login, with
  every table the logged-in company is allowed to see (RLS decides that on
  the server — the client never filters by company itself). Every write goes
  to the cache immediately (so screens stay instant and offline-safe) and is
  mirrored to Supabase as an upsert. If the network is down the write is
  queued by offline.js and replayed later.

  Per-device preferences (session, sidebar state) stay in localStorage in
  both modes — they are not business data.
*/

import { IS_PRODUCTION } from './config.js';
import { getSupabase } from './supabaseClient.js';

const NS = 'buildguard:';
const SEED_FLAG = NS + 'seeded_v1';

/** JS collection name -> Postgres table name. */
export const TABLE_MAP = {
  companies: 'companies',
  users: 'users',
  projects: 'projects',
  materials: 'materials',
  suppliers: 'suppliers',
  supplierPrices: 'supplier_prices',
  vehicles: 'vehicles',
  requests: 'requests',
  purchases: 'purchases',
  deliveries: 'deliveries',
  inventory: 'inventory',
  fuelTransactions: 'fuel_transactions',
  alerts: 'alerts',
  auditLog: 'audit_log',
  notifications: 'notifications',
  savings: 'savings'
};

/** Fields that exist only on the client and must never be sent to Postgres. */
const CLIENT_ONLY_FIELDS = new Set(['syncStatus']);

const cache = {};
let hydrated = false;

function key(name) { return NS + name; }

function stripClientFields(record) {
  const out = {};
  Object.keys(record).forEach((k) => { if (!CLIENT_ONLY_FIELDS.has(k)) out[k] = record[k]; });
  return out;
}

// ---------------------------------------------------------------------------
// Synchronous API used by db.js (identical in both modes)
// ---------------------------------------------------------------------------

export function getCollection(name) {
  if (cache[name]) return cache[name];
  if (IS_PRODUCTION) return (cache[name] = []); // not hydrated yet — empty, never localStorage
  try {
    const raw = localStorage.getItem(key(name));
    cache[name] = raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('[storage] failed to read', name, e);
    cache[name] = [];
  }
  return cache[name];
}

export function setCollection(name, arr) {
  cache[name] = arr;
  if (IS_PRODUCTION) {
    // Bulk mirror — used for derived collections (alerts) and bulk status changes.
    mirrorMany(name, arr);
  } else {
    localStorage.setItem(key(name), JSON.stringify(arr));
  }
}

/**
 * Single-record write hook, called by db.js's writeRecord(). Cheaper than
 * mirroring the whole collection on every change.
 */
export function syncRecord(name, record) {
  if (!IS_PRODUCTION) return; // localStorage already updated by setCollection
  mirrorOne(name, record);
}

export function getValue(name, fallback = null) {
  try {
    const raw = localStorage.getItem(key(name));
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

export function setValue(name, value) {
  localStorage.setItem(key(name), JSON.stringify(value));
}

export function isSeeded() {
  if (IS_PRODUCTION) return true; // never seed demo data into a real database
  return localStorage.getItem(SEED_FLAG) === 'true';
}

export function markSeeded() {
  if (!IS_PRODUCTION) localStorage.setItem(SEED_FLAG, 'true');
}

/** Wipes all BuildGuard demo data (demo mode only). */
export function resetAll() {
  Object.keys(localStorage).filter((k) => k.startsWith(NS)).forEach((k) => localStorage.removeItem(k));
  Object.keys(cache).forEach((k) => delete cache[k]);
}

// ---------------------------------------------------------------------------
// PRODUCTION: hydrate + mirror
// ---------------------------------------------------------------------------

export function isHydrated() { return !IS_PRODUCTION || hydrated; }

/**
 * Pull everything the current user is allowed to see into the cache.
 * No company filter is applied here on purpose — Row Level Security on the
 * server is the only thing deciding what comes back, so a bug in the client
 * can never leak another company's records.
 */
export async function hydrate() {
  if (!IS_PRODUCTION) return;
  const sb = await getSupabase();
  const names = Object.keys(TABLE_MAP);
  const results = await Promise.all(names.map((name) =>
    sb.from(TABLE_MAP[name]).select('*').then(({ data, error }) => {
      if (error) { console.error('[storage] hydrate failed for', name, error.message); return []; }
      return data || [];
    })
  ));
  names.forEach((name, i) => { cache[name] = results[i]; });
  hydrated = true;
}

export function clearCache() {
  Object.keys(cache).forEach((k) => delete cache[k]);
  hydrated = false;
}

/**
 * All writes to Supabase go through ONE ordered queue. This matters: the app
 * frequently writes two related rows back to back (a new user, then an audit
 * entry that references that user). Fired concurrently, the second can reach
 * the server first and fail a foreign-key check. Chaining them guarantees
 * they land in the order the app issued them.
 */
let writeChain = Promise.resolve();
function enqueue(task) {
  writeChain = writeChain.then(task).catch((e) => console.error('[storage] queued write failed:', e));
  return writeChain;
}

function mirrorOne(name, record) {
  const table = TABLE_MAP[name];
  if (!table) return;
  const payload = stripClientFields(record);
  return enqueue(async () => {
    const sb = await getSupabase();
    const { error } = await sb.from(table).upsert(payload, { onConflict: 'id' });
    if (error) {
      console.error(`[storage] upsert to ${table} failed:`, error.message);
      reportSyncError(error.message);
    }
  });
}

/**
 * Targeted partial write — sends ONLY the given fields, unlike mirrorOne's
 * full-row upsert. Use this for any edit of a record someone else might
 * also be writing to concurrently (e.g. an Owner changing a teammate's
 * status while that teammate's own device is mid-write). A full-row upsert
 * from a stale local cache would silently overwrite whatever the other
 * device just set — most dangerously users.auth_id, which is how a login
 * gets linked to its company record. This can never clobber a column it
 * doesn't mention.
 */
export function syncPatch(name, id, patch) {
  if (!IS_PRODUCTION) return;
  const table = TABLE_MAP[name];
  if (!table) return;
  const payload = stripClientFields(patch);
  return enqueue(async () => {
    const sb = await getSupabase();
    const { error } = await sb.from(table).update(payload).eq('id', id);
    if (error) {
      console.error(`[storage] patch to ${table} failed:`, error.message);
      reportSyncError(error.message);
    }
  });
}

function mirrorMany(name, arr) {
  const table = TABLE_MAP[name];
  if (!table || !arr.length) return;
  const payload = arr.map(stripClientFields);
  return enqueue(async () => {
    const sb = await getSupabase();
    const { error } = await sb.from(table).upsert(payload, { onConflict: 'id' });
    if (error) {
      console.error(`[storage] bulk upsert to ${table} failed:`, error.message);
      reportSyncError(error.message);
    }
  });
}

/** Wait for every queued write to reach the server (used before sign-out). */
export function flushWrites() { return writeChain; }

let syncErrorHandler = null;
export function onSyncError(fn) { syncErrorHandler = fn; }
function reportSyncError(message) { if (syncErrorHandler) syncErrorHandler(message); }
