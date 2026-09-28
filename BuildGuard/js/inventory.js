/*
  inventory.js — CHECK STOCK. Purchased / Received / Used / Expected /
  Actual / Variance per material per project, with a one-tap way to update
  a physical stock count (which immediately recalculates variance and,
  if the gap is large enough, raises a Money Leak).
*/

import { getSession, ROLES } from './state.js';
import { listInventory, getMaterial, getProject, listProjects, getUser, recordInventoryCount, projectIdsForUser } from './db.js';
import { formatDate, formatNumber, escapeHtml, toast, openModal, closeModal } from './utils.js';

export function renderInventoryPage(container) {
  const session = getSession();
  const user = getUser(session.userId);
  const myProjectIds = projectIdsForUser(user);
  const defaultProject = session.role === ROLES.OWNER ? '' : (myProjectIds[0] || '');
  const projects = listProjects(session.companyId).filter((p) => session.role === ROLES.OWNER || myProjectIds.includes(p.id));
  let projectFilter = defaultProject;

  function draw() {
    const rows = listInventory(session.companyId, { projectId: projectFilter || undefined });
    container.innerHTML = `
      <div class="page-title">📦 Stock</div>
      <div class="field">
        <label>Project</label>
        <select id="projectFilter">
          <option value="">All projects</option>
          ${projects.map((p) => `<option value="${p.id}" ${projectFilter === p.id ? 'selected' : ''}>${escapeHtml(p.project_name)}</option>`).join('')}
        </select>
      </div>
      <div class="card">
        ${rows.length ? rows.map(inventoryRow).join('') : `<div class="empty-state"><div class="emoji">📭</div>No stock records for this project yet.</div>`}
      </div>
    `;
    container.querySelector('#projectFilter').addEventListener('change', (e) => { projectFilter = e.target.value; draw(); });
    rows.forEach((row) => {
      container.querySelector(`[data-inv="${row.id}"]`).addEventListener('click', () => openDetail(row, draw));
    });
  }

  function inventoryRow(row) {
    const material = getMaterial(row.material_id);
    const project = getProject(row.project_id);
    const hasIssue = Math.abs(row.variance) >= 1;
    return `
      <div class="list-item" data-inv="${row.id}">
        <span class="li-icon">${hasIssue ? '⚠️' : '📦'}</span>
        <span class="li-main">
          <div class="li-title">${material ? escapeHtml(material.name) : ''}</div>
          <div class="li-sub">${project ? escapeHtml(project.project_name) : ''} · expected ${formatNumber(row.expected)} ${material ? escapeHtml(material.unit) : ''}</div>
        </span>
        <span class="li-end">
          ${hasIssue
            ? `<span class="badge badge-danger">${row.variance > 0 ? '+' : ''}${formatNumber(row.variance)}</span>`
            : `<span class="badge badge-success">✓ matches</span>`}
        </span>
      </div>`;
  }

  draw();
}

function openDetail(row, onChange) {
  const material = getMaterial(row.material_id);
  const project = getProject(row.project_id);
  const card = openModal(`
    <h3>${material ? escapeHtml(material.name) : ''}</h3>
    <p class="muted">${project ? escapeHtml(project.project_name) : ''}</p>
    <table class="simple-table">
      <tr><th>Purchased</th><td>${formatNumber(row.purchased)}</td></tr>
      <tr><th>Received</th><td>${formatNumber(row.received)}</td></tr>
      <tr><th>Used</th><td>${formatNumber(row.used)}</td></tr>
      <tr><th>Expected remaining</th><td>${formatNumber(row.expected)}</td></tr>
      <tr><th>Actual (last count)</th><td>${formatNumber(row.actual_counted)}</td></tr>
      <tr><th>Variance</th><td>${row.variance === 0 ? '0 ✓' : `${row.variance > 0 ? '+' : ''}${formatNumber(row.variance)} ⚠️`}</td></tr>
    </table>
    <p class="faint mt-2">Last counted ${formatDate(row.counted_at)}</p>
    ${Math.abs(row.variance) >= 1 ? `<p class="badge badge-warning mt-2">Quantity mismatch — requires review</p>` : ''}
    <div class="field mt-3">
      <label>Update physical count</label>
      <input type="number" id="countInput" min="0" step="any" placeholder="${row.actual_counted}">
    </div>
    <button class="btn btn-primary w-full" id="saveCountBtn">Save New Count</button>
  `);
  card.querySelector('#saveCountBtn').addEventListener('click', () => {
    const session = getSession();
    const val = Number(card.querySelector('#countInput').value);
    if (isNaN(val) || val < 0) { toast('Enter a valid count', 'error'); return; }
    recordInventoryCount({ inventoryId: row.id, actualCounted: val, countedBy: session.userId });
    toast('Stock count updated', 'success');
    closeModal();
    onChange && onChange();
  });
}
