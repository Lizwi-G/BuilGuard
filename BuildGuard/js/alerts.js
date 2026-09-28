/*
  alerts.js — Money Leaks / alert lifecycle (open -> acknowledged -> resolved).
  renderLeakItem/wireLeakItems are shared with dashboard.js so the leak
  cards on the home screen and the full Alerts screen behave identically.
*/

import { getSession, ROLES } from './state.js';
import { listAlerts, updateAlertStatus, getProject, getUser, projectIdsForUser } from './db.js';
import { formatCurrency, timeAgo, escapeHtml, openModal, closeModal, toast } from './utils.js';

const SEVERITY_ICON = { critical: '🔴', warning: '⚠️', info: '🟠' };
const TYPE_LABEL = {
  inventory_variance: 'Stock variance', price_variance: 'Price variance',
  delivery_shortage: 'Delivery shortage', fuel_anomaly: 'Fuel consumption', budget_variance: 'Budget variance'
};

export function renderLeakItem(alert) {
  const project = alert.project_id ? getProject(alert.project_id) : null;
  return `
    <div class="leak-item sev-${alert.severity}" data-alert-id="${alert.id}" style="cursor:pointer">
      <span class="leak-icon">${SEVERITY_ICON[alert.severity] || '⚠️'}</span>
      <div class="leak-body">
        <div class="leak-title">${escapeHtml(alert.message)}</div>
        <div class="leak-sub">${TYPE_LABEL[alert.alert_type] || 'Alert'}${project ? ' · ' + escapeHtml(project.project_name) : ''} · ${timeAgo(alert.created_at)}${alert.status === 'acknowledged' ? ' · acknowledged' : ''}</div>
      </div>
      ${alert.amount ? `<div class="leak-amount">${formatCurrency(alert.amount)}</div>` : ''}
    </div>
  `;
}

export function wireLeakItems(root, onChange) {
  root.querySelectorAll('[data-alert-id]').forEach((el) => {
    el.addEventListener('click', () => openAlertDetail(el.dataset.alertId, onChange));
  });
}

function openAlertDetail(alertId, onChange) {
  const alert = listAlerts(getSession().companyId, {}).find((a) => a.id === alertId)
    || listAlerts(getSession().companyId, { status: 'resolved' }).find((a) => a.id === alertId);
  if (!alert) return;
  const project = alert.project_id ? getProject(alert.project_id) : null;

  const card = openModal(`
    <div style="font-size:28px;">${SEVERITY_ICON[alert.severity] || '⚠️'}</div>
    <h3 class="mt-2">${escapeHtml(alert.message)}</h3>
    <p class="muted">${TYPE_LABEL[alert.alert_type] || 'Alert'}${project ? ' · ' + escapeHtml(project.project_name) : ''}</p>
    ${alert.amount ? `<p><strong>Estimated impact:</strong> ${formatCurrency(alert.amount)}</p>` : ''}
    <p class="faint">Raised ${timeAgo(alert.created_at)} · Status: ${alert.status}</p>
    <div class="btn-block-row mt-4">
      ${alert.status !== 'acknowledged' && alert.status !== 'resolved' ? `<button class="btn btn-outline" id="ackBtn">Acknowledge</button>` : ''}
      ${alert.status !== 'resolved' ? `<button class="btn btn-success" id="resolveBtn">Mark Resolved</button>` : ''}
    </div>
    ${alert.status === 'resolved' ? `<p class="faint text-center mt-3">✅ This has already been resolved.</p>` : ''}
  `);

  card.querySelector('#ackBtn')?.addEventListener('click', () => {
    updateAlertStatus(alert.id, 'acknowledged');
    toast('Marked as acknowledged — flagged for review', 'success');
    closeModal();
    onChange && onChange();
  });
  card.querySelector('#resolveBtn')?.addEventListener('click', () => {
    updateAlertStatus(alert.id, 'resolved');
    toast('Alert resolved', 'success');
    closeModal();
    onChange && onChange();
  });
}

export function renderAlertsPage(container) {
  const session = getSession();
  const user = getUser(session.userId);
  const myProjectIds = new Set(projectIdsForUser(user));
  const inScope = (a) => user.role === ROLES.OWNER || myProjectIds.has(a.project_id);
  let tab = 'open';

  function draw() {
    let alerts = listAlerts(session.companyId, {}).filter(inScope);
    if (tab === 'open') alerts = alerts.filter((a) => a.status === 'open');
    else if (tab === 'acknowledged') alerts = alerts.filter((a) => a.status === 'acknowledged');
    else alerts = alerts.filter((a) => a.status === 'resolved');

    const all = listAlerts(session.companyId, {}).filter(inScope);
    const counts = {
      open: all.filter((a) => a.status === 'open').length,
      acknowledged: all.filter((a) => a.status === 'acknowledged').length,
      resolved: all.filter((a) => a.status === 'resolved').length
    };

    container.innerHTML = `
      <div class="page-title">🚨 Alerts</div>
      <p class="muted mb-3">Unusual situations that may be costing you money — reviewed, not accused.</p>
      <div class="tabs">
        <button class="tab-btn ${tab === 'open' ? 'active' : ''}" data-tab="open">Open (${counts.open})</button>
        <button class="tab-btn ${tab === 'acknowledged' ? 'active' : ''}" data-tab="acknowledged">Acknowledged (${counts.acknowledged})</button>
        <button class="tab-btn ${tab === 'resolved' ? 'active' : ''}" data-tab="resolved">Resolved (${counts.resolved})</button>
      </div>
      <div id="alertsList">
        ${alerts.length ? alerts.map(renderLeakItem).join('') : `<div class="card empty-state"><div class="emoji">✅</div>Nothing here.</div>`}
      </div>
    `;

    container.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => { tab = btn.dataset.tab; draw(); });
    });
    wireLeakItems(container, draw);
  }

  draw();
}
