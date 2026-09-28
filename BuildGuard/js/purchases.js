/*
  purchases.js — BUY MATERIAL wizard + the material-request list.

  The actual approve/reject/verify decision UI now lives in approvals.js
  (every request — material or expense — shares one Request Detail
  screen). This file is responsible for: creating a new material request,
  and showing "my"/"this project's" material requests with their status.
*/

import { getSession, ROLES } from './state.js';
import {
  listMaterials, getMaterial, listProjects, getProject,
  createRequest, estimateMaterialCost, listRequests, getCurrentStageKey,
  getUser, projectIdsForUser
} from './db.js';
import { formatCurrency, escapeHtml, timeAgo, toast } from './utils.js';

const URGENCY_LABEL = { normal: 'Normal', soon: 'Soon', urgent: 'Urgent' };
const STAGE_WAIT_LABEL = { site_manager: 'Awaiting Site Manager', project_manager: 'Awaiting Project Manager', owner: 'Awaiting Owner' };

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export function renderPurchasesList(container) {
  const session = getSession();
  const user = getUser(session.userId);
  const myProjectIds = projectIdsForUser(user);
  let tab = 'pending';

  function draw() {
    let requests = listRequests(session.companyId, { requestType: 'material' });
    if (user.role === ROLES.SUPERVISOR) requests = requests.filter((r) => r.requested_by === session.userId);
    else requests = requests.filter((r) => myProjectIds.includes(r.project_id));

    const filtered = tab === 'pending'
      ? requests.filter((r) => r.status === 'pending' || r.status === 'info_requested')
      : requests.filter((r) => r.status === tab);

    container.innerHTML = `
      <div class="flex justify-between items-center mb-2">
        <div class="page-title" style="margin-bottom:0">🛒 Material Requests</div>
        <button class="btn btn-accent btn-sm" id="newRequestBtn">+ Buy Material</button>
      </div>
      <div class="tabs">
        <button class="tab-btn ${tab === 'pending' ? 'active' : ''}" data-tab="pending">Pending (${requests.filter((r) => r.status === 'pending' || r.status === 'info_requested').length})</button>
        <button class="tab-btn ${tab === 'approved' ? 'active' : ''}" data-tab="approved">Approved</button>
        <button class="tab-btn ${tab === 'rejected' ? 'active' : ''}" data-tab="rejected">Rejected</button>
      </div>
      <div class="card">
        ${filtered.length ? filtered.map(requestRow).join('') : `<div class="empty-state"><div class="emoji">📭</div>No ${tab} requests.</div>`}
      </div>
    `;

    container.querySelector('#newRequestBtn').addEventListener('click', () => { location.hash = '#/purchases/new'; });
    container.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => { tab = btn.dataset.tab; draw(); }));
    container.querySelectorAll('[data-req]').forEach((el) => {
      el.addEventListener('click', () => { location.hash = `#/approvals/${el.dataset.req}`; });
    });
  }

  draw();
}

function requestRow(r) {
  const material = getMaterial(r.material_id);
  const project = getProject(r.project_id);
  const requester = getUser(r.requested_by);
  const stageKey = getCurrentStageKey(r);
  const statusLabel = r.status === 'rejected' ? 'Rejected' : r.status === 'approved' ? 'Approved' : r.status === 'info_requested' ? 'Awaiting more info' : (STAGE_WAIT_LABEL[stageKey] || 'Pending');
  const badgeClass = r.status === 'rejected' ? 'badge-danger' : r.status === 'approved' ? 'badge-success' : 'badge-warning';

  return `
    <div class="list-item" data-req="${r.id}">
      <span class="li-icon">${materialEmoji(material ? material.name : '')}</span>
      <span class="li-main">
        <div class="li-title">${r.quantity} ${material ? escapeHtml(material.unit) : ''} — ${material ? escapeHtml(material.name) : 'Material'}</div>
        <div class="li-sub">${project ? escapeHtml(project.project_name) : ''} · ${requester ? escapeHtml(requester.name) : ''} · ${timeAgo(r.created_at)}</div>
      </span>
      <span class="li-end">
        <div class="li-title">${formatCurrency(r.amount)}</div>
        <span class="badge ${badgeClass}">${statusLabel}</span>
      </span>
    </div>`;
}

function materialEmoji(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('cement')) return '🧱';
  if (n.includes('brick')) return '🧱';
  if (n.includes('sand') || n.includes('stone')) return '⛰️';
  if (n.includes('steel')) return '🔩';
  if (n.includes('pipe') || n.includes('plumb')) return '🚿';
  if (n.includes('paint')) return '🎨';
  if (n.includes('electr')) return '💡';
  if (n.includes('ppe') || n.includes('helmet')) return '🦺';
  if (n.includes('roof')) return '🏚️';
  return '📦';
}

// ---------------------------------------------------------------------------
// Step 1-5: BUY MATERIAL wizard
// ---------------------------------------------------------------------------

export function renderBuyMaterialWizard(container) {
  const session = getSession();
  const user = getUser(session.userId);
  const materials = listMaterials(session.companyId);
  const myProjectIds = projectIdsForUser(user);
  const projects = listProjects(session.companyId).filter((p) => user.role === ROLES.OWNER || myProjectIds.includes(p.id));

  const data = {
    materialId: null, quantity: '', projectId: projects.length === 1 ? projects[0].id : null,
    urgency: 'normal', reason: ''
  };
  let step = 1;
  const totalSteps = 5;

  function draw() {
    container.innerHTML = `
      <div class="page-title">🛒 Buy Material</div>
      <div class="step-tracker">
        ${Array.from({ length: totalSteps }, (_, i) => `<div class="step-dot ${i + 1 < step ? 'done' : i + 1 === step ? 'active' : ''}"></div>`).join('')}
      </div>
      <div class="card">${stepBody()}</div>
    `;
    wireStep();
  }

  function stepBody() {
    if (step === 1) {
      return `
        <div class="step-label">STEP 1 OF 5</div>
        <h3>What do you need?</h3>
        <div class="field"><input type="search" id="materialSearch" placeholder="Search material..." autocomplete="off"></div>
        <div id="materialList">${materialOptions(materials, '')}</div>
      `;
    }
    if (step === 2) {
      const material = getMaterial(data.materialId);
      return `
        <div class="step-label">STEP 2 OF 5</div>
        <h3>How much ${material ? escapeHtml(material.name) : ''} do you need?</h3>
        <div class="field">
          <label>Quantity (${material ? escapeHtml(material.unit) : 'units'})</label>
          <input type="number" id="qtyInput" min="1" step="any" value="${escapeHtml(data.quantity)}" placeholder="e.g. 100">
        </div>
        ${navButtons(!!data.quantity && Number(data.quantity) > 0)}
      `;
    }
    if (step === 3) {
      return `
        <div class="step-label">STEP 3 OF 5</div>
        <h3>Which project is this for?</h3>
        <div class="field">
          ${projects.map((p) => `
            <div class="role-card ${data.projectId === p.id ? 'selected' : ''}" data-project="${p.id}">
              <span class="r-icon">🏗️</span>
              <div><div class="r-title">${escapeHtml(p.project_name)}</div><div class="r-sub">${escapeHtml(p.location)}</div></div>
            </div>`).join('')}
        </div>
        ${navButtons(!!data.projectId)}
      `;
    }
    if (step === 4) {
      return `
        <div class="step-label">STEP 4 OF 5</div>
        <h3>How urgent is this?</h3>
        <div class="chip-group mb-3">
          <button class="chip ${data.urgency === 'normal' ? 'selected' : ''}" data-urgency="normal">🟢 Normal</button>
          <button class="chip soon ${data.urgency === 'soon' ? 'selected' : ''}" data-urgency="soon">🟡 Soon</button>
          <button class="chip urgent ${data.urgency === 'urgent' ? 'selected' : ''}" data-urgency="urgent">🔴 Urgent</button>
        </div>
        <div class="field">
          <label>Reason (optional)</label>
          <textarea id="reasonInput" placeholder="e.g. Running low, pour scheduled tomorrow">${escapeHtml(data.reason)}</textarea>
        </div>
        ${navButtons(true)}
      `;
    }
    const material = getMaterial(data.materialId);
    const project = getProject(data.projectId);
    const estimate = estimateMaterialCost(session.companyId, data.materialId, Number(data.quantity) || 0);
    return `
      <div class="step-label">STEP 5 OF 5</div>
      <h3>Review your request</h3>
      <table class="simple-table">
        <tr><th>Material</th><td>${material ? escapeHtml(material.name) : ''}</td></tr>
        <tr><th>Quantity</th><td>${data.quantity} ${material ? escapeHtml(material.unit) : ''}</td></tr>
        <tr><th>Project</th><td>${project ? escapeHtml(project.project_name) : ''}</td></tr>
        <tr><th>Urgency</th><td>${URGENCY_LABEL[data.urgency]}</td></tr>
        <tr><th>Estimated Cost</th><td>${formatCurrency(estimate)}</td></tr>
        ${data.reason ? `<tr><th>Reason</th><td>${escapeHtml(data.reason)}</td></tr>` : ''}
      </table>
      <p class="faint mt-2">This estimate uses the cheapest known supplier quote and will be confirmed during approval.</p>
      <div class="btn-block-row mt-4">
        <button class="btn btn-ghost" id="backBtn">Back</button>
        <button class="btn btn-primary" id="submitBtn">Submit Request</button>
      </div>
    `;
  }

  function navButtons(nextEnabled) {
    return `
      <div class="btn-block-row mt-4">
        <button class="btn btn-ghost" id="backBtn">Back</button>
        <button class="btn btn-primary" id="nextBtn" ${nextEnabled ? '' : 'disabled'}>Next</button>
      </div>`;
  }

  function materialOptions(list, filter) {
    const f = filter.toLowerCase();
    const shown = list.filter((m) => m.name.toLowerCase().includes(f));
    if (!shown.length) return `<div class="empty-state"><div class="emoji">🔍</div>No materials match "${escapeHtml(filter)}"</div>`;
    return shown.map((m) => `
      <div class="list-item" data-material="${m.id}">
        <span class="li-icon">${materialEmoji(m.name)}</span>
        <span class="li-main"><div class="li-title">${escapeHtml(m.name)}</div><div class="li-sub">${escapeHtml(m.category)} · unit: ${escapeHtml(m.unit)}</div></span>
      </div>`).join('');
  }

  function wireStep() {
    if (step === 1) {
      const searchEl = container.querySelector('#materialSearch');
      searchEl.addEventListener('input', () => {
        container.querySelector('#materialList').innerHTML = materialOptions(materials, searchEl.value);
        wireMaterialClicks();
      });
      wireMaterialClicks();
    }
    if (step === 2) {
      const qtyEl = container.querySelector('#qtyInput');
      qtyEl.addEventListener('input', () => { data.quantity = qtyEl.value; container.querySelector('#nextBtn').disabled = !(Number(qtyEl.value) > 0); });
      bindNav();
    }
    if (step === 3) {
      container.querySelectorAll('[data-project]').forEach((el) => {
        el.addEventListener('click', () => { data.projectId = el.dataset.project; draw(); });
      });
      bindNav();
    }
    if (step === 4) {
      container.querySelectorAll('[data-urgency]').forEach((el) => {
        el.addEventListener('click', () => { data.urgency = el.dataset.urgency; draw(); });
      });
      container.querySelector('#reasonInput')?.addEventListener('input', (e) => { data.reason = e.target.value; });
      bindNav();
    }
    if (step === 5) {
      container.querySelector('#backBtn').addEventListener('click', () => { step -= 1; draw(); });
      container.querySelector('#submitBtn').addEventListener('click', submit);
    }
  }

  function wireMaterialClicks() {
    container.querySelectorAll('[data-material]').forEach((el) => {
      el.addEventListener('click', () => { data.materialId = el.dataset.material; step = 2; draw(); });
    });
  }

  function bindNav() {
    container.querySelector('#backBtn').addEventListener('click', () => { step -= 1; if (step < 1) { location.hash = '#/purchases'; } else draw(); });
    container.querySelector('#nextBtn')?.addEventListener('click', () => { step += 1; draw(); });
  }

  function submit() {
    try {
      const amount = estimateMaterialCost(session.companyId, data.materialId, Number(data.quantity));
      createRequest({
        companyId: session.companyId, projectId: data.projectId, requestedBy: session.userId, requestedByRole: user.role,
        requestType: 'material', materialId: data.materialId, quantity: Number(data.quantity),
        amount, urgency: data.urgency, reason: data.reason
      });
      toast('Request submitted ✅', 'success');
      location.hash = user.role === ROLES.SUPERVISOR ? '#/dashboard' : '#/purchases';
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  draw();
}
