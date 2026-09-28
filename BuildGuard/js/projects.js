/*
  projects.js — ALL PROJECTS (Owner) / MY PROJECTS (Project Manager) and
  the per-project cost-control detail screen. "How much money are we
  actually spending on this project, and is it healthy?"
*/

import { getSession, ROLES } from './state.js';
import {
  listProjects, getProject, getUser, listUsers, computeProjectCostSummary, computeProjectOverview,
  projectIdsForUser, getMaterial, computeProjectFinancials, computeProjectProfitability,
  createProject, updateProject
} from './db.js';
import { formatCurrency, formatDate, formatNumber, escapeHtml, toast, openModal, closeModal } from './utils.js';
import { renderLeakItem, wireLeakItems } from './alerts.js';

export function renderProjectsList(container) {
  const session = getSession();
  const user = getUser(session.userId);
  const isOwner = user.role === ROLES.OWNER;

  function draw() {
    const myProjectIds = new Set(projectIdsForUser(user));
    const projects = listProjects(session.companyId).filter((p) => isOwner || myProjectIds.has(p.id));
    const overviews = projects.map((p) => computeProjectOverview(session.companyId, p.id));

    container.innerHTML = `
      <div class="flex justify-between items-center mb-2">
        <div class="page-title" style="margin-bottom:0">🏗️ ${isOwner ? 'All Projects' : 'My Projects'}</div>
        ${isOwner ? '<button class="btn btn-accent btn-sm" id="addProjectBtn">+ Add Project</button>' : ''}
      </div>
      <div class="card">
        ${overviews.length ? overviews.map(projectRow).join('') : `
          <div class="empty-state">
            <div class="emoji">🏗️</div>
            ${isOwner ? 'No projects yet. Add your first project to start tracking its budget and spend.' : 'No projects assigned to you yet.'}
          </div>`}
      </div>
    `;
    container.querySelector('#addProjectBtn')?.addEventListener('click', () => openProjectForm(null, draw));
    overviews.forEach((o) => {
      container.querySelector(`[data-project="${o.project.id}"]`).addEventListener('click', () => { location.hash = `#/projects/${o.project.id}`; });
    });
  }

  draw();
}

/** Add (project=null) or edit a project. Owner only — wired only where the button renders. */
function openProjectForm(project, onChange) {
  const session = getSession();
  const managers = listUsers(session.companyId).filter((u) => u.role === ROLES.PROJECT_MANAGER && u.status !== 'inactive');
  const p = project || {};
  const v = (x) => escapeHtml(x ?? '');

  const card = openModal(`
    <h3>${project ? 'Edit Project' : 'Add Project'}</h3>
    <div class="field"><label>Project name *</label><input type="text" id="pName" value="${v(p.project_name)}" placeholder="e.g. Summerstrand Development"></div>
    <div class="field"><label>Client</label><input type="text" id="pClient" value="${v(p.client_name)}" placeholder="Who is this project for?"></div>
    <div class="input-row">
      <div class="field"><label>City</label><input type="text" id="pCity" value="${v(p.city)}" placeholder="Gqeberha"></div>
      <div class="field"><label>Province</label><input type="text" id="pProvince" value="${v(p.province)}" placeholder="Eastern Cape"></div>
    </div>
    <div class="field"><label>Site / area</label><input type="text" id="pRegion" value="${v(p.region)}" placeholder="e.g. Summerstrand"></div>
    <div class="input-row">
      <div class="field"><label>Budget (R) *</label><input type="number" id="pBudget" min="0" step="1000" value="${p.budget ?? ''}" placeholder="2500000"></div>
      <div class="field"><label>Contract value (R)</label><input type="number" id="pContract" min="0" step="1000" value="${p.contract_value ?? ''}" placeholder="2950000"></div>
    </div>
    <div class="field">
      <label>Spent to date (R)</label>
      <input type="number" id="pSpent" min="0" step="1000" value="${p.total_spent_to_date ?? 0}">
      <div class="hint">Total cost so far including labour and subcontracts — from your books. Materials and fuel captured in BuildGuard are shown separately.</div>
    </div>
    <div class="input-row">
      <div class="field"><label>Start date</label><input type="date" id="pStart" value="${v(p.start_date)}"></div>
      <div class="field"><label>Expected completion</label><input type="date" id="pEnd" value="${v(p.end_date)}"></div>
    </div>
    <div class="field">
      <label>Project Manager</label>
      <select id="pManager">
        <option value="">Unassigned</option>
        ${managers.map((m) => `<option value="${m.id}" ${p.manager_id === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
      </select>
      ${managers.length ? '' : '<div class="hint">No Project Managers yet — invite one under Team, then assign them here.</div>'}
    </div>
    ${project ? `
      <div class="field">
        <label>Status</label>
        <select id="pStatus">
          ${['active', 'on_hold', 'completed', 'cancelled'].map((s) => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}
        </select>
      </div>` : ''}
    <button class="btn btn-primary w-full" id="saveBtn">${project ? 'Save Changes' : 'Create Project'}</button>
    <button class="btn btn-ghost w-full mt-2" id="cancelBtn">Cancel</button>
  `);

  card.querySelector('#cancelBtn').addEventListener('click', closeModal);
  card.querySelector('#saveBtn').addEventListener('click', () => {
    const g = (id) => card.querySelector('#' + id).value;
    const fields = {
      project_name: g('pName').trim(), client_name: g('pClient').trim(),
      city: g('pCity').trim(), province: g('pProvince').trim(), region: g('pRegion').trim(),
      location: [g('pRegion').trim(), g('pCity').trim()].filter(Boolean).join(', '),
      budget: Number(g('pBudget')), contract_value: Number(g('pContract')) || 0,
      total_spent_to_date: Number(g('pSpent')) || 0,
      start_date: g('pStart') || null, end_date: g('pEnd') || null,
      manager_id: g('pManager') || null
    };
    try {
      if (project) {
        fields.status = g('pStatus');
        updateProject(project.id, fields, session.userId);
        toast('Project updated ✅', 'success');
      } else {
        createProject({
          companyId: session.companyId, createdBy: session.userId,
          projectName: fields.project_name, location: fields.location, province: fields.province, city: fields.city, region: fields.region,
          clientName: fields.client_name, contractValue: fields.contract_value, budget: fields.budget,
          totalSpentToDate: fields.total_spent_to_date, managerId: fields.manager_id, startDate: fields.start_date, endDate: fields.end_date
        });
        toast('Project created ✅', 'success');
      }
      closeModal();
      onChange && onChange();
    } catch (e) { toast(e.message, 'error'); }
  });
}

function projectRow(o) {
  return `
    <div class="list-item" data-project="${o.project.id}" style="flex-wrap:wrap;">
      <span class="li-icon">${o.health.icon}</span>
      <span class="li-main">
        <div class="li-title">${escapeHtml(o.project.project_name)}</div>
        <div class="li-sub">${o.manager ? escapeHtml(o.manager.name) : 'Unassigned'} · Budget ${formatCurrency(o.budget, { abbreviate: true })}</div>
        <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, o.spendPct)}%;background:${barColor(o.spendPct)}"></div></div>
        <div class="faint">Spent ${formatCurrency(o.spent, { abbreviate: true })} · Remaining ${formatCurrency(o.remaining, { abbreviate: true })} · ${o.spendPct}%</div>
      </span>
      <span class="li-end">
        <span class="badge ${o.health.key === 'action' ? 'badge-danger' : o.health.key === 'watch' ? 'badge-warning' : 'badge-success'}">${o.health.icon} ${o.health.label}</span>
        ${o.potentialLeakage > 0 ? `<div class="faint mt-1">Leak: ${formatCurrency(o.potentialLeakage)}</div>` : ''}
      </span>
    </div>`;
}

function barColor(pct) {
  if (pct >= 90) return 'var(--color-danger)';
  if (pct >= 70) return 'var(--color-warning)';
  return 'var(--color-success)';
}

function exposureRow(label, amount, hint) {
  return `
    <div class="flex justify-between items-center" style="padding:8px 0;border-bottom:1px solid var(--color-border);">
      <span><span class="muted">${escapeHtml(label)}</span><br><span class="faint">${escapeHtml(hint)}</span></span>
      <span style="font-weight:700;white-space:nowrap;">${formatCurrency(amount)}</span>
    </div>`;
}

export function renderProjectDetail(container, projectId) {
  const session = getSession();
  if (!getProject(projectId)) { container.innerHTML = `<div class="empty-state">Project not found.</div>`; return; }

  function draw() {
    const project = getProject(projectId); // re-read each draw so edits show immediately
    const summary = computeProjectCostSummary(session.companyId, projectId);
    const o = summary.overview;
    const fin = computeProjectFinancials(session.companyId, projectId);
    const profit = computeProjectProfitability(session.companyId, projectId);
    const isOwner = session.role === ROLES.OWNER;
    container.innerHTML = `
      <div class="flex justify-between items-center mb-2">
        <button class="btn btn-ghost btn-sm" id="backBtn">← Back to Projects</button>
        ${isOwner ? '<button class="btn btn-outline btn-sm" id="editBtn">✏️ Edit</button>' : ''}
      </div>
      <div class="flex justify-between items-start">
        <div>
          <div class="page-title" style="margin-bottom:2px;">${escapeHtml(project.project_name)}</div>
          <p class="muted mb-3">${escapeHtml(project.location || '')}${project.client_name ? ' · ' + escapeHtml(project.client_name) : ''}</p>
        </div>
        <span class="badge ${o.health.key === 'action' ? 'badge-danger' : o.health.key === 'watch' ? 'badge-warning' : 'badge-success'}">${o.health.icon} ${o.health.label}</span>
      </div>

      <div class="card mb-3">
        <div class="flex justify-between items-center">
          <span class="label">Budget</span>
          <span class="faint">${formatCurrency(fin.actual)} of ${formatCurrency(fin.budget)} (${fin.spendPct}%)</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, fin.spendPct)}%;background:${barColor(fin.spendPct)}"></div></div>
        <div class="flex justify-between mt-2"><span class="muted">Remaining budget</span><span style="font-weight:700">${formatCurrency(fin.remainingBudget)}</span></div>
        <div class="flex justify-between mt-1"><span class="muted">Money at risk</span><span style="font-weight:700">${formatCurrency(o.potentialLeakage)}</span></div>
        <div class="flex justify-between mt-1"><span class="muted">Project Manager</span><span style="font-weight:700">${o.manager ? escapeHtml(o.manager.name) : 'Unassigned'}</span></div>
      </div>

      <!-- TRUE FINANCIAL EXPOSURE (Phase 2 §2) — actual is only part of the story -->
      <div class="section-title" style="margin-top:0;">💼 True Financial Exposure</div>
      <div class="card">
        ${exposureRow('Actual spend', fin.actual, 'Money already spent')}
        ${exposureRow('Committed', fin.committed, 'Approved purchases not yet delivered')}
        ${exposureRow('Forecast', fin.forecast, 'Projected remaining spend')}
        <div class="flex justify-between items-center" style="padding:11px 0;border-top:2px solid var(--color-border);margin-top:4px;">
          <span style="font-weight:800">Expected total</span>
          <span style="font-weight:800;font-size:17px;">${formatCurrency(fin.expectedTotal)}</span>
        </div>
        <div class="flex justify-between items-center">
          <span style="font-weight:800;color:${fin.buffer < 0 ? 'var(--color-danger)' : 'var(--color-success)'}">
            ${fin.buffer < 0 ? 'Forecast overrun' : 'Remaining buffer'}
          </span>
          <span style="font-weight:800;font-size:17px;color:${fin.buffer < 0 ? 'var(--color-danger)' : 'var(--color-success)'}">
            ${formatCurrency(Math.abs(fin.buffer))}
          </span>
        </div>
        <div class="mt-3">
          <span class="badge ${fin.exposureStatus.badge}">${fin.exposureStatus.icon} Forecast: ${fin.exposureStatus.label}</span>
        </div>
        <p class="faint mt-2">
          <strong>Management Estimate.</strong> Straight-line projection from ${formatCurrency(fin.burnPerDay)}/day spent so far
          (${Math.round(fin.pctTimeElapsed)}% of the project timeline elapsed, ${fin.remainingDays} days remaining).
          Not an accounting forecast — construction spend is rarely linear, so treat this as an early-warning signal rather than a prediction.
        </p>
      </div>

      ${profit ? `
        <div class="section-title">📊 Profitability <span class="faint" style="font-weight:600">Management Estimate</span></div>
        <div class="card">
          <div class="flex justify-between mt-1"><span class="muted">Contract value</span><span style="font-weight:700">${formatCurrency(profit.contractValue)}</span></div>
          <div class="flex justify-between mt-1"><span class="muted">Costs to date</span><span style="font-weight:700">${formatCurrency(profit.actual)}</span></div>
          <div class="flex justify-between mt-1"><span class="muted">Margin today</span><span style="font-weight:700">${formatCurrency(profit.currentMargin)} (${Math.round(profit.currentMarginPct)}%)</span></div>
          <div class="flex justify-between mt-1" style="border-top:1px solid var(--color-border);padding-top:8px;">
            <span class="muted">Forecast margin</span>
            <span style="font-weight:800;color:${profit.forecastMargin < 0 ? 'var(--color-danger)' : 'var(--color-success)'}">
              ${formatCurrency(profit.forecastMargin)} (${Math.round(profit.forecastMarginPct)}%)
            </span>
          </div>
          <p class="faint mt-2">Contract value less expected cost. Not audited accounting — for management guidance only.</p>
        </div>
      ` : ''}

      <div class="section-title" style="margin-top:0;">Tracked in BuildGuard</div>
      <div class="grid grid-2">
        <div class="card stat-card accent-total"><div class="label">Materials</div><div class="value">${formatCurrency(summary.materialSpend)}</div></div>
        <div class="card stat-card accent-fuel"><div class="label">Fuel</div><div class="value">${formatCurrency(summary.fuelSpend)}</div></div>
      </div>
      <p class="faint mt-2">Total project spend includes labour and subcontracts not itemized in BuildGuard yet — materials &amp; fuel are tracked in full detail here.</p>

      <div class="section-title">🔎 Open Money Leaks ${summary.alerts.length ? `<span class="badge badge-danger">${summary.alerts.length}</span>` : ''}</div>
      <div id="leaksList">${summary.alerts.length ? summary.alerts.map(renderLeakItem).join('') : `<div class="card empty-state"><div class="emoji">✅</div>No open issues on this project.</div>`}</div>

      <div class="section-title">📦 Stock</div>
      <div class="card table-scroll">
        <table class="simple-table">
          <thead><tr><th>Material</th><th>Purchased</th><th>Used</th><th>Expected</th><th>Actual</th><th>Variance</th></tr></thead>
          <tbody>
            ${summary.inventory.length ? summary.inventory.map(inventoryRow).join('') : `<tr><td colspan="6" class="faint">No stock records yet.</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="section-title">📅 Timeline</div>
      <div class="card">
        <div class="flex justify-between"><span>Start</span><span class="faint">${formatDate(project.start_date)}</span></div>
        <div class="flex justify-between mt-1"><span>End</span><span class="faint">${formatDate(project.end_date)}</span></div>
        <div class="flex justify-between mt-1"><span>Status</span><span class="badge badge-info">${escapeHtml(project.status)}</span></div>
      </div>
    `;
    container.querySelector('#backBtn').addEventListener('click', () => { location.hash = '#/projects'; });
    container.querySelector('#editBtn')?.addEventListener('click', () => openProjectForm(getProject(projectId), draw));
    wireLeakItems(container, draw);
  }

  draw();
}

function inventoryRow(row) {
  const material = getMaterial(row.material_id);
  return `
    <tr style="${Math.abs(row.variance) >= 1 ? 'background:var(--color-danger-bg);' : ''}">
      <td>${material ? escapeHtml(material.name) : ''}</td>
      <td>${formatNumber(row.purchased)}</td>
      <td>${formatNumber(row.used)}</td>
      <td>${formatNumber(row.expected)}</td>
      <td>${formatNumber(row.actual_counted)}</td>
      <td>${row.variance === 0 ? '0' : (row.variance > 0 ? '+' : '') + formatNumber(row.variance)}</td>
    </tr>`;
}
