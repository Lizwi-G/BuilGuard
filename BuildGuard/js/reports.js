/*
  reports.js — simple, no-nonsense reports. Deliberately avoids complex
  charting per the product brief ("avoid overwhelming users with complex
  charts") — just sorted bars and clean tables.
*/

import { getSession, ROLES } from './state.js';
import {
  listProjects, getProject, getMaterial, getSupplier,
  listVehicles, listPurchases, listFuelTransactions, listDeliveries,
  listInventory, listRequests, getSupplierComparison, computeProjectCostSummary,
  getFuelConsumptionSeries, getUser, projectIdsForUser, getPurchase
} from './db.js';
import { formatCurrency, formatDate, formatNumber, escapeHtml } from './utils.js';

function scopedProjectIds(session) {
  const user = getUser(session.userId);
  if (user.role === ROLES.OWNER) return listProjects(session.companyId).map((p) => p.id);
  return projectIdsForUser(user);
}

const REPORTS = [
  { key: 'project', label: 'Project Spending', icon: '🏗️' },
  { key: 'material', label: 'Material Spending', icon: '🧱' },
  { key: 'fuel', label: 'Fuel Spending', icon: '⛽' },
  { key: 'supplier', label: 'Supplier Spending', icon: '🤝' },
  { key: 'purchaseHistory', label: 'Purchase History', icon: '🧾' },
  { key: 'inventoryVariance', label: 'Inventory Variances', icon: '📦' },
  { key: 'deliveryShortage', label: 'Delivery Shortages', icon: '🚚' },
  { key: 'fuelConsumption', label: 'Fuel Consumption', icon: '📈' },
  { key: 'savings', label: 'Potential Savings', icon: '💰' }
];

export function renderReportsPage(container) {
  const session = getSession();
  let active = 'project';

  function draw() {
    container.innerHTML = `
      <div class="page-title">📊 Reports</div>
      <div class="chip-group mb-3">
        ${REPORTS.map((r) => `<button class="chip ${active === r.key ? 'selected' : ''}" data-report="${r.key}">${r.icon} ${r.label}</button>`).join('')}
      </div>
      <div id="reportBody"></div>
    `;
    container.querySelectorAll('[data-report]').forEach((btn) => {
      btn.addEventListener('click', () => { active = btn.dataset.report; draw(); });
    });
    container.querySelector('#reportBody').innerHTML = RENDERERS[active](session);
  }

  draw();
}

function barList(items, { max }) {
  if (!items.length) return `<div class="card empty-state"><div class="emoji">📭</div>No data yet.</div>`;
  return `<div class="card">${items.map((it) => `
    <div class="bar-row">
      <div class="bar-label" title="${escapeHtml(it.label)}">${escapeHtml(it.label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${max ? Math.max(3, (it.value / max) * 100) : 0}%"></div></div>
      <div class="bar-value">${formatCurrency(it.value, { abbreviate: true })}</div>
    </div>`).join('')}</div>`;
}

const RENDERERS = {
  project(session) {
    const ids = new Set(scopedProjectIds(session));
    const rows = listProjects(session.companyId).filter((p) => ids.has(p.id)).map((p) => {
      const s = computeProjectCostSummary(session.companyId, p.id);
      return { label: p.project_name, value: s.totalTracked };
    }).sort((a, b) => b.value - a.value);
    const max = Math.max(1, ...rows.map((r) => r.value));
    return barList(rows, { max });
  },

  material(session) {
    const ids = new Set(scopedProjectIds(session));
    const purchases = listPurchases(session.companyId).filter((p) => ids.has(p.project_id));
    const byMaterial = {};
    purchases.forEach((p) => { byMaterial[p.material_id] = (byMaterial[p.material_id] || 0) + p.total_price; });
    const rows = Object.entries(byMaterial).map(([materialId, value]) => {
      const m = getMaterial(materialId);
      return { label: m ? m.name : materialId, value };
    }).sort((a, b) => b.value - a.value);
    const max = Math.max(1, ...rows.map((r) => r.value));
    return barList(rows, { max });
  },

  fuel(session) {
    const ids = new Set(scopedProjectIds(session));
    const fuel = listFuelTransactions(session.companyId).filter((f) => ids.has(f.project_id));
    const byVehicle = {};
    fuel.forEach((f) => { byVehicle[f.vehicle_id] = (byVehicle[f.vehicle_id] || 0) + f.total_cost; });
    const rows = Object.entries(byVehicle).map(([vehicleId, value]) => {
      const v = getVehicle(vehicleId);
      return { label: v ? v.vehicle_name : vehicleId, value };
    }).sort((a, b) => b.value - a.value);
    const max = Math.max(1, ...rows.map((r) => r.value));
    return barList(rows, { max });
  },

  supplier(session) {
    const ids = new Set(scopedProjectIds(session));
    const purchases = listPurchases(session.companyId).filter((p) => ids.has(p.project_id));
    const bySupplier = {};
    purchases.forEach((p) => { bySupplier[p.supplier_id] = (bySupplier[p.supplier_id] || 0) + p.total_price; });
    const rows = Object.entries(bySupplier).map(([supplierId, value]) => {
      const s = getSupplier(supplierId);
      return { label: s ? s.supplier_name : supplierId, value };
    }).sort((a, b) => b.value - a.value);
    const max = Math.max(1, ...rows.map((r) => r.value));
    return barList(rows, { max });
  },

  purchaseHistory(session) {
    const ids = new Set(scopedProjectIds(session));
    const purchases = listPurchases(session.companyId).filter((p) => ids.has(p.project_id));
    if (!purchases.length) return `<div class="card empty-state"><div class="emoji">📭</div>No purchases yet.</div>`;
    return `<div class="card table-scroll"><table class="simple-table">
      <thead><tr><th>Date</th><th>Material</th><th>Supplier</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
      <tbody>${purchases.map((p) => {
        const m = getMaterial(p.material_id), s = getSupplier(p.supplier_id);
        return `<tr><td>${formatDate(p.purchase_date)}</td><td>${m ? escapeHtml(m.name) : ''}</td><td>${s ? escapeHtml(s.supplier_name) : ''}</td><td>${formatNumber(p.quantity)}</td><td>${formatCurrency(p.unit_price)}</td><td>${formatCurrency(p.total_price)}</td></tr>`;
      }).join('')}</tbody>
    </table></div>`;
  },

  inventoryVariance(session) {
    const ids = new Set(scopedProjectIds(session));
    const rows = listInventory(session.companyId).filter((r) => ids.has(r.project_id) && Math.abs(r.variance) >= 1).sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
    if (!rows.length) return `<div class="card empty-state"><div class="emoji">✅</div>No stock variances — everything reconciles.</div>`;
    return `<div class="card table-scroll"><table class="simple-table">
      <thead><tr><th>Project</th><th>Material</th><th>Expected</th><th>Actual</th><th>Variance</th></tr></thead>
      <tbody>${rows.map((r) => {
        const m = getMaterial(r.material_id), p = getProject(r.project_id);
        return `<tr><td>${p ? escapeHtml(p.project_name) : ''}</td><td>${m ? escapeHtml(m.name) : ''}</td><td>${formatNumber(r.expected)}</td><td>${formatNumber(r.actual_counted)}</td><td>${r.variance > 0 ? '+' : ''}${formatNumber(r.variance)}</td></tr>`;
      }).join('')}</tbody>
    </table></div>`;
  },

  deliveryShortage(session) {
    const ids = new Set(scopedProjectIds(session));
    const rows = listDeliveries(session.companyId).filter((d) => {
      if (!d.shortage_quantity) return false;
      const purchase = getPurchase(d.purchase_id);
      return purchase && ids.has(purchase.project_id);
    });
    if (!rows.length) return `<div class="card empty-state"><div class="emoji">✅</div>No delivery shortages recorded.</div>`;
    return `<div class="card table-scroll"><table class="simple-table">
      <thead><tr><th>Date</th><th>Expected</th><th>Received</th><th>Shortage</th></tr></thead>
      <tbody>${rows.map((d) => `<tr><td>${formatDate(d.delivery_date)}</td><td>${formatNumber(d.expected_quantity)}</td><td>${formatNumber(d.received_quantity)}</td><td>-${formatNumber(d.shortage_quantity)}</td></tr>`).join('')}</tbody>
    </table></div>`;
  },

  fuelConsumption(session) {
    const ids = new Set(scopedProjectIds(session));
    const vehicles = listVehicles(session.companyId).filter((v) => ids.has(v.assigned_project));
    const rows = vehicles.map((v) => {
      const series = getFuelConsumptionSeries(session.companyId, v.id);
      const latest = series[0];
      return { vehicle: v, latest };
    });
    return `<div class="card table-scroll"><table class="simple-table">
      <thead><tr><th>Vehicle</th><th>Latest</th><th>Baseline</th><th>Status</th></tr></thead>
      <tbody>${rows.map(({ vehicle, latest }) => `
        <tr>
          <td>${escapeHtml(vehicle.vehicle_name)}</td>
          <td>${latest ? `${latest.rate} ${latest.unit}` : '—'}</td>
          <td>${vehicle.baseline_l_per_hr ? vehicle.baseline_l_per_hr + ' L/hr' : vehicle.baseline_km_per_l + ' km/L'}</td>
          <td>${latest ? (latest.anomalous ? '<span class="badge badge-warning">Unusual</span>' : '<span class="badge badge-success">Normal</span>') : '<span class="badge badge-neutral">No data</span>'}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
  },

  savings(session) {
    const ids = new Set(scopedProjectIds(session));
    const rows = listRequests(session.companyId, { status: 'pending', requestType: 'material' })
      .filter((req) => ids.has(req.project_id))
      .map((req) => {
      const m = getMaterial(req.material_id);
      const comparison = getSupplierComparison(session.companyId, req.material_id, req.quantity);
      return { req, material: m, comparison };
    }).filter((r) => r.comparison.potentialSaving > 0);
    const total = rows.reduce((s, r) => s + r.comparison.potentialSaving, 0);
    if (!rows.length) return `<div class="card empty-state"><div class="emoji">💰</div>No open savings opportunities right now.</div>`;
    return `
      <div class="card stat-card accent-savings mb-3"><div class="label">Total identified this period</div><div class="value">${formatCurrency(total)}</div></div>
      <div class="card table-scroll"><table class="simple-table">
        <thead><tr><th>Material</th><th>Qty</th><th>Best Supplier</th><th>Saving</th></tr></thead>
        <tbody>${rows.map(({ material, req, comparison }) => {
          const best = comparison.rows.find((r) => r.supplierId === comparison.bestSupplierId);
          return `<tr><td>${material ? escapeHtml(material.name) : ''}</td><td>${formatNumber(req.quantity)}</td><td>${best ? escapeHtml(best.supplierName) : ''}</td><td>${formatCurrency(comparison.potentialSaving)}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
    `;
  }
};
