/*
  dashboard.js — role-specific home screens.

  This is the core of the financial-control amendment: the Owner, Project
  Manager, Site Manager and Supervisor no longer see "the same dashboard
  with different buttons" — each gets the view built for their job.
  Owner = company financial control centre. PM = project command centre.
  Site Manager = today's site operations. Supervisor = my requests + four
  big buttons, nothing else.
*/

import { getSession, ROLES } from './state.js';
import {
  getUser, getCompany, getProject, listProjects,
  computeCompanyHealth, computeCompanySpending, computeMoneyLeaksBreakdown,
  computeAttentionItems, listRequestsAwaitingUser, computeProjectOverview,
  listAuditLog, projectIdsForUser, listRequests, listMaterials, listVehicles, listUsers,
  computeDailyBriefing, computeCompanyFinancials, computeSavingsSummary,
  computeMoneyAtRisk, computeBuildGuardImpact, computeProjectFinancials,
  computeProjectHealth
} from './db.js';
import { formatCurrency, escapeHtml, timeAgo } from './utils.js';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function firstName(fullName) { return (fullName || '').split(' ')[0]; }

function todayLabel() {
  return new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** Shared greeting header: name on the left, today's date pinned right on desktop. */
function dashboardHead(user, subtitle) {
  return `
    <div class="page-head">
      <div>
        <div class="page-title">${greeting()}, ${escapeHtml(firstName(user.name))} 👋</div>
        <div class="page-head-sub">${subtitle}</div>
      </div>
      <span class="date-pill">📅 ${todayLabel()}</span>
    </div>`;
}

export function renderDashboard(container) {
  const session = getSession();
  const user = getUser(session.userId);
  const company = getCompany(session.companyId);

  if (session.role === ROLES.OWNER) return renderOwnerDashboard(container, { session, user, company });
  if (session.role === ROLES.PROJECT_MANAGER) return renderPMDashboard(container, { session, user, company });
  if (session.role === ROLES.SITE_MANAGER) return renderSiteManagerDashboard(container, { session, user, company });
  return renderSupervisorDashboard(container, { session, user, company });
}

// ---------------------------------------------------------------------------
// OWNER — company-wide financial control centre
// ---------------------------------------------------------------------------

/**
 * The EXECUTIVE DASHBOARD (Phase 2 §1).
 * Answers "if I only have 2 minutes, what do I need to know about my company?"
 * Ordered by progressive disclosure (§53): the briefing tells the owner what
 * to DO, then the money position, then project health, then drill-downs.
 */
function renderOwnerDashboard(container, { session, user, company }) {
  const briefing = computeDailyBriefing(session.companyId, user);
  const fin = computeCompanyFinancials(session.companyId);
  const health = computeCompanyHealth(session.companyId);
  const spending = computeCompanySpending(session.companyId);
  const savings = computeSavingsSummary(session.companyId);
  const atRisk = computeMoneyAtRisk(session.companyId);
  const impact = computeBuildGuardImpact(session.companyId);
  const pendingForMe = listRequestsAwaitingUser(user);
  const pendingAmount = round2sum(pendingForMe);

  // Brand-new company? Show a setup checklist instead of a dashboard full of zeros.
  const setup = {
    projects: listProjects(session.companyId).length,
    materials: listMaterials(session.companyId).length,
    vehicles: listVehicles(session.companyId).length,
    team: listUsers(session.companyId).filter((u) => u.id !== user.id).length
  };
  const setupDone = Object.values(setup).filter((n) => n > 0).length;
  const showSetup = setup.projects === 0 || setupDone < 4;

  container.innerHTML = `
    ${dashboardHead(user, `${escapeHtml(company.company_name)} · Owner`)}

    ${showSetup ? `
      <div class="card setup-card mb-3">
        <div class="flex justify-between items-center"><div class="eyebrow">🚀 Get set up</div><span class="badge badge-warning">${setupDone} of 4 done</span></div>
        <div class="setup-progress">${[setup.projects, setup.materials, setup.vehicles, setup.team].map((n) => `<span class="${n > 0 ? 'done' : ''}"></span>`).join('')}</div>
        <p class="faint mb-2">${setup.projects === 0 ? 'Start with a project — everything in BuildGuard hangs off one.' : 'A few more steps and your team can start capturing on site.'}</p>
        ${setupStep('Add your first project', 'Budget, dates and who manages it', setup.projects > 0, '#/projects')}
        ${setupStep('Add materials', 'What sites are allowed to request', setup.materials > 0, '#/settings')}
        ${setupStep('Add vehicles & equipment', 'So fuel can be tracked and anomalies caught', setup.vehicles > 0, '#/settings')}
        ${setupStep('Invite your team', 'Project managers, site managers, supervisors', setup.team > 0, '#/team')}
      </div>
    ` : ''}

    <!-- 1. TODAY'S BRIEFING — the system surfacing problems, not the owner hunting -->
    <div class="card briefing-card mb-3">
      <div class="eyebrow mb-2">📋 Today's Briefing</div>
      ${briefing.count
        ? `<div style="font-weight:800;font-size:16px;margin-bottom:10px;">${briefing.count} thing${briefing.count > 1 ? 's' : ''} require${briefing.count > 1 ? '' : 's'} your attention.</div>
           ${briefing.items.map((b) => `
             <div class="briefing-item" data-route="${b.route}">
               <span>${b.icon}</span><span>${escapeHtml(b.text)}</span>
             </div>`).join('')}`
        : `<div style="font-weight:800;font-size:16px;">Nothing needs your attention right now. 🟢</div>`}
      ${briefing.positive ? `
        <div class="briefing-item briefing-positive" data-route="${briefing.positive.route}">
          <span>${briefing.positive.icon}</span><span>${escapeHtml(briefing.positive.text)}</span>
        </div>` : ''}
    </div>

    <!-- 2. COMPANY FINANCIAL HEALTH — true exposure, not just money already spent -->
    <div class="section-title">💰 Company Financial Health</div>
    <div class="grid grid-3">
      <div class="card stat-card accent-total"><div class="label">Total Budget</div><div class="value">${formatCurrency(fin.totalBudget, { abbreviate: true })}</div></div>
      <div class="card stat-card accent-material"><div class="label">Actual Spend</div><div class="value">${formatCurrency(fin.actual, { abbreviate: true })}</div></div>
      <div class="card stat-card accent-warning"><div class="label">Committed</div><div class="value">${formatCurrency(fin.committed, { abbreviate: true })}</div></div>
      <div class="card stat-card accent-fuel"><div class="label">Forecast</div><div class="value">${formatCurrency(fin.forecast, { abbreviate: true })}</div></div>
      <div class="card stat-card ${fin.buffer < 0 ? 'accent-danger' : 'accent-savings'}">
        <div class="label">${fin.buffer < 0 ? 'Forecast Overrun' : 'Remaining Buffer'}</div>
        <div class="value">${formatCurrency(Math.abs(fin.buffer), { abbreviate: true })}</div>
      </div>
      <div class="card stat-card accent-warning" id="pendingCard" style="cursor:pointer">
        <div class="label">Pending Approvals</div>
        <div class="value">${pendingForMe.length}</div>
        <div class="faint">${formatCurrency(pendingAmount)}</div>
      </div>
    </div>
    <p class="faint mt-2">Expected total ${formatCurrency(fin.expectedTotal)} of ${formatCurrency(fin.totalBudget)} budget (${fin.exposurePct}%) · <em>Management Estimate</em></p>

    <!-- 3. SAVED vs AT RISK — the two numbers that justify the product -->
    <div class="grid grid-2 mt-3">
      <div class="card stat-card accent-savings" id="savingsCard" style="cursor:pointer">
        <div class="label">💚 Money Saved (this month)</div>
        <div class="value">${formatCurrency(savings.thisMonth)}</div>
        <div class="faint">${formatCurrency(savings.ytd)} year to date</div>
      </div>
      <div class="card stat-card accent-danger" id="riskCard" style="cursor:pointer">
        <div class="label">⚠️ Money at Risk</div>
        <div class="value">${formatCurrency(atRisk.total)}</div>
        <div class="faint">Potential variance — requires review</div>
      </div>
    </div>

    <!-- 4. PROJECT HEALTH -->
    <div class="section-title">🏗️ Project Health</div>
    <div class="grid grid-3 mb-3">
      <div class="card stat-card accent-savings"><div class="label">🟢 Healthy</div><div class="value">${health.counts.healthy}</div></div>
      <div class="card stat-card accent-warning"><div class="label">🟠 Watch</div><div class="value">${health.counts.watch}</div></div>
      <div class="card stat-card accent-danger"><div class="label">🔴 Action Required</div><div class="value">${health.counts.action}</div></div>
    </div>
    <div class="card">
      ${fin.projects.length ? fin.projects.map(projectExecRow).join('') : `<div class="empty-state"><div class="emoji">🏗️</div>No projects yet — add one to see budget, spend and forecast here.</div>`}
    </div>
    <button class="btn btn-outline mt-3" id="viewAllProjectsBtn">View all projects →</button>

    <!-- 5. WHERE THE MONEY WENT -->
    <div class="section-title">💵 Company Spending <span class="faint" style="font-weight:600">This Month</span></div>
    <div class="grid grid-3">
      <div class="card stat-card accent-material"><div class="label">Materials</div><div class="value">${formatCurrency(spending.materialSpend, { abbreviate: true })}</div></div>
      <div class="card stat-card accent-fuel"><div class="label">Fuel</div><div class="value">${formatCurrency(spending.fuelSpend, { abbreviate: true })}</div></div>
      <div class="card stat-card"><div class="label">Other</div><div class="value">${formatCurrency(spending.otherSpend, { abbreviate: true })}</div></div>
    </div>
    <button class="btn btn-outline mt-2" id="viewInsightsBtn">📈 Spending insights &amp; trends →</button>

    <!-- 6. PRODUCT VALUE — what BuildGuard did for the company this month -->
    <div class="section-title">🛡️ BuildGuard Impact <span class="faint" style="font-weight:600">This Month</span></div>
    <div class="card">
      ${impactRow('Potential savings identified', formatCurrency(impact.potentialSavingsIdentified))}
      ${impactRow('Money at risk flagged', formatCurrency(impact.moneyAtRisk))}
      ${impactRow('Duplicate purchases prevented', `${impact.duplicatesPrevented} · ${formatCurrency(impact.duplicateValue)}`)}
      ${impactRow('Price variances detected', impact.priceVariancesDetected)}
      ${impactRow('Delivery shortages detected', impact.deliveryShortagesDetected)}
      ${impactRow('Fuel anomalies detected', impact.fuelAnomaliesDetected)}
      ${impactRow('Stock variances detected', impact.inventoryVariancesDetected)}
    </div>
  `;

  wireAttentionClicks(container);
  container.querySelector('#pendingCard').addEventListener('click', () => { location.hash = '#/approvals'; });
  container.querySelector('#savingsCard').addEventListener('click', () => { location.hash = '#/savings'; });
  container.querySelector('#riskCard').addEventListener('click', () => { location.hash = '#/moneyleaks'; });
  container.querySelector('#viewAllProjectsBtn').addEventListener('click', () => { location.hash = '#/projects'; });
  container.querySelector('#viewInsightsBtn').addEventListener('click', () => { location.hash = '#/insights'; });
  container.querySelectorAll('[data-project]').forEach((el) => {
    el.addEventListener('click', () => { location.hash = `#/projects/${el.dataset.project}`; });
  });
}

function setupStep(title, sub, done, route) {
  return `
    <div class="list-item setup-step ${done ? 'done' : ''}" data-route="${route}">
      <span class="setup-check" aria-hidden="true">${done ? '✓' : ''}</span>
      <span class="li-main"><div class="li-title">${escapeHtml(title)}</div><div class="li-sub">${escapeHtml(sub)}</div></span>
      <span class="li-end faint">${done ? 'Done' : '→'}</span>
    </div>`;
}

function impactRow(label, value) {
  return `<div class="flex justify-between items-center" style="padding:7px 0;border-bottom:1px solid var(--color-border);">
    <span class="muted">${escapeHtml(label)}</span><span style="font-weight:800">${value}</span>
  </div>`;
}

/** Executive project row — budget, actual, committed, forecast and status at a glance. */
function projectExecRow(f) {
  const manager = f.project.manager_id ? getUser(f.project.manager_id) : null;
  // Badge from the shared health calculation so this row can never contradict
  // the health counts above it or the project detail screen.
  const health = computeProjectHealth(f.project.company_id, f.project);
  const healthBadge = { healthy: 'badge-success', watch: 'badge-warning', action: 'badge-danger' }[health.key];
  return `
    <div class="list-item" data-project="${f.project.id}" style="flex-wrap:wrap;">
      <span class="li-icon">${health.icon}</span>
      <span class="li-main">
        <div class="li-title">${escapeHtml(f.project.project_name)}</div>
        <div class="li-sub">${manager ? escapeHtml(manager.name) : 'Unassigned'} · ${Math.round(f.spendPct)}% of budget spent</div>
        <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, f.spendPct)}%;background:${f.buffer < 0 ? 'var(--color-danger)' : f.spendPct >= 75 ? 'var(--color-warning)' : 'var(--color-success)'}"></div></div>
        <div class="faint">Actual ${formatCurrency(f.actual, { abbreviate: true })} · Committed ${formatCurrency(f.committed, { abbreviate: true })} · Forecast ${formatCurrency(f.forecast, { abbreviate: true })}</div>
      </span>
      <span class="li-end">
        <span class="badge ${healthBadge}">${health.label}</span>
        <div class="faint mt-1" style="color:${f.buffer < 0 ? 'var(--color-danger)' : 'var(--color-text-muted)'}">
          ${f.buffer < 0 ? 'Over by ' : 'Buffer '}${formatCurrency(Math.abs(f.buffer), { abbreviate: true })}
        </div>
      </span>
    </div>`;
}

// ---------------------------------------------------------------------------
// PROJECT MANAGER — project command centre
// ---------------------------------------------------------------------------

function renderPMDashboard(container, { session, user, company }) {
  const myProjectIds = projectIdsForUser(user);
  const myProjects = myProjectIds.map((id) => computeProjectFinancials(session.companyId, id)).filter(Boolean);
  const pendingForMe = listRequestsAwaitingUser(user);
  const pendingAmount = round2sum(pendingForMe);
  const attention = computeAttentionItems(session.companyId, user);
  const overviews = myProjectIds.map((id) => computeProjectOverview(session.companyId, id)).filter(Boolean);
  const totalLeak = overviews.reduce((s, p) => s + p.potentialLeakage, 0);
  const totalCommitted = myProjects.reduce((s, f) => s + f.committed, 0);

  container.innerHTML = `
    ${dashboardHead(user, `${escapeHtml(company.company_name)} · Project Manager`)}

    <div class="grid grid-3">
      <div class="card stat-card accent-total"><div class="label">My Projects</div><div class="value">${myProjects.length}</div></div>
      <div class="card stat-card accent-warning"><div class="label">Committed</div><div class="value">${formatCurrency(totalCommitted, { abbreviate: true })}</div></div>
      <div class="card stat-card accent-warning" id="pendingCard" style="cursor:pointer"><div class="label">Pending My Approval</div><div class="value">${pendingForMe.length}</div></div>
      <div class="card stat-card accent-danger" style="grid-column:1/-1"><div class="label">Money at Risk on my projects</div><div class="value">${formatCurrency(totalLeak)}</div></div>
    </div>

    <div class="section-title">🎯 Needs Your Action</div>
    ${renderAttentionList(attention)}

    <div class="section-title">🏗️ My Projects</div>
    <div class="card">
      ${myProjects.length ? myProjects.map(projectExecRow).join('') : `<div class="empty-state"><div class="emoji">🏗️</div>No projects assigned yet.</div>`}
    </div>
  `;

  wireAttentionClicks(container);
  container.querySelector('#pendingCard').addEventListener('click', () => { location.hash = '#/approvals'; });
  container.querySelectorAll('[data-project]').forEach((el) => {
    el.addEventListener('click', () => { location.hash = `#/projects/${el.dataset.project}`; });
  });
}

// ---------------------------------------------------------------------------
// SITE MANAGER — today's site operations (no company financials)
// ---------------------------------------------------------------------------

function renderSiteManagerDashboard(container, { session, user, company }) {
  const myProjectIds = projectIdsForUser(user);
  const projects = myProjectIds.map((id) => getProject(id)).filter(Boolean);
  const pendingForMe = listRequestsAwaitingUser(user);
  const myRecentActivity = myProjectIds
    .flatMap((pid) => listAuditLog(session.companyId, { projectId: pid }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 8);
  const recentDecisions = listRequests(session.companyId).filter((r) =>
    myProjectIds.includes(r.project_id) && r.stages.site_manager && r.stages.site_manager.actor === session.userId
  ).slice(0, 5);

  container.innerHTML = `
    ${dashboardHead(user, `${escapeHtml(company.company_name)} · ${escapeHtml(projects.map((p) => p.project_name).join(', ') || 'Site Manager')}`)}

    <div class="grid grid-2">
      <div class="card stat-card accent-warning" id="pendingCard" style="cursor:pointer"><div class="label">Requests to Verify</div><div class="value">${pendingForMe.length}</div></div>
      <div class="card stat-card"><div class="label">Sites</div><div class="value">${projects.length}</div></div>
    </div>

    ${quickActionsHtml()}

    <div class="section-title">🕒 Today's Site Activity</div>
    <div class="card">
      ${myRecentActivity.length ? myRecentActivity.map(activityRow).join('') : `<div class="empty-state"><div class="emoji">📭</div>Nothing logged yet today.</div>`}
    </div>

    ${recentDecisions.length ? `
      <div class="section-title">✅ Recently Verified by You</div>
      <div class="card">${recentDecisions.map((r) => requestMiniRow(r)).join('')}</div>
    ` : ''}
  `;

  wireQuickActions(container);
  container.querySelector('#pendingCard').addEventListener('click', () => { location.hash = '#/approvals'; });
}

function requestMiniRow(r) {
  const badge = { pending: 'badge-warning', approved: 'badge-success', rejected: 'badge-danger', info_requested: 'badge-info' }[r.status] || 'badge-neutral';
  return `
    <div class="list-item">
      <span class="li-icon">${r.request_type === 'material' ? '📦' : '💳'}</span>
      <span class="li-main"><div class="li-title">${formatCurrency(r.amount)}</div><div class="li-sub">${timeAgo(r.created_at)}</div></span>
      <span class="li-end"><span class="badge ${badge}">${r.status.replace('_', ' ')}</span></span>
    </div>`;
}

// ---------------------------------------------------------------------------
// SUPERVISOR — my requests + four big buttons, nothing else
// ---------------------------------------------------------------------------

function renderSupervisorDashboard(container, { session, user, company }) {
  const myProjectIds = projectIdsForUser(user);
  const project = myProjectIds.length ? getProject(myProjectIds[0]) : null;
  const myRequests = listRequests(session.companyId).filter((r) => r.requested_by === session.userId);
  const counts = {
    pending: myRequests.filter((r) => r.status === 'pending' || r.status === 'info_requested').length,
    approved: myRequests.filter((r) => r.status === 'approved').length,
    rejected: myRequests.filter((r) => r.status === 'rejected').length
  };

  container.innerHTML = `
    ${dashboardHead(user, `${escapeHtml(company.company_name)} · Supervisor`)}

    <div class="section-title" style="margin-top:0">📍 My Site</div>
    <div class="card">${project ? escapeHtml(project.project_name) : 'No site assigned'}</div>

    <div class="section-title">📋 My Requests</div>
    <div class="grid grid-3">
      <div class="card stat-card accent-warning"><div class="label">Pending</div><div class="value">${counts.pending}</div></div>
      <div class="card stat-card accent-savings"><div class="label">Approved</div><div class="value">${counts.approved}</div></div>
      <div class="card stat-card accent-danger"><div class="label">Rejected</div><div class="value">${counts.rejected}</div></div>
    </div>

    <div class="section-title">⚡ Quick Actions</div>
    ${quickActionsHtml()}

    ${myRequests.length ? `
      <div class="section-title">🕒 Recent</div>
      <div class="card">${myRequests.slice(0, 5).map(requestMiniRow).join('')}</div>
    ` : ''}
  `;
  wireQuickActions(container);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function renderAttentionList(items) {
  if (!items.length) return `<div class="card empty-state"><div class="emoji">✅</div>Nothing needs your attention right now.</div>`;
  return items.map((item) => `
    <div class="leak-item sev-${item.severity}" data-route="${item.route || ''}" style="cursor:pointer">
      <span class="leak-icon">${item.icon}</span>
      <div class="leak-body"><div class="leak-title">${escapeHtml(item.label)}</div></div>
      ${item.amount ? `<div class="leak-amount">${formatCurrency(item.amount)}</div>` : ''}
    </div>
  `).join('');
}

function wireAttentionClicks(container) {
  container.querySelectorAll('[data-route]').forEach((el) => {
    if (!el.dataset.route) return;
    el.addEventListener('click', () => { location.hash = el.dataset.route; });
  });
}

function activityRow(entry) {
  return `
    <div class="list-item">
      <span class="li-icon">🕒</span>
      <span class="li-main"><div class="li-title">${escapeHtml(entry.action)}</div><div class="li-sub">${escapeHtml(entry.user_name)} · ${escapeHtml(entry.details || '')}</div></span>
      <span class="li-end faint">${timeAgo(entry.created_at)}</span>
    </div>`;
}

export function quickActionsHtml() {
  return `
    <div class="quick-actions">
      <button class="qa-tile qa-blue" data-action="buy-material"><span class="qa-icon">🛒</span><span class="qa-label">Request Material</span></button>
      <button class="qa-tile qa-green" data-action="record-fuel"><span class="qa-icon">⛽</span><span class="qa-label">Record Fuel</span></button>
      <button class="qa-tile qa-yellow" data-action="receive-delivery"><span class="qa-icon">🚚</span><span class="qa-label">Receive Delivery</span></button>
      <button class="qa-tile qa-red" data-action="report-shortage"><span class="qa-icon">⚠️</span><span class="qa-label">Report Shortage</span></button>
      <button class="qa-tile qa-grey" data-action="request-expense" style="grid-column: 1 / -1;"><span class="qa-icon">💳</span><span class="qa-label">Request Expense</span></button>
    </div>
  `;
}

export function wireQuickActions(root) {
  const map = {
    'buy-material': '#/purchases/new',
    'record-fuel': '#/fuel/new',
    'receive-delivery': '#/deliveries/new',
    'report-shortage': '#/deliveries/shortage',
    'request-expense': '#/expenses/new'
  };
  root.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => { location.hash = map[btn.dataset.action]; });
  });
}

function round2sum(requests) {
  return requests.reduce((s, r) => s + (r.amount || 0), 0);
}
