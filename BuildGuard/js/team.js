/*
  team.js — TEAM management (Owner only). Invite a user into one of the
  three subordinate roles, see everyone at a glance (role/project/status/
  last activity), and view/edit/deactivate/reassign them. The Owner
  controls company membership — nobody can self-register as anything but
  Owner (via Create Company Account).
*/

import { getSession, ROLES, ROLE_LABELS } from './state.js';
import { IS_PRODUCTION } from './config.js';
import {
  listUsers, listProjects, getProject, inviteUser, updateUserStatus,
  updateUserAssignment, listAuditLog, refreshTeamData
} from './db.js';
import { escapeHtml, timeAgo, toast, openModal, closeModal, confirmAction } from './utils.js';

const INVITABLE_ROLES = [ROLES.PROJECT_MANAGER, ROLES.SITE_MANAGER, ROLES.SUPERVISOR];

export function renderTeamPage(container) {
  const session = getSession();

  function draw() {
    const users = listUsers(session.companyId).sort((a, b) => rolePriority(a.role) - rolePriority(b.role));
    container.innerHTML = `
      <div class="flex justify-between items-center mb-2">
        <div class="page-title" style="margin-bottom:0">👥 Team</div>
        <button class="btn btn-accent btn-sm" id="inviteBtn">+ Invite User</button>
      </div>
      <div class="card">${users.map(userRow).join('')}</div>
    `;
    container.querySelector('#inviteBtn').addEventListener('click', () => openInviteModal(draw));
    users.forEach((u) => {
      container.querySelector(`[data-user="${u.id}"]`)?.addEventListener('click', () => openUserDetail(u, draw));
    });
  }

  // Someone may have finished signing in on their own device seconds ago —
  // pull fresh data before drawing so the Owner never acts on a stale
  // "Invited" badge for someone who's actually already in.
  if (IS_PRODUCTION) {
    draw(); // show cached state immediately, don't block on the network
    refreshTeamData().then(draw);
  } else {
    draw();
  }
}

function rolePriority(role) { return { owner: 0, project_manager: 1, site_manager: 2, supervisor: 3 }[role] ?? 9; }

function projectLabel(u) {
  const ids = u.role === ROLES.PROJECT_MANAGER ? (u.manages_projects || []) : (u.assigned_projects || []);
  if (u.role === ROLES.OWNER) return 'All projects';
  if (!ids.length) return 'Unassigned';
  const names = ids.map((id) => getProject(id)?.project_name).filter(Boolean);
  return names.length > 1 ? `${names.length} projects` : (names[0] || 'Unassigned');
}

function userRow(u) {
  const lastActivity = listAuditLog(u.company_id, { userId: u.id })[0];
  return `
    <div class="list-item" data-user="${u.id}">
      <span class="li-icon">👤</span>
      <span class="li-main">
        <div class="li-title">${escapeHtml(u.name)}</div>
        <div class="li-sub">${escapeHtml(ROLE_LABELS[u.role] || u.role)} · ${escapeHtml(projectLabel(u))}</div>
      </span>
      <span class="li-end">
        <span class="badge ${u.status === 'active' ? 'badge-success' : u.status === 'invited' ? 'badge-warning' : 'badge-neutral'}">${u.status === 'active' ? '🟢 Active' : u.status === 'invited' ? '✉️ Invited' : '⚪ Inactive'}</span>
        <div class="faint mt-1">${lastActivity ? timeAgo(lastActivity.created_at) : 'no activity'}</div>
      </span>
    </div>`;
}

function openUserDetail(user, onChange) {
  const session = getSession();
  const projects = listProjects(session.companyId);
  const currentIds = user.role === ROLES.PROJECT_MANAGER ? (user.manages_projects || []) : (user.assigned_projects || []);

  // A person only gets a working login once THEY finish "I was invited —
  // set up my login" on their own device — that's what sets auth_id. Status
  // (active/inactive) is a separate, purely administrative switch for
  // suspending someone who already has a login; it does nothing for someone
  // who hasn't signed up yet. Showing a "Reactivate" button before auth_id
  // exists implied it would grant access, which it never did — that's the
  // control people kept clicking expecting it to fix a stuck sign-in.
  const awaitingSignUp = IS_PRODUCTION && !user.auth_id;

  const card = openModal(`
    <h3>${escapeHtml(user.name)}</h3>
    <p class="muted">${escapeHtml(ROLE_LABELS[user.role] || user.role)}</p>
    <p class="faint">📞 ${escapeHtml(user.phone || '—')} · ✉️ ${escapeHtml(user.email || '—')}</p>
    ${user.role !== ROLES.OWNER ? `
      <div class="field mt-3">
        <label>Assigned Projects</label>
        ${projects.map((p) => `
          <label style="display:flex;align-items:center;gap:8px;padding:8px 0;">
            <input type="checkbox" data-project-check value="${p.id}" ${currentIds.includes(p.id) ? 'checked' : ''}>
            ${escapeHtml(p.project_name)}
          </label>`).join('')}
        <button class="btn btn-outline w-full mt-2" id="saveAssignBtn">Save Assignment</button>
      </div>
      ${awaitingSignUp ? `
        <div class="card mt-3" style="background:var(--color-warning-bg);border-color:transparent;">
          <div class="eyebrow mb-1">⏳ Waiting on them, not you</div>
          <p class="faint" style="margin-bottom:0;">
            ${escapeHtml(user.name)} hasn't signed in yet. There's nothing to activate here — on
            <strong>their own phone or computer</strong> they need to open BuildGuard, tap
            <strong>"I was invited — set up my login"</strong>, and enter <strong>${escapeHtml(user.email || 'this exact email')}</strong>
            with a password of their choice. The moment they do, they're in automatically.
          </p>
        </div>
      ` : `
        <button class="btn ${user.status === 'active' ? 'btn-danger' : 'btn-success'} w-full mt-3" id="toggleStatusBtn">
          ${user.status === 'active' ? 'Deactivate User' : 'Reactivate User'}
        </button>
      `}
    ` : '<p class="faint mt-3">Owners manage their own account.</p>'}
    <button class="btn btn-ghost w-full mt-2" id="closeBtn">Close</button>
  `);

  card.querySelector('#saveAssignBtn')?.addEventListener('click', () => {
    const ids = Array.from(card.querySelectorAll('[data-project-check]:checked')).map((el) => el.value);
    updateUserAssignment(user.id, ids);
    toast('Assignment updated', 'success');
    closeModal();
    onChange && onChange();
  });
  card.querySelector('#toggleStatusBtn')?.addEventListener('click', async () => {
    const nextStatus = user.status === 'active' ? 'inactive' : 'active';
    const ok = await confirmAction(`${nextStatus === 'active' ? 'Reactivate' : 'Deactivate'} ${user.name}?`, { danger: nextStatus === 'inactive' });
    if (!ok) return;
    updateUserStatus(user.id, nextStatus);
    toast('Status updated', 'success');
    closeModal();
    onChange && onChange();
  });
  card.querySelector('#closeBtn').addEventListener('click', closeModal);
}

function openInviteModal(onChange) {
  const session = getSession();
  const projects = listProjects(session.companyId);
  let role = null;

  function draw() {
    const card = openModal(`
      <h3>Invite User</h3>
      <div class="field">
        <label>Role</label>
        <div class="chip-group">
          ${INVITABLE_ROLES.map((r) => `<button class="chip ${role === r ? 'selected' : ''}" data-role="${r}">${ROLE_LABELS[r]}</button>`).join('')}
        </div>
      </div>
      <div class="field"><label>Name</label><input type="text" id="nameInput" placeholder="Full name"></div>
      <div class="field"><label>Email</label><input type="email" id="emailInput" placeholder="name@company.co.za"></div>
      <div class="field"><label>Phone</label><input type="tel" id="phoneInput" placeholder="082 000 0000"></div>
      ${role ? `
        <div class="field">
          <label>Assigned Project${role === ROLES.PROJECT_MANAGER ? '(s)' : ''}</label>
          ${projects.map((p) => `
            <label style="display:flex;align-items:center;gap:8px;padding:6px 0;">
              <input type="checkbox" data-project-check value="${p.id}">
              ${escapeHtml(p.project_name)}
            </label>`).join('')}
        </div>
      ` : ''}
      <button class="btn btn-primary w-full" id="sendBtn">Send Invitation</button>
      <p class="faint text-center mt-2">${IS_PRODUCTION
        ? 'BuildGuard doesn\'t email invitations yet. After adding them, tell the person to open BuildGuard and tap <strong>"I was invited — set up my login"</strong> using this exact email address.'
        : '🧪 DEMO — this creates a real team member immediately; no email is actually sent.'}</p>
    `);
    card.querySelectorAll('[data-role]').forEach((el) => el.addEventListener('click', () => { role = el.dataset.role; draw(); }));
    card.querySelector('#sendBtn').addEventListener('click', () => submit(card));
  }

  function submit(card) {
    if (!role) { toast('Choose a role', 'error'); return; }
    const name = card.querySelector('#nameInput').value.trim();
    const email = card.querySelector('#emailInput').value.trim();
    const phone = card.querySelector('#phoneInput').value.trim();
    const projectIds = Array.from(card.querySelectorAll('[data-project-check]:checked')).map((el) => el.value);
    try {
      inviteUser({ companyId: session.companyId, role, name, email, phone, projectIds });
      toast(`${name} invited as ${ROLE_LABELS[role]} ✅`, 'success');
      closeModal();
      onChange && onChange();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  draw();
}
