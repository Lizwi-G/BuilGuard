/*
  state.js — tiny in-memory app state + pub/sub.
  Holds "who is logged in, as what role, at what company" for the current
  session. Persisted to localStorage so a page refresh keeps you logged in.
*/

import { getValue, setValue } from './storage.js';
import { MODE } from './config.js';

// Namespaced per mode so a production login can never be mistaken for a demo
// user (or vice versa) when the same browser opens the app with ?demo.
const SESSION_KEY = 'session:' + MODE;

const listeners = new Set();

// BuildGuard is a financial control platform first — these four roles model
// the "data flows up" hierarchy: Supervisors/Site Managers capture activity
// on site, Project Managers control project spend, the Owner controls the
// company's finances. See ROLE_RANK below for the approval chain order.
export const ROLES = {
  OWNER: 'owner',
  PROJECT_MANAGER: 'project_manager',
  SITE_MANAGER: 'site_manager',
  SUPERVISOR: 'supervisor'
};

export const ROLE_LABELS = {
  [ROLES.OWNER]: 'Owner / Director',
  [ROLES.PROJECT_MANAGER]: 'Project Manager',
  [ROLES.SITE_MANAGER]: 'Site Manager',
  [ROLES.SUPERVISOR]: 'Supervisor'
};

// Position in the approval chain — used by the routing engine in db.js to
// decide which stage comes next.
export const ROLE_RANK = {
  [ROLES.SUPERVISOR]: 0,
  [ROLES.SITE_MANAGER]: 1,
  [ROLES.PROJECT_MANAGER]: 2,
  [ROLES.OWNER]: 3
};

const state = {
  mode: MODE, // 'demo' | 'production' — decided by whether js/config.js has Supabase keys
  session: getValue(SESSION_KEY, null), // { companyId, userId, role }
  onlineOverride: null // null = trust navigator.onLine; true/false = demo toggle
};

export function getState() { return state; }

export function getSession() { return state.session; }

export function setSession(session) {
  state.session = session;
  setValue(SESSION_KEY, session);
  emit();
}

export function clearSession() {
  state.session = null;
  setValue(SESSION_KEY, null);
  emit();
}

export function isLoggedIn() { return !!state.session; }

export function onStateChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } });
}

/** Demo-only helper: simulate going offline/online without touching real network. */
export function setOnlineOverride(val) {
  state.onlineOverride = val;
  emit();
}

export function isOnline() {
  if (state.onlineOverride !== null) return state.onlineOverride;
  return navigator.onLine;
}
