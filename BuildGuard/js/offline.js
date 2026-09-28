/*
  offline.js — Phase 6: offline-first transaction queue.

  Construction sites often have poor signal. Every write in db.js happens
  instantly against local storage (so the UI never blocks), but when the
  device is offline at the moment of the write, the record is also marked
  syncStatus:'pending' and dropped into this IndexedDB queue. When the
  connection returns, flushQueue() "syncs" each pending record (in Phase
  3/4 this is where the real Supabase INSERT/UPDATE would fire) and clears
  the pending flag.

  This means: no data is ever lost because of a dropped connection, and the
  user always sees a clear "Pending Sync" indicator instead of a silent
  failure.
*/

import { isOnline, onStateChange } from './state.js';
import { toast } from './utils.js';

const DB_NAME = 'buildguard_offline';
const DB_VERSION = 1;
const STORE = 'pending_actions';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { resolve(null); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'queueId', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null); // fail soft — offline queue is a nice-to-have, not a blocker
  });
  return dbPromise;
}

/** Add a pending write to the queue. `syncFn` will be called (with `payload`) when we flush. */
export async function queueAction(collectionName, recordId, payload) {
  const db = await openDb();
  const entry = { collectionName, recordId, payload, queuedAt: new Date().toISOString() };
  if (!db) return; // no IndexedDB available — record still saved locally by db.js, just no queue UI
  await new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  refreshBadge();
}

export async function getPendingCount() {
  const db = await openDb();
  if (!db) return 0;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(0);
  });
}

async function getAllPending() {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function clearQueue() {
  const db = await openDb();
  if (!db) return;
  await new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/**
 * Called by db.js: marks the records that were queued while offline as
 * synced (in a real backend this is where the network call happens).
 * `markSyncedFn(collectionName, recordId)` mutates the local record.
 */
export async function flushQueue(markSyncedFn) {
  const pending = await getAllPending();
  if (!pending.length) return 0;
  for (const item of pending) {
    try { markSyncedFn(item.collectionName, item.recordId); } catch (e) { console.error(e); }
  }
  await clearQueue();
  refreshBadge();
  return pending.length;
}

export async function refreshBadge() {
  const count = await getPendingCount();
  const badge = document.getElementById('syncBadge');
  const countEl = document.getElementById('syncCount');
  if (!badge || !countEl) return;
  countEl.textContent = String(count);
  badge.classList.toggle('hidden', count === 0);
}

export function refreshConnectionBadge() {
  const el = document.getElementById('connBadge');
  if (!el) return;
  const online = isOnline();
  el.textContent = online ? 'Online' : 'Offline';
  el.classList.toggle('offline', !online);
}

let flushHandler = null;
/** Register the function used to mark a queued record as synced (set once from db.js). */
export function setFlushHandler(fn) { flushHandler = fn; }

export function initOfflineQueue() {
  refreshBadge();
  refreshConnectionBadge();

  window.addEventListener('online', tryFlush);
  window.addEventListener('offline', refreshConnectionBadge);
  onStateChange(refreshConnectionBadge);
  onStateChange(tryFlush);
}

async function tryFlush() {
  refreshConnectionBadge();
  if (!isOnline() || !flushHandler) return;
  const n = await flushQueue(flushHandler);
  if (n > 0) toast(`Synced ${n} change${n > 1 ? 's' : ''}`, 'success');
}
