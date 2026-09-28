/*
  auditlog.js — AUDIT LOG. Owner-only formal accountability record: who,
  did what, when, on which project, for which transaction, including the
  rand amount where relevant. Every approval decision writes here via
  db.js's logAudit(), so this table is never hand-maintained.
*/

import { getSession } from './state.js';
import { listAuditLog, listProjects, listUsers } from './db.js';
import { escapeHtml, formatDateTime, formatCurrency } from './utils.js';

export function renderAuditLogPage(container) {
  const session = getSession();
  const projects = listProjects(session.companyId);
  const users = listUsers(session.companyId);
  let projectFilter = '';
  let userFilter = '';

  function draw() {
    const rows = listAuditLog(session.companyId, { projectId: projectFilter || undefined, userId: userFilter || undefined });

    container.innerHTML = `
      <div class="page-title">📜 Audit Log</div>
      <p class="muted mb-3">Every approval, rejection and capture action — who, what, when.</p>
      <div class="input-row mb-3">
        <div class="field" style="margin-bottom:0;">
          <label>Project</label>
          <select id="projectFilter">
            <option value="">All projects</option>
            ${projects.map((p) => `<option value="${p.id}" ${projectFilter === p.id ? 'selected' : ''}>${escapeHtml(p.project_name)}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="margin-bottom:0;">
          <label>User</label>
          <select id="userFilter">
            <option value="">Everyone</option>
            ${users.map((u) => `<option value="${u.id}" ${userFilter === u.id ? 'selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="card table-scroll">
        <table class="simple-table">
          <thead><tr><th>Date</th><th>User</th><th>Action</th><th>Details</th><th>Amount</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map(rowHtml).join('') : `<tr><td colspan="5" class="faint">No activity recorded yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
    container.querySelector('#projectFilter').addEventListener('change', (e) => { projectFilter = e.target.value; draw(); });
    container.querySelector('#userFilter').addEventListener('change', (e) => { userFilter = e.target.value; draw(); });
  }

  draw();
}

function rowHtml(entry) {
  return `
    <tr>
      <td class="faint">${formatDateTime(entry.created_at)}</td>
      <td>${escapeHtml(entry.user_name)}</td>
      <td>${escapeHtml(entry.action)}</td>
      <td>${escapeHtml(entry.details || '—')}</td>
      <td>${entry.amount ? formatCurrency(entry.amount) : '—'}</td>
    </tr>`;
}
