/*
  moneyleaks.js — COMPANY MONEY LEAKS. Aggregates open alerts by category
  (Fuel / Materials / Inventory / Deliveries) and lets the Owner (or a
  Project Manager, scoped to their own projects) drill into exactly which
  vehicle/material/delivery is responsible and why.
*/

import { getSession, ROLES } from './state.js';
import {
  getUser, listAlerts, getProject, getVehicle, getMaterial, getPurchase,
  getFuelConsumptionSeries, projectIdsForUser, updateAlertStatus
} from './db.js';
import { formatCurrency, formatDate, escapeHtml } from './utils.js';

const CATEGORY_META = {
  fuel: { type: 'fuel_anomaly', label: 'Fuel Anomalies', icon: '⛽' },
  materials: { type: 'price_variance', label: 'Material Price Variances', icon: '🧱' },
  inventory: { type: 'inventory_variance', label: 'Inventory Discrepancies', icon: '📦' },
  deliveries: { type: 'delivery_shortage', label: 'Delivery Shortages', icon: '🚚' }
};

function scopedAlerts(session, user) {
  const all = listAlerts(session.companyId).filter((a) => a.status !== 'resolved');
  if (user.role === ROLES.OWNER) return all;
  const myProjectIds = new Set(projectIdsForUser(user));
  return all.filter((a) => myProjectIds.has(a.project_id));
}

export function renderMoneyLeaksPage(container, category) {
  const session = getSession();
  const user = getUser(session.userId);
  const alerts = scopedAlerts(session, user);

  if (category && CATEGORY_META[category]) {
    renderCategoryDrilldown(container, category, alerts);
    return;
  }

  const totals = {};
  Object.entries(CATEGORY_META).forEach(([key, meta]) => {
    totals[key] = alerts.filter((a) => a.alert_type === meta.type).reduce((s, a) => s + (a.amount || 0), 0);
  });
  const total = Object.values(totals).reduce((s, v) => s + v, 0);

  container.innerHTML = `
    <div class="page-title">💸 Money Leaks</div>
    <div class="card stat-card accent-danger mb-3">
      <div class="label">Potential financial impact</div>
      <div class="value" style="font-size:30px;">${formatCurrency(total)}</div>
    </div>
    <div class="grid grid-2">
      ${Object.entries(CATEGORY_META).map(([key, meta]) => `
        <div class="card stat-card" data-cat="${key}" style="cursor:pointer">
          <div class="label">${meta.icon} ${meta.label}</div>
          <div class="value">${formatCurrency(totals[key])}</div>
        </div>
      `).join('')}
    </div>
  `;
  container.querySelectorAll('[data-cat]').forEach((el) => {
    el.addEventListener('click', () => { location.hash = `#/moneyleaks/${el.dataset.cat}`; });
  });
}

function renderCategoryDrilldown(container, category, alerts) {
  const meta = CATEGORY_META[category];
  const rows = alerts.filter((a) => a.alert_type === meta.type && (a.meta || category === 'inventory' || category === 'deliveries'));

  container.innerHTML = `
    <button class="btn btn-ghost btn-sm mb-2" id="backBtn">← Back</button>
    <div class="page-title">${meta.icon} ${meta.label}</div>
    <div class="card">
      ${rows.length ? rows.map((a) => drilldownRow(a, category)).join('') : `<div class="empty-state"><div class="emoji">✅</div>No open items in this category.</div>`}
    </div>
  `;
  container.querySelector('#backBtn').addEventListener('click', () => { location.hash = '#/moneyleaks'; });
  container.querySelectorAll('[data-resolve]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      updateAlertStatus(el.dataset.resolve, 'resolved');
      renderCategoryDrilldown(container, category, alerts.filter((a) => a.id !== el.dataset.resolve));
    });
  });
}

function drilldownRow(alert, category) {
  const project = alert.project_id ? getProject(alert.project_id) : null;
  if (category === 'fuel') return fuelRow(alert, project);
  if (category === 'materials') return materialsRow(alert, project);
  if (category === 'inventory') return inventoryRow(alert, project);
  return deliveryRow(alert, project);
}

function fuelRow(alert, project) {
  const vehicleId = alert.meta?.vehicleId;
  const vehicle = vehicleId ? getVehicle(vehicleId) : null;
  const series = vehicle ? getFuelConsumptionSeries(vehicle.company_id, vehicle.id) : [];
  const match = series.find((s) => s.transaction.id === alert.meta?.fuelTransactionId);
  return `
    <div class="card mb-2">
      <div class="flex justify-between items-center">
        <div style="font-weight:800;">${vehicle ? escapeHtml(vehicle.vehicle_name) : 'Vehicle'}</div>
        <span class="badge badge-danger">Requires Review</span>
      </div>
      <div class="faint mb-2">${project ? escapeHtml(project.project_name) : ''}</div>
      <table class="simple-table">
        <tr><th>Expected</th><td>${match ? match.baseline : '—'} ${match ? match.unit : ''}</td></tr>
        <tr><th>Actual</th><td>${match ? match.rate : '—'} ${match ? match.unit : ''}</td></tr>
        <tr><th>Variance</th><td>${match ? match.pctWorse + '%' : '—'}</td></tr>
        <tr><th>Potential impact</th><td>${formatCurrency(alert.amount)}</td></tr>
        <tr><th>Date</th><td>${match ? formatDate(match.transaction.transaction_date) : ''}</td></tr>
      </table>
      <button class="btn btn-outline btn-sm mt-2" data-resolve="${alert.id}">Mark Resolved</button>
    </div>`;
}

function materialsRow(alert, project) {
  const purchase = alert.meta?.purchaseId ? getPurchase(alert.meta.purchaseId) : null;
  const material = purchase ? getMaterial(purchase.material_id) : null;
  return `
    <div class="card mb-2">
      <div class="flex justify-between items-center">
        <div style="font-weight:800;">${material ? escapeHtml(material.name) : 'Material'}</div>
        <span class="badge badge-warning">Price Variance</span>
      </div>
      <div class="faint mb-2">${project ? escapeHtml(project.project_name) : ''}</div>
      <table class="simple-table">
        <tr><th>New Price</th><td>${purchase ? formatCurrency(purchase.unit_price) : '—'}</td></tr>
        <tr><th>Quantity</th><td>${purchase ? purchase.quantity : '—'}</td></tr>
        <tr><th>Potential impact</th><td>${formatCurrency(alert.amount)}</td></tr>
        <tr><th>Date</th><td>${purchase ? formatDate(purchase.purchase_date) : ''}</td></tr>
      </table>
      <button class="btn btn-outline btn-sm mt-2" data-resolve="${alert.id}">Mark Resolved</button>
    </div>`;
}

function inventoryRow(alert, project) {
  return `
    <div class="card mb-2">
      <div class="flex justify-between items-center">
        <div style="font-weight:800;">${escapeHtml(alert.message)}</div>
        <span class="badge badge-danger">Variance</span>
      </div>
      <div class="faint mb-2">${project ? escapeHtml(project.project_name) : ''}</div>
      <table class="simple-table"><tr><th>Potential impact</th><td>${formatCurrency(alert.amount)}</td></tr></table>
      <button class="btn btn-outline btn-sm mt-2" data-resolve="${alert.id}">Mark Resolved</button>
    </div>`;
}

function deliveryRow(alert, project) {
  return `
    <div class="card mb-2">
      <div class="flex justify-between items-center">
        <div style="font-weight:800;">${escapeHtml(alert.message)}</div>
        <span class="badge badge-danger">Shortage</span>
      </div>
      <div class="faint mb-2">${project ? escapeHtml(project.project_name) : ''}</div>
      <table class="simple-table"><tr><th>Potential impact</th><td>${formatCurrency(alert.amount)}</td></tr></table>
      <button class="btn btn-outline btn-sm mt-2" data-resolve="${alert.id}">Mark Resolved</button>
    </div>`;
}
