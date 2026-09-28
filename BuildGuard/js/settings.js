/*
  settings.js — COMPANY SETTINGS (Phase 2 §3, §22, §46).

  Nothing about approval routing or budget alerting is hard-coded: an owner
  configures the ceilings that decide who may approve what, and the budget
  percentages that decide when a project starts shouting. Both are read live
  by the approval engine and the alert engine in db.js.
*/

import { getSession } from './state.js';
import {
  getCompany, getApprovalLimits, updateApprovalLimits,
  getBudgetThresholds, updateBudgetThresholds,
  getRoleLimits, updateRoleLimits,
  listMaterials, createMaterial, listVehicles, createVehicle, listProjects, getProject
} from './db.js';
import { formatCurrency, toast, escapeHtml, openModal, closeModal } from './utils.js';

export function renderSettingsPage(container) {
  const session = getSession();

  function draw() {
    const company = getCompany(session.companyId);
    const { pmLimit, ownerSoloLimit } = getApprovalLimits(session.companyId);
    const roleLimits = getRoleLimits(session.companyId);
    const thresholds = getBudgetThresholds(session.companyId);
    const materials = listMaterials(session.companyId);
    const vehicles = listVehicles(session.companyId);

    container.innerHTML = `
      <div class="page-title">⚙️ Company Settings</div>
      <p class="muted mb-3">${escapeHtml(company.company_name)}</p>

      <div class="section-title" style="margin-top:0;">🔐 Who can approve what</div>
      <div class="card">
        <p class="faint mb-3">Approval ceilings by role. A Supervisor can never approve — they raise requests only.</p>
        <div class="field">
          <label>Site Manager can approve up to (R)</label>
          <input type="number" id="smLimitInput" min="0" step="100" value="${roleLimits.site_manager}">
          <div class="hint">Small site purchases at or below this are fully signed off by the Site Manager.</div>
        </div>
        <div class="field">
          <label>Project Manager can approve up to (R)</label>
          <input type="number" id="pmLimitInput" min="0" step="100" value="${roleLimits.project_manager}">
          <div class="hint">At or above this, the Owner must also approve.</div>
        </div>
        <div class="field">
          <label>Owner high-value threshold (R)</label>
          <input type="number" id="ownerLimitInput" min="0" step="100" value="${ownerSoloLimit}">
          <div class="hint">Requests at or above this are flagged as high-value spend for the Owner.</div>
        </div>
        <button class="btn btn-primary w-full" id="saveLimitsBtn">Save Approval Limits</button>
      </div>

      <div class="card mt-3">
        <div class="eyebrow mb-2">How this reads today</div>
        <p>🟢 Up to ${formatCurrency(roleLimits.site_manager)}: <strong>Site Manager approves</strong> (for Supervisor requests).</p>
        <p>🔵 Up to ${formatCurrency(roleLimits.project_manager)}: <strong>Project Manager approves.</strong></p>
        <p>🟠 ${formatCurrency(roleLimits.project_manager)} and above: <strong>Project Manager, then Owner.</strong></p>
        <p>🔴 ${formatCurrency(ownerSoloLimit)} and above: <strong>flagged as high-value</strong> for the Owner.</p>
      </div>

      <div class="section-title">📊 Budget alert thresholds</div>
      <div class="card">
        <p class="faint mb-3">When a project's spend reaches these percentages of its budget, BuildGuard changes its status and raises an alert.</p>
        <div class="input-row">
          <div class="field"><label>🟡 Watch (%)</label><input type="number" id="watchInput" min="1" max="200" value="${thresholds.watch}"></div>
          <div class="field"><label>🟠 High Risk (%)</label><input type="number" id="highInput" min="1" max="200" value="${thresholds.high}"></div>
        </div>
        <div class="input-row">
          <div class="field"><label>🔴 Over Budget (%)</label><input type="number" id="overInput" min="1" max="300" value="${thresholds.over}"></div>
          <div class="field"><label>🔴 Critical (%)</label><input type="number" id="criticalInput" min="1" max="300" value="${thresholds.critical}"></div>
        </div>
        <button class="btn btn-primary w-full" id="saveThresholdsBtn">Save Budget Thresholds</button>
      </div>

      <div class="section-title">🧱 Materials <span class="faint" style="font-weight:600">${materials.length}</span></div>
      <div class="card">
        <p class="faint mb-2">What your sites can request. Supervisors pick from this list when they raise a Buy Material request.</p>
        ${materials.length ? materials.map((m) => `
          <div class="list-item">
            <span class="li-icon">🧱</span>
            <span class="li-main"><div class="li-title">${escapeHtml(m.name)}</div><div class="li-sub">${escapeHtml(m.category || '')} · unit: ${escapeHtml(m.unit)}${m.minimum_stock_level ? ` · min stock ${m.minimum_stock_level}` : ''}</div></span>
          </div>`).join('') : '<div class="empty-state"><div class="emoji">🧱</div>No materials yet — nobody can raise a material request until you add some.</div>'}
        <button class="btn btn-outline w-full mt-2" id="addMaterialBtn">+ Add Material</button>
      </div>

      <div class="section-title">🚜 Vehicles &amp; Equipment <span class="faint" style="font-weight:600">${vehicles.length}</span></div>
      <div class="card">
        <p class="faint mb-2">Anything that burns fuel. The baseline consumption is what BuildGuard compares every fill-up against to catch anomalies.</p>
        ${vehicles.length ? vehicles.map((v) => `
          <div class="list-item">
            <span class="li-icon">${v.baseline_l_per_hr ? '🚜' : '🛻'}</span>
            <span class="li-main">
              <div class="li-title">${escapeHtml(v.vehicle_name)}</div>
              <div class="li-sub">${escapeHtml(v.registration_number)} · ${v.baseline_l_per_hr ? `${v.baseline_l_per_hr} L/hr` : v.baseline_km_per_l ? `${v.baseline_km_per_l} km/L` : 'no baseline'}${v.assigned_project ? ' · ' + escapeHtml(getProject(v.assigned_project)?.project_name || '') : ''}</div>
            </span>
            <span class="li-end"><span class="badge ${v.status === 'active' ? 'badge-success' : 'badge-neutral'}">${v.status}</span></span>
          </div>`).join('') : '<div class="empty-state"><div class="emoji">🚜</div>No vehicles yet — nobody can record fuel until you add some.</div>'}
        <button class="btn btn-outline w-full mt-2" id="addVehicleBtn">+ Add Vehicle / Equipment</button>
      </div>

      <div class="section-title">🏢 Company information</div>
      <div class="card">
        <table class="simple-table">
          <tr><th>Company</th><td>${escapeHtml(company.company_name)}</td></tr>
          <tr><th>Registration</th><td>${escapeHtml(company.registration_number || '—')}</td></tr>
          <tr><th>Contact</th><td>${escapeHtml(company.contact_information || '—')}</td></tr>
          <tr><th>Currency</th><td>South African Rand (R)</td></tr>
        </table>
        <p class="faint mt-2">Editing company details, expense categories and notification preferences is not built yet — planned alongside the Phase 3 Supabase backend.</p>
      </div>
    `;

    container.querySelector('#saveLimitsBtn').addEventListener('click', () => {
      const sm = Number(container.querySelector('#smLimitInput').value);
      const pm = Number(container.querySelector('#pmLimitInput').value);
      const owner = Number(container.querySelector('#ownerLimitInput').value);
      try {
        updateRoleLimits(session.companyId, { site_manager: sm, project_manager: pm }, session.userId);
        updateApprovalLimits(session.companyId, { pmLimit: pm, ownerSoloLimit: owner }, session.userId);
        toast('Approval limits updated ✅', 'success');
        draw();
      } catch (e) { toast(e.message, 'error'); }
    });

    container.querySelector('#addMaterialBtn').addEventListener('click', () => openAddMaterial(draw));
    container.querySelector('#addVehicleBtn').addEventListener('click', () => openAddVehicle(draw));

    container.querySelector('#saveThresholdsBtn').addEventListener('click', () => {
      try {
        updateBudgetThresholds(session.companyId, {
          watch: Number(container.querySelector('#watchInput').value),
          high: Number(container.querySelector('#highInput').value),
          over: Number(container.querySelector('#overInput').value),
          critical: Number(container.querySelector('#criticalInput').value)
        }, session.userId);
        toast('Budget thresholds updated ✅', 'success');
        draw();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  draw();
}

// ---------------------------------------------------------------------------
// Company setup modals
// ---------------------------------------------------------------------------

const MATERIAL_CATEGORIES = ['Building Materials', 'Aggregates', 'Steel', 'Plumbing', 'Electrical', 'Finishes', 'Roofing', 'Safety', 'Tools', 'General'];
const UNIT_SUGGESTIONS = ['bags (50kg)', 'bricks', 'm³', 'tons', 'lengths (6m)', 'drums (20L)', 'sets', 'sheets', 'units', 'litres', 'kg', 'm'];

function openAddMaterial(onChange) {
  const session = getSession();
  const card = openModal(`
    <h3>Add Material</h3>
    <div class="field"><label>Name *</label><input type="text" id="mName" placeholder="e.g. Cement"></div>
    <div class="field">
      <label>Category</label>
      <select id="mCategory">${MATERIAL_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('')}</select>
    </div>
    <div class="field">
      <label>Unit *</label>
      <input type="text" id="mUnit" list="unitList" placeholder="e.g. bags (50kg)">
      <datalist id="unitList">${UNIT_SUGGESTIONS.map((u) => `<option value="${u}">`).join('')}</datalist>
      <div class="hint">Use a plural word — it's used in sentences like "30 bags of Cement unaccounted for".</div>
    </div>
    <div class="field"><label>Minimum stock level (optional)</label><input type="number" id="mMin" min="0" step="any" placeholder="0"></div>
    <button class="btn btn-primary w-full" id="saveBtn">Add Material</button>
    <button class="btn btn-ghost w-full mt-2" id="cancelBtn">Cancel</button>
  `);
  card.querySelector('#cancelBtn').addEventListener('click', closeModal);
  card.querySelector('#saveBtn').addEventListener('click', () => {
    try {
      createMaterial({
        companyId: session.companyId, createdBy: session.userId,
        name: card.querySelector('#mName').value, category: card.querySelector('#mCategory').value,
        unit: card.querySelector('#mUnit').value, minimumStockLevel: Number(card.querySelector('#mMin').value) || 0
      });
      toast('Material added ✅', 'success');
      closeModal();
      onChange && onChange();
    } catch (e) { toast(e.message, 'error'); }
  });
}

const VEHICLE_TYPES = ['Bakkie', 'Flatbed Truck', 'Delivery Truck', 'Tipper Truck', 'Excavator', 'TLB', 'Grader', 'Roller', 'Generator', 'Water Tanker', 'Other'];

function openAddVehicle(onChange) {
  const session = getSession();
  const projects = listProjects(session.companyId);
  const card = openModal(`
    <h3>Add Vehicle / Equipment</h3>
    <div class="field"><label>Name *</label><input type="text" id="vName" placeholder="e.g. Toyota Hilux 2.8 GD-6"></div>
    <div class="field"><label>Registration / asset number *</label><input type="text" id="vReg" placeholder="e.g. NP 123 456 or PLANT-EX01"></div>
    <div class="field">
      <label>Type</label>
      <select id="vType">${VEHICLE_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}</select>
    </div>
    <div class="field">
      <label>How is usage measured?</label>
      <div class="chip-group">
        <button class="chip selected" data-meter="km">🛻 Odometer (km)</button>
        <button class="chip" data-meter="hr">🚜 Hour meter</button>
      </div>
    </div>
    <div class="field" id="baselineField">
      <label>Normal consumption (km per litre) *</label>
      <input type="number" id="vBaseline" min="0.1" step="0.1" placeholder="e.g. 9">
      <div class="hint">What this vehicle normally does. Fill-ups that fall well below this get flagged as a fuel anomaly.</div>
    </div>
    <div class="field">
      <label>Usually works on</label>
      <select id="vProject"><option value="">Not assigned</option>${projects.map((p) => `<option value="${p.id}">${escapeHtml(p.project_name)}</option>`).join('')}</select>
    </div>
    <button class="btn btn-primary w-full" id="saveBtn">Add Vehicle</button>
    <button class="btn btn-ghost w-full mt-2" id="cancelBtn">Cancel</button>
  `);

  let meter = 'km';
  card.querySelectorAll('[data-meter]').forEach((el) => el.addEventListener('click', () => {
    meter = el.dataset.meter;
    card.querySelectorAll('[data-meter]').forEach((x) => x.classList.toggle('selected', x === el));
    card.querySelector('#baselineField label').textContent = meter === 'km' ? 'Normal consumption (km per litre) *' : 'Normal consumption (litres per hour) *';
    card.querySelector('#vBaseline').placeholder = meter === 'km' ? 'e.g. 9' : 'e.g. 12';
  }));

  card.querySelector('#cancelBtn').addEventListener('click', closeModal);
  card.querySelector('#saveBtn').addEventListener('click', () => {
    const baseline = Number(card.querySelector('#vBaseline').value);
    if (!(baseline > 0)) { toast('Enter the normal consumption so fuel anomalies can be detected', 'error'); return; }
    try {
      createVehicle({
        companyId: session.companyId, createdBy: session.userId,
        vehicleName: card.querySelector('#vName').value, registrationNumber: card.querySelector('#vReg').value,
        vehicleType: card.querySelector('#vType').value, fuelType: 'Diesel',
        assignedProject: card.querySelector('#vProject').value || null,
        baselineKmPerL: meter === 'km' ? baseline : null, baselineLPerHr: meter === 'hr' ? baseline : null
      });
      toast('Vehicle added ✅', 'success');
      closeModal();
      onChange && onChange();
    } catch (e) { toast(e.message, 'error'); }
  });
}
