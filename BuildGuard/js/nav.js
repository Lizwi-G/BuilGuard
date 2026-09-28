/*
  nav.js — role-based navigation. Bottom nav on mobile, sidebar on desktop,
  same route list drives both so they never drift out of sync.

  v2: the nav now reflects the financial-control hierarchy — Owner and
  Project Manager get an Approvals inbox and money-visibility routes;
  Supervisors get a deliberately short list (they capture data, they don't
  need to navigate a financial platform).

  v3 (this pass): the sidebar can genuinely have 11 items for an Owner, so
  it now scrolls internally and can collapse to an icon rail (persisted,
  toggled from the topbar's ☰ or the rail's own chevron) so nothing at the
  bottom of the list is ever unreachable. The mobile bottom nav auto-hides
  while scrolling down through a page and reappears on scroll-up, at the
  top, at the bottom of the page, or on every navigation — with a small
  "peek" handle so a hidden nav is never more than one tap away.
*/

import { getSession, ROLES, ROLE_LABELS, clearSession } from './state.js';
import { IS_PRODUCTION } from './config.js';
import { getUser, getCompany, getUnreadNotificationCount } from './db.js';
import { getValue, setValue } from './storage.js';
import { openModal, closeModal, escapeHtml } from './utils.js';

const ALL_ITEMS = {
  dashboard: { route: 'dashboard', icon: '🏠', label: 'Home', group: 'Overview' },
  approvals: { route: 'approvals', icon: '📥', label: 'Approvals', group: 'Overview' },
  projects: { route: 'projects', icon: '🏗️', label: 'Projects', group: 'Overview' },
  purchases: { route: 'purchases', icon: '🛒', label: 'Requests', group: 'Site' },
  fuel: { route: 'fuel', icon: '⛽', label: 'Fuel', group: 'Site' },
  inventory: { route: 'inventory', icon: '📦', label: 'Stock', group: 'Site' },
  suppliers: { route: 'suppliers', icon: '🤝', label: 'Suppliers', group: 'Money' },
  alerts: { route: 'alerts', icon: '🚨', label: 'Alerts', group: 'Money' },
  moneyleaks: { route: 'moneyleaks', icon: '💸', label: 'Money Leaks', group: 'Money' },
  savings: { route: 'savings', icon: '💚', label: 'Savings', group: 'Money' },
  insights: { route: 'insights', icon: '📈', label: 'Insights', group: 'Money' },
  reports: { route: 'reports', icon: '📊', label: 'Reports', group: 'Company' },
  team: { route: 'team', icon: '👥', label: 'Team', group: 'Company' },
  activity: { route: 'activity', icon: '🕒', label: 'Activity', group: 'Company' },
  audit: { route: 'audit', icon: '📜', label: 'Audit Log', group: 'Company' },
  settings: { route: 'settings', icon: '⚙️', label: 'Settings', group: 'Company' }
};

const ROLE_NAV = {
  [ROLES.OWNER]: ['dashboard', 'approvals', 'projects', 'savings', 'moneyleaks', 'insights', 'alerts', 'suppliers', 'team', 'reports', 'activity', 'audit', 'settings'],
  [ROLES.PROJECT_MANAGER]: ['dashboard', 'approvals', 'projects', 'purchases', 'alerts', 'insights', 'fuel', 'inventory', 'reports'],
  [ROLES.SITE_MANAGER]: ['dashboard', 'approvals', 'purchases', 'fuel', 'inventory', 'alerts'],
  [ROLES.SUPERVISOR]: ['dashboard', 'purchases', 'fuel', 'inventory']
};

const MOBILE_MAX = 5;
const SIDEBAR_COLLAPSE_KEY = 'sidebarCollapsed';
const DESKTOP_MIN_WIDTH = 768;
const RAIL_ONLY_MAX_WIDTH = 1024; // below this a mouse-driven window only has room for the icon rail

/**
 * Mirrors the CSS media query that decides sidebar-vs-bottom-bar. Any
 * mouse-driven device (a PC, even in a narrow window) is "desktop", so the
 * phone-style bottom bar can never cover a form field on a computer.
 */
export function isDesktopNav() {
  return window.innerWidth >= DESKTOP_MIN_WIDTH ||
    (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
}
function isRailForced() { return isDesktopNav() && window.innerWidth < RAIL_ONLY_MAX_WIDTH; }

let lastActiveRoute = 'dashboard';

export function getNavItemsForRole(role) {
  return (ROLE_NAV[role] || ROLE_NAV[ROLES.SUPERVISOR]).map((key) => ALL_ITEMS[key]);
}

function isSidebarCollapsed() { return getValue(SIDEBAR_COLLAPSE_KEY, false) === true; }
function setSidebarCollapsed(val) { setValue(SIDEBAR_COLLAPSE_KEY, !!val); }

export function renderNav(activeRoute) {
  lastActiveRoute = activeRoute;
  const session = getSession();
  if (!session) {
    document.getElementById('bottomNav').innerHTML = '';
    document.getElementById('sidebar').innerHTML = '';
    return;
  }
  const items = getNavItemsForRole(session.role);
  renderBottomNav(items, activeRoute);
  renderSidebar(items, activeRoute, session);
  showBottomNav(); // every navigation starts with the nav visible
}

function renderBottomNav(items, activeRoute) {
  const host = document.getElementById('bottomNav');
  const visible = items.slice(0, MOBILE_MAX);
  const overflow = items.slice(MOBILE_MAX);

  host.innerHTML = visible.map((item) => navBtnHtml(item, activeRoute)).join('') +
    (overflow.length ? `<button class="nav-item" id="navMoreBtn"><span class="nav-icon">⋯</span><span>More</span></button>` : '');

  visible.forEach((item) => {
    host.querySelector(`[data-route="${item.route}"]`).addEventListener('click', () => go(item.route));
  });
  if (overflow.length) {
    document.getElementById('navMoreBtn').addEventListener('click', () => showMoreSheet(overflow));
  }
}

function renderSidebar(items, activeRoute, session) {
  const host = document.getElementById('sidebar');
  const user = getUser(session.userId);
  const company = getCompany(session.companyId);
  const forcedRail = isRailForced();
  const collapsed = forcedRail || isSidebarCollapsed();
  const initials = (user?.name || '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();

  host.classList.toggle('collapsed', collapsed);
  host.classList.toggle('forced-rail', forcedRail);
  document.body.classList.toggle('rail-forced', forcedRail);

  // Group headings only appear where the group changes, so a short
  // Supervisor list doesn't get four labels for four items.
  let lastGroup = null;
  const body = items.map((item) => {
    let heading = '';
    if (item.group !== lastGroup && items.length > 5) {
      heading = `<div class="sidebar-group"><span>${escapeHtml(item.group)}</span></div>`;
      lastGroup = item.group;
    }
    return heading + navBtnHtml(item, activeRoute, collapsed);
  }).join('');

  host.innerHTML = `
    <div class="sidebar-header">
      <div class="sidebar-header-avatar" title="${escapeHtml(user ? user.name : '')}">${escapeHtml(initials)}</div>
      <div class="sidebar-header-text">
        <div class="sidebar-company">${escapeHtml(company ? company.company_name : '')}</div>
        <div class="sidebar-who">${escapeHtml(user ? user.name : '')} · ${escapeHtml(ROLE_LABELS[session.role] || '')}</div>
      </div>
    </div>
    ${body}
    <div class="sidebar-spacer"></div>
    <button class="nav-item" id="sidebarSwitchBtn" title="Sign out / switch user"><span class="nav-icon">↪</span><span>Sign out</span></button>
    <button class="sidebar-toggle" id="sidebarToggleBtn" title="${collapsed ? 'Expand sidebar' : 'Collapse sidebar'}">
      <span>${collapsed ? '»' : '« Collapse'}</span>
    </button>
  `;
  items.forEach((item) => {
    host.querySelector(`[data-route="${item.route}"]`).addEventListener('click', () => go(item.route));
  });
  host.querySelector('#sidebarSwitchBtn').addEventListener('click', doLogout);
  host.querySelector('#sidebarToggleBtn').addEventListener('click', toggleSidebar);
}

function toggleSidebar() {
  setSidebarCollapsed(!isSidebarCollapsed());
  renderNav(lastActiveRoute);
}

function navBtnHtml(item, activeRoute, collapsed) {
  const active = activeRoute === item.route ? 'active' : '';
  const badge = item.route === 'approvals' ? approvalsBadge() : '';
  const title = collapsed ? ` title="${escapeHtml(item.label)}"` : '';
  return `<button class="nav-item ${active}" data-route="${item.route}"${title}><span class="nav-icon">${item.icon}${badge}</span><span>${item.label}</span></button>`;
}

function approvalsBadge() {
  return ''; // populated by dashboard/approvals badge counts shown inline in their own screens
}

function showMoreSheet(overflowItems) {
  const card = openModal(`
    <h3>More</h3>
    <div>
      ${overflowItems.map((item) => `
        <div class="list-item" data-route="${item.route}">
          <span class="li-icon">${item.icon}</span>
          <span class="li-main"><span class="li-title">${item.label}</span></span>
        </div>
      `).join('')}
    </div>
  `);
  overflowItems.forEach((item) => {
    card.querySelector(`[data-route="${item.route}"]`).addEventListener('click', () => { closeModal(); go(item.route); });
  });
}

function go(route) {
  location.hash = `#/${route}`;
}

async function doLogout() {
  closeModal();
  if (IS_PRODUCTION) {
    // Ends the Supabase session and drops the in-memory company data, so the
    // next person on this device can't see the previous company's records.
    const { signOutProduction } = await import('./auth.js');
    await signOutProduction();
  } else {
    clearSession();
  }
  location.hash = '#/login';
}

export function setupAccountMenu() {
  const btn = document.getElementById('userBtn');
  btn.addEventListener('click', () => {
    const session = getSession();
    if (!session) { location.hash = '#/login'; return; }
    const user = getUser(session.userId);
    const company = getCompany(session.companyId);
    const card = openModal(`
      <h3>${escapeHtml(user ? user.name : 'Account')}</h3>
      <p class="muted">${escapeHtml(company ? company.company_name : '')} · ${escapeHtml(ROLE_LABELS[session.role] || '')}</p>
      <button class="btn btn-outline mt-3" id="switchUserBtn">🔁 Switch company / user</button>
      <button class="btn btn-ghost mt-2" id="closeAccountBtn">Close</button>
    `);
    card.querySelector('#switchUserBtn').addEventListener('click', doLogout);
    card.querySelector('#closeAccountBtn').addEventListener('click', closeModal);
  });
}

export function setupNotificationBell() {
  const btn = document.getElementById('notifBtn');
  if (!btn) return;
  function refreshBadge() {
    const session = getSession();
    const badge = document.getElementById('notifBadge');
    if (!session || !badge) return;
    const count = getUnreadNotificationCount(session.userId);
    badge.textContent = String(count);
    badge.classList.toggle('hidden', count === 0);
  }
  refreshBadge();
  window.addEventListener('hashchange', refreshBadge);
  return refreshBadge;
}

/** Desktop-only: the topbar's ☰ button toggles the sidebar rail. */
export function setupSidebarToggle() {
  const btn = document.getElementById('menuBtn');
  if (!btn) return;
  btn.addEventListener('click', toggleSidebar);
}

// ---------------------------------------------------------------------------
// Mobile bottom-nav auto-hide: slides away while scrolling down through a
// page, slides back on scroll-up, and always shows near the top/bottom of
// the page or right after navigating. A small peek handle stays reachable
// whenever the nav is hidden, so it's never more than one tap away.
// ---------------------------------------------------------------------------

function showBottomNav() {
  document.getElementById('bottomNav')?.classList.remove('bottom-nav-hidden');
  document.getElementById('bottomNavPeek')?.classList.remove('visible');
}

export function setupBottomNavAutoHide() {
  const peek = document.getElementById('bottomNavPeek');
  peek?.addEventListener('click', showBottomNav);
  peek?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') showBottomNav(); });

  let lastY = window.scrollY;
  let lastRun = 0;
  const TOP_ZONE = 60;
  const BOTTOM_ZONE = 32;
  const DEAD_ZONE = 8; // ignore tiny jitter so it doesn't flicker
  const THROTTLE_MS = 80; // plenty smooth for a nav-bar slide, no rAF dependency needed

  function update() {
    const bottomNav = document.getElementById('bottomNav');
    if (!bottomNav || isDesktopNav()) { lastY = window.scrollY; return; } // desktop uses the sidebar, not this

    const y = window.scrollY;
    const doc = document.documentElement;
    const atTop = y < TOP_ZONE;
    const atBottom = (window.innerHeight + y) >= (doc.scrollHeight - BOTTOM_ZONE);
    const delta = y - lastY;

    if (atTop || atBottom) {
      bottomNav.classList.remove('bottom-nav-hidden');
      peek?.classList.remove('visible');
    } else if (delta > DEAD_ZONE) {
      bottomNav.classList.add('bottom-nav-hidden');
      peek?.classList.add('visible');
    } else if (delta < -DEAD_ZONE) {
      bottomNav.classList.remove('bottom-nav-hidden');
      peek?.classList.remove('visible');
    }
    lastY = y;
  }

  window.addEventListener('scroll', () => {
    const now = Date.now();
    if (now - lastRun < THROTTLE_MS) return;
    lastRun = now;
    update();
  }, { passive: true });

  // Resizing a desktop window across the rail/full-sidebar threshold should
  // re-lay the sidebar out, and always bring the bottom nav back into view.
  let resizeTimer = null;
  let wasRail = isRailForced();
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const nowRail = isRailForced();
      if (nowRail !== wasRail) { wasRail = nowRail; if (getSession()) renderNav(lastActiveRoute); }
      showBottomNav();
    }, 120);
  });
}
