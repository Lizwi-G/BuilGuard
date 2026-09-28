/*
  demoData.js — seed data for DEMO MODE.

  BuildGuard v2: a financial control platform, not a site-ops app. The org
  chart below models "data flows up" — Supervisors capture activity,
  Site Managers verify it operationally, Project Managers control project
  spend, and the Owner controls company finances. Ubuntu Construction is
  fully populated (including a live, in-flight approval chain so the
  10-step demo scenario in the brief can be clicked through end to end);
  Siyakhula Civils and Masakhane Projects are lighter, purely to prove
  company data isolation when switching companies at login.
*/

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const NOW = new Date();
const Y = NOW.getFullYear();
const M = NOW.getMonth() + 1;
const PM = M === 1 ? 12 : M - 1;
const PMY = M === 1 ? Y - 1 : Y;
const PPM = PM === 1 ? 12 : PM - 1;
const PPMY = PM === 1 ? PMY - 1 : PMY;

const thisMonth = (d) => iso(Y, M, d);
const lastMonth = (d) => iso(PMY, PM, d);
const twoMonthsAgo = (d) => iso(PPMY, PPM, d);
const nowIso = () => new Date().toISOString();
const hoursAgoIso = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const daysAgoIso = (d) => new Date(Date.now() - d * 86400 * 1000).toISOString();

/** A fully-approved 3-stage history helper for seeded historical requests. */
function approvedStages({ siteManager, projectManager, owner, needsSiteManager, needsOwner, daysAgoStart = 14 }) {
  const stages = {};
  let day = daysAgoStart;
  if (needsSiteManager) {
    stages.site_manager = { required: true, status: 'approved', actor: siteManager.id, actorName: siteManager.name, at: daysAgoIso(day), comment: 'Confirmed on site.' };
    day -= 1;
  } else {
    stages.site_manager = { required: false, status: 'not_required' };
  }
  stages.project_manager = { required: true, status: 'approved', actor: projectManager.id, actorName: projectManager.name, at: daysAgoIso(day), comment: 'Approved — within project budget.' };
  day -= 1;
  if (needsOwner) {
    stages.owner = { required: true, status: 'approved', actor: owner.id, actorName: owner.name, at: daysAgoIso(day), comment: 'Approved.' };
  } else {
    stages.owner = { required: false, status: 'not_required' };
  }
  return stages;
}

export function buildDemoData() {
  const owner_ubuntu = { id: 'user_sipho', name: 'Sipho Mthembu' };
  const pm_thabo = { id: 'user_thabo', name: 'Thabo Mokoena' };
  const pm_nomsa = { id: 'user_nomsa', name: 'Nomsa Dlamini' };
  const sm_john = { id: 'user_john', name: 'John Smith' };
  const sm_peter = { id: 'user_peter', name: 'Peter Adams' };
  const sup_david = { id: 'user_david', name: 'David Ndlovu' };
  const sup_sarah = { id: 'user_sarah', name: 'Sarah Jacobs' };

  return {
    companies: [
      {
        id: 'co_ubuntu', company_name: 'Ubuntu Construction', registration_number: '2014/123456/07',
        contact_information: 'info@ubuntuconstruction.co.za · 041 555 1000', created_at: twoMonthsAgo(1),
        pm_approval_limit: 5000, owner_solo_limit: 25000,
        // Per-role ceilings (Phase 2 §22) — a Supervisor can never approve.
        role_limits: { site_manager: 2500, project_manager: 25000 },
        // Budget alert thresholds as % of budget (Phase 2 §3) — all configurable.
        budget_thresholds: { watch: 75, high: 90, over: 100, critical: 110 }
      },
      {
        id: 'co_siyakhula', company_name: 'Siyakhula Civils', registration_number: '2017/234567/07',
        contact_information: 'admin@siyakhulacivils.co.za · 042 555 2000', created_at: twoMonthsAgo(1),
        pm_approval_limit: 3000, owner_solo_limit: 15000,
        role_limits: { site_manager: 1500, project_manager: 15000 },
        budget_thresholds: { watch: 75, high: 90, over: 100, critical: 110 }
      },
      {
        id: 'co_masakhane', company_name: 'Masakhane Projects', registration_number: '2019/345678/07',
        contact_information: 'office@masakhaneprojects.co.za · 041 555 3000', created_at: twoMonthsAgo(1),
        pm_approval_limit: 4000, owner_solo_limit: 20000,
        role_limits: { site_manager: 2000, project_manager: 20000 },
        budget_thresholds: { watch: 75, high: 90, over: 100, critical: 110 }
      }
    ],

    users: [
      { id: 'user_sipho', company_id: 'co_ubuntu', name: 'Sipho Mthembu', email: 'sipho@ubuntuconstruction.co.za', phone: '082 111 1001', role: 'owner', status: 'active', created_at: twoMonthsAgo(1) },
      { id: 'user_thabo', company_id: 'co_ubuntu', name: 'Thabo Mokoena', email: 'thabo@ubuntuconstruction.co.za', phone: '082 111 1002', role: 'project_manager', manages_projects: ['proj_summerstrand', 'proj_gqeberha'], status: 'active', created_at: twoMonthsAgo(1) },
      { id: 'user_nomsa', company_id: 'co_ubuntu', name: 'Nomsa Dlamini', email: 'nomsa@ubuntuconstruction.co.za', phone: '082 111 1003', role: 'project_manager', manages_projects: ['proj_walmer'], status: 'active', created_at: twoMonthsAgo(1) },
      { id: 'user_john', company_id: 'co_ubuntu', name: 'John Smith', email: 'john@ubuntuconstruction.co.za', phone: '082 111 1004', role: 'site_manager', assigned_projects: ['proj_summerstrand'], status: 'active', created_at: twoMonthsAgo(1) },
      { id: 'user_peter', company_id: 'co_ubuntu', name: 'Peter Adams', email: 'peter@ubuntuconstruction.co.za', phone: '082 111 1005', role: 'site_manager', assigned_projects: ['proj_walmer', 'proj_gqeberha'], status: 'active', created_at: twoMonthsAgo(1) },
      { id: 'user_david', company_id: 'co_ubuntu', name: 'David Ndlovu', email: 'david@ubuntuconstruction.co.za', phone: '082 111 1006', role: 'supervisor', assigned_projects: ['proj_gqeberha'], status: 'active', created_at: twoMonthsAgo(1) },
      { id: 'user_sarah', company_id: 'co_ubuntu', name: 'Sarah Jacobs', email: 'sarah@ubuntuconstruction.co.za', phone: '082 111 1007', role: 'supervisor', assigned_projects: ['proj_summerstrand', 'proj_walmer'], status: 'active', created_at: twoMonthsAgo(1) },

      { id: 'user_lindelwa', company_id: 'co_siyakhula', name: 'Lindelwa Mtshali', email: 'lindelwa@siyakhulacivils.co.za', phone: '083 222 3001', role: 'owner', status: 'active', created_at: twoMonthsAgo(1) },
      { id: 'user_bongani_pm', company_id: 'co_siyakhula', name: 'Bongani Radebe', email: 'bongani@siyakhulacivils.co.za', phone: '083 222 3002', role: 'project_manager', manages_projects: ['proj_n2road'], status: 'active', created_at: twoMonthsAgo(1) },
      { id: 'user_andile', company_id: 'co_siyakhula', name: 'Andile Booi', email: 'andile@siyakhulacivils.co.za', phone: '083 222 3003', role: 'site_manager', assigned_projects: ['proj_n2road'], status: 'active', created_at: twoMonthsAgo(1) },
      { id: 'user_nosipho', company_id: 'co_siyakhula', name: 'Nosipho Gqamane', email: 'nosipho@siyakhulacivils.co.za', phone: '083 222 3004', role: 'supervisor', assigned_projects: ['proj_n2road'], status: 'active', created_at: twoMonthsAgo(1) },

      { id: 'user_zanele', company_id: 'co_masakhane', name: 'Zanele Mabaso', email: 'zanele@masakhaneprojects.co.za', phone: '084 333 4001', role: 'owner', status: 'active', created_at: twoMonthsAgo(1) },
      { id: 'user_simphiwe_pm', company_id: 'co_masakhane', name: 'Simphiwe Dyantyi', email: 'simphiwe@masakhaneprojects.co.za', phone: '084 333 4002', role: 'project_manager', manages_projects: ['proj_motherwell'], status: 'active', created_at: twoMonthsAgo(1) },
      { id: 'user_bongani', company_id: 'co_masakhane', name: 'Bongani Ndlovu', email: 'bongani@masakhaneprojects.co.za', phone: '084 333 4003', role: 'supervisor', assigned_projects: ['proj_motherwell'], status: 'active', created_at: twoMonthsAgo(1) }
    ],

    projects: [
      { id: 'proj_summerstrand', company_id: 'co_ubuntu', project_name: 'Summerstrand Development', location: 'Summerstrand, Gqeberha', province: 'Eastern Cape', city: 'Gqeberha', region: 'Summerstrand', client_name: 'Summerstrand Property Holdings', contract_value: 2950000, budget: 2500000, total_spent_to_date: 1450000, manager_id: 'user_thabo', start_date: iso(Y - 1, 9, 1), end_date: iso(Y + 1, 2, 28), status: 'active', created_at: twoMonthsAgo(1) },
      { id: 'proj_walmer', company_id: 'co_ubuntu', project_name: 'Walmer Residential Development', location: 'Walmer, Gqeberha', province: 'Eastern Cape', city: 'Gqeberha', region: 'Walmer', client_name: 'Walmer Homes (Pty) Ltd', contract_value: 2020000, budget: 1800000, total_spent_to_date: 1620000, manager_id: 'user_nomsa', start_date: iso(Y, 5, 1), end_date: iso(Y, 11, 30), status: 'active', created_at: twoMonthsAgo(1) },
      { id: 'proj_gqeberha', company_id: 'co_ubuntu', project_name: 'Gqeberha Housing Development', location: 'Gqeberha, Eastern Cape', province: 'Eastern Cape', city: 'Gqeberha', region: 'Northern Areas', client_name: 'Eastern Cape Housing Department', contract_value: 1850000, budget: 1600000, total_spent_to_date: 1150000, manager_id: 'user_thabo', start_date: iso(Y, 2, 1), end_date: iso(Y, 12, 15), status: 'active', created_at: twoMonthsAgo(1) },

      { id: 'proj_n2road', company_id: 'co_siyakhula', project_name: 'N2 Road Maintenance — Humansdorp', location: 'Humansdorp, Eastern Cape', province: 'Eastern Cape', city: 'Humansdorp', region: 'Kouga', client_name: 'Sarah Baartman District Municipality', contract_value: 3600000, budget: 3100000, total_spent_to_date: 980000, manager_id: 'user_bongani_pm', start_date: iso(Y, 4, 1), end_date: iso(Y, 10, 31), status: 'active', created_at: twoMonthsAgo(1) },

      { id: 'proj_motherwell', company_id: 'co_masakhane', project_name: 'Motherwell Community Hall', location: 'Motherwell, Gqeberha', province: 'Eastern Cape', city: 'Gqeberha', region: 'Motherwell', client_name: 'Nelson Mandela Bay Municipality', contract_value: 2150000, budget: 1850000, total_spent_to_date: 610000, manager_id: 'user_simphiwe_pm', start_date: iso(Y, 6, 1), end_date: iso(Y, 12, 20), status: 'active', created_at: twoMonthsAgo(1) }
    ],

    materials: [
      { id: 'mat_cement', company_id: 'co_ubuntu', name: 'Cement', category: 'Building Materials', unit: 'bags (50kg)', minimum_stock_level: 100 },
      { id: 'mat_bricks', company_id: 'co_ubuntu', name: 'Stock Bricks', category: 'Building Materials', unit: 'bricks', minimum_stock_level: 5000 },
      { id: 'mat_sand', company_id: 'co_ubuntu', name: 'River Sand', category: 'Aggregates', unit: 'm³', minimum_stock_level: 20 },
      { id: 'mat_stone', company_id: 'co_ubuntu', name: 'Stone (19mm)', category: 'Aggregates', unit: 'm³', minimum_stock_level: 20 },
      { id: 'mat_steel', company_id: 'co_ubuntu', name: 'Reinforcing Steel', category: 'Steel', unit: 'tons', minimum_stock_level: 2 },
      { id: 'mat_pipes', company_id: 'co_ubuntu', name: 'PVC Pipes', category: 'Plumbing', unit: 'lengths (6m)', minimum_stock_level: 50 },
      { id: 'mat_paint', company_id: 'co_ubuntu', name: 'PVA Paint', category: 'Finishes', unit: 'drums (20L)', minimum_stock_level: 10 },
      { id: 'mat_electrical', company_id: 'co_ubuntu', name: 'Electrical Cable & Fittings', category: 'Electrical', unit: 'sets', minimum_stock_level: 15 },
      { id: 'mat_plumbing', company_id: 'co_ubuntu', name: 'Plumbing Fittings', category: 'Plumbing', unit: 'sets', minimum_stock_level: 15 },
      { id: 'mat_ppe', company_id: 'co_ubuntu', name: 'PPE (Helmets/Boots/Vests)', category: 'Safety', unit: 'sets', minimum_stock_level: 20 },

      { id: 'mat2_cement', company_id: 'co_siyakhula', name: 'Cement', category: 'Building Materials', unit: 'bags (50kg)', minimum_stock_level: 80 },
      { id: 'mat2_stone', company_id: 'co_siyakhula', name: 'Stone (19mm)', category: 'Aggregates', unit: 'm³', minimum_stock_level: 15 },

      { id: 'mat3_cement', company_id: 'co_masakhane', name: 'Cement', category: 'Building Materials', unit: 'bags (50kg)', minimum_stock_level: 60 },
      { id: 'mat3_roofing', company_id: 'co_masakhane', name: 'Roofing Sheets', category: 'Roofing', unit: 'sheets', minimum_stock_level: 40 }
    ],

    suppliers: [
      { id: 'sup_buildmart', company_id: 'co_ubuntu', supplier_name: 'BuildMart Wholesale', contact_person: 'Andre Fourie', phone: '041 555 0101', email: 'sales@buildmart.co.za', address: 'Neave Industrial, Gqeberha', status: 'active' },
      { id: 'sup_ppc', company_id: 'co_ubuntu', supplier_name: 'PPC Cement Direct', contact_person: 'Karabo Sithole', phone: '041 555 0202', email: 'orders@ppcdirect.co.za', address: 'Deal Party, Gqeberha', status: 'active' },
      { id: 'sup_coastal', company_id: 'co_ubuntu', supplier_name: 'Coastal Building Supplies', contact_person: 'Bongani Zulu', phone: '041 555 0404', email: 'sales@coastalbuild.co.za', address: 'Struandale, Gqeberha', status: 'active' },
      { id: 'sup_steelcity', company_id: 'co_ubuntu', supplier_name: 'Steel City Distributors', contact_person: 'Werner Botha', phone: '041 555 0303', email: 'sales@steelcity.co.za', address: 'Markman, Gqeberha', status: 'active' },
      { id: 'sup_ecsteel', company_id: 'co_ubuntu', supplier_name: 'Eastern Cape Steel Merchants', contact_person: 'Vuyo Radebe', phone: '041 555 0606', email: 'quotes@ecsteel.co.za', address: 'Deal Party, Gqeberha', status: 'active' },
      { id: 'sup_electroplumb', company_id: 'co_ubuntu', supplier_name: 'ElectroPlumb Supplies', contact_person: 'Fatima Adams', phone: '041 555 0505', email: 'sales@electroplumb.co.za', address: 'North End, Gqeberha', status: 'active' },
      { id: 'sup_voltex', company_id: 'co_ubuntu', supplier_name: 'Voltex Electrical Wholesalers', contact_person: 'Grace Mokoena', phone: '041 555 0707', email: 'quotes@voltex.co.za', address: 'Sidwell, Gqeberha', status: 'active' },
      { id: 'sup_masterfinish', company_id: 'co_ubuntu', supplier_name: 'MasterFinish Paints & Hardware', contact_person: 'Deon Pretorius', phone: '041 555 0808', email: 'sales@masterfinish.co.za', address: 'Newton Park, Gqeberha', status: 'active' },

      { id: 'sup2_roadstone', company_id: 'co_siyakhula', supplier_name: 'Eastern Cape Roadstone', contact_person: 'Pieter Joubert', phone: '042 555 2101', email: 'sales@ecroadstone.co.za', address: 'Humansdorp', status: 'active' },

      { id: 'sup3_buildmart', company_id: 'co_masakhane', supplier_name: 'BuildMart Wholesale', contact_person: 'Andre Fourie', phone: '041 555 0101', email: 'sales@buildmart.co.za', address: 'Neave Industrial, Gqeberha', status: 'active' },
      { id: 'sup3_roofworld', company_id: 'co_masakhane', supplier_name: 'RoofWorld Gqeberha', contact_person: 'Simphiwe Dyantyi', phone: '041 555 0909', email: 'sales@roofworld.co.za', address: 'Kempston Road, Gqeberha', status: 'active' }
    ],

    supplierPrices: [
      { supplier_id: 'sup_buildmart', material_id: 'mat_cement', price: 95, previous_price: 94 },
      { supplier_id: 'sup_ppc', material_id: 'mat_cement', price: 88, previous_price: 87 },
      { supplier_id: 'sup_coastal', material_id: 'mat_cement', price: 91, previous_price: 90 },

      { supplier_id: 'sup_steelcity', material_id: 'mat_steel', price: 969, previous_price: 855 },
      { supplier_id: 'sup_ecsteel', material_id: 'mat_steel', price: 900, previous_price: 895 },

      { supplier_id: 'sup_buildmart', material_id: 'mat_paint', price: 890, previous_price: 880 },
      { supplier_id: 'sup_masterfinish', material_id: 'mat_paint', price: 845, previous_price: 840 },

      { supplier_id: 'sup_electroplumb', material_id: 'mat_electrical', price: 620, previous_price: 610 },
      { supplier_id: 'sup_voltex', material_id: 'mat_electrical', price: 575, previous_price: 570 },

      { supplier_id: 'sup_coastal', material_id: 'mat_sand', price: 355, previous_price: 350 },
      { supplier_id: 'sup_buildmart', material_id: 'mat_bricks', price: 3.8, previous_price: 3.6 },
      { supplier_id: 'sup_buildmart', material_id: 'mat_ppe', price: 480, previous_price: 475 }
    ],

    vehicles: [
      { id: 'veh_hilux', company_id: 'co_ubuntu', registration_number: 'NP 123 456', vehicle_name: 'Toyota Hilux 2.8 GD-6', vehicle_type: 'Bakkie', fuel_type: 'Diesel', assigned_project: 'proj_gqeberha', status: 'active', baseline_km_per_l: 9.0 },
      { id: 'veh_isuzutruck', company_id: 'co_ubuntu', registration_number: 'NP 234 567', vehicle_name: 'Isuzu Truck', vehicle_type: 'Flatbed Truck', fuel_type: 'Diesel', assigned_project: 'proj_summerstrand', status: 'active', baseline_km_per_l: 5.0 },
      { id: 'veh_excavator', company_id: 'co_ubuntu', registration_number: 'PLANT-EX01', vehicle_name: 'CAT 320 Excavator', vehicle_type: 'Excavator', fuel_type: 'Diesel', assigned_project: 'proj_gqeberha', status: 'active', baseline_l_per_hr: 18.0 },
      { id: 'veh_tlb', company_id: 'co_ubuntu', registration_number: 'PLANT-TLB01', vehicle_name: 'JCB 3CX TLB', vehicle_type: 'TLB', fuel_type: 'Diesel', assigned_project: 'proj_walmer', status: 'active', baseline_l_per_hr: 12.0 },
      { id: 'veh_deliverytruck', company_id: 'co_ubuntu', registration_number: 'NP 345 678', vehicle_name: 'Delivery Truck', vehicle_type: 'Delivery Truck', fuel_type: 'Diesel', assigned_project: 'proj_summerstrand', status: 'maintenance', baseline_km_per_l: 6.0 },

      { id: 'veh2_tlb', company_id: 'co_siyakhula', registration_number: 'CFX 555 EC', vehicle_name: 'JCB 3CX TLB', vehicle_type: 'TLB', fuel_type: 'Diesel', assigned_project: 'proj_n2road', status: 'active', baseline_l_per_hr: 12.0 },

      { id: 'veh3_truck', company_id: 'co_masakhane', registration_number: 'NP 789 012', vehicle_name: 'Delivery Truck', vehicle_type: 'Delivery Truck', fuel_type: 'Diesel', assigned_project: 'proj_motherwell', status: 'active', baseline_km_per_l: 6.0 }
    ],

    // Historical, already-invoiced purchases — feed price-variance detection,
    // project spend totals and the Materials/Fuel reports. Approved by
    // whichever Project Manager owns that project (matches the new model:
    // PMs, not a separate procurement role, sign off on purchases).
    purchases: [
      { id: 'pur_cement_jun5', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', supplier_id: 'sup_buildmart', material_id: 'mat_cement', quantity: 300, unit_price: 92, total_price: 27600, purchase_date: twoMonthsAgo(5), approved_by: 'user_thabo' },
      { id: 'pur_cement_jun20', company_id: 'co_ubuntu', project_id: 'proj_walmer', supplier_id: 'sup_buildmart', material_id: 'mat_cement', quantity: 200, unit_price: 93, total_price: 18600, purchase_date: twoMonthsAgo(20), approved_by: 'user_nomsa' },
      { id: 'pur_cement_jul8', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', supplier_id: 'sup_buildmart', material_id: 'mat_cement', quantity: 250, unit_price: 94, total_price: 23500, purchase_date: lastMonth(8), approved_by: 'user_thabo' },
      { id: 'pur_cement_jul22', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', supplier_id: 'sup_ppc', material_id: 'mat_cement', quantity: 400, unit_price: 88, total_price: 35200, purchase_date: lastMonth(22), approved_by: 'user_thabo' },
      { id: 'pur_cement_500', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', supplier_id: 'sup_buildmart', material_id: 'mat_cement', quantity: 500, unit_price: 95, total_price: 47500, purchase_date: thisMonth(3), approved_by: 'user_thabo' },

      { id: 'pur_steel_jun10', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', supplier_id: 'sup_steelcity', material_id: 'mat_steel', quantity: 3, unit_price: 830, total_price: 2490, purchase_date: twoMonthsAgo(10), approved_by: 'user_thabo' },
      { id: 'pur_steel_jun28', company_id: 'co_ubuntu', project_id: 'proj_walmer', supplier_id: 'sup_steelcity', material_id: 'mat_steel', quantity: 2, unit_price: 845, total_price: 1690, purchase_date: twoMonthsAgo(28), approved_by: 'user_nomsa' },
      { id: 'pur_steel_jul15', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', supplier_id: 'sup_steelcity', material_id: 'mat_steel', quantity: 4, unit_price: 860, total_price: 3440, purchase_date: lastMonth(15), approved_by: 'user_thabo' },
      { id: 'pur_steel_jul30', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', supplier_id: 'sup_steelcity', material_id: 'mat_steel', quantity: 3, unit_price: 855, total_price: 2565, purchase_date: lastMonth(30), approved_by: 'user_thabo' },
      { id: 'pur_steel_aug10', company_id: 'co_ubuntu', project_id: 'proj_walmer', supplier_id: 'sup_steelcity', material_id: 'mat_steel', quantity: 5, unit_price: 969, total_price: 4845, purchase_date: thisMonth(10), approved_by: 'user_nomsa' },

      { id: 'pur_sand_jul5', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', supplier_id: 'sup_coastal', material_id: 'mat_sand', quantity: 40, unit_price: 350, total_price: 14000, purchase_date: lastMonth(5), approved_by: 'user_thabo' },
      { id: 'pur_sand_aug2', company_id: 'co_ubuntu', project_id: 'proj_walmer', supplier_id: 'sup_coastal', material_id: 'mat_sand', quantity: 25, unit_price: 360, total_price: 9000, purchase_date: thisMonth(2), approved_by: 'user_nomsa' },
      { id: 'pur_sand_aug12', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', supplier_id: 'sup_coastal', material_id: 'mat_sand', quantity: 30, unit_price: 355, total_price: 10650, purchase_date: thisMonth(12), approved_by: 'user_thabo' },
      { id: 'pur_stone_jul12', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', supplier_id: 'sup_coastal', material_id: 'mat_stone', quantity: 35, unit_price: 380, total_price: 13300, purchase_date: lastMonth(12), approved_by: 'user_thabo' },
      { id: 'pur_stone_aug6', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', supplier_id: 'sup_coastal', material_id: 'mat_stone', quantity: 20, unit_price: 385, total_price: 7700, purchase_date: thisMonth(6), approved_by: 'user_thabo' },

      { id: 'pur_bricks_jul18', company_id: 'co_ubuntu', project_id: 'proj_walmer', supplier_id: 'sup_buildmart', material_id: 'mat_bricks', quantity: 8000, unit_price: 3.6, total_price: 28800, purchase_date: lastMonth(18), approved_by: 'user_nomsa' },
      { id: 'pur_bricks_aug8', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', supplier_id: 'sup_buildmart', material_id: 'mat_bricks', quantity: 6000, unit_price: 3.8, total_price: 22800, purchase_date: thisMonth(8), approved_by: 'user_thabo' },

      { id: 'pur_pipes_jul25', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', supplier_id: 'sup_electroplumb', material_id: 'mat_pipes', quantity: 60, unit_price: 145, total_price: 8700, purchase_date: lastMonth(25), approved_by: 'user_thabo' },
      { id: 'pur_pipes_aug9', company_id: 'co_ubuntu', project_id: 'proj_walmer', supplier_id: 'sup_electroplumb', material_id: 'mat_pipes', quantity: 40, unit_price: 150, total_price: 6000, purchase_date: thisMonth(9), approved_by: 'user_nomsa' },

      { id: 'pur_paint_aug1', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', supplier_id: 'sup_buildmart', material_id: 'mat_paint', quantity: 15, unit_price: 890, total_price: 13350, purchase_date: thisMonth(1), approved_by: 'user_thabo' },
      { id: 'pur_plumbing_aug7', company_id: 'co_ubuntu', project_id: 'proj_walmer', supplier_id: 'sup_electroplumb', material_id: 'mat_plumbing', quantity: 18, unit_price: 540, total_price: 9720, purchase_date: thisMonth(7), approved_by: 'user_nomsa' },

      { id: 'pur2_stone_jul10', company_id: 'co_siyakhula', project_id: 'proj_n2road', supplier_id: 'sup2_roadstone', material_id: 'mat2_stone', quantity: 60, unit_price: 340, total_price: 20400, purchase_date: lastMonth(10), approved_by: 'user_bongani_pm' },
      { id: 'pur2_cement_aug5', company_id: 'co_siyakhula', project_id: 'proj_n2road', supplier_id: 'sup2_roadstone', material_id: 'mat2_cement', quantity: 180, unit_price: 91, total_price: 16380, purchase_date: thisMonth(5), approved_by: 'user_bongani_pm' },

      { id: 'pur3_cement_jul20', company_id: 'co_masakhane', project_id: 'proj_motherwell', supplier_id: 'sup3_buildmart', material_id: 'mat3_cement', quantity: 150, unit_price: 93, total_price: 13950, purchase_date: lastMonth(20), approved_by: 'user_simphiwe_pm' },
      { id: 'pur3_roofing_aug6', company_id: 'co_masakhane', project_id: 'proj_motherwell', supplier_id: 'sup3_roofworld', material_id: 'mat3_roofing', quantity: 80, unit_price: 610, total_price: 48800, purchase_date: thisMonth(6), approved_by: 'user_simphiwe_pm' }
    ],

    deliveries: [
      { id: 'del_cement_500', purchase_id: 'pur_cement_500', expected_quantity: 500, received_quantity: 450, shortage_quantity: 50, received_by: 'user_david', delivery_date: thisMonth(4), notes: 'Truck arrived with 9 pallets instead of 10 — driver said the balance is coming on the next trip.', photo_url: null },
      { id: 'del_pipes_aug9', purchase_id: 'pur_pipes_aug9', expected_quantity: 40, received_quantity: 36, shortage_quantity: 4, received_by: 'user_sarah', delivery_date: thisMonth(10), notes: '4 lengths missing from the bundle, delivery note says 40.', photo_url: null },
      { id: 'del_steel_aug10', purchase_id: 'pur_steel_aug10', expected_quantity: 5, received_quantity: 5, shortage_quantity: 0, received_by: 'user_sarah', delivery_date: thisMonth(11), notes: 'Full delivery received, signed clean.', photo_url: null }
    ],

    inventory: [
      { id: 'inv_cement_gq', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', material_id: 'mat_cement', purchased: 1050, received: 1000, used: 820, actual_counted: 150, counted_at: thisMonth(15), updated_at: thisMonth(15) },
      { id: 'inv_cement_wal', company_id: 'co_ubuntu', project_id: 'proj_walmer', material_id: 'mat_cement', purchased: 200, received: 200, used: 165, actual_counted: 35, counted_at: thisMonth(14), updated_at: thisMonth(14) },
      { id: 'inv_cement_sum', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', material_id: 'mat_cement', purchased: 400, received: 400, used: 250, actual_counted: 150, counted_at: thisMonth(14), updated_at: thisMonth(14) },
      { id: 'inv_steel_wal', company_id: 'co_ubuntu', project_id: 'proj_walmer', material_id: 'mat_steel', purchased: 7, received: 7, used: 4.2, actual_counted: 2.8, counted_at: thisMonth(13), updated_at: thisMonth(13) },
      { id: 'inv_steel_sum', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', material_id: 'mat_steel', purchased: 6, received: 6, used: 4.4, actual_counted: 1.6, counted_at: thisMonth(13), updated_at: thisMonth(13) },
      { id: 'inv_steel_gq', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', material_id: 'mat_steel', purchased: 4, received: 4, used: 3.1, actual_counted: 0.9, counted_at: thisMonth(13), updated_at: thisMonth(13) },
      { id: 'inv_sand_gq', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', material_id: 'mat_sand', purchased: 40, received: 40, used: 33, actual_counted: 7, counted_at: thisMonth(12), updated_at: thisMonth(12) },
      { id: 'inv_sand_wal', company_id: 'co_ubuntu', project_id: 'proj_walmer', material_id: 'mat_sand', purchased: 25, received: 25, used: 18, actual_counted: 7, counted_at: thisMonth(12), updated_at: thisMonth(12) },
      { id: 'inv_stone_sum', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', material_id: 'mat_stone', purchased: 35, received: 35, used: 24, actual_counted: 11, counted_at: thisMonth(11), updated_at: thisMonth(11) },
      { id: 'inv_bricks_wal', company_id: 'co_ubuntu', project_id: 'proj_walmer', material_id: 'mat_bricks', purchased: 8000, received: 8000, used: 6100, actual_counted: 1900, counted_at: thisMonth(10), updated_at: thisMonth(10) },
      { id: 'inv_pipes_sum', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', material_id: 'mat_pipes', purchased: 60, received: 60, used: 42, actual_counted: 18, counted_at: thisMonth(9), updated_at: thisMonth(9) },
      { id: 'inv_paint_gq', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', material_id: 'mat_paint', purchased: 15, received: 15, used: 9, actual_counted: 6, counted_at: thisMonth(9), updated_at: thisMonth(9) },

      { id: 'inv2_cement_n2', company_id: 'co_siyakhula', project_id: 'proj_n2road', material_id: 'mat2_cement', purchased: 180, received: 180, used: 140, actual_counted: 40, counted_at: thisMonth(10), updated_at: thisMonth(10) },
      { id: 'inv3_cement_mw', company_id: 'co_masakhane', project_id: 'proj_motherwell', material_id: 'mat3_cement', purchased: 150, received: 150, used: 118, actual_counted: 32, counted_at: thisMonth(9), updated_at: thisMonth(9) }
    ],

    fuelTransactions: [
      { id: 'fuel_hilux_1', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', vehicle_id: 'veh_hilux', user_id: 'user_david', litres: 55, price_per_litre: 22.8, total_cost: 1254, odometer_reading: 48200, supplier: 'Sasol Walmer', transaction_date: lastMonth(3) },
      { id: 'fuel_hilux_2', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', vehicle_id: 'veh_hilux', user_id: 'user_david', litres: 50, price_per_litre: 23.1, total_cost: 1155, odometer_reading: 48650, supplier: 'Sasol Walmer', transaction_date: lastMonth(17) },
      { id: 'fuel_hilux_3', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', vehicle_id: 'veh_hilux', user_id: 'user_david', litres: 52, price_per_litre: 23.4, total_cost: 1217, odometer_reading: 49110, supplier: 'Engen Newton Park', transaction_date: thisMonth(1) },
      { id: 'fuel_hilux_4', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', vehicle_id: 'veh_hilux', user_id: 'user_david', litres: 60, price_per_litre: 23.6, total_cost: 1416, odometer_reading: 49175, supplier: 'Engen Newton Park', transaction_date: thisMonth(14) },

      { id: 'fuel_isuzu_1', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', vehicle_id: 'veh_isuzutruck', user_id: 'user_sarah', litres: 120, price_per_litre: 22.9, total_cost: 2748, odometer_reading: 88500, supplier: 'Sasol Walmer', transaction_date: lastMonth(6) },
      { id: 'fuel_isuzu_2', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', vehicle_id: 'veh_isuzutruck', user_id: 'user_sarah', litres: 110, price_per_litre: 23.2, total_cost: 2552, odometer_reading: 89050, supplier: 'Sasol Walmer', transaction_date: thisMonth(2) },
      { id: 'fuel_isuzu_3', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', vehicle_id: 'veh_isuzutruck', user_id: 'user_sarah', litres: 115, price_per_litre: 23.6, total_cost: 2714, odometer_reading: 89620, supplier: 'Engen Newton Park', transaction_date: thisMonth(13) },

      { id: 'fuel_exc_1', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', vehicle_id: 'veh_excavator', user_id: 'user_peter', litres: 180, price_per_litre: 22.7, total_cost: 4086, hour_meter: 1200, supplier: 'Site bulk tank', transaction_date: lastMonth(9) },
      { id: 'fuel_exc_2', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', vehicle_id: 'veh_excavator', user_id: 'user_peter', litres: 190, price_per_litre: 23.0, total_cost: 4370, hour_meter: 1210.5, supplier: 'Site bulk tank', transaction_date: thisMonth(5) },

      { id: 'fuel_tlb_1', company_id: 'co_ubuntu', project_id: 'proj_walmer', vehicle_id: 'veh_tlb', user_id: 'user_peter', litres: 96, price_per_litre: 22.8, total_cost: 2189, hour_meter: 640, supplier: 'Site bulk tank', transaction_date: lastMonth(12) },
      { id: 'fuel_tlb_2', company_id: 'co_ubuntu', project_id: 'proj_walmer', vehicle_id: 'veh_tlb', user_id: 'user_peter', litres: 90, price_per_litre: 23.2, total_cost: 2088, hour_meter: 647.5, supplier: 'Site bulk tank', transaction_date: thisMonth(6) },

      { id: 'fuel2_tlb_1', company_id: 'co_siyakhula', project_id: 'proj_n2road', vehicle_id: 'veh2_tlb', user_id: 'user_andile', litres: 96, price_per_litre: 22.9, total_cost: 2198, hour_meter: 320, supplier: 'Site bulk tank', transaction_date: lastMonth(11) },
      { id: 'fuel2_tlb_2', company_id: 'co_siyakhula', project_id: 'proj_n2road', vehicle_id: 'veh2_tlb', user_id: 'user_andile', litres: 90, price_per_litre: 23.3, total_cost: 2097, hour_meter: 327.5, supplier: 'Site bulk tank', transaction_date: thisMonth(7) },

      { id: 'fuel3_truck_1', company_id: 'co_masakhane', project_id: 'proj_motherwell', vehicle_id: 'veh3_truck', user_id: 'user_bongani', litres: 80, price_per_litre: 22.9, total_cost: 1832, odometer_reading: 15200, supplier: 'Engen Motherwell', transaction_date: thisMonth(6) }
    ],

    // =========================================================================
    // REQUESTS — the unified approval-workflow collection (materials + generic
    // expenses share the same Supervisor -> Site Manager -> Project Manager ->
    // Owner chain). Deliberately spans every pipeline state so every role's
    // Approvals inbox has something real to show on first login.
    // =========================================================================
    requests: [
      // R1 — THE live flagship demo request (see brief step 1-9): a Supervisor's
      // material request, fresh, sitting with the Site Manager.
      {
        id: 'req_cement_live', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', request_type: 'material',
        material_id: 'mat_cement', quantity: 100, amount: 8800, urgency: 'urgent',
        reason: 'Foundation work — slab pour scheduled tomorrow morning', requested_by: 'user_david',
        created_at: hoursAgoIso(2), status: 'pending',
        stages: {
          site_manager: { required: true, status: 'pending' },
          project_manager: { required: true, status: 'waiting' },
          owner: { required: true, status: 'waiting' }
        }
      },

      // R2 — matches the brief's "Diesel — 500L, R11,750, Awaiting Owner" example.
      {
        id: 'req_diesel_500l', company_id: 'co_ubuntu', project_id: 'proj_walmer', request_type: 'expense',
        category: 'Fuel', amount: 11750, urgency: 'soon',
        reason: '500L bulk diesel top-up — TLB and site generator running low', requested_by: 'user_sarah',
        created_at: daysAgoIso(1), status: 'pending',
        stages: {
          site_manager: { required: true, status: 'approved', actor: 'user_peter', actorName: 'Peter Adams', at: daysAgoIso(1), comment: 'Confirmed — tank is low.' },
          project_manager: { required: true, status: 'approved', actor: 'user_nomsa', actorName: 'Nomsa Dlamini', at: hoursAgoIso(20), comment: 'Approved — within fuel budget for the month.' },
          owner: { required: true, status: 'pending' }
        }
      },

      // R3 — Site Manager originated, small amount: skips the site-manager
      // stage entirely (can't review your own request) and, being under the
      // R5,000 PM limit, never needs the Owner either.
      {
        id: 'req_steel_direct', company_id: 'co_ubuntu', project_id: 'proj_walmer', request_type: 'material',
        material_id: 'mat_steel', quantity: 5, amount: 4845, urgency: 'soon',
        reason: 'Foundation reinforcement, next pour in 3 days', requested_by: 'user_peter',
        created_at: daysAgoIso(2), status: 'pending',
        stages: {
          site_manager: { required: false, status: 'not_required' },
          project_manager: { required: true, status: 'pending' },
          owner: { required: false, status: 'not_required' }
        }
      },

      // R4 — a second item sitting in Peter Adams' inbox alongside R1, this
      // time a generic expense (not material) to prove the workflow is generic.
      {
        id: 'req_tlb_repair', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', request_type: 'expense',
        category: 'Repairs', amount: 3200, urgency: 'urgent',
        reason: 'TLB hydraulic hose burst on site — needs replacing before work can continue', requested_by: 'user_david',
        created_at: hoursAgoIso(5), status: 'pending',
        stages: {
          site_manager: { required: true, status: 'pending' },
          project_manager: { required: true, status: 'waiting' },
          owner: { required: false, status: 'not_required' }
        }
      },

      // R5 — fully approved, all 3 stages, with a real approval-history
      // timeline. Its resulting purchase is pur_electrical_final below.
      {
        id: 'req_electrical_done', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', request_type: 'material',
        material_id: 'mat_electrical', quantity: 25, amount: 15500, urgency: 'normal',
        reason: 'First-fix wiring, ground floor', requested_by: 'user_sarah',
        created_at: daysAgoIso(13), status: 'approved',
        supplier_id: 'sup_voltex', unit_price: 575,
        stages: approvedStages({ siteManager: sm_john, projectManager: pm_thabo, owner: owner_ubuntu, needsSiteManager: true, needsOwner: true, daysAgoStart: 13 })
      },

      // R6 — rejected by the Project Manager.
      {
        id: 'req_bricks_rejected', company_id: 'co_ubuntu', project_id: 'proj_walmer', request_type: 'material',
        material_id: 'mat_bricks', quantity: 10000, amount: 38000, urgency: 'normal',
        reason: 'Boundary wall', requested_by: 'user_peter',
        created_at: daysAgoIso(9), status: 'rejected', rejection_reason: 'Duplicate — already ordered on the 18th.',
        stages: {
          site_manager: { required: false, status: 'not_required' },
          project_manager: { required: true, status: 'rejected', actor: 'user_nomsa', actorName: 'Nomsa Dlamini', at: daysAgoIso(8), comment: 'Duplicate — already ordered on the 18th.' },
          owner: { required: true, status: 'skipped' }
        }
      },

      // R7 — Site Manager asked for more information before forwarding.
      {
        id: 'req_paint_info', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', request_type: 'material',
        material_id: 'mat_paint', quantity: 15, amount: 12675, urgency: 'normal',
        reason: 'Paint for finishing', requested_by: 'user_david',
        created_at: daysAgoIso(1), status: 'info_requested', info_request_note: 'Which block is this for — A or B? Please confirm before I forward this.',
        stages: {
          site_manager: { required: true, status: 'info_requested', actor: 'user_peter', actorName: 'Peter Adams', at: hoursAgoIso(10), comment: 'Which block is this for — A or B? Please confirm before I forward this.' },
          project_manager: { required: true, status: 'waiting' },
          owner: { required: true, status: 'waiting' }
        }
      },

      // R8 — a small, fast-closed example (no Owner needed) for contrast.
      {
        id: 'req_ppe_done', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', request_type: 'material',
        material_id: 'mat_ppe', quantity: 10, amount: 4800, urgency: 'soon',
        reason: 'New sub-contractor crew starting Monday', requested_by: 'user_sarah',
        created_at: daysAgoIso(19), status: 'approved',
        supplier_id: 'sup_buildmart', unit_price: 480,
        stages: approvedStages({ siteManager: sm_john, projectManager: pm_thabo, owner: owner_ubuntu, needsSiteManager: true, needsOwner: false, daysAgoStart: 19 })
      },

      // Siyakhula Civils — one live request to prove multi-company isolation.
      {
        id: 'req2_ppe_live', company_id: 'co_siyakhula', project_id: 'proj_n2road', request_type: 'material',
        material_id: 'mat2_cement', quantity: 60, amount: 5460, urgency: 'soon',
        reason: 'Culvert work needs more cement', requested_by: 'user_nosipho',
        created_at: hoursAgoIso(6), status: 'pending',
        stages: {
          site_manager: { required: true, status: 'pending' },
          project_manager: { required: true, status: 'waiting' },
          owner: { required: true, status: 'waiting' }
        }
      }
    ],

    // Purchase created automatically when req_electrical_done was approved —
    // mirrors what actOnRequest() does live for any new material approval.
    approvedRequestPurchases: [
      { id: 'pur_electrical_final', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', supplier_id: 'sup_voltex', material_id: 'mat_electrical', quantity: 25, unit_price: 575, total_price: 14375, purchase_date: daysAgoIso(11).slice(0, 10), approved_by: 'user_sipho', source_request_id: 'req_electrical_done' },
      { id: 'pur_ppe_final', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', supplier_id: 'sup_buildmart', material_id: 'mat_ppe', quantity: 10, unit_price: 480, total_price: 4800, purchase_date: daysAgoIso(18).slice(0, 10), approved_by: 'user_thabo', source_request_id: 'req_ppe_done' }
    ],

    // =========================================================================
    // SAVINGS LEDGER (Phase 2 §40) — every rand BuildGuard actually saved the
    // company, itemised. Deliberately seeded so the drill-down SUMS EXACTLY to
    // the headline figures: a demo where the numbers reconcile is far more
    // credible to an owner than one matching a nicer round number that doesn't.
    // New savings are appended live by recordSaving() whenever an approver
    // picks a supplier below the baseline price.
    // =========================================================================
    savingsSeed: [
      // ---- This month (sums to R18,750) ----
      { id: 'sav_1', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', saving_type: 'supplier_comparison', description: 'Cement 100 bags — PPC Cement Direct chosen over BuildMart Wholesale', amount: 700, created_at: thisMonth(3) },
      { id: 'sav_2', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', saving_type: 'supplier_comparison', description: 'Electrical Cable & Fittings 25 sets — Voltex chosen over ElectroPlumb', amount: 1125, created_at: thisMonth(4) },
      { id: 'sav_3', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', saving_type: 'supplier_comparison', description: 'PVA Paint 20 drums — MasterFinish chosen over BuildMart', amount: 900, created_at: thisMonth(5) },
      { id: 'sav_4', company_id: 'co_ubuntu', project_id: 'proj_walmer', saving_type: 'negotiation', description: 'Reinforcing Steel — price renegotiated with Steel City after variance flagged', amount: 2400, created_at: thisMonth(6) },
      { id: 'sav_5', company_id: 'co_ubuntu', project_id: 'proj_walmer', saving_type: 'duplicate_prevented', description: 'Stock Bricks 10,000 — duplicate order caught at Project Manager review', amount: 1500, created_at: thisMonth(8) },
      { id: 'sav_6', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', saving_type: 'bulk_discount', description: 'Cement 400 bags — consolidated into one bulk order', amount: 2800, created_at: thisMonth(9) },
      { id: 'sav_7', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', saving_type: 'supplier_comparison', description: 'PPE 10 sets — BuildMart chosen over SafetyFirst', amount: 345, created_at: thisMonth(11) },
      { id: 'sav_8', company_id: 'co_ubuntu', project_id: 'proj_walmer', saving_type: 'negotiation', description: 'Plumbing Fittings — trade discount negotiated with ElectroPlumb', amount: 1980, created_at: thisMonth(12) },
      { id: 'sav_9', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', saving_type: 'bulk_discount', description: 'Sand & Stone — combined delivery, single transport charge', amount: 3200, created_at: thisMonth(13) },
      { id: 'sav_10', company_id: 'co_ubuntu', project_id: 'proj_walmer', saving_type: 'duplicate_prevented', description: 'PVC Pipes — second order for the same section caught before approval', amount: 3800, created_at: thisMonth(14) },

      // ---- Last month (sums to R21,400) ----
      { id: 'sav_11', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', saving_type: 'bulk_discount', description: 'Bricks 8,000 — bulk pricing negotiated with BuildMart', amount: 6400, created_at: lastMonth(6) },
      { id: 'sav_12', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', saving_type: 'supplier_comparison', description: 'Cement 400 bags — PPC Cement Direct chosen over BuildMart', amount: 5200, created_at: lastMonth(12) },
      { id: 'sav_13', company_id: 'co_ubuntu', project_id: 'proj_walmer', saving_type: 'duplicate_prevented', description: 'Duplicate sand order for the same pour caught at site level', amount: 3900, created_at: lastMonth(18) },
      { id: 'sav_14', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', saving_type: 'negotiation', description: 'Stone (19mm) — delivery charge waived on repeat order', amount: 2700, created_at: lastMonth(23) },
      { id: 'sav_15', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', saving_type: 'supplier_comparison', description: 'Reinforcing Steel 4 tons — Eastern Cape Steel chosen over Steel City', amount: 3200, created_at: lastMonth(28) },

      // ---- Two months ago (sums to R19,800) ----
      { id: 'sav_16', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', saving_type: 'bulk_discount', description: 'Cement 300 bags — early-order discount secured', amount: 7100, created_at: twoMonthsAgo(7) },
      { id: 'sav_17', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', saving_type: 'supplier_comparison', description: 'Steel — Eastern Cape Steel Merchants chosen over Steel City', amount: 4600, created_at: twoMonthsAgo(14) },
      { id: 'sav_18', company_id: 'co_ubuntu', project_id: 'proj_walmer', saving_type: 'negotiation', description: 'Paint — trade account rate applied retroactively', amount: 3300, created_at: twoMonthsAgo(21) },
      { id: 'sav_19', company_id: 'co_ubuntu', project_id: 'proj_walmer', saving_type: 'duplicate_prevented', description: 'Repeat PPE order for the same crew caught at Site Manager review', amount: 4800, created_at: twoMonthsAgo(26) },

      { id: 'sav2_1', company_id: 'co_siyakhula', project_id: 'proj_n2road', saving_type: 'supplier_comparison', description: 'Cement 180 bags — Eastern Cape Roadstone selected on price', amount: 1620, created_at: thisMonth(5) },
      { id: 'sav3_1', company_id: 'co_masakhane', project_id: 'proj_motherwell', saving_type: 'bulk_discount', description: 'Roofing Sheets 80 — bulk rate from RoofWorld', amount: 2400, created_at: thisMonth(6) }
    ],

    alertsSeed: [
      { id: 'alert_seed_bricks', company_id: 'co_ubuntu', project_id: 'proj_walmer', alert_type: 'price_variance', severity: 'warning', message: 'Bricks price was 8% above historical average on the July order.', amount: 1440, status: 'resolved', created_at: lastMonth(19) },
      { id: 'alert_seed_fuel', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', alert_type: 'fuel_anomaly', severity: 'warning', message: 'Isuzu Truck consumption variance flagged and reviewed with driver — logbook mismatch, corrected.', amount: null, status: 'resolved', created_at: lastMonth(7) }
    ],

    // A handful of seeded audit entries so the Audit Log isn't empty on first
    // load — every new action taken during the demo appends live via logAudit().
    auditLogSeed: [
      { id: 'audit_seed_1', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', user_id: 'user_john', user_name: 'John Smith', action: 'Verified request', details: 'Electrical Cable & Fittings — 25 sets', entity_type: 'request', entity_id: 'req_electrical_done', amount: 15500, created_at: daysAgoIso(13) },
      { id: 'audit_seed_2', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', user_id: 'user_thabo', user_name: 'Thabo Mokoena', action: 'Approved request', details: 'Electrical Cable & Fittings — selected Voltex Electrical Wholesalers', entity_type: 'request', entity_id: 'req_electrical_done', amount: 15500, created_at: daysAgoIso(12) },
      { id: 'audit_seed_3', company_id: 'co_ubuntu', project_id: 'proj_summerstrand', user_id: 'user_sipho', user_name: 'Sipho Mthembu', action: 'Approved request', details: 'Electrical Cable & Fittings — final sign-off', entity_type: 'request', entity_id: 'req_electrical_done', amount: 15500, created_at: daysAgoIso(11) },
      { id: 'audit_seed_4', company_id: 'co_ubuntu', project_id: 'proj_walmer', user_id: 'user_nomsa', user_name: 'Nomsa Dlamini', action: 'Rejected request', details: 'Stock Bricks — 10,000 bricks (duplicate order)', entity_type: 'request', entity_id: 'req_bricks_rejected', amount: 38000, created_at: daysAgoIso(8) },
      { id: 'audit_seed_5', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', user_id: 'user_david', user_name: 'David Ndlovu', action: 'Received delivery', details: 'Cement — 450 of 500 bags (50 short)', entity_type: 'delivery', entity_id: 'del_cement_500', amount: 4750, created_at: thisMonth(4) },
      { id: 'audit_seed_6', company_id: 'co_ubuntu', project_id: 'proj_gqeberha', user_id: 'user_david', user_name: 'David Ndlovu', action: 'Submitted request', details: 'Cement — 100 bags', entity_type: 'request', entity_id: 'req_cement_live', amount: 8800, created_at: hoursAgoIso(2) }
    ]
  };
}
