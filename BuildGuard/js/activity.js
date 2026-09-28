/*
  activity.js — RECENT COMPANY ACTIVITY. A live timeline of everything
  captured across the company (requests, approvals, deliveries, fuel,
  inventory counts), filterable by category and project — "what is
  happening on my sites without calling everyone."
*/

import { getSession, ROLES } from './state.js';
import { getUser, listAuditLog, listProjects, projectIdsForUser } from './db.js';
import { escapeHtml, timeAgo, formatCurrency } from './utils.js';

const CATEGORY_FILTERS = [
  { key: '', label: 'All', icon: '🕒' },
  { key: 'request', label: 'Requests & Approvals', icon: '📥' },
  { key: 'fuel', label: 'Fuel', icon: '⛽' },
  { key: 'delivery', label: 'Deliveries', icon: '🚚' },
  { key: 'inventory', label: 'Inventory', icon: '📦' },
  { key: 'user', label: 'Team', icon: '👥' }
];

const ACTION_ICON = {
  'Submitted request': '📝', 'Approved': '✅', 'Rejected request': '🚫', 'Requested more information': '❓',
  'Provided more information': '💬', 'Received delivery': '🚚', 'Recorded fuel': '⛽', 'Updated stock count': '📦'
};
function iconFor(action) {
  const match = Object.keys(ACTION_ICON).find((k) => action.startsWith(k));
  return match ? ACTION_ICON[match] : '🕒';
}

export function renderActivityPage(container) {
  const session = getSession();
  const user = getUser(session.userId);
  const isOwner = user.role === ROLES.OWNER;
  const myProjectIds = new Set(projectIdsForUser(user));
  const projects = listProjects(session.companyId).filter((p) => isOwner || myProjectIds.has(p.id));

  let category = '';
  let projectFilter = '';

  function draw() {
    let rows = listAuditLog(session.companyId, { category: category || undefined, projectId: projectFilter || undefined });
    if (!isOwner) rows = rows.filter((r) => !r.project_id || myProjectIds.has(r.project_id));
    rows = rows.slice(0, 100);

    container.innerHTML = `
      <div class="page-title">🕒 ${isOwner ? 'Recent Company Activity' : 'Site Activity'}</div>
      <div class="field">
        <label>Project</label>
        <select id="projectFilter">
          <option value="">All projects</option>
          ${projects.map((p) => `<option value="${p.id}" ${projectFilter === p.id ? 'selected' : ''}>${escapeHtml(p.project_name)}</option>`).join('')}
        </select>
      </div>
      <div class="chip-group mb-3">
        ${CATEGORY_FILTERS.map((f) => `<button class="chip ${category === f.key ? 'selected' : ''}" data-cat="${f.key}">${f.icon} ${f.label}</button>`).join('')}
      </div>
      <div class="card">
        ${rows.length ? rows.map(activityRow).join('') : `<div class="empty-state"><div class="emoji">📭</div>No activity yet.</div>`}
      </div>
    `;

    container.querySelector('#projectFilter').addEventListener('change', (e) => { projectFilter = e.target.value; draw(); });
    container.querySelectorAll('[data-cat]').forEach((el) => el.addEventListener('click', () => { category = el.dataset.cat; draw(); }));
  }

  draw();
}

function activityRow(entry) {
  return `
    <div class="list-item">
      <span class="li-icon">${iconFor(entry.action)}</span>
      <span class="li-main">
        <div class="li-title">${escapeHtml(entry.user_name)} — ${escapeHtml(entry.action)}</div>
        <div class="li-sub">${escapeHtml(entry.details || '')}</div>
      </span>
      <span class="li-end">
        ${entry.amount ? `<div class="li-title">${formatCurrency(entry.amount)}</div>` : ''}
        <div class="faint">${timeAgo(entry.created_at)}</div>
      </span>
    </div>`;
}
