/*
  insights.js — "WHERE IS OUR MONEY GOING?" (Phase 2 §5, §19, §27–§30, §39)

  Cost trend analysis, month-on-month movement, top expenses, top suppliers
  and supplier concentration. Deliberately built with plain CSS bars rather
  than a charting library: no dependency, works offline, and stays readable
  on a phone — which is where an owner actually opens this.
*/

import { getSession, ROLES } from './state.js';
import {
  getUser, computeSpendTrend, computeMonthComparison, computeTopExpenses,
  computeTopSuppliers, computeCompanySpending, projectIdsForUser, listProjects
} from './db.js';
import { formatCurrency, formatDate, escapeHtml } from './utils.js';

const RANGES = [
  { key: 7, label: '7 days' },
  { key: 30, label: '30 days' },
  { key: 90, label: '90 days' },
  { key: 182, label: '6 months' },
  { key: 365, label: '12 months' }
];

export function renderInsightsPage(container) {
  const session = getSession();
  const user = getUser(session.userId);
  const isOwner = user.role === ROLES.OWNER;
  const myProjectIds = projectIdsForUser(user);
  const projects = listProjects(session.companyId).filter((p) => isOwner || myProjectIds.includes(p.id));

  let days = 90;
  let projectFilter = '';

  function draw() {
    const trend = computeSpendTrend(session.companyId, { days, projectId: projectFilter || null });
    const comparison = computeMonthComparison(session.companyId);
    const topExpenses = computeTopExpenses(session.companyId);
    const topSuppliers = computeTopSuppliers(session.companyId);
    const spending = computeCompanySpending(session.companyId);

    container.innerHTML = `
      <div class="page-title">📈 Spending Insights</div>
      <p class="muted mb-3">Where the money is going, and what changed.</p>

      <div class="field">
        <label>Project</label>
        <select id="projectFilter">
          <option value="">All projects</option>
          ${projects.map((p) => `<option value="${p.id}" ${projectFilter === p.id ? 'selected' : ''}>${escapeHtml(p.project_name)}</option>`).join('')}
        </select>
      </div>

      <div class="chip-group mb-3">
        ${RANGES.map((r) => `<button class="chip ${days === r.key ? 'selected' : ''}" data-days="${r.key}">${r.label}</button>`).join('')}
      </div>

      <div class="card">
        <div class="flex justify-between items-center mb-2">
          <span class="eyebrow">Spend trend · by ${trend.granularity}</span>
          <span style="font-weight:800">${formatCurrency(trend.rows.reduce((s, r) => s + r.total, 0))}</span>
        </div>
        ${trend.rows.length ? `
          <div class="trend-chart">
            ${trend.rows.map((r) => `
              <div class="trend-col" title="${escapeHtml(r.key)} — ${formatCurrency(r.total)}">
                ${r.other ? `<div class="trend-seg other" style="height:${barH(r.other, trend.max)}px"></div>` : ''}
                ${r.fuel ? `<div class="trend-seg fuel" style="height:${barH(r.fuel, trend.max)}px"></div>` : ''}
                ${r.materials ? `<div class="trend-seg materials" style="height:${barH(r.materials, trend.max)}px"></div>` : ''}
              </div>`).join('')}
          </div>
          <div class="flex" style="gap:4px;">
            ${trend.rows.map((r) => `<div class="trend-label" style="flex:1">${shortLabel(r.key, trend.granularity)}</div>`).join('')}
          </div>
          <div class="legend mt-3">
            <span><span class="legend-dot" style="background:var(--color-accent-dark)"></span>Materials</span>
            <span><span class="legend-dot" style="background:var(--color-info)"></span>Fuel</span>
            <span><span class="legend-dot" style="background:var(--color-text-faint)"></span>Other</span>
          </div>
        ` : '<div class="empty-state"><div class="emoji">📭</div>No spending recorded in this period.</div>'}
      </div>

      <div class="section-title">📊 This Month vs Last Month</div>
      <div class="card">
        ${comparisonRow('Total spending', comparison.total)}
        ${comparisonRow('Materials', comparison.materials)}
        ${comparisonRow('Fuel', comparison.fuel)}
        ${comparisonRow('Other expenses', comparison.other)}
      </div>

      <div class="section-title">🔝 Top 10 Expenses <span class="faint" style="font-weight:600">This Month</span></div>
      <div class="card table-scroll">
        <table class="simple-table">
          <thead><tr><th>Project</th><th>Category</th><th>Supplier</th><th>Amount</th><th>% of spend</th></tr></thead>
          <tbody>
            ${topExpenses.rows.length ? topExpenses.rows.map((e) => `
              <tr>
                <td>${escapeHtml(e.projectName)}</td>
                <td>${escapeHtml(e.category)}</td>
                <td>${escapeHtml(e.supplier)}</td>
                <td>${formatCurrency(e.amount)}</td>
                <td>${Math.round(e.pctOfTotal)}%</td>
              </tr>`).join('') : '<tr><td colspan="5" class="faint">No expenses this month.</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="section-title">🤝 Top Suppliers by Spend</div>
      ${topSuppliers.concentrated.length ? topSuppliers.concentrated.map((c) => `
        <div class="leak-item sev-warning">
          <span class="leak-icon">⚠️</span>
          <div class="leak-body">
            <div class="leak-title">High supplier concentration</div>
            <div class="leak-sub">${escapeHtml(c.supplierName)} accounts for ${Math.round(c.pctOfTotal)}% of material spending. Not automatically a problem — worth reviewing supplier dependency.</div>
          </div>
        </div>`).join('') : ''}
      <div class="card">
        ${topSuppliers.rows.length ? topSuppliers.rows.map((s) => `
          <div class="list-item" data-supplier="${s.supplierId}">
            <span class="li-icon">🏢</span>
            <span class="li-main">
              <div class="li-title">${escapeHtml(s.supplierName)}</div>
              <div class="li-sub">${s.purchaseCount} purchase${s.purchaseCount === 1 ? '' : 's'} · ${Math.round(s.pctOfTotal)}% of material spend</div>
              <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, s.pctOfTotal)}%;background:var(--color-primary-light)"></div></div>
            </span>
            <span class="li-end" style="font-weight:800">${formatCurrency(s.spend, { abbreviate: true })}</span>
          </div>`).join('') : '<div class="empty-state"><div class="emoji">🤝</div>No supplier spending yet.</div>'}
      </div>
      <button class="btn btn-outline mt-2" id="supplierIntelBtn">🔍 Supplier intelligence →</button>
    `;

    container.querySelectorAll('[data-days]').forEach((el) => {
      el.addEventListener('click', () => { days = Number(el.dataset.days); draw(); });
    });
    container.querySelector('#projectFilter').addEventListener('change', (e) => { projectFilter = e.target.value; draw(); });
    container.querySelector('#supplierIntelBtn').addEventListener('click', () => { location.hash = '#/suppliers'; });
    container.querySelectorAll('[data-supplier]').forEach((el) => {
      el.addEventListener('click', () => { location.hash = `#/suppliers/${el.dataset.supplier}`; });
    });
  }

  draw();
}

function barH(value, max) {
  return Math.max(2, Math.round((value / max) * 120));
}

function shortLabel(key, granularity) {
  if (granularity === 'month') {
    const [y, m] = key.split('-');
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-ZA', { month: 'short' });
  }
  const d = new Date(key);
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' });
}

function comparisonRow(label, d) {
  const up = d.change > 0;
  const flat = Math.abs(d.pct) < 0.5;
  // Rising cost is the thing an owner needs to notice, so it reads red — but
  // it is never called a problem outright, just a change worth investigating.
  const color = flat ? 'var(--color-text-muted)' : up ? 'var(--color-danger)' : 'var(--color-success)';
  return `
    <div class="flex justify-between items-center" style="padding:9px 0;border-bottom:1px solid var(--color-border);">
      <span class="muted">${escapeHtml(label)}</span>
      <span style="text-align:right;">
        <span style="font-weight:800">${formatCurrency(d.now)}</span>
        <span class="faint" style="display:block;color:${color}">
          ${flat ? '→ no real change' : `${up ? '▲' : '▼'} ${Math.round(Math.abs(d.pct))}% vs ${formatCurrency(d.before)}`}
        </span>
      </span>
    </div>`;
}
