/*
  approvals.js — the Approvals inbox and Request Detail screen. This is
  where the Supervisor -> Site Manager -> Project Manager -> Owner chain
  actually gets acted on: verify, approve, reject, or ask for more info.
  A person can never act on their own request — enforced in db.js and
  mirrored here in the UI (no action buttons render for your own request).
*/

import { getSession, ROLES, ROLE_LABELS } from './state.js';
import {
  getUser, getRequest, getMaterial, getProject, getSupplierComparison,
  actOnRequest, provideMoreInfo, getApprovalTimeline, listRequestsAwaitingUser,
  listRequests, getCurrentStageKey, listSuppliers as listSuppliersFor
} from './db.js';
import { formatCurrency, formatDateTime, timeAgo, escapeHtml, toast, confirmAction, openModal, closeModal } from './utils.js';

const STAGE_WAIT_LABEL = { site_manager: 'Awaiting Site Manager', project_manager: 'Awaiting Project Manager', owner: 'Awaiting Owner' };

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

export function renderApprovalsInbox(container) {
  const session = getSession();
  const user = getUser(session.userId);
  let tab = 'waiting';

  function draw() {
    const waiting = listRequestsAwaitingUser(user);
    const decided = listRequests(session.companyId).filter((r) =>
      Object.values(r.stages).some((s) => s.actor === session.userId)
    ).slice(0, 15);

    const list = tab === 'waiting' ? waiting : decided;
    const totalAmount = waiting.reduce((s, r) => s + (r.amount || 0), 0);

    container.innerHTML = `
      <div class="page-title">📥 Approvals</div>
      ${waiting.length ? `
        <div class="card mb-3" style="border-left:4px solid var(--color-danger);">
          <div style="font-weight:800;font-size:15px;">🔴 ${waiting.length} REQUEST${waiting.length > 1 ? 'S' : ''} REQUIRE YOUR ATTENTION</div>
          <div class="faint">Totalling ${formatCurrency(totalAmount)}</div>
        </div>
      ` : `<div class="card mb-3 empty-state"><div class="emoji">✅</div>Nothing waiting on you right now.</div>`}

      <div class="tabs">
        <button class="tab-btn ${tab === 'waiting' ? 'active' : ''}" data-tab="waiting">Waiting for you (${waiting.length})</button>
        <button class="tab-btn ${tab === 'decided' ? 'active' : ''}" data-tab="decided">Recently decided</button>
      </div>
      <div class="card">
        ${list.length ? list.map((r) => requestRow(r, tab)).join('') : `<div class="empty-state"><div class="emoji">📭</div>Nothing here.</div>`}
      </div>
    `;

    container.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => { tab = btn.dataset.tab; draw(); }));
    container.querySelectorAll('[data-req]').forEach((el) => {
      el.addEventListener('click', () => { location.hash = `#/approvals/${el.dataset.req}`; });
    });
  }

  draw();
}

function requestRow(r, tab) {
  const material = r.request_type === 'material' ? getMaterial(r.material_id) : null;
  const project = getProject(r.project_id);
  const requester = getUser(r.requested_by);
  const stageKey = getCurrentStageKey(r);
  const statusLabel = r.status === 'rejected' ? 'Rejected' : r.status === 'approved' ? 'Approved' : r.status === 'info_requested' ? 'Awaiting more info' : (STAGE_WAIT_LABEL[stageKey] || r.status);
  const badgeClass = r.status === 'rejected' ? 'badge-danger' : r.status === 'approved' ? 'badge-success' : 'badge-warning';

  return `
    <div class="list-item" data-req="${r.id}">
      <span class="li-icon">${r.request_type === 'material' ? '📦' : '💳'}</span>
      <span class="li-main">
        <div class="li-title">${r.request_type === 'material' ? `${r.quantity} × ${material ? escapeHtml(material.name) : ''}` : escapeHtml(r.category || 'Expense')}</div>
        <div class="li-sub">${project ? escapeHtml(project.project_name) : ''} · ${requester ? escapeHtml(requester.name) : ''} · ${timeAgo(r.created_at)}</div>
      </span>
      <span class="li-end">
        <div class="li-title">${formatCurrency(r.amount)}</div>
        <span class="badge ${badgeClass}">${statusLabel}</span>
      </span>
    </div>`;
}

// ---------------------------------------------------------------------------
// Request detail
// ---------------------------------------------------------------------------

export function renderRequestDetail(container, requestId) {
  const session = getSession();
  const user = getUser(session.userId);

  function draw() {
    const request = getRequest(requestId);
    if (!request) { container.innerHTML = `<div class="empty-state">Request not found.</div>`; return; }

    const material = request.request_type === 'material' ? getMaterial(request.material_id) : null;
    const project = getProject(request.project_id);
    const requester = getUser(request.requested_by);
    const stageKey = getCurrentStageKey(request);
    const canAct = stageKey && STAGE_ROLE_MATCH(stageKey, user.role) && request.requested_by !== user.id;
    const isFinancialStage = stageKey === 'project_manager' || stageKey === 'owner';
    const comparison = request.request_type === 'material' ? getSupplierComparison(session.companyId, request.material_id, request.quantity) : null;
    const timeline = getApprovalTimeline(request);

    const spent = project ? (project.total_spent_to_date || 0) : 0;
    const budgetImpact = project && project.budget ? round1(request.amount / project.budget * 100) : 0;

    container.innerHTML = `
      <button class="btn btn-ghost btn-sm mb-2" id="backBtn">← Back</button>
      <div class="page-title">${request.request_type === 'material' ? 'Material Request' : 'Expense Request'}</div>

      <div class="card mb-3">
        <table class="simple-table">
          ${request.request_type === 'material' ? `
            <tr><th>Material</th><td>${material ? escapeHtml(material.name) : ''}</td></tr>
            <tr><th>Quantity</th><td>${request.quantity} ${material ? escapeHtml(material.unit) : ''}</td></tr>
          ` : `
            <tr><th>Category</th><td>${escapeHtml(request.category)}</td></tr>
            <tr><th>Amount</th><td>${formatCurrency(request.amount)}</td></tr>
          `}
          <tr><th>Project</th><td>${project ? escapeHtml(project.project_name) : ''}</td></tr>
          <tr><th>Requested By</th><td>${requester ? escapeHtml(requester.name) : ''}</td></tr>
          <tr><th>Reason</th><td>${escapeHtml(request.reason || '—')}</td></tr>
          <tr><th>Urgency</th><td>${escapeHtml(request.urgency)}</td></tr>
        </table>
      </div>

      ${comparison && comparison.rows.length ? `
        <div class="section-title" style="margin-top:0;">Supplier Options</div>
        <div class="table-scroll">
          <table class="simple-table">
            <thead><tr><th></th><th>Supplier</th><th>Unit Price</th><th>Total</th></tr></thead>
            <tbody>
              ${comparison.rows.map((r) => `
                <tr class="${r.supplierId === comparison.bestSupplierId ? 'best-value' : ''}">
                  <td>${isFinancialStage && canAct ? `<input type="radio" name="supplierPick" value="${r.supplierId}|${r.unitPrice}" ${r.supplierId === (request.supplier_id || comparison.bestSupplierId) ? 'checked' : ''}>` : (r.supplierId === (request.supplier_id || comparison.bestSupplierId) ? '✓' : '')}</td>
                  <td>${escapeHtml(r.supplierName)}${r.supplierId === comparison.bestSupplierId ? ' ⭐ Recommended' : ''}</td>
                  <td>${formatCurrency(r.unitPrice)}</td>
                  <td>${formatCurrency(r.total)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${comparison.potentialSaving > 0 ? `<p class="badge badge-success mt-2">Potential Saving: ${formatCurrency(comparison.potentialSaving)}</p>` : ''}
      ` : (request.request_type === 'material' && isFinancialStage && canAct ? `
        <div class="section-title" style="margin-top:0;">Supplier &amp; Price</div>
        <div class="card">
          <p class="faint">No supplier quotes on file for this material yet — enter one to approve.</p>
          <div class="field"><label>Supplier</label>
            <select id="manualSupplier">
              <option value="">Select supplier...</option>
              ${listSuppliersFor(session.companyId).map((s) => `<option value="${s.id}">${escapeHtml(s.supplier_name)}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Unit price (R)</label><input type="number" id="manualPrice" min="0.01" step="0.01"></div>
        </div>
      ` : '')}

      <div class="section-title">Project Budget Context</div>
      <div class="card">
        <div class="flex justify-between"><span class="muted">Project Budget</span><span style="font-weight:700">${formatCurrency(project?.budget || 0)}</span></div>
        <div class="flex justify-between mt-1"><span class="muted">Project Spent</span><span style="font-weight:700">${formatCurrency(spent)}</span></div>
        <div class="flex justify-between mt-1"><span class="muted">This Request</span><span style="font-weight:700">${formatCurrency(request.amount)}</span></div>
        <div class="flex justify-between mt-1"><span class="muted">Budget Impact</span><span style="font-weight:700">${budgetImpact}%</span></div>
      </div>

      <div class="section-title">Approval History</div>
      <div class="card">${timeline.map(timelineRow).join('')}</div>

      ${request.status === 'info_requested' && request.requested_by === user.id ? `
        <div class="section-title">Respond</div>
        <div class="card">
          <p class="faint">"${escapeHtml(request.info_request_note || '')}"</p>
          <div class="field"><textarea id="infoInput" placeholder="Add the requested detail..."></textarea></div>
          <button class="btn btn-primary w-full" id="provideInfoBtn">Submit More Information</button>
        </div>
      ` : ''}

      ${canAct ? `
        <div class="section-title">Your Decision</div>
        <div class="btn-block-row">
          <button class="btn btn-danger" id="rejectBtn">REJECT</button>
          <button class="btn btn-outline" id="infoBtn">MORE INFO</button>
          <button class="btn btn-success" id="approveBtn">${stageKey === 'site_manager' ? 'VERIFY' : 'APPROVE'}</button>
        </div>
      ` : (request.status === 'pending' || request.status === 'info_requested') ? `<p class="faint text-center mt-3">${STAGE_WAIT_LABEL[stageKey] || 'Awaiting further action'}</p>` : ''}
    `;

    container.querySelector('#backBtn').addEventListener('click', () => { location.hash = '#/approvals'; });

    container.querySelector('#provideInfoBtn')?.addEventListener('click', () => {
      const val = container.querySelector('#infoInput').value.trim();
      if (!val) { toast('Please add some detail first', 'error'); return; }
      try { provideMoreInfo(request.id, session.userId, val); toast('Sent back for review', 'success'); draw(); }
      catch (e) { toast(e.message, 'error'); }
    });

    container.querySelector('#approveBtn')?.addEventListener('click', async () => {
      let supplierId, unitPrice;
      if (isFinancialStage && comparison && comparison.rows.length) {
        const picked = container.querySelector('input[name="supplierPick"]:checked');
        if (!picked) { toast('Select a supplier before approving', 'error'); return; }
        [supplierId, unitPrice] = picked.value.split('|');
        unitPrice = Number(unitPrice);
      } else if (isFinancialStage && request.request_type === 'material' && (!comparison || !comparison.rows.length)) {
        supplierId = container.querySelector('#manualSupplier')?.value;
        unitPrice = Number(container.querySelector('#manualPrice')?.value);
        if (!supplierId || !(unitPrice > 0)) { toast('Choose a supplier and enter a valid price', 'error'); return; }
      }
      const ok = await confirmAction(stageKey === 'site_manager' ? 'Verify this request and forward it?' : 'Approve this request?', { okLabel: stageKey === 'site_manager' ? 'Verify' : 'Approve' });
      if (!ok) return;
      try {
        actOnRequest({ requestId: request.id, userId: session.userId, decision: 'approve', supplierId, unitPrice });
        toast('Decision recorded ✅', 'success');
        draw();
      } catch (e) { toast(e.message, 'error'); }
    });

    container.querySelector('#rejectBtn')?.addEventListener('click', async () => {
      const reason = await promptText('Why are you rejecting this request?');
      if (reason === null) return;
      try { actOnRequest({ requestId: request.id, userId: session.userId, decision: 'reject', comment: reason }); toast('Request rejected', ''); draw(); }
      catch (e) { toast(e.message, 'error'); }
    });

    container.querySelector('#infoBtn')?.addEventListener('click', async () => {
      const note = await promptText('What information do you need?');
      if (note === null) return;
      try { actOnRequest({ requestId: request.id, userId: session.userId, decision: 'info', comment: note }); toast('Sent back to requester', ''); draw(); }
      catch (e) { toast(e.message, 'error'); }
    });
  }

  draw();
}

function STAGE_ROLE_MATCH(stageKey, role) {
  return { site_manager: ROLES.SITE_MANAGER, project_manager: ROLES.PROJECT_MANAGER, owner: ROLES.OWNER }[stageKey] === role;
}

function timelineRow(item) {
  const icon = { submitted: '📝', pending: '⏳', waiting: '⏳', approved: '✅', rejected: '🚫', info_requested: '❓', not_required: '➖', skipped: '➖' }[item.status] || '•';
  const statusText = item.status === 'submitted' ? 'Submitted' : item.status === 'not_required' ? 'Not required' : item.status === 'waiting' || item.status === 'pending' ? 'Pending' : item.status.replace('_', ' ');
  return `
    <div class="list-item">
      <span class="li-icon">${icon}</span>
      <span class="li-main">
        <div class="li-title">${escapeHtml(item.label)}${item.actorName ? ` — ${escapeHtml(item.actorName)}` : ''}</div>
        <div class="li-sub">${statusText}${item.comment && item.status !== 'submitted' ? `: "${escapeHtml(item.comment)}"` : ''}</div>
      </span>
      <span class="li-end faint">${item.at ? formatDateTime(item.at) : ''}</span>
    </div>`;
}

function promptText(label) {
  return new Promise((resolve) => {
    const card = openModal(`
      <h3>${escapeHtml(label)}</h3>
      <div class="field"><textarea id="reasonInput" placeholder="Type here..."></textarea></div>
      <div class="btn-block-row">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="okBtn">Confirm</button>
      </div>
    `);
    card.querySelector('#cancelBtn').addEventListener('click', () => { closeModal(); resolve(null); });
    card.querySelector('#okBtn').addEventListener('click', () => {
      const val = card.querySelector('#reasonInput').value.trim();
      if (!val) { toast('Please add a note', 'error'); return; }
      closeModal();
      resolve(val);
    });
  });
}

function round1(n) { return Math.round(n * 10) / 10; }
