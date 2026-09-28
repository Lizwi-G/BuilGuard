/*
  fuel.js — RECORD FUEL + fuel consumption history.
  Litres/km and litres/hour are calculated automatically and compared to
  each vehicle's known baseline consumption to catch fuel misuse early.
*/

import { getSession, ROLES } from './state.js';
import {
  listVehicles, getVehicle, listProjects, listFuelTransactions,
  getFuelConsumptionSeries, createFuelTransaction, getUser, projectIdsForUser
} from './db.js';
import { formatCurrency, formatDate, escapeHtml, toast, openModal, closeModal } from './utils.js';

const VEHICLE_EMOJI = {
  Bakkie: '🛻', 'Flatbed Truck': '🚛', Excavator: '🚜', TLB: '🚜', 'Delivery Truck': '🚚'
};

export function renderFuelPage(container) {
  const session = getSession();
  const vehicles = listVehicles(session.companyId);

  container.innerHTML = `
    <div class="flex justify-between items-center mb-2">
      <div class="page-title" style="margin-bottom:0">⛽ Fuel</div>
      <button class="btn btn-accent btn-sm" id="recordFuelBtn">+ Record Fuel</button>
    </div>
    <p class="muted mb-3">Tap a vehicle to see its fuel history and consumption trend.</p>
    <div class="card">
      ${vehicles.map(vehicleRow).join('')}
    </div>
  `;

  container.querySelector('#recordFuelBtn').addEventListener('click', () => { location.hash = '#/fuel/new'; });
  vehicles.forEach((v) => {
    container.querySelector(`[data-vehicle="${v.id}"]`).addEventListener('click', () => openVehicleHistory(v.id));
  });
}

function vehicleRow(v) {
  const txs = listFuelTransactions(v.company_id, { vehicleId: v.id });
  const monthCost = txs.filter((t) => sameMonth(t.transaction_date)).reduce((s, t) => s + t.total_cost, 0);
  const series = getFuelConsumptionSeries(v.company_id, v.id);
  const anomalous = series.some((s) => s.anomalous);
  return `
    <div class="list-item" data-vehicle="${v.id}">
      <span class="li-icon">${VEHICLE_EMOJI[v.vehicle_type] || '🚗'}</span>
      <span class="li-main">
        <div class="li-title">${escapeHtml(v.vehicle_name)} ${anomalous ? '⚠️' : ''}</div>
        <div class="li-sub">${escapeHtml(v.registration_number)} · ${v.status}</div>
      </span>
      <span class="li-end">
        <div class="li-title">${formatCurrency(monthCost)}</div>
        <div class="faint">this month</div>
      </span>
    </div>`;
}

function sameMonth(dateStr) {
  const d = new Date(dateStr), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
}

function openVehicleHistory(vehicleId) {
  const v = getVehicle(vehicleId);
  const session = getSession();
  const series = getFuelConsumptionSeries(session.companyId, vehicleId);
  const txs = listFuelTransactions(session.companyId, { vehicleId });

  const card = openModal(`
    <h3>${VEHICLE_EMOJI[v.vehicle_type] || '🚗'} ${escapeHtml(v.vehicle_name)}</h3>
    <p class="muted">${escapeHtml(v.registration_number)} · baseline ${v.baseline_l_per_hr ? v.baseline_l_per_hr + ' L/hr' : v.baseline_km_per_l + ' km/L'}</p>
    ${series.length ? series.map(seriesRow).join('') : '<p class="faint">Not enough fuel-ups yet to calculate consumption trend.</p>'}
    <div class="section-title" style="font-size:15px;">Transactions</div>
    ${txs.map((t) => `
      <div class="list-item">
        <span class="li-icon">⛽</span>
        <span class="li-main"><div class="li-title">${t.litres} L</div><div class="li-sub">${formatDate(t.transaction_date)} · ${escapeHtml(t.supplier || '—')}</div></span>
        <span class="li-end">${formatCurrency(t.total_cost)}</span>
      </div>`).join('')}
    <button class="btn btn-ghost mt-3" id="closeBtn">Close</button>
  `);
  card.querySelector('#closeBtn').addEventListener('click', closeModal);
}

function seriesRow(s) {
  return `
    <div class="leak-item ${s.anomalous ? 'sev-warning' : 'sev-info'}">
      <span class="leak-icon">${s.anomalous ? '⚠️' : '✅'}</span>
      <div class="leak-body">
        <div class="leak-title">${formatDate(s.transaction.transaction_date)} — ${s.rate ?? '—'} ${s.unit}</div>
        <div class="leak-sub">${s.anomalous ? `Unusual — normal is ${s.baseline} ${s.unit}` : 'Within normal range'}</div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// RECORD FUEL form
// ---------------------------------------------------------------------------

export function renderRecordFuelForm(container) {
  const session = getSession();
  const user = getUser(session.userId);
  const myProjectIds = projectIdsForUser(user);
  const vehicles = listVehicles(session.companyId).filter((v) => v.status !== 'maintenance');
  const projects = listProjects(session.companyId).filter((p) => user.role === ROLES.OWNER || myProjectIds.includes(p.id));
  let photoAttached = false;

  container.innerHTML = `
    <button class="btn btn-ghost btn-sm mb-2" id="backBtn">← Back</button>
    <div class="page-title">⛽ Record Fuel</div>
    <div class="card">
      <div class="field">
        <label>Vehicle</label>
        <select id="vehicleSelect">
          <option value="">Select vehicle...</option>
          ${vehicles.map((v) => `<option value="${v.id}">${escapeHtml(v.vehicle_name)} — ${escapeHtml(v.registration_number)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Project</label>
        <select id="projectSelect">
          <option value="">Select project...</option>
          ${projects.map((p) => `<option value="${p.id}">${escapeHtml(p.project_name)}</option>`).join('')}
        </select>
      </div>
      <div class="input-row">
        <div class="field">
          <label>Litres</label>
          <input type="number" id="litresInput" min="0.1" step="0.1" placeholder="e.g. 55">
        </div>
        <div class="field">
          <label>Price per litre (R)</label>
          <input type="number" id="priceInput" min="0.01" step="0.01" placeholder="e.g. 23.50">
        </div>
      </div>
      <div class="field">
        <label>Total cost</label>
        <input type="text" id="totalDisplay" value="R0" disabled style="background:#F4F6F5;font-weight:700;">
      </div>
      <div class="field" id="meterField"></div>
      <div class="field">
        <label>Supplier / filling station</label>
        <input type="text" id="supplierInput" placeholder="e.g. Sasol Walmer">
      </div>
      <div class="field">
        <label>Receipt photo (optional)</label>
        <input type="file" id="photoInput" accept="image/*" capture="environment">
        <div class="hint" id="photoHint">No photo attached</div>
      </div>
      <button class="btn btn-primary w-full" id="submitBtn">Save Fuel Record</button>
    </div>
  `;

  container.querySelector('#backBtn').addEventListener('click', () => history.back());

  const vehicleSelect = container.querySelector('#vehicleSelect');
  const projectSelect = container.querySelector('#projectSelect');
  const litresInput = container.querySelector('#litresInput');
  const priceInput = container.querySelector('#priceInput');
  const totalDisplay = container.querySelector('#totalDisplay');
  const meterField = container.querySelector('#meterField');

  function updateMeterField() {
    const v = getVehicle(vehicleSelect.value);
    if (!v) { meterField.innerHTML = ''; return; }
    if (v.baseline_l_per_hr != null) {
      meterField.innerHTML = `<label>Hour meter reading</label><input type="number" id="meterInput" min="0" step="0.1" placeholder="e.g. 647.5">`;
    } else {
      meterField.innerHTML = `<label>Odometer reading (km)</label><input type="number" id="meterInput" min="0" step="1" placeholder="e.g. 49175">`;
    }
    if (v.assigned_project) projectSelect.value = v.assigned_project;
  }
  vehicleSelect.addEventListener('change', updateMeterField);

  function updateTotal() {
    const total = (Number(litresInput.value) || 0) * (Number(priceInput.value) || 0);
    totalDisplay.value = formatCurrency(total);
  }
  litresInput.addEventListener('input', updateTotal);
  priceInput.addEventListener('input', updateTotal);

  container.querySelector('#photoInput').addEventListener('change', (e) => {
    photoAttached = e.target.files && e.target.files.length > 0;
    container.querySelector('#photoHint').textContent = photoAttached ? `📷 ${e.target.files[0].name} attached` : 'No photo attached';
  });

  container.querySelector('#submitBtn').addEventListener('click', () => {
    const vehicleId = vehicleSelect.value;
    const projectId = projectSelect.value;
    const litres = Number(litresInput.value);
    const price = Number(priceInput.value);
    const meterVal = container.querySelector('#meterInput')?.value;

    if (!vehicleId) { toast('Select a vehicle', 'error'); return; }
    if (!projectId) { toast('Select a project', 'error'); return; }
    if (!(litres > 0)) { toast('Enter a valid litres amount', 'error'); return; }
    if (!(price > 0)) { toast('Enter a valid price per litre', 'error'); return; }

    const vehicle = getVehicle(vehicleId);
    const usesHours = vehicle.baseline_l_per_hr != null;

    try {
      createFuelTransaction({
        companyId: session.companyId, projectId, vehicleId, userId: session.userId,
        litres, pricePerLitre: price,
        odometerReading: usesHours ? null : Number(meterVal) || null,
        hourMeter: usesHours ? Number(meterVal) || null : null,
        supplier: container.querySelector('#supplierInput').value,
        receiptPhoto: photoAttached ? 'attached' : null
      });
    } catch (e) {
      toast(e.message, 'error');
      return;
    }

    const series = getFuelConsumptionSeries(session.companyId, vehicleId);
    const latest = series[0];
    if (latest && latest.anomalous) {
      showAnomalyWarning(vehicle, latest);
    } else {
      toast('Fuel record saved ✅', 'success');
      location.hash = '#/fuel';
    }
  });
}

function showAnomalyWarning(vehicle, series) {
  const card = openModal(`
    <div style="font-size:32px;">⚠️</div>
    <h3 class="mt-2">Unusual fuel consumption detected</h3>
    <p class="muted">${escapeHtml(vehicle.vehicle_name)} used ${series.rate} ${series.unit} on this trip, compared to its normal ${series.baseline} ${series.unit}. This has been flagged in Money Leaks for review.</p>
    <button class="btn btn-primary w-full mt-3" id="okBtn">Got it</button>
  `);
  card.querySelector('#okBtn').addEventListener('click', () => { closeModal(); location.hash = '#/fuel'; });
}
