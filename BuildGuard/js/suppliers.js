/*
  suppliers.js — SUPPLIER INTELLIGENCE (Phase 2 §6, §7).

  Was a plain directory; now scores every supplier on price competitiveness,
  delivery accuracy and reliability, and shows the price history behind the
  score. The point is to let an owner answer "is this supplier actually
  costing us money?" without opening a spreadsheet.

  The score weighting (price 40 / delivery 40 / reliability 20) is a product
  judgement, not an industry standard — it is stated openly on the screen so
  nobody mistakes it for an external rating.
*/

import { getSession } from './state.js';
import {
  listSuppliers, listSupplierIntelligence, computeSupplierIntelligence,
  getMaterialPriceHistory, getMaterial, listMaterials,
  createSupplier, updateSupplierStatus
} from './db.js';
import { formatCurrency, escapeHtml, toast, openModal, closeModal } from './utils.js';

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export function renderSuppliersPage(container) {
  const session = getSession();

  function draw() {
    const intel = listSupplierIntelligence(session.companyId);
    container.innerHTML = `
      <div class="flex justify-between items-center mb-2">
        <div class="page-title" style="margin-bottom:0">🤝 Suppliers</div>
        <button class="btn btn-accent btn-sm" id="addSupplierBtn">+ Add</button>
      </div>
      <p class="muted mb-3">Scored on price, delivery accuracy and trading history. Tap a supplier for the detail.</p>
      <div class="card">
        ${intel.length ? intel.map(supplierRow).join('') : `<div class="empty-state"><div class="emoji">🤝</div>No suppliers yet.</div>`}
      </div>
      <button class="btn btn-outline mt-3" id="priceHistoryBtn">📉 Material price history →</button>
    `;
    container.querySelector('#addSupplierBtn').addEventListener('click', () => openAddSupplier(draw));
    container.querySelector('#priceHistoryBtn').addEventListener('click', () => { location.hash = '#/pricehistory'; });
    intel.forEach((s) => {
      container.querySelector(`[data-supplier="${s.supplier.id}"]`).addEventListener('click', () => {
        location.hash = `#/suppliers/${s.supplier.id}`;
      });
    });
  }

  draw();
}

function scoreColor(score) {
  if (score >= 80) return 'var(--color-success)';
  if (score >= 60) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

function supplierRow(s) {
  // A score built on no trading history is provisional — say so plainly rather
  // than letting an untested supplier look as proven as one with a real record.
  const untested = s.purchaseCount === 0;
  return `
    <div class="list-item" data-supplier="${s.supplier.id}">
      <span class="score-badge" style="background:${untested ? 'var(--color-bg)' : scoreColor(s.scores.overall) + '22'};color:${untested ? 'var(--color-text-faint)' : scoreColor(s.scores.overall)}">
        ${untested ? '–' : s.scores.overall}
      </span>
      <span class="li-main" style="margin-left:10px;">
        <div class="li-title">${escapeHtml(s.supplier.supplier_name)}</div>
        <div class="li-sub">${untested
          ? 'No purchase history yet — quotes on file only'
          : `${s.purchaseCount} purchase${s.purchaseCount === 1 ? '' : 's'}${s.shortageCount ? ` · ${s.shortageCount} short delivery${s.shortageCount === 1 ? '' : 's'}` : ''}`}</div>
      </span>
      <span class="li-end">
        <div class="li-title">${formatCurrency(s.totalSpend, { abbreviate: true })}</div>
        <span class="badge ${s.supplier.status === 'active' ? 'badge-success' : 'badge-neutral'}">${s.supplier.status}</span>
      </span>
    </div>`;
}

// ---------------------------------------------------------------------------
// Supplier detail — the intelligence view
// ---------------------------------------------------------------------------

export function renderSupplierDetail(container, supplierId) {
  const session = getSession();

  function draw() {
    const s = computeSupplierIntelligence(session.companyId, supplierId);
    if (!s) { container.innerHTML = `<div class="empty-state">Supplier not found.</div>`; return; }

    container.innerHTML = `
      <button class="btn btn-ghost btn-sm mb-2" id="backBtn">← Back to Suppliers</button>
      <div class="page-title">${escapeHtml(s.supplier.supplier_name)}</div>
      <p class="muted mb-3">${escapeHtml(s.supplier.contact_person || 'No contact person on file')} · ${escapeHtml(s.supplier.phone || '—')}</p>

      <div class="card mb-3">
        <div class="flex items-center gap-3 mb-3">
          <span class="score-badge" style="background:${scoreColor(s.scores.overall)}22;color:${scoreColor(s.scores.overall)};width:64px;height:64px;font-size:20px;">
            ${s.scores.overall}
          </span>
          <div>
            <div style="font-weight:800;font-size:15px;">Performance score</div>
            <div class="faint">${s.scores.overall}/100 overall</div>
          </div>
        </div>
        ${scoreRow('Price', s.scores.price)}
        ${scoreRow('Delivery', s.scores.delivery)}
        ${scoreRow('Reliability', s.scores.reliability)}
        ${s.purchaseCount === 0 ? `
          <p class="badge badge-warning mt-2">Provisional — no purchase history yet</p>
          <p class="faint mt-2">This score is based on quoted prices alone. Delivery and reliability default to a neutral baseline until this supplier has actually been used.</p>
        ` : ''}
        <p class="faint mt-2">Weighting: price 40%, delivery accuracy 40%, trading history 20%. This is BuildGuard's own internal measure, not an external credit or industry rating.</p>
      </div>

      <div class="grid grid-2">
        <div class="card stat-card accent-total"><div class="label">Total Spend</div><div class="value">${formatCurrency(s.totalSpend, { abbreviate: true })}</div></div>
        <div class="card stat-card"><div class="label">Purchases</div><div class="value">${s.purchaseCount}</div></div>
        <div class="card stat-card"><div class="label">Average Purchase</div><div class="value">${formatCurrency(s.averagePurchase, { abbreviate: true })}</div></div>
        <div class="card stat-card ${s.shortageCount ? 'accent-danger' : 'accent-savings'}">
          <div class="label">Short Deliveries</div>
          <div class="value">${s.shortageCount}</div>
          ${s.totalShortageValue ? `<div class="faint">${formatCurrency(s.totalShortageValue)} value</div>` : ''}
        </div>
      </div>

      ${s.deliveredCount ? `<p class="faint mt-2">${s.shortageCount} of ${s.deliveredCount} recorded deliveries arrived short (${s.shortageRate}%).</p>` : '<p class="faint mt-2">No deliveries recorded against this supplier yet.</p>'}

      <div class="section-title">Current Quotes</div>
      <div class="card">
        ${s.quotes.length ? `
          <table class="simple-table">
            <thead><tr><th>Material</th><th>Price</th><th>Previous</th></tr></thead>
            <tbody>
              ${s.quotes.map((q) => {
                const m = getMaterial(q.material_id);
                const up = q.previous_price && q.price > q.previous_price;
                return `<tr>
                  <td>${m ? escapeHtml(m.name) : ''}</td>
                  <td>${formatCurrency(q.price)}${m ? ` <span class="faint">/ ${escapeHtml(m.unit)}</span>` : ''}</td>
                  <td class="faint">${q.previous_price ? `${formatCurrency(q.previous_price)} ${up ? '▲' : '▼'}` : '—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>` : '<p class="faint">No price quotes on file yet.</p>'}
      </div>

      <div class="section-title">Used On</div>
      <div class="card">
        ${s.projects.length ? s.projects.map((p) => `
          <div class="list-item" data-project="${p.id}">
            <span class="li-icon">🏗️</span>
            <span class="li-main"><div class="li-title">${escapeHtml(p.project_name)}</div></span>
          </div>`).join('') : '<p class="faint">Not yet used on any project.</p>'}
      </div>

      <button class="btn ${s.supplier.status === 'active' ? 'btn-outline' : 'btn-success'} w-full mt-3" id="toggleBtn">
        ${s.supplier.status === 'active' ? 'Mark Inactive' : 'Mark Active'}
      </button>
    `;

    container.querySelector('#backBtn').addEventListener('click', () => { location.hash = '#/suppliers'; });
    container.querySelectorAll('[data-project]').forEach((el) => {
      el.addEventListener('click', () => { location.hash = `#/projects/${el.dataset.project}`; });
    });
    container.querySelector('#toggleBtn').addEventListener('click', () => {
      updateSupplierStatus(supplierId, s.supplier.status === 'active' ? 'inactive' : 'active');
      toast('Supplier updated', 'success');
      draw();
    });
  }

  draw();
}

function scoreRow(label, score) {
  return `
    <div class="score-row">
      <div class="score-label">${escapeHtml(label)}</div>
      <div class="score-track"><div class="score-fill" style="width:${score}%;background:${scoreColor(score)}"></div></div>
      <div class="score-value">${score}/100</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Material price history (Phase 2 §7)
// ---------------------------------------------------------------------------

export function renderPriceHistoryPage(container) {
  const session = getSession();
  const materials = listMaterials(session.companyId);
  let selected = materials.length ? materials[0].id : null;

  function draw() {
    const history = selected ? getMaterialPriceHistory(session.companyId, selected) : null;

    container.innerHTML = `
      <button class="btn btn-ghost btn-sm mb-2" id="backBtn">← Back to Suppliers</button>
      <div class="page-title">📉 Material Price History</div>
      <p class="muted mb-3">What each material has actually cost the company over time.</p>

      <div class="field">
        <label>Material</label>
        <select id="materialSelect">
          ${materials.map((m) => `<option value="${m.id}" ${selected === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
        </select>
      </div>

      ${history && history.rows.length ? `
        <div class="card">
          <div class="flex justify-between items-center mb-2">
            <span class="eyebrow">Average unit price by month</span>
            <span class="badge ${history.trendPct > 5 ? 'badge-danger' : history.trendPct < -5 ? 'badge-success' : 'badge-neutral'}">
              ${history.trendPct > 0 ? '▲' : history.trendPct < 0 ? '▼' : '→'} ${Math.abs(history.trendPct)}% over period
            </span>
          </div>
          <div class="trend-chart">
            ${history.rows.map((r) => `
              <div class="trend-col" title="${escapeHtml(r.month)} — ${formatCurrency(r.avgPrice)}">
                <div class="trend-seg materials" style="height:${Math.max(4, Math.round((r.avgPrice / history.max) * 120))}px"></div>
              </div>`).join('')}
          </div>
          <div class="flex" style="gap:4px;">
            ${history.rows.map((r) => `<div class="trend-label" style="flex:1">${monthLabel(r.month)}</div>`).join('')}
          </div>
        </div>

        <div class="card mt-3 table-scroll">
          <table class="simple-table">
            <thead><tr><th>Month</th><th>Average</th><th>Lowest</th><th>Highest</th><th>Suppliers</th></tr></thead>
            <tbody>
              ${history.rows.map((r) => `
                <tr>
                  <td>${monthLabel(r.month)}</td>
                  <td><strong>${formatCurrency(r.avgPrice)}</strong></td>
                  <td class="faint">${formatCurrency(r.minPrice)}</td>
                  <td class="faint">${formatCurrency(r.maxPrice)}</td>
                  <td class="faint">${escapeHtml(r.suppliers.join(', '))}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      ` : '<div class="card empty-state"><div class="emoji">📭</div>No purchase history for this material yet.</div>'}
    `;

    container.querySelector('#backBtn').addEventListener('click', () => { location.hash = '#/suppliers'; });
    container.querySelector('#materialSelect').addEventListener('change', (e) => { selected = e.target.value; draw(); });
  }

  draw();
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' });
}

// ---------------------------------------------------------------------------
// Add supplier
// ---------------------------------------------------------------------------

function openAddSupplier(onChange) {
  const session = getSession();
  const card = openModal(`
    <h3>Add Supplier</h3>
    <div class="field"><label>Company name</label><input type="text" id="nameInput" placeholder="e.g. BuildMart Wholesale"></div>
    <div class="field"><label>Contact person</label><input type="text" id="contactInput"></div>
    <div class="field"><label>Phone</label><input type="tel" id="phoneInput"></div>
    <div class="field"><label>Email</label><input type="email" id="emailInput"></div>
    <div class="field"><label>Address</label><input type="text" id="addressInput"></div>
    <button class="btn btn-primary w-full" id="saveBtn">Save Supplier</button>
  `);
  card.querySelector('#saveBtn').addEventListener('click', () => {
    const supplierName = card.querySelector('#nameInput').value.trim();
    if (!supplierName) { toast('Supplier name is required', 'error'); return; }
    createSupplier({
      companyId: session.companyId, supplierName,
      contactPerson: card.querySelector('#contactInput').value,
      phone: card.querySelector('#phoneInput').value,
      email: card.querySelector('#emailInput').value,
      address: card.querySelector('#addressInput').value
    });
    toast('Supplier added ✅', 'success');
    closeModal();
    onChange && onChange();
  });
}
