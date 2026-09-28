/*
  expenses.js — REQUEST EXPENSE. A generic authorization request (Fuel,
  Transport, Equipment, Repairs, PPE, Tools, Other) that flows through the
  exact same Supervisor -> Site Manager -> Project Manager -> Owner
  approval chain as a material request — this is what lets BuildGuard grow
  into the company's general financial-control layer, not just materials.
*/

import { getSession, ROLES } from './state.js';
import { getUser, listProjects, createRequest, projectIdsForUser } from './db.js';
import { escapeHtml, toast } from './utils.js';

const CATEGORIES = ['Fuel', 'Materials', 'Transport', 'Equipment', 'Repairs', 'PPE', 'Tools', 'Other'];
const CATEGORY_ICON = { Fuel: '⛽', Materials: '🧱', Transport: '🚚', Equipment: '🚜', Repairs: '🔧', PPE: '🦺', Tools: '🛠️', Other: '💳' };

export function renderRequestExpenseForm(container) {
  const session = getSession();
  const user = getUser(session.userId);
  const myProjectIds = projectIdsForUser(user);
  const projects = listProjects(session.companyId).filter((p) => user.role === ROLES.OWNER || myProjectIds.includes(p.id));

  const data = { category: null, projectId: projects.length === 1 ? projects[0].id : null, amount: '', urgency: 'normal', reason: '' };

  function draw() {
    container.innerHTML = `
      <button class="btn btn-ghost btn-sm mb-2" id="backBtn">← Back</button>
      <div class="page-title">💳 Request Expense</div>
      <div class="card">
        <div class="field">
          <label>Category</label>
          <div class="chip-group">
            ${CATEGORIES.map((c) => `<button class="chip ${data.category === c ? 'selected' : ''}" data-cat="${c}">${CATEGORY_ICON[c]} ${c}</button>`).join('')}
          </div>
        </div>
        <div class="field">
          <label>Project</label>
          <select id="projectSelect">
            <option value="">Select project...</option>
            ${projects.map((p) => `<option value="${p.id}" ${data.projectId === p.id ? 'selected' : ''}>${escapeHtml(p.project_name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Amount (R)</label>
          <input type="number" id="amountInput" min="1" step="0.01" value="${escapeHtml(data.amount)}" placeholder="e.g. 3200">
        </div>
        <div class="field">
          <label>Urgency</label>
          <div class="chip-group">
            <button class="chip ${data.urgency === 'normal' ? 'selected' : ''}" data-urgency="normal">🟢 Normal</button>
            <button class="chip soon ${data.urgency === 'soon' ? 'selected' : ''}" data-urgency="soon">🟡 Soon</button>
            <button class="chip urgent ${data.urgency === 'urgent' ? 'selected' : ''}" data-urgency="urgent">🔴 Urgent</button>
          </div>
        </div>
        <div class="field">
          <label>Reason</label>
          <textarea id="reasonInput" placeholder="e.g. TLB hydraulic hose burst on site">${escapeHtml(data.reason)}</textarea>
        </div>
        <button class="btn btn-primary w-full" id="submitBtn">Submit Request</button>
      </div>
    `;

    container.querySelector('#backBtn').addEventListener('click', () => history.back());
    container.querySelectorAll('[data-cat]').forEach((el) => el.addEventListener('click', () => { data.category = el.dataset.cat; draw(); }));
    container.querySelectorAll('[data-urgency]').forEach((el) => el.addEventListener('click', () => { data.urgency = el.dataset.urgency; draw(); }));
    container.querySelector('#projectSelect').addEventListener('change', (e) => { data.projectId = e.target.value; });
    container.querySelector('#amountInput').addEventListener('input', (e) => { data.amount = e.target.value; });
    container.querySelector('#reasonInput').addEventListener('input', (e) => { data.reason = e.target.value; });
    container.querySelector('#submitBtn').addEventListener('click', submit);
  }

  function submit() {
    if (!data.category) { toast('Choose a category', 'error'); return; }
    if (!data.projectId) { toast('Select a project', 'error'); return; }
    if (!(Number(data.amount) > 0)) { toast('Enter a valid amount', 'error'); return; }
    try {
      createRequest({
        companyId: session.companyId, projectId: data.projectId, requestedBy: session.userId, requestedByRole: user.role,
        requestType: 'expense', category: data.category, amount: Number(data.amount), urgency: data.urgency, reason: data.reason
      });
      toast('Expense request submitted ✅', 'success');
      location.hash = user.role === ROLES.SUPERVISOR ? '#/dashboard' : '#/purchases';
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  draw();
}
