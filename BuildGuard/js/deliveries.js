/*
  deliveries.js — RECEIVE DELIVERY (expected vs received, auto shortage
  calculation) and REPORT SHORTAGE (quick manual flag for issues spotted
  after the fact, e.g. during a stock check).
*/

import { getSession, ROLES } from './state.js';
import {
  listPurchases, getPurchase, getMaterial, getProject, getSupplier,
  getDeliveryForPurchase, listDeliveries, createDelivery,
  listMaterials, listProjects, createManualAlert, getUser, projectIdsForUser
} from './db.js';
import { formatCurrency, formatDate, escapeHtml, toast, openModal, closeModal } from './utils.js';

function scopedProjects(session) {
  const user = getUser(session.userId);
  const ids = projectIdsForUser(user);
  return listProjects(session.companyId).filter((p) => user.role === ROLES.OWNER || ids.includes(p.id));
}

export function renderDeliveriesPage(container) {
  const session = getSession();
  const myProjectIds = scopedProjects(session).map((p) => p.id);
  const purchases = listPurchases(session.companyId).filter((p) => !getDeliveryForPurchase(p.id) && myProjectIds.includes(p.project_id));
  const recent = listDeliveries(session.companyId).filter((d) => {
    const purchase = getPurchase(d.purchase_id);
    return purchase && myProjectIds.includes(purchase.project_id);
  }).slice(0, 10);

  container.innerHTML = `
    <div class="flex justify-between items-center mb-2">
      <div class="page-title" style="margin-bottom:0">🚚 Deliveries</div>
      <button class="btn btn-accent btn-sm" id="receiveBtn">+ Receive Delivery</button>
    </div>

    <div class="section-title" style="margin-top:8px">Awaiting delivery (${purchases.length})</div>
    <div class="card mb-3">
      ${purchases.length ? purchases.map(awaitingRow).join('') : `<div class="empty-state"><div class="emoji">✅</div>Nothing outstanding.</div>`}
    </div>

    <div class="section-title">Recent deliveries</div>
    <div class="card">
      ${recent.length ? recent.map(deliveryRow).join('') : `<div class="empty-state"><div class="emoji">📭</div>No deliveries recorded yet.</div>`}
    </div>
  `;

  container.querySelector('#receiveBtn').addEventListener('click', () => { location.hash = '#/deliveries/new'; });
  container.querySelectorAll('[data-purchase]').forEach((el) => {
    el.addEventListener('click', () => { location.hash = `#/deliveries/new?purchase=${el.dataset.purchase}`; });
  });
}

function awaitingRow(p) {
  const material = getMaterial(p.material_id);
  const project = getProject(p.project_id);
  const supplier = getSupplier(p.supplier_id);
  return `
    <div class="list-item" data-purchase="${p.id}">
      <span class="li-icon">🚚</span>
      <span class="li-main">
        <div class="li-title">${p.quantity} ${material ? escapeHtml(material.unit) : ''} — ${material ? escapeHtml(material.name) : ''}</div>
        <div class="li-sub">${supplier ? escapeHtml(supplier.supplier_name) : ''} · ${project ? escapeHtml(project.project_name) : ''} · ordered ${formatDate(p.purchase_date)}</div>
      </span>
      <span class="li-end faint">Receive →</span>
    </div>`;
}

function deliveryRow(d) {
  const purchase = getPurchase(d.purchase_id);
  const material = purchase ? getMaterial(purchase.material_id) : null;
  return `
    <div class="list-item">
      <span class="li-icon">${d.shortage_quantity > 0 ? '🔴' : '✅'}</span>
      <span class="li-main">
        <div class="li-title">${material ? escapeHtml(material.name) : 'Delivery'}</div>
        <div class="li-sub">${formatDate(d.delivery_date)} · expected ${d.expected_quantity}, received ${d.received_quantity}</div>
      </span>
      <span class="li-end">${d.shortage_quantity > 0 ? `<span class="badge badge-danger">-${d.shortage_quantity}</span>` : '<span class="badge badge-success">Full</span>'}</span>
    </div>`;
}

// ---------------------------------------------------------------------------
// RECEIVE DELIVERY
// ---------------------------------------------------------------------------

export function renderReceiveDeliveryForm(container, preselectedPurchaseId) {
  const session = getSession();
  const myProjectIds = scopedProjects(session).map((p) => p.id);
  const purchases = listPurchases(session.companyId).filter((p) => !getDeliveryForPurchase(p.id) && myProjectIds.includes(p.project_id));
  let selected = preselectedPurchaseId || null;
  let photoAttached = false;

  function draw() {
    container.innerHTML = `
      <button class="btn btn-ghost btn-sm mb-2" id="backBtn">← Back</button>
      <div class="page-title">🚚 Receive Delivery</div>
      <div class="card">
        <div class="field">
          <label>Which purchase is this delivery for?</label>
          <select id="purchaseSelect">
            <option value="">Select purchase...</option>
            ${purchases.map((p) => {
              const m = getMaterial(p.material_id);
              return `<option value="${p.id}" ${selected === p.id ? 'selected' : ''}>${p.quantity} ${m ? m.unit : ''} — ${m ? m.name : ''} (${formatDate(p.purchase_date)})</option>`;
            }).join('')}
          </select>
        </div>
        <div id="detailArea"></div>
      </div>
    `;
    container.querySelector('#backBtn').addEventListener('click', () => { location.hash = '#/deliveries'; });
    const sel = container.querySelector('#purchaseSelect');
    sel.addEventListener('change', () => { selected = sel.value; drawDetail(); });
    drawDetail();
  }

  function drawDetail() {
    const area = container.querySelector('#detailArea');
    if (!selected) { area.innerHTML = ''; return; }
    const purchase = getPurchase(selected);
    const material = getMaterial(purchase.material_id);
    area.innerHTML = `
      <div class="field">
        <label>Expected</label>
        <input type="text" value="${purchase.quantity} ${escapeHtml(material ? material.unit : '')}" disabled style="background:#F4F6F5;font-weight:700;">
      </div>
      <div class="field">
        <label>Received</label>
        <input type="number" id="receivedInput" min="0" step="any" placeholder="e.g. ${purchase.quantity}">
      </div>
      <div class="field" id="shortageBanner"></div>
      <div class="field"><label>Notes</label><textarea id="notesInput" placeholder="Anything unusual about this delivery?"></textarea></div>
      <div class="field">
        <label>Delivery document photo (optional)</label>
        <input type="file" id="photoInput" accept="image/*" capture="environment">
        <div class="hint" id="photoHint">No photo attached</div>
      </div>
      <button class="btn btn-primary w-full" id="submitBtn">Confirm Delivery</button>
    `;
    const receivedInput = area.querySelector('#receivedInput');
    const banner = area.querySelector('#shortageBanner');
    receivedInput.addEventListener('input', () => {
      const shortage = Math.max(0, purchase.quantity - (Number(receivedInput.value) || 0));
      banner.innerHTML = shortage > 0
        ? `<div class="badge badge-danger">🔴 ${shortage} ${material ? material.unit : ''} missing</div>`
        : receivedInput.value ? `<div class="badge badge-success">✅ Full delivery</div>` : '';
    });
    area.querySelector('#photoInput').addEventListener('change', (e) => {
      photoAttached = e.target.files && e.target.files.length > 0;
      area.querySelector('#photoHint').textContent = photoAttached ? `📷 ${e.target.files[0].name} attached` : 'No photo attached';
    });
    area.querySelector('#submitBtn').addEventListener('click', () => {
      const received = Number(receivedInput.value);
      if (isNaN(received) || received < 0) { toast('Enter a valid received quantity', 'error'); return; }
      const delivery = createDelivery({
        purchaseId: purchase.id, expectedQuantity: purchase.quantity, receivedQuantity: received,
        receivedBy: session.userId, notes: area.querySelector('#notesInput').value,
        photoUrl: photoAttached ? 'attached' : null
      });
      if (delivery.shortage_quantity > 0) {
        showShortageConfirmation(delivery, material);
      } else {
        toast('Delivery confirmed ✅', 'success');
        location.hash = '#/deliveries';
      }
    });
  }

  draw();
}

function showShortageConfirmation(delivery, material) {
  const card = openModal(`
    <div style="font-size:32px;">🔴</div>
    <h3 class="mt-2">${delivery.shortage_quantity} ${escapeHtml(material ? material.unit : '')} missing</h3>
    <p class="muted">This has been logged as a delivery variance and added to Money Leaks for review.</p>
    <button class="btn btn-primary w-full mt-3" id="okBtn">Got it</button>
  `);
  card.querySelector('#okBtn').addEventListener('click', () => { closeModal(); location.hash = '#/deliveries'; });
}

// ---------------------------------------------------------------------------
// REPORT SHORTAGE — quick manual flag (not tied to a specific delivery)
// ---------------------------------------------------------------------------

export function renderReportShortageForm(container) {
  const session = getSession();
  const materials = listMaterials(session.companyId);
  const projects = scopedProjects(session);

  container.innerHTML = `
    <button class="btn btn-ghost btn-sm mb-2" id="backBtn">← Back</button>
    <div class="page-title">⚠️ Report Shortage</div>
    <p class="muted mb-3">Spotted missing material on site? Flag it here — no blame, just visibility.</p>
    <div class="card">
      <div class="field">
        <label>Project</label>
        <select id="projectSelect"><option value="">Select project...</option>${projects.map((p) => `<option value="${p.id}">${escapeHtml(p.project_name)}</option>`).join('')}</select>
      </div>
      <div class="field">
        <label>Material</label>
        <select id="materialSelect"><option value="">Select material...</option>${materials.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}</select>
      </div>
      <div class="field">
        <label>Quantity short</label>
        <input type="number" id="qtyInput" min="0.1" step="any" placeholder="e.g. 15">
      </div>
      <div class="field">
        <label>What happened?</label>
        <textarea id="notesInput" placeholder="e.g. Found 15 bags missing from the store room this morning"></textarea>
      </div>
      <button class="btn btn-danger w-full" id="submitBtn">Submit Report</button>
    </div>
  `;

  container.querySelector('#backBtn').addEventListener('click', () => history.back());
  container.querySelector('#submitBtn').addEventListener('click', () => {
    const projectId = container.querySelector('#projectSelect').value;
    const materialId = container.querySelector('#materialSelect').value;
    const qty = Number(container.querySelector('#qtyInput').value);
    const notes = container.querySelector('#notesInput').value;

    if (!projectId) { toast('Select a project', 'error'); return; }
    if (!materialId) { toast('Select a material', 'error'); return; }
    if (!(qty > 0)) { toast('Enter a valid quantity', 'error'); return; }

    const material = getMaterial(materialId);
    const project = getProject(projectId);
    createManualAlert({
      companyId: session.companyId, projectId, alertType: 'delivery_shortage', severity: 'warning',
      message: `${qty} ${material.unit} of ${material.name} reported missing at ${project.project_name}.${notes ? ' "' + notes + '"' : ''}`,
      reportedBy: session.userId
    });
    toast('Shortage reported — added to Money Leaks', 'success');
    location.hash = '#/alerts';
  });
}
