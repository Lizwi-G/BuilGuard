/*
  db.js — BuildGuard's data access layer + business intelligence.

  Every module in the app reads and writes data ONLY through the functions
  exported here. Right now the functions read/write storage.js
  (localStorage), which is DEMO MODE — see the Phase 3/4 note this file
  originally shipped with; that seam is unchanged by this amendment.

  v2 — FINANCIAL CONTROL AMENDMENT
  BuildGuard is a financial control platform, not a site-ops app. The
  centrepiece of this file is now the unified approval engine: every
  material request AND every generic expense request flows through the
  same Supervisor -> Site Manager -> Project Manager -> Owner chain, routed
  by each company's configurable approval limits. Alongside it: an audit
  log (who did what, when, on which project), role-aware notifications,
  and the aggregate calculations the Owner/PM dashboards need (project
  health, company spending, money-leak breakdown).
*/

import { getCollection, setCollection, isSeeded, markSeeded, syncRecord, syncPatch, hydrate, clearCache } from './storage.js';
import { IS_PRODUCTION } from './config.js';
import { buildDemoData } from './demoData.js';
import { uid, round2, pctAbove } from './utils.js';
import { isOnline, ROLES } from './state.js';
import { queueAction, setFlushHandler } from './offline.js';

// ---------------------------------------------------------------------------
// Bootstrapping
//
// DEMO:       seed sample data into localStorage once, then compute alerts.
// PRODUCTION: nothing is seeded — the database is the source of truth. Data
//             is pulled into the cache by loadCompanyData() after login.
// ---------------------------------------------------------------------------

export async function init() {
  setFlushHandler(markSynced);
  if (IS_PRODUCTION) return; // wait for login; see loadCompanyData()
  if (!isSeeded()) {
    const demo = buildDemoData();
    setCollection('companies', demo.companies);
    setCollection('users', demo.users);
    setCollection('projects', demo.projects);
    setCollection('materials', demo.materials);
    setCollection('suppliers', demo.suppliers);
    setCollection('supplierPrices', demo.supplierPrices);
    setCollection('vehicles', demo.vehicles);
    setCollection('requests', demo.requests);
    setCollection('purchases', [...demo.purchases, ...demo.approvedRequestPurchases]);
    setCollection('deliveries', demo.deliveries);
    setCollection('inventory', demo.inventory);
    setCollection('fuelTransactions', demo.fuelTransactions);
    setCollection('alerts', demo.alertsSeed);
    setCollection('auditLog', demo.auditLogSeed);
    setCollection('savings', demo.savingsSeed);
    setCollection('notifications', []);
    markSeeded();
  }
  refreshAlerts(); // compute live anomaly alerts on top of the seed/transaction data
}

/**
 * PRODUCTION: called once a user is authenticated. Pulls the company's data
 * (as permitted by Row Level Security) into the cache, then runs the alert
 * engine over it exactly as demo mode does.
 */
export async function loadCompanyData() {
  if (!IS_PRODUCTION) return;
  await hydrate();
  refreshAlerts();
}

export function unloadCompanyData() {
  clearCache();
}

export function resetDemoData() {
  if (IS_PRODUCTION) throw new Error('Reset is only available in demo mode.');
  localStorage.clear();
  return init();
}

// ---------------------------------------------------------------------------
// Low-level write helper — every mutation goes through here so offline
// queueing is automatic and consistent.
// ---------------------------------------------------------------------------

function writeRecord(collectionName, record) {
  const list = getCollection(collectionName);
  const idx = list.findIndex((r) => r.id === record.id);
  const online = isOnline();
  record.syncStatus = online ? 'synced' : 'pending';
  if (idx >= 0) list[idx] = record; else list.push(record);

  if (IS_PRODUCTION) {
    // Update the cache directly and mirror just this one row — setCollection
    // would re-upload the whole table on every keystroke.
    if (online) syncRecord(collectionName, record);
  } else {
    setCollection(collectionName, list);
  }
  if (!online) queueAction(collectionName, record.id, record);
  return record;
}

/**
 * Like writeRecord, but sends only the changed fields to the server instead
 * of the whole cached row. Use this for editing a record someone else might
 * be writing to at the same time (see storage.js's syncPatch for why a
 * full-row upsert is unsafe there). The local cache still gets the merged
 * object so the UI updates instantly.
 */
function patchRecord(collectionName, id, patch) {
  const list = getCollection(collectionName);
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) throw new Error('Record not found.');
  const online = isOnline();
  const record = Object.assign(list[idx], patch, { syncStatus: online ? 'synced' : 'pending' });

  if (IS_PRODUCTION) {
    if (online) syncPatch(collectionName, id, patch);
  } else {
    setCollection(collectionName, list);
  }
  if (!online) queueAction(collectionName, id, record);
  return record;
}

function markSynced(collectionName, recordId) {
  const list = getCollection(collectionName);
  const idx = list.findIndex((r) => r.id === recordId);
  if (idx >= 0) {
    list[idx].syncStatus = 'synced';
    if (IS_PRODUCTION) {
      // Connection is back — push the record that was queued while offline.
      syncRecord(collectionName, list[idx]);
    } else {
      setCollection(collectionName, list);
    }
  }
}

// ---------------------------------------------------------------------------
// Simple reads — companies, users, projects, materials, suppliers, vehicles
// ---------------------------------------------------------------------------

export const listCompanies = () => getCollection('companies');
export const getCompany = (id) => getCollection('companies').find((c) => c.id === id) || null;

export function getApprovalLimits(companyId) {
  const company = getCompany(companyId);
  return {
    pmLimit: (company && company.pm_approval_limit) || 5000,
    ownerSoloLimit: (company && company.owner_solo_limit) || 25000
  };
}

const DEFAULT_THRESHOLDS = { watch: 75, high: 90, over: 100, critical: 110 };

/** Budget alert thresholds as % of budget (Phase 2 §3) — configurable per company. */
export function getBudgetThresholds(companyId) {
  const company = getCompany(companyId);
  return { ...DEFAULT_THRESHOLDS, ...((company && company.budget_thresholds) || {}) };
}

export function updateBudgetThresholds(companyId, thresholds, changedBy) {
  const company = getCompany(companyId);
  if (!company) throw new Error('Company not found.');
  const { watch, high, over, critical } = thresholds;
  if (!(watch > 0 && high > watch && over > high && critical > over)) {
    throw new Error('Thresholds must increase in order: Watch < High Risk < Over Budget < Critical.');
  }
  company.budget_thresholds = { watch: round2(watch), high: round2(high), over: round2(over), critical: round2(critical) };
  writeRecord('companies', company);
  logAudit({ companyId, userId: changedBy, action: 'Updated budget thresholds', details: `${watch}% / ${high}% / ${over}% / ${critical}%`, entityType: 'settings', entityId: companyId });
  return company;
}

/**
 * Budget status for a given "% of budget" figure (Phase 2 §3).
 * Returns the band plus its badge styling so every screen renders it identically.
 */
export function computeBudgetStatus(pct, companyId) {
  const t = getBudgetThresholds(companyId);
  if (pct >= t.critical) return { key: 'critical', label: 'Critical', icon: '🔴', badge: 'badge-danger' };
  if (pct >= t.over) return { key: 'over', label: 'Over Budget', icon: '🔴', badge: 'badge-danger' };
  if (pct >= t.high) return { key: 'high', label: 'High Risk', icon: '🟠', badge: 'badge-warning' };
  if (pct >= t.watch) return { key: 'watch', label: 'Watch', icon: '🟡', badge: 'badge-warning' };
  return { key: 'ok', label: 'On Track', icon: '🟢', badge: 'badge-success' };
}

/**
 * Per-role approval ceilings (Phase 2 §22). A Supervisor can never approve.
 * NOTE the single source of truth: the Project Manager ceiling IS
 * `company.pm_approval_limit` — the field the routing engine already uses — so
 * the Settings screen and the approval chain can never disagree with each other.
 */
export function getRoleLimits(companyId) {
  const company = getCompany(companyId);
  return {
    supervisor: 0,
    site_manager: (company && company.role_limits && company.role_limits.site_manager) || 2500,
    project_manager: (company && company.pm_approval_limit) || 5000
  };
}

export function updateRoleLimits(companyId, limits, changedBy) {
  const company = getCompany(companyId);
  if (!company) throw new Error('Company not found.');
  if (!(limits.site_manager >= 0) || !(limits.project_manager > limits.site_manager)) {
    throw new Error('Project Manager limit must be greater than the Site Manager limit.');
  }
  company.role_limits = { ...(company.role_limits || {}), site_manager: round2(limits.site_manager) };
  company.pm_approval_limit = round2(limits.project_manager);
  writeRecord('companies', company);
  logAudit({ companyId, userId: changedBy, action: 'Updated role approval limits', details: `Site Manager R${limits.site_manager}, Project Manager R${limits.project_manager}`, entityType: 'settings', entityId: companyId });
  return company;
}

export function updateApprovalLimits(companyId, { pmLimit, ownerSoloLimit }, changedBy) {
  const company = getCompany(companyId);
  if (!company) throw new Error('Company not found.');
  if (!(pmLimit > 0) || !(ownerSoloLimit > pmLimit)) throw new Error('Owner threshold must be greater than the Project Manager limit.');
  company.pm_approval_limit = round2(pmLimit);
  company.owner_solo_limit = round2(ownerSoloLimit);
  writeRecord('companies', company);
  logAudit({ companyId, userId: changedBy, action: 'Updated approval limits', details: `PM limit R${pmLimit}, Owner threshold R${ownerSoloLimit}`, entityType: 'settings', entityId: companyId });
  return company;
}

/**
 * Registration — the person creating the company becomes Owner automatically.
 * In production, `authId` is the Supabase Auth user id created by auth.js just
 * before this runs; it's what Row Level Security uses to map a login to a
 * company. In demo mode it's simply absent.
 */
export function buildCompanyAccountRecords({ companyName, registrationNumber, ownerName, ownerEmail, phone, authId }) {
  if (!companyName || !ownerName || !ownerEmail) throw new Error('Company name, owner name and email are required.');
  const companyId = uid('co');
  const ownerId = uid('user');
  const company = {
    id: companyId, company_name: companyName, registration_number: registrationNumber || '',
    contact_information: `${ownerEmail} · ${phone || ''}`, created_at: new Date().toISOString(),
    pm_approval_limit: 5000, owner_solo_limit: 25000,
    role_limits: { site_manager: 2500 },
    budget_thresholds: { watch: 75, high: 90, over: 100, critical: 110 }
  };
  const owner = {
    id: ownerId, company_id: companyId, name: ownerName, email: ownerEmail.toLowerCase(), phone: phone || '',
    role: ROLES.OWNER, status: 'active', auth_id: authId || null, created_at: new Date().toISOString()
  };
  return { company, owner };
}

/** DEMO registration: writes straight to the local cache. Production goes via auth.js. */
export function createCompanyAccount(details) {
  const { company, owner } = buildCompanyAccountRecords(details);
  writeRecord('companies', company);
  writeRecord('users', owner);
  logAudit({ companyId: company.id, userId: owner.id, action: 'Company registered', details: `${company.company_name} created`, entityType: 'company', entityId: company.id });
  return { companyId: company.id, userId: owner.id };
}

export const listUsers = (companyId) => getCollection('users').filter((u) => u.company_id === companyId);
export const getUser = (id) => getCollection('users').find((u) => u.id === id) || null;
export const getUserByAuthId = (authId) => getCollection('users').find((u) => u.auth_id === authId) || null;
export const getUserByEmail = (email) => getCollection('users').find((u) => (u.email || '').toLowerCase() === (email || '').toLowerCase()) || null;

/**
 * Invite a team member. In production the row is created with status
 * 'invited' and no auth_id; when that person signs up with the same email,
 * auth.js calls claimInvite() to attach their login to this row. This keeps
 * the Owner in control of membership without needing a server-side admin key.
 */
export function inviteUser({ companyId, role, name, email, phone, projectIds }) {
  if (!name || !email || !role) throw new Error('Name, email and role are required.');
  const record = {
    id: uid('user'), company_id: companyId, name, email: email.toLowerCase(), phone: phone || '', role,
    status: IS_PRODUCTION ? 'invited' : 'active', auth_id: null, created_at: new Date().toISOString()
  };
  if (role === ROLES.PROJECT_MANAGER) record.manages_projects = projectIds || [];
  if (role === ROLES.SITE_MANAGER || role === ROLES.SUPERVISOR) record.assigned_projects = projectIds || [];
  writeRecord('users', record);
  logAudit({ companyId, userId: record.id, action: 'User invited', details: `${name} added as ${role.replace('_', ' ')}`, entityType: 'user', entityId: record.id });
  return record;
}

/** Attach a freshly-signed-up login to a pending invite that matches its email. */
export function claimInvite(userRow, authId) {
  userRow.auth_id = authId;
  userRow.status = 'active';
  writeRecord('users', userRow);
  logAudit({ companyId: userRow.company_id, userId: userRow.id, action: 'Invitation accepted', details: userRow.name, entityType: 'user', entityId: userRow.id });
  return userRow;
}

export function updateUserStatus(userId, status) {
  const user = getUser(userId);
  if (!user) throw new Error('User not found.');
  // Patched, not upserted: this may run on the Owner's device while the
  // teammate's own device is mid-claim of their invite (setting auth_id) —
  // a full-row write from the Owner's possibly-stale cache would wipe that
  // back out and lock the teammate out again. See storage.js's syncPatch.
  const updated = patchRecord('users', userId, { status });
  logAudit({ companyId: user.company_id, userId, action: status === 'active' ? 'User reactivated' : 'User deactivated', details: user.name, entityType: 'user', entityId: userId });
  return updated;
}

export function updateUserAssignment(userId, projectIds) {
  const user = getUser(userId);
  if (!user) throw new Error('User not found.');
  const field = user.role === ROLES.PROJECT_MANAGER ? 'manages_projects' : 'assigned_projects';
  const updated = patchRecord('users', userId, { [field]: projectIds });
  logAudit({ companyId: user.company_id, userId, action: 'Project assignment changed', details: user.name, entityType: 'user', entityId: userId });
  return updated;
}

/**
 * Re-pull company data from the server before showing the Team page. Team
 * membership is the one screen where staleness actively misleads the Owner
 * — e.g. showing "Invited" for someone who already finished signing up on
 * their own device a minute ago, tempting the Owner to "reactivate" them
 * (harmless now, but pointless) instead of just telling them to try again.
 */
export async function refreshTeamData() {
  if (!IS_PRODUCTION) return;
  await hydrate();
}

/** Every project a user has visibility over (used for scoping requests/alerts/activity). */
export function projectIdsForUser(user) {
  if (!user) return [];
  if (user.role === ROLES.OWNER) return listProjects(user.company_id).map((p) => p.id);
  if (user.role === ROLES.PROJECT_MANAGER) return user.manages_projects || [];
  return user.assigned_projects || [];
}

export const listProjects = (companyId, { status } = {}) =>
  getCollection('projects').filter((p) => p.company_id === companyId && (!status || p.status === status));
export const getProject = (id) => getCollection('projects').find((p) => p.id === id) || null;

// ---------------------------------------------------------------------------
// Company setup — projects, materials, vehicles. A brand-new company starts
// with nothing, so the Owner needs to create these before anyone can raise a
// request, record fuel or receive a delivery.
// ---------------------------------------------------------------------------

export function createProject({ companyId, createdBy, projectName, location, province, city, region, clientName, contractValue, budget, totalSpentToDate, managerId, startDate, endDate }) {
  if (!projectName) throw new Error('Project name is required.');
  if (!(budget > 0)) throw new Error('Budget must be greater than zero.');
  if (startDate && endDate && new Date(endDate) <= new Date(startDate)) throw new Error('End date must be after the start date.');
  const record = {
    id: uid('proj'), company_id: companyId, project_name: projectName.trim(),
    location: location || '', province: province || '', city: city || '', region: region || '',
    client_name: clientName || '', contract_value: round2(contractValue || 0), budget: round2(budget),
    total_spent_to_date: round2(totalSpentToDate || 0), manager_id: managerId || null,
    start_date: startDate || new Date().toISOString().slice(0, 10), end_date: endDate || null,
    status: 'active', created_at: new Date().toISOString()
  };
  writeRecord('projects', record);
  logAudit({ companyId, projectId: record.id, userId: createdBy, action: 'Project created', details: `${record.project_name} — budget R${record.budget}`, entityType: 'project', entityId: record.id, amount: record.budget });
  return record;
}

export function updateProject(projectId, fields, changedBy) {
  const project = getProject(projectId);
  if (!project) throw new Error('Project not found.');
  const allowed = ['project_name', 'location', 'province', 'city', 'region', 'client_name', 'contract_value', 'budget', 'total_spent_to_date', 'manager_id', 'start_date', 'end_date', 'status'];
  const changes = [];
  allowed.forEach((k) => {
    if (fields[k] === undefined) return;
    const next = ['contract_value', 'budget', 'total_spent_to_date'].includes(k) ? round2(fields[k]) : fields[k];
    if (next !== project[k]) { changes.push(k.replace(/_/g, ' ')); project[k] = next; }
  });
  if (!(project.budget > 0)) throw new Error('Budget must be greater than zero.');
  if (project.start_date && project.end_date && new Date(project.end_date) <= new Date(project.start_date)) throw new Error('End date must be after the start date.');
  writeRecord('projects', project);
  if (changes.length) {
    logAudit({ companyId: project.company_id, projectId, userId: changedBy, action: 'Project updated', details: `${project.project_name}: ${changes.join(', ')}`, entityType: 'project', entityId: projectId });
  }
  refreshAlerts(); // budget/spend changes move the health and forecast immediately
  return project;
}

export function createMaterial({ companyId, createdBy, name, category, unit, minimumStockLevel }) {
  if (!name || !unit) throw new Error('Material name and unit are required.');
  const record = {
    id: uid('mat'), company_id: companyId, name: name.trim(), category: category || 'General',
    unit: unit.trim(), minimum_stock_level: round2(minimumStockLevel || 0), created_at: new Date().toISOString()
  };
  writeRecord('materials', record);
  logAudit({ companyId, userId: createdBy, action: 'Material added', details: `${record.name} (${record.unit})`, entityType: 'material', entityId: record.id });
  return record;
}

export function createVehicle({ companyId, createdBy, vehicleName, registrationNumber, vehicleType, fuelType, assignedProject, baselineKmPerL, baselineLPerHr }) {
  if (!vehicleName || !registrationNumber) throw new Error('Vehicle name and registration are required.');
  const usesHours = baselineLPerHr > 0;
  const record = {
    id: uid('veh'), company_id: companyId, vehicle_name: vehicleName.trim(), registration_number: registrationNumber.trim(),
    vehicle_type: vehicleType || 'Vehicle', fuel_type: fuelType || 'Diesel', assigned_project: assignedProject || null,
    status: 'active',
    baseline_km_per_l: usesHours ? null : (baselineKmPerL > 0 ? round2(baselineKmPerL) : null),
    baseline_l_per_hr: usesHours ? round2(baselineLPerHr) : null,
    created_at: new Date().toISOString()
  };
  writeRecord('vehicles', record);
  logAudit({ companyId, userId: createdBy, action: 'Vehicle added', details: `${record.vehicle_name} (${record.registration_number})`, entityType: 'vehicle', entityId: record.id });
  return record;
}

export const listMaterials = (companyId) => getCollection('materials').filter((m) => m.company_id === companyId);
export const getMaterial = (id) => getCollection('materials').find((m) => m.id === id) || null;

export const listSuppliers = (companyId) => getCollection('suppliers').filter((s) => s.company_id === companyId);
export const getSupplier = (id) => getCollection('suppliers').find((s) => s.id === id) || null;
export const listSupplierQuotes = (supplierId) => getCollection('supplierPrices').filter((sp) => sp.supplier_id === supplierId);

export function createSupplier({ companyId, supplierName, contactPerson, phone, email, address }) {
  if (!supplierName) throw new Error('Supplier name is required.');
  const record = {
    id: uid('sup'), company_id: companyId, supplier_name: supplierName, contact_person: contactPerson || '',
    phone: phone || '', email: email || '', address: address || '', status: 'active'
  };
  return writeRecord('suppliers', record);
}

export function updateSupplierStatus(id, status) {
  const supplier = getSupplier(id);
  if (!supplier) throw new Error('Supplier not found.');
  supplier.status = status;
  return writeRecord('suppliers', supplier);
}

export const listVehicles = (companyId) => getCollection('vehicles').filter((v) => v.company_id === companyId);
export const getVehicle = (id) => getCollection('vehicles').find((v) => v.id === id) || null;

export function listPurchases(companyId, { projectId, materialId } = {}) {
  return getCollection('purchases')
    .filter((p) => p.company_id === companyId)
    .filter((p) => !projectId || p.project_id === projectId)
    .filter((p) => !materialId || p.material_id === materialId)
    .sort((a, b) => new Date(b.purchase_date) - new Date(a.purchase_date));
}
export const getPurchase = (id) => getCollection('purchases').find((p) => p.id === id) || null;
export const getPurchaseByRequestId = (requestId) => getCollection('purchases').find((p) => p.source_request_id === requestId) || null;

export function listDeliveries(companyId) {
  const purchaseIds = new Set(getCollection('purchases').filter((p) => p.company_id === companyId).map((p) => p.id));
  return getCollection('deliveries')
    .filter((d) => purchaseIds.has(d.purchase_id))
    .sort((a, b) => new Date(b.delivery_date) - new Date(a.delivery_date));
}
export const getDeliveryForPurchase = (purchaseId) => getCollection('deliveries').find((d) => d.purchase_id === purchaseId) || null;

export function listFuelTransactions(companyId, { vehicleId, projectId } = {}) {
  return getCollection('fuelTransactions')
    .filter((f) => f.company_id === companyId)
    .filter((f) => !vehicleId || f.vehicle_id === vehicleId)
    .filter((f) => !projectId || f.project_id === projectId)
    .sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date));
}

export function listInventory(companyId, { projectId } = {}) {
  return getCollection('inventory')
    .filter((i) => i.company_id === companyId)
    .filter((i) => !projectId || i.project_id === projectId)
    .map(withInventoryMath);
}

function withInventoryMath(row) {
  const expected = round2(row.received - row.used);
  const variance = round2(row.actual_counted - expected);
  return { ...row, expected, variance };
}

export function listAlerts(companyId, { status, projectId } = {}) {
  return getCollection('alerts')
    .filter((a) => a.company_id === companyId)
    .filter((a) => !status || a.status === status)
    .filter((a) => !projectId || a.project_id === projectId)
    .sort((a, b) => {
      const sevRank = { critical: 0, warning: 1, info: 2 };
      const sr = (sevRank[a.severity] ?? 3) - (sevRank[b.severity] ?? 3);
      if (sr !== 0) return sr;
      return new Date(b.created_at) - new Date(a.created_at);
    });
}
export const getAlert = (id) => getCollection('alerts').find((a) => a.id === id) || null;

export function updateAlertStatus(id, status) {
  const list = getCollection('alerts');
  const alert = list.find((a) => a.id === id);
  if (!alert) return null;
  alert.status = status;
  alert.updated_at = new Date().toISOString();
  writeRecord('alerts', alert);
  return alert;
}

// ---------------------------------------------------------------------------
// Delivery / fuel / inventory capture (unchanged mechanics, now audited)
// ---------------------------------------------------------------------------

export function createDelivery({ purchaseId, expectedQuantity, receivedQuantity, receivedBy, notes, photoUrl }) {
  if (receivedQuantity < 0) throw new Error('Received quantity cannot be negative.');
  const shortage = round2(Math.max(0, expectedQuantity - receivedQuantity));
  const record = {
    id: uid('del'), purchase_id: purchaseId, expected_quantity: expectedQuantity,
    received_quantity: receivedQuantity, shortage_quantity: shortage, received_by: receivedBy,
    delivery_date: new Date().toISOString().slice(0, 10), notes: notes || '', photo_url: photoUrl || null
  };
  writeRecord('deliveries', record);
  const purchase = getPurchase(purchaseId);
  const user = getUser(receivedBy);
  logAudit({
    companyId: purchase?.company_id, projectId: purchase?.project_id, userId: receivedBy,
    action: 'Received delivery', details: `${receivedQuantity} of ${expectedQuantity} received${shortage ? ` (${shortage} short)` : ''}`,
    entityType: 'delivery', entityId: record.id, amount: shortage ? round2(shortage * (purchase?.unit_price || 0)) : null
  });
  refreshAlerts();
  if (shortage > 0 && purchase) {
    const project = getProject(purchase.project_id);
    notifyRoleHolders(purchase.company_id, [ROLES.OWNER], {
      type: 'delivery_shortage', title: 'Delivery shortage detected',
      message: `${shortage} short on a delivery${project ? ' at ' + project.project_name : ''}.`,
      projectId: purchase.project_id, entityType: 'delivery', entityId: record.id
    });
    notifyProjectManagers(purchase.company_id, purchase.project_id, {
      type: 'delivery_shortage', title: 'Delivery shortage detected',
      message: `${shortage} short on a delivery${project ? ' at ' + project.project_name : ''}.`,
      projectId: purchase.project_id, entityType: 'delivery', entityId: record.id
    });
  }
  return record;
}

export function recordInventoryCount({ inventoryId, actualCounted, countedBy }) {
  const list = getCollection('inventory');
  const row = list.find((i) => i.id === inventoryId);
  if (!row) throw new Error('Inventory record not found.');
  if (actualCounted < 0) throw new Error('Count cannot be negative.');
  row.actual_counted = actualCounted;
  row.counted_at = new Date().toISOString().slice(0, 10);
  row.counted_by = countedBy;
  row.updated_at = new Date().toISOString();
  writeRecord('inventory', row);
  logAudit({ companyId: row.company_id, projectId: row.project_id, userId: countedBy, action: 'Updated stock count', details: `${getMaterial(row.material_id)?.name || 'Material'} counted at ${actualCounted}`, entityType: 'inventory', entityId: row.id });
  refreshAlerts();
  return withInventoryMath(row);
}

export function createFuelTransaction({ companyId, projectId, vehicleId, userId, litres, pricePerLitre, odometerReading, hourMeter, supplier, receiptPhoto }) {
  if (!(litres > 0)) throw new Error('Litres must be greater than zero.');
  if (!(pricePerLitre > 0)) throw new Error('Price per litre must be greater than zero.');
  const record = {
    id: uid('fuel'), company_id: companyId, project_id: projectId, vehicle_id: vehicleId, user_id: userId,
    litres: Number(litres), price_per_litre: round2(pricePerLitre), total_cost: round2(litres * pricePerLitre),
    odometer_reading: odometerReading != null ? Number(odometerReading) : null,
    hour_meter: hourMeter != null ? Number(hourMeter) : null,
    supplier: supplier || '', receipt_photo: receiptPhoto || null,
    transaction_date: new Date().toISOString().slice(0, 10)
  };
  writeRecord('fuelTransactions', record);
  logAudit({ companyId, projectId, userId, action: 'Recorded fuel', details: `${litres}L — ${getVehicle(vehicleId)?.vehicle_name || 'vehicle'}`, entityType: 'fuel', entityId: record.id, amount: record.total_cost });
  refreshAlerts();
  return record;
}

// ---------------------------------------------------------------------------
// UNIFIED APPROVAL ENGINE
// Every material request AND generic expense request is a `requests` row
// routed through the same Supervisor -> Site Manager -> Project Manager ->
// Owner chain. Stage requirement is decided once, at creation, from the
// company's configurable approval limits:
//   - Site Manager stage is required only when the requester is a
//     Supervisor (verifying operational need before it becomes a financial
//     decision — a Site Manager's own request skips straight to their PM).
//   - Project Manager stage is required unless the amount is small enough to
//     sit entirely within the Site Manager's own ceiling (Phase 2 §22).
//   - Owner stage is required once the amount reaches the company's
//     pm_approval_limit (the Project Manager's ceiling).
// A person can never act on their own request, at any stage.
// ---------------------------------------------------------------------------

const STAGE_ORDER = ['site_manager', 'project_manager', 'owner'];
const STAGE_ROLE = { site_manager: ROLES.SITE_MANAGER, project_manager: ROLES.PROJECT_MANAGER, owner: ROLES.OWNER };

function computeInitialStages(companyId, requestedByRole, amount) {
  const { pmLimit } = getApprovalLimits(companyId);
  const roleLimits = getRoleLimits(companyId);

  const siteManagerRequired = requestedByRole === ROLES.SUPERVISOR;
  // A Site Manager can fully sign off spend within their own ceiling — small
  // site purchases shouldn't burn a Project Manager's time.
  const withinSiteManagerCeiling = siteManagerRequired && amount <= roleLimits.site_manager;

  const requiredMap = {
    site_manager: siteManagerRequired,
    project_manager: !withinSiteManagerCeiling,
    owner: !withinSiteManagerCeiling && amount >= pmLimit
  };
  const stages = {};
  let firstSet = false;
  STAGE_ORDER.forEach((key) => {
    if (!requiredMap[key]) {
      stages[key] = { required: false, status: 'not_required' };
    } else if (!firstSet) {
      stages[key] = { required: true, status: 'pending' };
      firstSet = true;
    } else {
      stages[key] = { required: true, status: 'waiting' };
    }
  });
  return stages;
}

function nextStageKey(stages, afterKey) {
  const start = afterKey ? STAGE_ORDER.indexOf(afterKey) + 1 : 0;
  for (let i = start; i < STAGE_ORDER.length; i++) {
    const key = STAGE_ORDER[i];
    if (stages[key].required && stages[key].status === 'waiting') return key;
  }
  return null;
}

export function getCurrentStageKey(request) {
  return STAGE_ORDER.find((key) => request.stages[key].required && request.stages[key].status === 'pending') || null;
}

/** Best available estimate for routing a brand-new material request. */
export function estimateMaterialCost(companyId, materialId, quantity) {
  const comparison = getSupplierComparison(companyId, materialId, quantity);
  if (comparison.rows.length) return comparison.rows[0].total;
  const latest = latestUnitPrice(companyId, materialId);
  return latest ? round2(latest * quantity) : 0;
}

export function listRequests(companyId, { status, projectId, requestType } = {}) {
  return getCollection('requests')
    .filter((r) => r.company_id === companyId)
    .filter((r) => !status || r.status === status)
    .filter((r) => !projectId || r.project_id === projectId)
    .filter((r) => !requestType || r.request_type === requestType)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}
export const getRequest = (id) => getCollection('requests').find((r) => r.id === id) || null;

/** Requests sitting in `user`'s inbox right now — scoped to their projects, excluding their own. */
export function listRequestsAwaitingUser(user) {
  if (!user) return [];
  const role = user.role;
  if (role === ROLES.SUPERVISOR) return [];
  const myProjectIds = new Set(projectIdsForUser(user));
  return getCollection('requests')
    .filter((r) => r.company_id === user.company_id)
    .filter((r) => r.requested_by !== user.id)
    .filter((r) => myProjectIds.has(r.project_id))
    .filter((r) => {
      const stageKey = getCurrentStageKey(r);
      return stageKey && STAGE_ROLE[stageKey] === role;
    })
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); // oldest first — clear the queue
}

export function createRequest({ companyId, projectId, requestedBy, requestedByRole, requestType, materialId, quantity, category, amount, urgency, reason }) {
  if (requestType === 'material') {
    if (!(quantity > 0)) throw new Error('Quantity must be greater than zero.');
  } else if (!(amount > 0)) {
    throw new Error('Amount must be greater than zero.');
  }
  const finalAmount = requestType === 'material' ? round2(amount) : round2(amount);
  const record = {
    id: uid('req'), company_id: companyId, project_id: projectId, request_type: requestType,
    material_id: requestType === 'material' ? materialId : null,
    quantity: requestType === 'material' ? Number(quantity) : null,
    category: requestType === 'expense' ? category : null,
    amount: finalAmount, urgency: urgency || 'normal', reason: reason || '',
    requested_by: requestedBy, created_at: new Date().toISOString(), status: 'pending',
    stages: computeInitialStages(companyId, requestedByRole, finalAmount)
  };
  writeRecord('requests', record);

  const requester = getUser(requestedBy);
  const project = getProject(projectId);
  logAudit({
    companyId, projectId, userId: requestedBy, action: 'Submitted request',
    details: requestType === 'material' ? `${quantity} × ${getMaterial(materialId)?.name || 'material'}` : `${category} — ${requester?.name || ''}`,
    entityType: 'request', entityId: record.id, amount: finalAmount
  });

  const stageKey = getCurrentStageKey(record);
  if (stageKey) notifyStageActors(record, stageKey, project);

  return record;
}

/**
 * The single entry point for every approval decision: Verify (site manager),
 * Approve, Reject, or Request More Information. Enforces "you cannot act on
 * your own request." On final approval, converts a material request into a
 * real purchase (reusing the existing supplier/inventory/delivery pipeline)
 * or, for an expense, simply closes it out as approved spend.
 */
export function actOnRequest({ requestId, userId, decision, comment, supplierId, unitPrice }) {
  const request = getRequest(requestId);
  if (!request) throw new Error('Request not found.');
  if (request.requested_by === userId) throw new Error('You cannot act on your own request.');

  const stageKey = getCurrentStageKey(request);
  if (!stageKey) throw new Error('This request is not currently awaiting action.');
  const user = getUser(userId);
  if (!user || STAGE_ROLE[stageKey] !== user.role) throw new Error('This request is not awaiting your role.');

  const stage = request.stages[stageKey];
  stage.actor = userId;
  stage.actorName = user.name;
  stage.at = new Date().toISOString();
  stage.comment = comment || '';

  if (supplierId && unitPrice) {
    request.supplier_id = supplierId;
    request.unit_price = round2(unitPrice);
  }

  if (decision === 'reject') {
    stage.status = 'rejected';
    request.status = 'rejected';
    request.rejection_reason = comment || 'Not approved';
    STAGE_ORDER.forEach((key) => { if (request.stages[key].status === 'waiting') request.stages[key].status = 'skipped'; });
    logAudit({ companyId: request.company_id, projectId: request.project_id, userId, action: 'Rejected request', details: comment || '', entityType: 'request', entityId: request.id, amount: request.amount });
    notifyUser(request.requested_by, { type: 'request_rejected', title: 'Request rejected', message: comment || 'Your request was not approved.', projectId: request.project_id, entityType: 'request', entityId: request.id });
  } else if (decision === 'info') {
    stage.status = 'info_requested';
    request.status = 'info_requested';
    request.info_request_note = comment || '';
    logAudit({ companyId: request.company_id, projectId: request.project_id, userId, action: 'Requested more information', details: comment || '', entityType: 'request', entityId: request.id, amount: request.amount });
    notifyUser(request.requested_by, { type: 'info_requested', title: 'More information needed', message: comment || 'Please provide more detail on your request.', projectId: request.project_id, entityType: 'request', entityId: request.id });
  } else {
    stage.status = 'approved';
    logAudit({ companyId: request.company_id, projectId: request.project_id, userId, action: `Approved (${ROLE_STAGE_LABEL[stageKey]})`, details: comment || '', entityType: 'request', entityId: request.id, amount: request.amount });

    const next = nextStageKey(request.stages, stageKey);
    if (next) {
      request.stages[next].status = 'pending';
      request.status = 'pending';
      const project = getProject(request.project_id);
      notifyStageActors(request, next, project);
    } else {
      request.status = 'approved';
      if (request.request_type === 'material') {
        finalizeMaterialPurchase(request, userId);
      }
      notifyUser(request.requested_by, { type: 'request_approved', title: 'Request approved', message: 'Your request has been fully approved.', projectId: request.project_id, entityType: 'request', entityId: request.id });
    }
  }

  writeRecord('requests', request);
  refreshAlerts();
  return request;
}

const ROLE_STAGE_LABEL = { site_manager: 'Site Manager', project_manager: 'Project Manager', owner: 'Owner' };

function finalizeMaterialPurchase(request, approvedBy) {
  if (!request.supplier_id || !request.unit_price) {
    // No supplier was ever picked (shouldn't normally happen) — fall back to the cheapest quote.
    const comparison = getSupplierComparison(request.company_id, request.material_id, request.quantity);
    if (comparison.rows.length) {
      request.supplier_id = comparison.bestSupplierId;
      request.unit_price = comparison.rows[0].unitPrice;
    }
  }
  // IMPORTANT: work out the price baseline BEFORE writing the purchase. The
  // baseline is "the supplier we'd otherwise have used", derived from the most
  // recent purchase of this material — so if the new purchase is written first
  // it becomes its own baseline and every saving silently evaluates to zero.
  const comparison = getSupplierComparison(request.company_id, request.material_id, request.quantity);
  const baselineRow = comparison.rows.find((r) => r.supplierId === comparison.baselineSupplierId);

  const purchase = {
    id: uid('pur'), company_id: request.company_id, project_id: request.project_id, supplier_id: request.supplier_id,
    material_id: request.material_id, quantity: request.quantity, unit_price: request.unit_price,
    total_price: round2(request.unit_price * request.quantity), purchase_date: new Date().toISOString().slice(0, 10),
    approved_by: approvedBy, source_request_id: request.id
  };
  writeRecord('purchases', purchase);

  // Savings ledger (Phase 2 §40): if the approver chose a supplier cheaper than
  // the one the company would otherwise have used, bank the difference. This is
  // what turns "we compared prices" into a hard, reportable rand figure.
  if (baselineRow && request.unit_price < baselineRow.unitPrice) {
    const saved = round2((baselineRow.unitPrice - request.unit_price) * request.quantity);
    const chosen = getSupplier(request.supplier_id);
    const material = getMaterial(request.material_id);
    recordSaving({
      companyId: request.company_id, projectId: request.project_id,
      savingType: 'supplier_comparison',
      description: `${material ? material.name : 'Material'} ${request.quantity} — ${chosen ? chosen.supplier_name : 'supplier'} chosen over ${baselineRow.supplierName}`,
      amount: saved, sourceEntityId: purchase.id
    });
  }
  return purchase;
}

/** Requester adds detail after a "Request More Information" — sends it back to the same stage. */
export function provideMoreInfo(requestId, userId, additionalInfo) {
  const request = getRequest(requestId);
  if (!request) throw new Error('Request not found.');
  if (request.requested_by !== userId) throw new Error('Only the requester can respond.');
  const stageKey = STAGE_ORDER.find((key) => request.stages[key].status === 'info_requested');
  if (!stageKey) throw new Error('This request is not awaiting more information.');
  request.reason = `${request.reason}\n\nAdditional info: ${additionalInfo}`;
  request.stages[stageKey].status = 'pending';
  request.status = 'pending';
  writeRecord('requests', request);
  logAudit({ companyId: request.company_id, projectId: request.project_id, userId, action: 'Provided more information', details: additionalInfo, entityType: 'request', entityId: request.id });
  notifyStageActors(request, stageKey, getProject(request.project_id));
  return request;
}

/** Ordered timeline for the Request Detail / Approval History screen. */
export function getApprovalTimeline(request) {
  const requester = getUser(request.requested_by);
  const timeline = [{ label: 'Submitted', actorName: requester?.name || 'Unknown', at: request.created_at, status: 'submitted', comment: request.reason }];
  STAGE_ORDER.forEach((key) => {
    const stage = request.stages[key];
    if (!stage.required) return;
    timeline.push({ label: ROLE_STAGE_LABEL[key], actorName: stage.actorName || null, at: stage.at || null, status: stage.status, comment: stage.comment || null });
  });
  return timeline;
}

// ---------------------------------------------------------------------------
// Notifications — role-aware, generated on key events
// ---------------------------------------------------------------------------

function notifyUser(userId, { type, title, message, projectId, entityType, entityId }) {
  const user = getUser(userId);
  if (!user) return;
  const record = {
    id: uid('notif'), company_id: user.company_id, user_id: userId, type, title, message,
    project_id: projectId || null, entity_type: entityType || null, entity_id: entityId || null,
    read: false, created_at: new Date().toISOString()
  };
  writeRecord('notifications', record);
}

function notifyRoleHolders(companyId, roles, payload) {
  listUsers(companyId).filter((u) => roles.includes(u.role) && u.status !== 'inactive').forEach((u) => notifyUser(u.id, payload));
}

function notifyProjectManagers(companyId, projectId, payload) {
  listUsers(companyId).filter((u) => u.role === ROLES.PROJECT_MANAGER && (u.manages_projects || []).includes(projectId)).forEach((u) => notifyUser(u.id, payload));
}

function notifyStageActors(request, stageKey, project) {
  const role = STAGE_ROLE[stageKey];
  const companyId = request.company_id;
  const title = 'Approval required';
  const materialOrCategory = request.request_type === 'material' ? getMaterial(request.material_id)?.name : request.category;
  const message = `${materialOrCategory || 'Request'} — ${project ? project.project_name : ''} needs your review.`;
  const payload = { type: 'approval_required', title, message, projectId: request.project_id, entityType: 'request', entityId: request.id };

  if (role === ROLES.OWNER) {
    notifyRoleHolders(companyId, [ROLES.OWNER], payload);
  } else if (role === ROLES.PROJECT_MANAGER) {
    notifyProjectManagers(companyId, request.project_id, payload);
  } else if (role === ROLES.SITE_MANAGER) {
    listUsers(companyId).filter((u) => u.role === ROLES.SITE_MANAGER && (u.assigned_projects || []).includes(request.project_id)).forEach((u) => notifyUser(u.id, payload));
  }
}

export function listNotifications(userId, { unreadOnly = false } = {}) {
  return getCollection('notifications')
    .filter((n) => n.user_id === userId)
    .filter((n) => !unreadOnly || !n.read)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export function getUnreadNotificationCount(userId) {
  return getCollection('notifications').filter((n) => n.user_id === userId && !n.read).length;
}

export function markNotificationRead(id) {
  const list = getCollection('notifications');
  const n = list.find((x) => x.id === id);
  if (n) { n.read = true; setCollection('notifications', list); }
}

export function markAllNotificationsRead(userId) {
  const list = getCollection('notifications');
  list.filter((n) => n.user_id === userId).forEach((n) => { n.read = true; });
  setCollection('notifications', list);
}

// ---------------------------------------------------------------------------
// Audit log — who did what, when, on which project
// ---------------------------------------------------------------------------

export function logAudit({ companyId, projectId, userId, action, details, entityType, entityId, amount }) {
  if (!companyId) return;
  const user = getUser(userId);
  const record = {
    id: uid('audit'), company_id: companyId, project_id: projectId || null, user_id: userId || null,
    user_name: user ? user.name : 'System', action, details: details || '', entity_type: entityType || null,
    entity_id: entityId || null, amount: amount ?? null, created_at: new Date().toISOString()
  };
  writeRecord('auditLog', record);
  return record;
}

export function listAuditLog(companyId, { projectId, userId, category, sinceDays } = {}) {
  let rows = getCollection('auditLog').filter((a) => a.company_id === companyId);
  if (projectId) rows = rows.filter((a) => a.project_id === projectId);
  if (userId) rows = rows.filter((a) => a.user_id === userId);
  if (category) rows = rows.filter((a) => a.entity_type === category);
  if (sinceDays) {
    const cutoff = Date.now() - sinceDays * 86400 * 1000;
    rows = rows.filter((a) => new Date(a.created_at).getTime() >= cutoff);
  }
  return rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// ---------------------------------------------------------------------------
// Supplier price comparison
// ---------------------------------------------------------------------------

export function getSupplierComparison(companyId, materialId, quantity) {
  const quotes = getCollection('supplierPrices').filter((sp) => sp.material_id === materialId);
  const suppliers = listSuppliers(companyId);
  const rows = quotes
    .map((q) => {
      const supplier = suppliers.find((s) => s.id === q.supplier_id);
      if (!supplier) return null;
      return {
        supplierId: q.supplier_id,
        supplierName: supplier.supplier_name,
        unitPrice: q.price,
        previousPrice: q.previous_price,
        total: round2(q.price * quantity)
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.unitPrice - b.unitPrice);

  if (!rows.length) return { rows: [], bestSupplierId: null, potentialSaving: 0 };

  const best = rows[0];
  const recentPurchase = getCollection('purchases')
    .filter((p) => p.company_id === companyId && p.material_id === materialId)
    .sort((a, b) => new Date(b.purchase_date) - new Date(a.purchase_date))[0];
  const baselineRow = (recentPurchase && rows.find((r) => r.supplierId === recentPurchase.supplier_id))
    || rows[rows.length - 1];

  const potentialSaving = round2(Math.max(0, (baselineRow.unitPrice - best.unitPrice) * quantity));
  return { rows, bestSupplierId: best.supplierId, baselineSupplierId: baselineRow.supplierId, potentialSaving };
}

// ---------------------------------------------------------------------------
// Fuel consumption series
// ---------------------------------------------------------------------------

export function getFuelConsumptionSeries(companyId, vehicleId) {
  const vehicle = getVehicle(vehicleId);
  if (!vehicle) return [];
  const txs = getCollection('fuelTransactions')
    .filter((f) => f.company_id === companyId && f.vehicle_id === vehicleId)
    .sort((a, b) => new Date(a.transaction_date) - new Date(b.transaction_date));

  const usesHours = vehicle.baseline_l_per_hr != null;
  const baseline = usesHours ? vehicle.baseline_l_per_hr : vehicle.baseline_km_per_l;

  const series = [];
  for (let i = 1; i < txs.length; i++) {
    const prev = txs[i - 1];
    const cur = txs[i];
    let rate = null, delta = null, anomalous = false, pctWorse = 0;
    if (usesHours) {
      delta = round2((cur.hour_meter ?? 0) - (prev.hour_meter ?? 0));
      if (delta > 0) {
        rate = round2(cur.litres / delta);
        pctWorse = round2(((rate - baseline) / baseline) * 100);
        anomalous = pctWorse >= 15;
      }
    } else {
      delta = round2((cur.odometer_reading ?? 0) - (prev.odometer_reading ?? 0));
      if (delta > 0) {
        rate = round2(delta / cur.litres);
        pctWorse = round2(((baseline - rate) / baseline) * 100);
        anomalous = pctWorse >= 15;
      }
    }
    series.push({ transaction: cur, previous: prev, delta, rate, unit: usesHours ? 'L/hr' : 'km/L', baseline, pctWorse, anomalous, usesHours });
  }
  return series.reverse();
}

// ---------------------------------------------------------------------------
// Anomaly-detection / Money Leaks engine
// ---------------------------------------------------------------------------

function upsertLiveAlert(existingList, candidate) {
  const prior = existingList.find((a) => a.id === candidate.id);
  if (prior) return { ...candidate, status: prior.status, created_at: prior.created_at };
  return { ...candidate, status: 'open', created_at: new Date().toISOString() };
}

export function createManualAlert({ companyId, projectId, alertType, severity, message, amount, reportedBy }) {
  const record = {
    id: uid('alertm'), company_id: companyId, project_id: projectId || null, alert_type: alertType,
    severity: severity || 'warning', message, amount: amount || null, status: 'open',
    reported_by: reportedBy || null, created_at: new Date().toISOString()
  };
  return writeRecord('alerts', record);
}

export function refreshAlerts() {
  const allAlerts = getCollection('alerts');
  const seeded = allAlerts.filter((a) => a.id.startsWith('alert_seed_'));
  const manual = allAlerts.filter((a) => a.id.startsWith('alertm_'));
  const live = [];
  const newlyCreated = [];

  const companies = getCollection('companies');
  companies.forEach((company) => {
    const companyId = company.id;

    listInventory(companyId).forEach((row) => {
      if (Math.abs(row.variance) < 1) return;
      const material = getMaterial(row.material_id);
      const project = getProject(row.project_id);
      if (!material || !project) return;
      const unitPrice = latestUnitPrice(companyId, row.material_id) || 0;
      const amount = round2(Math.abs(row.variance) * unitPrice);
      const magnitudePct = row.expected ? Math.abs(row.variance) / Math.max(row.expected, 1) * 100 : 100;
      const severity = (Math.abs(row.variance) >= 20 || magnitudePct >= 15) ? 'critical' : 'warning';
      const id = `alert_inv_${row.id}`;
      const direction = row.variance < 0 ? 'unaccounted for' : 'more than expected — recount recommended';
      const candidate = {
        id, company_id: companyId, project_id: row.project_id, alert_type: 'inventory_variance', severity,
        message: `${Math.abs(row.variance)} ${material.unit} of ${material.name} ${direction} at ${project.project_name}.`,
        amount, meta: { inventoryId: row.id }
      };
      if (!allAlerts.find((a) => a.id === id)) newlyCreated.push(candidate);
      live.push(upsertLiveAlert(allAlerts, candidate));
    });

    listMaterials(companyId).forEach((material) => {
      const purchases = getCollection('purchases')
        .filter((p) => p.company_id === companyId && p.material_id === material.id)
        .sort((a, b) => new Date(a.purchase_date) - new Date(b.purchase_date));
      if (purchases.length < 2) return;
      const latest = purchases[purchases.length - 1];
      const history = purchases.slice(0, -1);
      const avg = round2(history.reduce((s, p) => s + p.unit_price, 0) / history.length);
      const pct = pctAbove(latest.unit_price, avg);
      if (pct < 10) return;
      const project = getProject(latest.project_id);
      const amount = round2((latest.unit_price - avg) * latest.quantity);
      const id = `alert_price_${latest.id}`;
      const candidate = {
        id, company_id: companyId, project_id: latest.project_id, alert_type: 'price_variance',
        severity: pct >= 20 ? 'critical' : 'warning',
        message: `${material.name} price is ${pct}% above the historical average (R${avg} → R${latest.unit_price})${project ? ' — ' + project.project_name : ''}.`,
        amount, meta: { purchaseId: latest.id }
      };
      if (!allAlerts.find((a) => a.id === id)) newlyCreated.push(candidate);
      live.push(upsertLiveAlert(allAlerts, candidate));
    });

    listDeliveries(companyId).forEach((delivery) => {
      if (!delivery.shortage_quantity) return;
      const purchase = getPurchase(delivery.purchase_id);
      if (!purchase || purchase.company_id !== companyId) return;
      const material = getMaterial(purchase.material_id);
      const project = getProject(purchase.project_id);
      const pctShort = round2((delivery.shortage_quantity / delivery.expected_quantity) * 100);
      const amount = round2(delivery.shortage_quantity * purchase.unit_price);
      const id = `alert_delivery_${delivery.id}`;
      const candidate = {
        id, company_id: companyId, project_id: purchase.project_id, alert_type: 'delivery_shortage',
        severity: pctShort >= 10 ? 'critical' : 'warning',
        message: `${delivery.shortage_quantity} ${material ? material.unit : 'units'} of ${material ? material.name : 'material'} missing from a delivery${project ? ' at ' + project.project_name : ''}.`,
        amount, meta: { deliveryId: delivery.id }
      };
      if (!allAlerts.find((a) => a.id === id)) newlyCreated.push(candidate);
      live.push(upsertLiveAlert(allAlerts, candidate));
    });

    listVehicles(companyId).forEach((vehicle) => {
      const series = getFuelConsumptionSeries(companyId, vehicle.id);
      const flagged = series.find((s) => s.anomalous);
      if (!flagged) return;
      const project = getProject(flagged.transaction.project_id);
      const id = `alert_fuel_${flagged.transaction.id}`;
      const description = flagged.usesHours
        ? `${flagged.rate} L/hr vs a normal ${flagged.baseline} L/hr`
        : `${flagged.rate} km/L vs a normal ${flagged.baseline} km/L`;
      const excessLitres = flagged.usesHours
        ? round2(flagged.transaction.litres - flagged.delta * flagged.baseline)
        : round2(flagged.transaction.litres - (flagged.delta / flagged.baseline));
      const amount = round2(Math.max(0, excessLitres) * flagged.transaction.price_per_litre);
      const candidate = {
        id, company_id: companyId, project_id: flagged.transaction.project_id, alert_type: 'fuel_anomaly',
        severity: flagged.pctWorse >= 40 ? 'critical' : 'warning',
        message: `${vehicle.vehicle_name} fuel consumption is unusually high — ${description}${project ? ' (' + project.project_name + ')' : ''}.`,
        amount, meta: { fuelTransactionId: flagged.transaction.id, vehicleId: vehicle.id }
      };
      if (!allAlerts.find((a) => a.id === id)) newlyCreated.push(candidate);
      live.push(upsertLiveAlert(allAlerts, candidate));
    });

    // 5) Budget threshold breaches (Phase 2 §3). Deliberately carries NO rand
    //    amount: a budget overrun is a signal to act, not money suspected
    //    missing, so it must not inflate the "money at risk" figure.
    listProjects(companyId).forEach((project) => {
      const fin = computeProjectFinancials(companyId, project.id);
      if (!fin || fin.budgetStatus.key === 'ok') return;
      const id = `alert_budget_${project.id}_${fin.budgetStatus.key}`;
      const candidate = {
        id, company_id: companyId, project_id: project.id, alert_type: 'budget_variance',
        severity: (fin.budgetStatus.key === 'over' || fin.budgetStatus.key === 'critical') ? 'critical' : 'warning',
        message: `${project.project_name} has used ${fin.spendPct}% of its budget — ${fin.budgetStatus.label}.`,
        amount: null, meta: { projectId: project.id, spendPct: fin.spendPct }
      };
      if (!allAlerts.find((a) => a.id === id)) newlyCreated.push(candidate);
      live.push(upsertLiveAlert(allAlerts, candidate));
    });
  });

  const merged = [...seeded, ...manual, ...live];
  setCollection('alerts', merged);

  // Notify Owner + the relevant Project Manager about genuinely new leaks only.
  newlyCreated.forEach((alert) => {
    notifyRoleHolders(alert.company_id, [ROLES.OWNER], { type: 'money_leak', title: 'New money leak detected', message: alert.message, projectId: alert.project_id, entityType: 'alert', entityId: alert.id });
    if (alert.project_id) notifyProjectManagers(alert.company_id, alert.project_id, { type: 'money_leak', title: 'New money leak detected', message: alert.message, projectId: alert.project_id, entityType: 'alert', entityId: alert.id });
  });

  return merged;
}

function latestUnitPrice(companyId, materialId) {
  const purchases = getCollection('purchases')
    .filter((p) => p.company_id === companyId && p.material_id === materialId)
    .sort((a, b) => new Date(b.purchase_date) - new Date(a.purchase_date));
  return purchases.length ? purchases[0].unit_price : null;
}

// ---------------------------------------------------------------------------
// Company / project financial aggregates
// ---------------------------------------------------------------------------

function inSameMonth(dateStr, ref) {
  const d = new Date(dateStr);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

/** "WHERE IS OUR MONEY GOING?" — company-wide monthly spend by category. */
export function computeCompanySpending(companyId, refDate = new Date()) {
  const purchases = getCollection('purchases').filter((p) => p.company_id === companyId && inSameMonth(p.purchase_date, refDate));
  const fuelTx = getCollection('fuelTransactions').filter((f) => f.company_id === companyId && inSameMonth(f.transaction_date, refDate));
  const expenseRequests = getCollection('requests').filter((r) =>
    r.company_id === companyId && r.request_type === 'expense' && r.status === 'approved' && inSameMonth(r.created_at, refDate));

  const materialSpend = round2(purchases.reduce((s, p) => s + p.total_price, 0));
  const fuelFromRequests = round2(expenseRequests.filter((r) => r.category === 'Fuel').reduce((s, r) => s + r.amount, 0));
  const fuelSpend = round2(fuelTx.reduce((s, f) => s + f.total_cost, 0) + fuelFromRequests);
  const otherSpend = round2(expenseRequests.filter((r) => r.category !== 'Fuel').reduce((s, r) => s + r.amount, 0));
  const totalSpend = round2(materialSpend + fuelSpend + otherSpend);

  return { totalSpend, materialSpend, fuelSpend, otherSpend, numberOfPurchases: purchases.length };
}

/** Money leaks aggregated across the whole company, grouped by category. */
export function computeMoneyLeaksBreakdown(companyId, { projectId } = {}) {
  const open = listAlerts(companyId, { projectId }).filter((a) => a.status !== 'resolved');
  const byCategory = { fuel_anomaly: 0, price_variance: 0, inventory_variance: 0, delivery_shortage: 0, budget_variance: 0 };
  open.forEach((a) => { byCategory[a.alert_type] = round2((byCategory[a.alert_type] || 0) + (a.amount || 0)); });
  const total = round2(Object.values(byCategory).reduce((s, v) => s + v, 0));
  return {
    total,
    fuel: byCategory.fuel_anomaly, materials: byCategory.price_variance,
    inventory: byCategory.inventory_variance, deliveries: byCategory.delivery_shortage,
    budget: byCategory.budget_variance, alerts: open
  };
}

const HEALTH = {
  healthy: { key: 'healthy', label: 'Healthy', icon: '🟢' },
  watch: { key: 'watch', label: 'Watch', icon: '🟠' },
  action: { key: 'action', label: 'Action Required', icon: '🔴' }
};

/**
 * Project health (🟢/🟠/🔴). Driven primarily by the FORECAST rather than
 * money already spent — a project can be comfortably under budget today and
 * still be heading for an overrun, which is exactly the case an owner needs
 * flagged early.
 *
 * This is the single source of truth for health: the executive dashboard, the
 * projects list and the project detail screen all badge from it, so a project
 * can never appear "On Track" in one place and "forecast over budget" in
 * another. Budget-variance alerts are excluded from the critical-alert count
 * because budget pressure is already represented by the forecast itself.
 */
export function computeProjectHealth(companyId, project) {
  if (!project) return HEALTH.healthy;
  const fin = computeProjectFinancials(companyId, project.id);
  if (!fin) return HEALTH.healthy;

  const criticalCount = listAlerts(companyId, { projectId: project.id })
    .filter((a) => a.status !== 'resolved' && a.alert_type !== 'budget_variance' && a.severity === 'critical').length;

  const overrunPct = (fin.buffer < 0 && fin.budget) ? Math.abs((fin.buffer / fin.budget) * 100) : 0;

  if (overrunPct >= 10 || fin.budgetStatus.key === 'over' || fin.budgetStatus.key === 'critical' || criticalCount >= 2) {
    return HEALTH.action;
  }
  if (fin.buffer < 0 || fin.exposurePct >= 95 || fin.budgetStatus.key === 'watch' || fin.budgetStatus.key === 'high' || criticalCount >= 1) {
    return HEALTH.watch;
  }
  return HEALTH.healthy;
}

/** The Owner's "ALL PROJECTS" overview row: budget/spent/remaining/spend%/leakage/status. */
export function computeProjectOverview(companyId, projectId) {
  const project = getProject(projectId);
  if (!project) return null;
  const spent = project.total_spent_to_date || 0;
  const remaining = round2(project.budget - spent);
  const spendPct = project.budget ? round2((spent / project.budget) * 100) : 0;
  const leaks = computeMoneyLeaksBreakdown(companyId, { projectId });
  const health = computeProjectHealth(companyId, project);
  const manager = project.manager_id ? getUser(project.manager_id) : null;
  return { project, manager, budget: project.budget, spent, remaining, spendPct, potentialLeakage: leaks.total, health };
}

/** Itemized (materials + fuel) drill-down BuildGuard actually tracks for a project. */
export function computeProjectCostSummary(companyId, projectId) {
  const project = getProject(projectId);
  const purchases = getCollection('purchases').filter((p) => p.company_id === companyId && p.project_id === projectId);
  const fuel = getCollection('fuelTransactions').filter((f) => f.company_id === companyId && f.project_id === projectId);
  const materialSpend = round2(purchases.reduce((s, p) => s + p.total_price, 0));
  const fuelSpend = round2(fuel.reduce((s, f) => s + f.total_cost, 0));
  const totalTracked = round2(materialSpend + fuelSpend);
  const inventory = listInventory(companyId, { projectId });
  const alerts = listAlerts(companyId, { projectId }).filter((a) => a.status !== 'resolved');
  const overview = computeProjectOverview(companyId, projectId);

  return {
    project, materialSpend, fuelSpend, totalTracked, purchaseCount: purchases.length,
    inventory, alerts, overview
  };
}

/** Owner's "COMPANY HEALTH" roll-up across every project. */
export function computeCompanyHealth(companyId) {
  const projects = listProjects(companyId);
  const counts = { healthy: 0, watch: 0, action: 0 };
  const items = projects.map((p) => {
    const overview = computeProjectOverview(companyId, p.id);
    counts[overview.health.key] += 1;
    return overview;
  });
  return { counts, projects: items };
}

// ===========================================================================
// PHASE 2 — FINANCIAL INTELLIGENCE LAYER
//
// The four questions this section exists to answer:
//   1. WHERE IS THE MONEY GOING?      → spend trend, top expenses/suppliers
//   2. WHERE IS THE MONEY AT RISK?    → money-at-risk, budget status, forecast
//   3. WHERE CAN WE SAVE MONEY?       → savings ledger, supplier intelligence
//   4. WHAT DOES MANAGEMENT DO NEXT?  → daily briefing, approval performance
// ===========================================================================

const DAY_MS = 86400 * 1000;
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY_MS);

// ---------------------------------------------------------------------------
// COMMITTED vs ACTUAL vs FORECAST  (Phase 2 §2 and §4)
// ---------------------------------------------------------------------------

/**
 * Approved purchases that have NOT yet been delivered — money the company is
 * contractually on the hook for but hasn't paid out. This is the number most
 * spreadsheets miss, and it's why an owner can feel "under budget" right up
 * until the invoices land.
 */
function committedSpendForProject(companyId, projectId) {
  return round2(
    getCollection('purchases')
      .filter((p) => p.company_id === companyId && p.project_id === projectId)
      .filter((p) => !getDeliveryForPurchase(p.id))
      .reduce((s, p) => s + p.total_price, 0)
  );
}

/**
 * The Owner's TRUE FINANCIAL EXPOSURE for one project (Phase 2 §2/§4).
 *
 *   actual    — spend to date, from the company's own books (project.total_spent_to_date).
 *               BuildGuard itemises materials + fuel within this; labour and
 *               subcontracts are part of the figure but not yet itemised here.
 *   committed — approved purchases awaiting delivery (calculated live, above).
 *   forecast  — projected ADDITIONAL spend over the remaining project duration,
 *               using a straight-line burn rate. Commitments are subtracted so
 *               they are never counted twice.
 *
 * The forecast is a deliberately simple, explainable straight-line projection —
 * NOT an accounting forecast, and every screen that shows it must label it
 * "Management Estimate". Real construction spend is S-curved rather than
 * linear, so this will overstate on front-loaded projects; that trade-off is
 * accepted here in favour of a number a site owner can actually reason about.
 */
export function computeProjectFinancials(companyId, projectId, refDate = new Date()) {
  const project = getProject(projectId);
  if (!project) return null;

  const budget = project.budget || 0;
  const actual = project.total_spent_to_date || 0;
  const committed = committedSpendForProject(companyId, projectId);

  const totalDays = Math.max(1, daysBetween(project.start_date, project.end_date));
  const elapsedDays = Math.min(totalDays, Math.max(1, daysBetween(project.start_date, refDate)));
  const remainingDays = Math.max(0, totalDays - elapsedDays);

  const burnPerDay = actual / elapsedDays;
  const projectedRemaining = round2(burnPerDay * remainingDays);
  // Commitments already cover part of that future spend — don't double count.
  const forecast = round2(Math.max(0, projectedRemaining - committed));

  const expectedTotal = round2(actual + committed + forecast);
  const buffer = round2(budget - expectedTotal);
  const remainingBudget = round2(budget - actual);

  const spendPct = budget ? round2((actual / budget) * 100) : 0;
  const exposurePct = budget ? round2((expectedTotal / budget) * 100) : 0;

  return {
    project, budget, actual, committed, forecast, expectedTotal, buffer, remainingBudget,
    spendPct, exposurePct,
    forecastVariance: buffer, // negative = expected to exceed budget
    budgetStatus: computeBudgetStatus(spendPct, companyId),
    exposureStatus: computeBudgetStatus(exposurePct, companyId),
    totalDays, elapsedDays, remainingDays,
    burnPerDay: round2(burnPerDay),
    pctTimeElapsed: round2((elapsedDays / totalDays) * 100)
  };
}

/** Company-wide roll-up of the same three-way exposure picture. */
export function computeCompanyFinancials(companyId) {
  const projects = listProjects(companyId);
  const per = projects.map((p) => computeProjectFinancials(companyId, p.id)).filter(Boolean);
  const sum = (key) => round2(per.reduce((s, f) => s + f[key], 0));
  const totalBudget = sum('budget');
  const expectedTotal = sum('expectedTotal');
  return {
    projects: per,
    totalBudget,
    totalContractValue: round2(projects.reduce((s, p) => s + (p.contract_value || 0), 0)),
    actual: sum('actual'),
    committed: sum('committed'),
    forecast: sum('forecast'),
    expectedTotal,
    remainingBudget: sum('remainingBudget'),
    buffer: round2(totalBudget - expectedTotal),
    exposurePct: totalBudget ? round2((expectedTotal / totalBudget) * 100) : 0
  };
}

/**
 * Management-estimate profitability (Phase 2 §25). Explicitly NOT audited
 * accounting — margin here is contract value less expected cost.
 */
export function computeProjectProfitability(companyId, projectId) {
  const fin = computeProjectFinancials(companyId, projectId);
  if (!fin) return null;
  const contractValue = fin.project.contract_value || 0;
  const currentMargin = round2(contractValue - fin.actual);
  const forecastMargin = round2(contractValue - fin.expectedTotal);
  return {
    ...fin,
    contractValue,
    currentMargin,
    forecastMargin,
    currentMarginPct: contractValue ? round2((currentMargin / contractValue) * 100) : 0,
    forecastMarginPct: contractValue ? round2((forecastMargin / contractValue) * 100) : 0
  };
}

// ---------------------------------------------------------------------------
// SAVINGS LEDGER  (Phase 2 §40)
// ---------------------------------------------------------------------------

export const SAVING_TYPES = {
  supplier_comparison: { label: 'Supplier comparison', icon: '🤝' },
  negotiation: { label: 'Price negotiation', icon: '🤔' },
  duplicate_prevented: { label: 'Duplicate purchase prevented', icon: '🛑' },
  bulk_discount: { label: 'Bulk / consolidated order', icon: '📦' }
};

export function recordSaving({ companyId, projectId, savingType, description, amount, sourceEntityId }) {
  if (!(amount > 0)) return null;
  const record = {
    id: uid('sav'), company_id: companyId, project_id: projectId || null,
    saving_type: savingType, description: description || '', amount: round2(amount),
    source_entity_id: sourceEntityId || null, created_at: new Date().toISOString()
  };
  return writeRecord('savings', record);
}

export function listSavings(companyId, { projectId, sinceDays, savingType } = {}) {
  let rows = getCollection('savings').filter((s) => s.company_id === companyId);
  if (projectId) rows = rows.filter((s) => s.project_id === projectId);
  if (savingType) rows = rows.filter((s) => s.saving_type === savingType);
  if (sinceDays) {
    const cutoff = Date.now() - sinceDays * DAY_MS;
    rows = rows.filter((s) => new Date(s.created_at).getTime() >= cutoff);
  }
  return rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export function computeSavingsSummary(companyId, refDate = new Date()) {
  const all = listSavings(companyId);
  const thisMonth = all.filter((s) => inSameMonth(s.created_at, refDate));
  const prevRef = new Date(refDate.getFullYear(), refDate.getMonth() - 1, 1);
  const lastMonth = all.filter((s) => inSameMonth(s.created_at, prevRef));
  const ytd = all.filter((s) => new Date(s.created_at).getFullYear() === refDate.getFullYear());

  const byType = {};
  Object.keys(SAVING_TYPES).forEach((k) => { byType[k] = 0; });
  thisMonth.forEach((s) => { byType[s.saving_type] = round2((byType[s.saving_type] || 0) + s.amount); });

  const total = (rows) => round2(rows.reduce((s, r) => s + r.amount, 0));
  return {
    thisMonth: total(thisMonth), lastMonth: total(lastMonth), ytd: total(ytd),
    allTime: total(all), byType, items: thisMonth, count: thisMonth.length
  };
}

// ---------------------------------------------------------------------------
// MONEY AT RISK  (Phase 2 §41)
// Deliberately worded as "potential variance requiring investigation" — never
// as confirmed loss, and never as an accusation against a named person.
// ---------------------------------------------------------------------------

export function computeMoneyAtRisk(companyId, { projectId } = {}) {
  const leaks = computeMoneyLeaksBreakdown(companyId, { projectId });
  return {
    total: leaks.total,
    categories: [
      { key: 'inventory', label: 'Potential inventory variance', amount: leaks.inventory, route: '#/moneyleaks/inventory' },
      { key: 'fuel', label: 'Fuel consumption variance', amount: leaks.fuel, route: '#/moneyleaks/fuel' },
      { key: 'deliveries', label: 'Delivery variance', amount: leaks.deliveries, route: '#/moneyleaks/deliveries' },
      { key: 'materials', label: 'Material price variance', amount: leaks.materials, route: '#/moneyleaks/materials' }
    ].filter((c) => c.amount > 0),
    alerts: leaks.alerts
  };
}

// ---------------------------------------------------------------------------
// APPROVAL PERFORMANCE  (Phase 2 §31)
// ---------------------------------------------------------------------------

export function computeApprovalPerformance(companyId, { sinceDays = 30 } = {}) {
  const cutoff = Date.now() - sinceDays * DAY_MS;
  const all = getCollection('requests').filter((r) => r.company_id === companyId);
  const recent = all.filter((r) => new Date(r.created_at).getTime() >= cutoff);

  const approved = recent.filter((r) => r.status === 'approved');
  const rejected = recent.filter((r) => r.status === 'rejected');
  const returned = recent.filter((r) => r.status === 'info_requested');
  const pending = all.filter((r) => r.status === 'pending' || r.status === 'info_requested');

  // Time from submission to the last recorded approval stage.
  const durations = approved.map((r) => {
    const times = Object.values(r.stages || {})
      .filter((s) => s.at).map((s) => new Date(s.at).getTime());
    if (!times.length) return null;
    return Math.max(...times) - new Date(r.created_at).getTime();
  }).filter((d) => d != null && d >= 0);

  const avgMs = durations.length ? durations.reduce((s, d) => s + d, 0) / durations.length : 0;
  const oldest = pending
    .map((r) => ({ request: r, ageMs: Date.now() - new Date(r.created_at).getTime() }))
    .sort((a, b) => b.ageMs - a.ageMs)[0] || null;

  return {
    avgApprovalMs: avgMs,
    approvedCount: approved.length,
    rejectedCount: rejected.length,
    returnedCount: returned.length,
    pendingCount: pending.length,
    pendingValue: round2(pending.reduce((s, r) => s + (r.amount || 0), 0)),
    oldestPending: oldest
  };
}

// ---------------------------------------------------------------------------
// COST TREND ANALYSIS  (Phase 2 §5)
// ---------------------------------------------------------------------------

/** Spend bucketed over a window. Granularity adapts to the range requested. */
export function computeSpendTrend(companyId, { days = 30, projectId = null } = {}) {
  const granularity = days <= 14 ? 'day' : days <= 92 ? 'week' : 'month';
  const now = new Date();
  const start = new Date(now.getTime() - days * DAY_MS);

  const purchases = getCollection('purchases')
    .filter((p) => p.company_id === companyId && (!projectId || p.project_id === projectId))
    .filter((p) => new Date(p.purchase_date) >= start)
    .map((p) => ({ date: p.purchase_date, amount: p.total_price, cat: 'materials' }));
  const fuel = getCollection('fuelTransactions')
    .filter((f) => f.company_id === companyId && (!projectId || f.project_id === projectId))
    .filter((f) => new Date(f.transaction_date) >= start)
    .map((f) => ({ date: f.transaction_date, amount: f.total_cost, cat: 'fuel' }));
  const expenses = getCollection('requests')
    .filter((r) => r.company_id === companyId && r.request_type === 'expense' && r.status === 'approved')
    .filter((r) => (!projectId || r.project_id === projectId) && new Date(r.created_at) >= start)
    .map((r) => ({ date: r.created_at, amount: r.amount, cat: r.category === 'Fuel' ? 'fuel' : 'other' }));

  const events = [...purchases, ...fuel, ...expenses];
  const buckets = new Map();

  function keyFor(dateStr) {
    const d = new Date(dateStr);
    if (granularity === 'day') return d.toISOString().slice(0, 10);
    if (granularity === 'month') return d.toISOString().slice(0, 7);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    return weekStart.toISOString().slice(0, 10);
  }

  events.forEach((e) => {
    const k = keyFor(e.date);
    if (!buckets.has(k)) buckets.set(k, { key: k, materials: 0, fuel: 0, other: 0, total: 0 });
    const b = buckets.get(k);
    b[e.cat] = round2(b[e.cat] + e.amount);
    b.total = round2(b.total + e.amount);
  });

  const rows = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
  return { granularity, rows, max: Math.max(1, ...rows.map((r) => r.total)) };
}

/** Month-on-month comparison for the headline categories (Phase 2 §39). */
export function computeMonthComparison(companyId, refDate = new Date()) {
  const current = computeCompanySpending(companyId, refDate);
  const prevRef = new Date(refDate.getFullYear(), refDate.getMonth() - 1, 1);
  const previous = computeCompanySpending(companyId, prevRef);
  const delta = (now, before) => ({
    now, before,
    change: round2(now - before),
    pct: before ? round2(((now - before) / before) * 100) : (now > 0 ? 100 : 0)
  });
  return {
    total: delta(current.totalSpend, previous.totalSpend),
    materials: delta(current.materialSpend, previous.materialSpend),
    fuel: delta(current.fuelSpend, previous.fuelSpend),
    other: delta(current.otherSpend, previous.otherSpend)
  };
}

// ---------------------------------------------------------------------------
// TOP SPENDING / SUPPLIER CONCENTRATION  (Phase 2 §28, §29, §30)
// ---------------------------------------------------------------------------

export function computeTopExpenses(companyId, { limit = 10, refDate = new Date() } = {}) {
  const purchases = getCollection('purchases')
    .filter((p) => p.company_id === companyId && inSameMonth(p.purchase_date, refDate))
    .map((p) => ({
      date: p.purchase_date, amount: p.total_price, projectId: p.project_id,
      category: getMaterial(p.material_id)?.name || 'Material',
      supplier: getSupplier(p.supplier_id)?.supplier_name || '—'
    }));
  const fuel = getCollection('fuelTransactions')
    .filter((f) => f.company_id === companyId && inSameMonth(f.transaction_date, refDate))
    .map((f) => ({
      date: f.transaction_date, amount: f.total_cost, projectId: f.project_id,
      category: 'Fuel', supplier: f.supplier || '—'
    }));
  const expenses = getCollection('requests')
    .filter((r) => r.company_id === companyId && r.request_type === 'expense' && r.status === 'approved' && inSameMonth(r.created_at, refDate))
    .map((r) => ({ date: r.created_at, amount: r.amount, projectId: r.project_id, category: r.category, supplier: '—' }));

  const all = [...purchases, ...fuel, ...expenses];
  const grandTotal = round2(all.reduce((s, e) => s + e.amount, 0));
  const rows = all.sort((a, b) => b.amount - a.amount).slice(0, limit)
    .map((e) => ({
      ...e,
      projectName: getProject(e.projectId)?.project_name || '—',
      pctOfTotal: grandTotal ? round2((e.amount / grandTotal) * 100) : 0
    }));
  return { rows, grandTotal };
}

export function computeTopSuppliers(companyId, { limit = 10 } = {}) {
  const purchases = getCollection('purchases').filter((p) => p.company_id === companyId);
  const total = round2(purchases.reduce((s, p) => s + p.total_price, 0));
  const bySupplier = {};
  purchases.forEach((p) => { bySupplier[p.supplier_id] = round2((bySupplier[p.supplier_id] || 0) + p.total_price); });

  const rows = Object.entries(bySupplier)
    .map(([supplierId, spend]) => ({
      supplierId,
      supplierName: getSupplier(supplierId)?.supplier_name || 'Unknown supplier',
      spend,
      pctOfTotal: total ? round2((spend / total) * 100) : 0,
      purchaseCount: purchases.filter((p) => p.supplier_id === supplierId).length
    }))
    .sort((a, b) => b.spend - a.spend);

  // Concentration is not automatically a problem — it's a prompt to review
  // supplier dependency, so it's surfaced as information, not an accusation.
  const CONCENTRATION_THRESHOLD = 40;
  const concentrated = rows.filter((r) => r.pctOfTotal >= CONCENTRATION_THRESHOLD);

  return { rows: rows.slice(0, limit), total, concentrated, threshold: CONCENTRATION_THRESHOLD };
}

// ---------------------------------------------------------------------------
// SUPPLIER INTELLIGENCE  (Phase 2 §6, §7)
// ---------------------------------------------------------------------------

/**
 * A supplier performance score out of 100, blended from three sub-scores.
 * The weightings are a deliberate product judgement, not an industry standard:
 * price competitiveness 40%, delivery accuracy 40%, reliability 20%.
 */
export function computeSupplierIntelligence(companyId, supplierId) {
  const supplier = getSupplier(supplierId);
  if (!supplier) return null;

  const purchases = getCollection('purchases').filter((p) => p.company_id === companyId && p.supplier_id === supplierId);
  const totalSpend = round2(purchases.reduce((s, p) => s + p.total_price, 0));
  const purchaseCount = purchases.length;

  // Delivery performance across this supplier's purchases.
  const deliveries = purchases.map((p) => getDeliveryForPurchase(p.id)).filter(Boolean);
  const shortDeliveries = deliveries.filter((d) => d.shortage_quantity > 0);
  const deliveredCount = deliveries.length;
  const shortageRate = deliveredCount ? shortDeliveries.length / deliveredCount : 0;
  const totalShortageValue = round2(shortDeliveries.reduce((s, d) => {
    const p = getPurchase(d.purchase_id);
    return s + (d.shortage_quantity * (p?.unit_price || 0));
  }, 0));

  // Price competitiveness: for each material this supplier quotes, how far
  // above the cheapest available quote are they?
  const quotes = getCollection('supplierPrices').filter((sp) => sp.supplier_id === supplierId);
  let priceScore = 75; // neutral default when there's nothing to compare against
  if (quotes.length) {
    const gaps = quotes.map((q) => {
      const allForMaterial = getCollection('supplierPrices').filter((sp) => sp.material_id === q.material_id);
      const cheapest = Math.min(...allForMaterial.map((sp) => sp.price));
      return cheapest > 0 ? ((q.price - cheapest) / cheapest) * 100 : 0;
    });
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    priceScore = Math.round(Math.max(0, Math.min(100, 100 - avgGap * 4)));
  }

  // Delivery score uses additive smoothing rather than the raw shortage rate.
  // Without it a supplier with a single recorded short delivery scores 0/100 —
  // statistically meaningless from one data point, and exactly the kind of
  // number that would wrongly get a good supplier dropped. The observed rate is
  // blended toward a neutral 15% baseline, with confidence growing as real
  // delivery history accumulates.
  const PRIOR_WEIGHT = 3;
  const PRIOR_RATE = 0.15;
  const smoothedShortageRate = (shortDeliveries.length + PRIOR_WEIGHT * PRIOR_RATE) / (deliveredCount + PRIOR_WEIGHT);
  const deliveryScore = deliveredCount
    ? Math.round(Math.max(0, Math.min(100, 100 - smoothedShortageRate * 100)))
    : 75;
  // Reliability rewards a consistent trading history rather than one-off orders.
  const reliabilityScore = Math.round(Math.max(0, Math.min(100, 60 + Math.min(purchaseCount, 8) * 5)));
  const overall = Math.round(priceScore * 0.4 + deliveryScore * 0.4 + reliabilityScore * 0.2);

  const projectIds = [...new Set(purchases.map((p) => p.project_id))];

  return {
    supplier, totalSpend, purchaseCount,
    averagePurchase: purchaseCount ? round2(totalSpend / purchaseCount) : 0,
    deliveredCount, shortageCount: shortDeliveries.length, totalShortageValue,
    shortageRate: round2(shortageRate * 100),
    scores: { overall, price: priceScore, delivery: deliveryScore, reliability: reliabilityScore },
    projects: projectIds.map((id) => getProject(id)).filter(Boolean),
    quotes
  };
}

export function listSupplierIntelligence(companyId) {
  return listSuppliers(companyId)
    .map((s) => computeSupplierIntelligence(companyId, s.id))
    .filter(Boolean)
    .sort((a, b) => b.totalSpend - a.totalSpend);
}

/** Month-by-month unit-price history for a material (Phase 2 §7). */
export function getMaterialPriceHistory(companyId, materialId) {
  const purchases = getCollection('purchases')
    .filter((p) => p.company_id === companyId && p.material_id === materialId)
    .sort((a, b) => new Date(a.purchase_date) - new Date(b.purchase_date));

  const byMonth = new Map();
  purchases.forEach((p) => {
    const key = String(p.purchase_date).slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, { key, prices: [], supplierIds: new Set() });
    byMonth.get(key).prices.push(p.unit_price);
    byMonth.get(key).supplierIds.add(p.supplier_id);
  });

  const rows = [...byMonth.values()].map((b) => ({
    month: b.key,
    avgPrice: round2(b.prices.reduce((s, v) => s + v, 0) / b.prices.length),
    minPrice: Math.min(...b.prices),
    maxPrice: Math.max(...b.prices),
    suppliers: [...b.supplierIds].map((id) => getSupplier(id)?.supplier_name).filter(Boolean)
  }));

  const first = rows[0], last = rows[rows.length - 1];
  return {
    material: getMaterial(materialId),
    rows,
    max: Math.max(1, ...rows.map((r) => r.avgPrice)),
    min: Math.min(...rows.map((r) => r.avgPrice), Infinity),
    trendPct: (first && last && first.avgPrice) ? round2(((last.avgPrice - first.avgPrice) / first.avgPrice) * 100) : 0
  };
}

// ---------------------------------------------------------------------------
// BUILDGUARD IMPACT + DAILY BRIEFING  (Phase 2 §36, §54)
// ---------------------------------------------------------------------------

export function computeBuildGuardImpact(companyId, refDate = new Date()) {
  const savings = computeSavingsSummary(companyId, refDate);
  const atRisk = computeMoneyAtRisk(companyId);
  const alerts = listAlerts(companyId).filter((a) => a.status !== 'resolved');
  const approval = computeApprovalPerformance(companyId);
  const monthSavings = listSavings(companyId).filter((s) => inSameMonth(s.created_at, refDate));

  return {
    potentialSavingsIdentified: savings.thisMonth,
    savingsYtd: savings.ytd,
    moneyAtRisk: atRisk.total,
    duplicatesPrevented: monthSavings.filter((s) => s.saving_type === 'duplicate_prevented').length,
    duplicateValue: round2(monthSavings.filter((s) => s.saving_type === 'duplicate_prevented').reduce((s, r) => s + r.amount, 0)),
    priceVariancesDetected: alerts.filter((a) => a.alert_type === 'price_variance').length,
    deliveryShortagesDetected: alerts.filter((a) => a.alert_type === 'delivery_shortage').length,
    fuelAnomaliesDetected: alerts.filter((a) => a.alert_type === 'fuel_anomaly').length,
    inventoryVariancesDetected: alerts.filter((a) => a.alert_type === 'inventory_variance').length,
    avgApprovalMs: approval.avgApprovalMs
  };
}

/**
 * "TODAY'S BRIEFING" (Phase 2 §36) — the system surfacing problems rather than
 * making the owner hunt for them. Returns a small ranked set of plain-language
 * items plus one positive, so the briefing never reads as pure bad news.
 */
export function computeDailyBriefing(companyId, user) {
  const items = [];

  const pending = listRequestsAwaitingUser(user);
  if (pending.length) {
    items.push({
      severity: 'warning', icon: '🟠',
      text: `${formatRands(round2(pending.reduce((s, r) => s + r.amount, 0)))} in requests are waiting for your approval.`,
      route: '#/approvals'
    });
  }

  if (user.role === ROLES.OWNER) {
    listProjects(companyId).forEach((p) => {
      const fin = computeProjectFinancials(companyId, p.id);
      if (!fin) return;
      if (fin.buffer < 0) {
        const overPct = fin.budget ? Math.round(Math.abs((fin.buffer / fin.budget) * 100)) : 0;
        items.push({
          severity: 'critical', icon: '🔴',
          text: `${p.project_name} is forecast to finish ${overPct}% above budget.`,
          route: `#/projects/${p.id}`
        });
      } else if (fin.budgetStatus.key === 'high' || fin.budgetStatus.key === 'watch') {
        items.push({
          severity: 'warning', icon: '🟠',
          text: `${p.project_name} has used ${fin.spendPct}% of its budget.`,
          route: `#/projects/${p.id}`
        });
      }
    });

    const atRisk = computeMoneyAtRisk(companyId);
    const fuelAlerts = atRisk.alerts.filter((a) => a.alert_type === 'fuel_anomaly');
    if (fuelAlerts.length) {
      items.push({
        severity: 'warning', icon: '⚠️',
        text: `Fuel consumption variance detected on ${fuelAlerts.length} vehicle${fuelAlerts.length > 1 ? 's' : ''}.`,
        route: '#/moneyleaks/fuel'
      });
    }
    const invAlerts = atRisk.alerts.filter((a) => a.alert_type === 'inventory_variance');
    if (invAlerts.length) {
      items.push({
        severity: 'warning', icon: '🟠',
        text: `${formatRands(round2(invAlerts.reduce((s, a) => s + (a.amount || 0), 0)))} of stock requires investigation.`,
        route: '#/moneyleaks/inventory'
      });
    }
  }

  const weekSavings = listSavings(companyId, { sinceDays: 7 });
  const weekTotal = round2(weekSavings.reduce((s, r) => s + r.amount, 0));
  const positive = weekTotal > 0
    ? { icon: '🟢', text: `You saved approximately ${formatRands(weekTotal)} through supplier comparison and price control this week.`, route: '#/savings' }
    : null;

  const rank = { critical: 0, warning: 1 };
  items.sort((a, b) => (rank[a.severity] ?? 2) - (rank[b.severity] ?? 2));
  return { items: items.slice(0, 5), positive, count: items.length };
}

/** Local Rand formatter — db.js stays free of UI imports. */
function formatRands(n) {
  return 'R' + Math.round(Number(n) || 0).toLocaleString('en-ZA');
}

/** Owner / PM "NEEDS YOUR ATTENTION" feed. */
export function computeAttentionItems(companyId, user) {
  const items = [];
  const pending = listRequestsAwaitingUser(user);
  if (pending.length) {
    const sum = round2(pending.reduce((s, r) => s + r.amount, 0));
    items.push({ severity: 'critical', icon: '🔴', label: `${pending.length} approval${pending.length > 1 ? 's' : ''} waiting`, amount: sum, route: '#/approvals' });
  }
  if (user.role === ROLES.OWNER) {
    const { projects } = computeCompanyHealth(companyId);
    const atRisk = projects.filter((p) => p.health.key === 'action');
    atRisk.forEach((p) => items.push({ severity: 'critical', icon: '🔴', label: `${p.project.project_name} spending above forecast`, amount: null, route: `#/projects/${p.project.id}` }));

    const leaks = computeMoneyLeaksBreakdown(companyId);
    if (leaks.fuel > 0) items.push({ severity: 'warning', icon: '⚠️', label: 'Unusual fuel consumption detected', amount: leaks.fuel, route: '#/moneyleaks/fuel' });
    if (leaks.materials > 0) items.push({ severity: 'warning', icon: '⚠️', label: 'Material prices increased', amount: leaks.materials, route: '#/moneyleaks/materials' });
    if (leaks.inventory > 0) items.push({ severity: 'warning', icon: '🟠', label: 'Inventory variance detected', amount: leaks.inventory, route: '#/moneyleaks/inventory' });
  } else if (user.role === ROLES.PROJECT_MANAGER) {
    const myProjectIds = new Set(projectIdsForUser(user));
    const leaks = listAlerts(companyId).filter((a) => a.status !== 'resolved' && myProjectIds.has(a.project_id));
    const deliveryIssues = leaks.filter((a) => a.alert_type === 'delivery_shortage');
    if (deliveryIssues.length) items.push({ severity: 'warning', icon: '🟠', label: `${deliveryIssues.length} delivery discrepanc${deliveryIssues.length > 1 ? 'ies' : 'y'}`, amount: round2(deliveryIssues.reduce((s, a) => s + (a.amount || 0), 0)), route: '#/moneyleaks/deliveries' });
    const fuelIssues = leaks.filter((a) => a.alert_type === 'fuel_anomaly');
    if (fuelIssues.length) items.push({ severity: 'warning', icon: '⚠️', label: 'Fuel anomaly detected', amount: round2(fuelIssues.reduce((s, a) => s + (a.amount || 0), 0)), route: '#/moneyleaks/fuel' });
    projectIdsForUser(user).forEach((pid) => {
      const overview = computeProjectOverview(companyId, pid);
      if (overview && overview.health.key !== 'healthy' && overview.spendPct >= 85) {
        items.push({ severity: 'warning', icon: '🟠', label: `${overview.project.project_name} approaching budget threshold`, amount: null, route: `#/projects/${pid}` });
      }
    });
  }
  return items;
}
