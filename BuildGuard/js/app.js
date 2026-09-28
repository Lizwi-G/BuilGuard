/*
  app.js — bootstrap + hash router. This is the only file that wires the
  feature modules together; every module below is otherwise independent.
*/

import { init as initDb } from './db.js';
import { isLoggedIn, onStateChange } from './state.js';
import { IS_PRODUCTION } from './config.js';
import { onSyncError } from './storage.js';
import { toast } from './utils.js';
import { initOfflineQueue } from './offline.js';
import { renderNav, setupAccountMenu, setupNotificationBell, setupSidebarToggle, setupBottomNavAutoHide } from './nav.js';
import { setupNotificationPanel } from './notifications.js';
import { renderLogin, restoreProductionSession } from './auth.js';
import { renderDashboard } from './dashboard.js';
import { renderApprovalsInbox, renderRequestDetail } from './approvals.js';
import { renderPurchasesList, renderBuyMaterialWizard } from './purchases.js';
import { renderRequestExpenseForm } from './expenses.js';
import { renderFuelPage, renderRecordFuelForm } from './fuel.js';
import { renderDeliveriesPage, renderReceiveDeliveryForm, renderReportShortageForm } from './deliveries.js';
import { renderInventoryPage } from './inventory.js';
import { renderSuppliersPage, renderSupplierDetail, renderPriceHistoryPage } from './suppliers.js';
import { renderSavingsPage } from './savings.js';
import { renderInsightsPage } from './insights.js';
import { renderProjectsList, renderProjectDetail } from './projects.js';
import { renderAlertsPage } from './alerts.js';
import { renderMoneyLeaksPage } from './moneyleaks.js';
import { renderReportsPage } from './reports.js';
import { renderTeamPage } from './team.js';
import { renderActivityPage } from './activity.js';
import { renderAuditLogPage } from './auditlog.js';
import { renderSettingsPage } from './settings.js';

function parseHash() {
  const raw = (location.hash || '#/dashboard').slice(2); // strip "#/"
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const params = new URLSearchParams(queryPart || '');
  return { segments, params };
}

let refreshNotifBadge = null;

function router() {
  const { segments, params } = parseHash();
  const route = segments[0] || 'dashboard';
  const app = document.getElementById('app');

  if (!isLoggedIn() && route !== 'login') { location.hash = '#/login'; return; }
  if (isLoggedIn() && route === 'login') { location.hash = '#/dashboard'; return; }

  app.scrollTop = 0;
  window.scrollTo(0, 0);

  if (route === 'login') {
    document.getElementById('sidebar').innerHTML = '';
    document.getElementById('bottomNav').innerHTML = '';
    renderLogin(app);
    return;
  }

  switch (route) {
    case 'dashboard':
      renderDashboard(app);
      break;

    case 'approvals':
      if (segments[1]) renderRequestDetail(app, segments[1]);
      else renderApprovalsInbox(app);
      break;

    case 'projects':
      if (segments[1]) renderProjectDetail(app, segments[1]);
      else renderProjectsList(app);
      break;

    case 'purchases':
      if (segments[1] === 'new') renderBuyMaterialWizard(app);
      else renderPurchasesList(app);
      break;

    case 'expenses':
      renderRequestExpenseForm(app);
      break;

    case 'fuel':
      if (segments[1] === 'new') renderRecordFuelForm(app);
      else renderFuelPage(app);
      break;

    case 'deliveries':
      if (segments[1] === 'new') renderReceiveDeliveryForm(app, params.get('purchase'));
      else if (segments[1] === 'shortage') renderReportShortageForm(app);
      else renderDeliveriesPage(app);
      break;

    case 'inventory':
      renderInventoryPage(app);
      break;

    case 'suppliers':
      if (segments[1]) renderSupplierDetail(app, segments[1]);
      else renderSuppliersPage(app);
      break;

    case 'pricehistory':
      renderPriceHistoryPage(app);
      break;

    case 'savings':
      renderSavingsPage(app);
      break;

    case 'insights':
      renderInsightsPage(app);
      break;

    case 'alerts':
      renderAlertsPage(app);
      break;

    case 'moneyleaks':
      renderMoneyLeaksPage(app, segments[1]);
      break;

    case 'reports':
      renderReportsPage(app);
      break;

    case 'team':
      renderTeamPage(app);
      break;

    case 'activity':
      renderActivityPage(app);
      break;

    case 'audit':
      renderAuditLogPage(app);
      break;

    case 'settings':
      renderSettingsPage(app);
      break;

    default:
      renderDashboard(app);
  }

  renderNav(route);
  refreshNotifBadge && refreshNotifBadge();
}

async function bootstrap() {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="empty-state"><div class="emoji">🛡️</div>Loading BuildGuard…</div>`;

  await initDb();
  initOfflineQueue();
  setupAccountMenu();
  refreshNotifBadge = setupNotificationBell();
  setupNotificationPanel(refreshNotifBadge);
  setupSidebarToggle();
  setupBottomNavAutoHide();

  if (IS_PRODUCTION) {
    // A Supabase write failing is the one thing the owner must never miss —
    // surface it loudly rather than letting data silently diverge.
    onSyncError((msg) => toast('⚠️ Could not save to server: ' + msg, 'error', 7000));
    try {
      await restoreProductionSession(); // returning user? hydrate their company
    } catch (e) {
      console.error(e);
      toast(e.message, 'error', 6000);
    }
  } else {
    document.getElementById('demoRibbon').classList.remove('hidden');
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch((e) => console.warn('Service worker registration failed', e));
  }

  window.addEventListener('hashchange', router);
  onStateChange(router);
  router();
}

bootstrap();
