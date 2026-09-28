/*
  savings.js — MONEY SAVED (Phase 2 §40).

  Strategically this is BuildGuard's most important screen: it turns "the
  system helped us buy better" into a hard, itemised rand figure the owner
  can point at. Deliberately kept separate from MONEY AT RISK (§41) — one is
  banked benefit, the other is potential variance requiring investigation,
  and conflating the two would overstate both.

  Every row here is a real ledger entry. Savings are appended automatically
  by db.js whenever an approver picks a supplier below the baseline price.
*/

import { getSession } from './state.js';
import {
  listSavings, computeSavingsSummary, computeMoneyAtRisk,
  getProject, SAVING_TYPES
} from './db.js';
import { formatCurrency, formatDate, escapeHtml } from './utils.js';

export function renderSavingsPage(container) {
  const session = getSession();
  let range = 'month'; // 'month' | 'ytd' | 'all'

  function draw() {
    const summary = computeSavingsSummary(session.companyId);
    const atRisk = computeMoneyAtRisk(session.companyId);
    const all = listSavings(session.companyId);

    const now = new Date();
    const rows = range === 'month'
      ? all.filter((s) => { const d = new Date(s.created_at); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); })
      : range === 'ytd'
        ? all.filter((s) => new Date(s.created_at).getFullYear() === now.getFullYear())
        : all;
    const rangeTotal = rows.reduce((s, r) => s + r.amount, 0);

    // Month-on-month direction, so the number has context rather than sitting alone.
    const delta = summary.lastMonth ? Math.round(((summary.thisMonth - summary.lastMonth) / summary.lastMonth) * 100) : null;

    container.innerHTML = `
      <div class="page-title">💚 Money Saved</div>
      <p class="muted mb-3">Savings BuildGuard has helped this company capture — every entry is itemised and traceable.</p>

      <div class="grid grid-3">
        <div class="card stat-card accent-savings">
          <div class="label">This Month</div>
          <div class="value">${formatCurrency(summary.thisMonth)}</div>
          ${delta !== null ? `<div class="faint">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs last month</div>` : ''}
        </div>
        <div class="card stat-card"><div class="label">Last Month</div><div class="value">${formatCurrency(summary.lastMonth)}</div></div>
        <div class="card stat-card accent-total"><div class="label">Year to Date</div><div class="value">${formatCurrency(summary.ytd)}</div></div>
      </div>

      <div class="section-title">How the savings were made <span class="faint" style="font-weight:600">This Month</span></div>
      <div class="card">
        ${Object.entries(SAVING_TYPES).map(([key, meta]) => {
          const amount = summary.byType[key] || 0;
          const pct = summary.thisMonth ? Math.round((amount / summary.thisMonth) * 100) : 0;
          return `
            <div class="bar-row">
              <div class="bar-label">${meta.icon} ${escapeHtml(meta.label)}</div>
              <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:var(--color-success)"></div></div>
              <div class="bar-value">${formatCurrency(amount)}</div>
            </div>`;
        }).join('')}
      </div>

      <div class="section-title">Savings ledger</div>
      <div class="chip-group mb-3">
        <button class="chip ${range === 'month' ? 'selected' : ''}" data-range="month">This month</button>
        <button class="chip ${range === 'ytd' ? 'selected' : ''}" data-range="ytd">Year to date</button>
        <button class="chip ${range === 'all' ? 'selected' : ''}" data-range="all">All time</button>
      </div>
      <div class="card">
        <div class="flex justify-between items-center mb-2">
          <span class="eyebrow">${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}</span>
          <span style="font-weight:800">${formatCurrency(rangeTotal)}</span>
        </div>
        ${rows.length ? rows.map(savingRow).join('') : '<div class="empty-state"><div class="emoji">💚</div>No savings recorded in this period yet.</div>'}
      </div>

      <div class="section-title">⚠️ Money at Risk</div>
      <div class="card">
        <p class="faint mb-2">Separate from savings — this is <strong>potential variance requiring investigation</strong>, not confirmed loss.</p>
        <div class="flex justify-between items-center mb-3">
          <span class="muted">Total flagged</span>
          <span style="font-weight:800;font-size:19px;color:var(--color-danger)">${formatCurrency(atRisk.total)}</span>
        </div>
        ${atRisk.categories.length
          ? atRisk.categories.map((c) => `
              <div class="list-item" data-route="${c.route}">
                <span class="li-icon">⚠️</span>
                <span class="li-main"><div class="li-title">${escapeHtml(c.label)}</div></span>
                <span class="li-end" style="font-weight:800">${formatCurrency(c.amount)}</span>
              </div>`).join('')
          : '<div class="empty-state"><div class="emoji">✅</div>Nothing currently flagged for investigation.</div>'}
      </div>
    `;

    container.querySelectorAll('[data-range]').forEach((el) => {
      el.addEventListener('click', () => { range = el.dataset.range; draw(); });
    });
    container.querySelectorAll('[data-route]').forEach((el) => {
      el.addEventListener('click', () => { location.hash = el.dataset.route; });
    });
  }

  draw();
}

function savingRow(s) {
  const meta = SAVING_TYPES[s.saving_type] || { icon: '💚', label: s.saving_type };
  const project = s.project_id ? getProject(s.project_id) : null;
  return `
    <div class="list-item">
      <span class="li-icon">${meta.icon}</span>
      <span class="li-main">
        <div class="li-title">${escapeHtml(s.description || meta.label)}</div>
        <div class="li-sub">${escapeHtml(meta.label)}${project ? ' · ' + escapeHtml(project.project_name) : ''} · ${formatDate(s.created_at)}</div>
      </span>
      <span class="li-end" style="font-weight:800;color:var(--color-success)">+${formatCurrency(s.amount)}</span>
    </div>`;
}
