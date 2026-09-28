/*
  auth.js — login, registration and invitation acceptance.

  DEMO MODE        pick a company, pick a person. No passwords, nothing leaves
                   the browser. For sales demos.
  PRODUCTION MODE  real Supabase Auth (email + password). Three flows:
    1. Sign in       -> look up the users row for this login -> load company data.
    2. Create company -> sign up, then insert the company + owner rows IN ORDER
                        (users has a foreign key to companies, so the writes are
                        awaited sequentially rather than fire-and-forget).
    3. Accept invite -> an Owner invited this email earlier (users row exists
                        with status 'invited', no auth_id). On sign-up we attach
                        the new login to that row. No admin key needed.
*/

import {
  listCompanies, listUsers, listProjects, createCompanyAccount,
  buildCompanyAccountRecords, getUserByAuthId, getUserByEmail,
  loadCompanyData, unloadCompanyData
} from './db.js';
import { setSession, clearSession, ROLE_LABELS } from './state.js';
import { IS_PRODUCTION } from './config.js';
import { getSupabase } from './supabaseClient.js';
import { hydrate, flushWrites } from './storage.js';
import { escapeHtml, toast } from './utils.js';

const ROLE_ICON = { owner: '👑', project_manager: '📐', site_manager: '🦺', supervisor: '🔧' };

const LOGO_SVG = `<svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="120" fill="#0C3124"/><path d="M256 76 L426 156 V246 C426 356 356 436 256 466 C156 436 86 356 86 246 V156 Z" fill="#2E9A6B" stroke="#95D5B2" stroke-width="12"/><path d="M256 130 L378 186 V244 C378 328 324 388 256 412 C188 388 134 328 134 244 V186 Z" fill="#F2A21B"/><path d="M186 300 L226 260 L256 288 L326 210" stroke="#0C3124" stroke-width="20" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="326" cy="210" r="15" fill="#0C3124"/></svg>`;

/**
 * Every auth screen shares one split layout: on desktop a dark brand panel
 * on the left states what the product is for; the form sits on the right.
 * On phones only the form shows. Keeps the six auth screens visually
 * identical without each one re-declaring the shell.
 */
function authOpen() {
  return `
    <div class="auth-page">
      <aside class="auth-hero" aria-hidden="true">
        <div class="auth-hero-brand"><span class="brand-mark">${LOGO_SVG}</span> BuildGuard</div>
        <div>
          <h2>Every rand on every site, <em>under control.</em></h2>
          <p>Approval workflows, live budget exposure and money-leak detection built for South African construction companies.</p>
          <div class="auth-proof">
            <div class="auth-proof-item"><span class="ico">🔐</span><div><strong>Nothing is spent without sign-off</strong>Multi-stage approvals with limits you set per role.</div></div>
            <div class="auth-proof-item"><span class="ico">📈</span><div><strong>Forecast, not hindsight</strong>Committed vs actual vs forecast on every project, every day.</div></div>
            <div class="auth-proof-item"><span class="ico">🛡️</span><div><strong>Leaks caught automatically</strong>Fuel anomalies, price variances, duplicate orders and short deliveries.</div></div>
          </div>
        </div>
        <div class="auth-hero-foot">Financial control for construction · South Africa</div>
      </aside>
      <div class="auth-panel">
      <div class="login-wrap">
        <div class="login-logo">${LOGO_SVG}</div>`;
}
function authClose() { return `</div></div></div>`; }

export function renderLogin(container) {
  if (IS_PRODUCTION) return renderProductionAuth(container);
  return renderDemoLogin(container);
}

// ===========================================================================
// PRODUCTION
// ===========================================================================

/**
 * On app boot: if Supabase already has a session (user came back), resolve
 * it into an app session and load their company. Returns true if logged in.
 */
export async function restoreProductionSession() {
  if (!IS_PRODUCTION) return false;
  const sb = await getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { clearSession(); return false; }
  return resolveLogin(session.user);
}

/**
 * Insert the company + owner rows for a "Create Company Account" sign-up.
 * Shared by two callers: the happy path (session already present right after
 * signUp, e.g. email confirmation is off) and the deferred path in
 * resolveLogin (confirmation was required, and this is the first time this
 * auth user has come back since confirming — on ANY device).
 */
async function finishCompanyRegistration(authUser, details) {
  const sb = await getSupabase();
  const { company, owner } = buildCompanyAccountRecords({ ...details, authId: authUser.id });
  let res = await sb.from('companies').insert(company);
  if (res.error) throw new Error('Could not create company: ' + res.error.message);
  res = await sb.from('users').insert(owner);
  if (res.error) throw new Error('Could not create owner account: ' + res.error.message);
  await sb.from('audit_log').insert({
    id: 'audit_' + Date.now().toString(36), company_id: company.id, user_id: owner.id, user_name: owner.name,
    action: 'Company registered', details: company.company_name + ' created', entity_type: 'company', entity_id: company.id
  });
  return { company, owner };
}

/** Map an authenticated Supabase user to an app session + company data. */
async function resolveLogin(authUser) {
  await hydrate(); // RLS lets us read our own users row (and any invite for our email)
  let userRow = getUserByAuthId(authUser.id);

  if (!userRow) {
    // Not linked yet — was this email invited by an Owner?
    const invite = getUserByEmail(authUser.email);
    if (invite && !invite.auth_id) {
      const sb = await getSupabase();
      const { error } = await sb.from('users').update({ auth_id: authUser.id, status: 'active' }).eq('id', invite.id);
      if (error) throw new Error('Could not accept your invitation: ' + error.message);
      await hydrate(); // re-pull now that we belong to a company
      userRow = getUserByAuthId(authUser.id);
    }
  }

  if (!userRow && authUser.user_metadata && authUser.user_metadata.pending_company) {
    // This auth user registered a company but had to confirm their email
    // first, so the company/owner rows were never created at sign-up time.
    // This is the first time they've come back since confirming — on
    // whichever device that happens to be — so finish it now.
    const pending = authUser.user_metadata.pending_company;
    await finishCompanyRegistration(authUser, pending);
    const sb = await getSupabase();
    await sb.auth.updateUser({ data: { pending_company: null } }); // done — never redo this
    await hydrate();
    userRow = getUserByAuthId(authUser.id);
  }

  if (!userRow) return false; // signed in, but no company — caller shows guidance
  if (userRow.status === 'inactive') throw new Error('This account has been deactivated. Contact your company owner.');

  setSession({ companyId: userRow.company_id, userId: userRow.id, role: userRow.role });
  await loadCompanyData();
  return true;
}

export async function signOutProduction() {
  if (!IS_PRODUCTION) return;
  await flushWrites(); // don't drop the session while a write is still in flight
  const sb = await getSupabase();
  await sb.auth.signOut();
  unloadCompanyData();
  clearSession();
}

function renderProductionAuth(container) {
  let mode = 'signin'; // 'signin' | 'register' | 'nocompany'

  function draw() {
    if (mode === 'register') return drawRegister();
    if (mode === 'nocompany') return drawNoCompany();
    if (mode === 'invite') return drawAcceptInvite();
    container.innerHTML = `
      ${authOpen()}
        <h1 class="auth-title">BuildGuard</h1>
        <p class="auth-sub">Your company's financial control centre.</p>
        <div class="card auth-card">
          <div class="field"><label>Email</label><input type="email" id="emailInput" autocomplete="email" placeholder="you@company.co.za"></div>
          <div class="field"><label>Password</label><input type="password" id="passwordInput" autocomplete="current-password"></div>
          <button class="btn btn-primary w-full" id="signInBtn">Sign In</button>
          <button class="btn btn-ghost w-full mt-2" id="forgotBtn">Forgot password?</button>
        </div>
        <div class="auth-divider">New here?</div>
        <div class="auth-alt">
          <button class="btn btn-outline" id="registerBtn">➕ Create Company Account</button>
          <button class="btn btn-ghost" id="inviteBtn">✉️ I was invited — set up my login</button>
        </div>
      ${authClose()}
    `;
    container.querySelector('#signInBtn').addEventListener('click', signIn);
    container.querySelector('#passwordInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') signIn(); });
    container.querySelector('#registerBtn').addEventListener('click', () => { mode = 'register'; draw(); });
    container.querySelector('#inviteBtn').addEventListener('click', () => { mode = 'invite'; draw(); });
    container.querySelector('#forgotBtn').addEventListener('click', forgotPassword);
  }

  function drawAcceptInvite() {
    container.innerHTML = `
      ${authOpen()}
        <h1 class="auth-title">Set up your login</h1>
        <p class="auth-sub">Use the <strong>same email address</strong> your company owner invited.</p>
        <div class="card auth-card">
          <div class="field"><label>Email</label><input type="email" id="invEmail" autocomplete="email" placeholder="you@company.co.za"></div>
          <div class="field"><label>Choose a password</label><input type="password" id="invPassword" autocomplete="new-password" placeholder="Minimum 8 characters"></div>
          <div class="field"><label>Confirm password</label><input type="password" id="invPassword2" autocomplete="new-password"></div>
          <button class="btn btn-primary w-full" id="acceptBtn">Join My Company</button>
          <button class="btn btn-ghost w-full mt-2" id="backBtn">← Back to sign in</button>
        </div>
        <p class="auth-foot">Not invited yet? Ask your company owner to add you under Team → Invite User.</p>
      ${authClose()}
    `;
    container.querySelector('#backBtn').addEventListener('click', () => { mode = 'signin'; draw(); });
    container.querySelector('#acceptBtn').addEventListener('click', acceptInvite);
  }

  async function acceptInvite() {
    const email = container.querySelector('#invEmail').value.trim();
    const password = container.querySelector('#invPassword').value;
    const password2 = container.querySelector('#invPassword2').value;
    if (!email) { toast('Enter the email you were invited with', 'error'); return; }
    if (password.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
    if (password !== password2) { toast('Passwords do not match', 'error'); return; }
    const btn = container.querySelector('#acceptBtn');
    btn.disabled = true; btn.textContent = 'Joining…';
    try {
      const sb = await getSupabase();
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        toast('Check your email to confirm your address, then sign in — your invitation will be linked automatically.', 'warn', 8000);
        mode = 'signin'; draw();
        return;
      }
      const ok = await resolveLogin(data.user); // finds the invite by email and claims it
      if (!ok) { mode = 'nocompany'; draw(); return; }
      toast('Welcome aboard!', 'success');
      location.hash = '#/dashboard';
    } catch (e) {
      toast(e.message || 'Could not set up login', 'error', 6000);
      btn.disabled = false; btn.textContent = 'Join My Company';
    }
  }

  async function signIn() {
    const email = container.querySelector('#emailInput').value.trim();
    const password = container.querySelector('#passwordInput').value;
    if (!email || !password) { toast('Enter your email and password', 'error'); return; }
    const btn = container.querySelector('#signInBtn');
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const sb = await getSupabase();
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const ok = await resolveLogin(data.user);
      if (!ok) { mode = 'nocompany'; draw(); return; }
      location.hash = '#/dashboard';
    } catch (e) {
      toast(e.message || 'Sign-in failed', 'error');
      btn.disabled = false; btn.textContent = 'Sign In';
    }
  }

  async function forgotPassword() {
    const email = container.querySelector('#emailInput').value.trim();
    if (!email) { toast('Enter your email first, then tap Forgot password', 'error'); return; }
    const sb = await getSupabase();
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) toast(error.message, 'error');
    else toast('Password reset email sent — check your inbox', 'success', 5000);
  }

  function drawNoCompany() {
    container.innerHTML = `
      ${authOpen()}
        <h1 class="auth-title">You're signed in, but not in a company yet</h1>
        <div class="card auth-card">
          <p>Your login works, but it isn't linked to a BuildGuard company.</p>
          <p class="mt-2"><strong>If you own a construction company:</strong> create its account below — you'll be its Owner.</p>
          <p class="mt-2"><strong>If you were invited:</strong> ask your company owner to check the invitation was sent to <em>exactly</em> this email address, then sign in again.</p>
          <button class="btn btn-primary w-full mt-3" id="registerBtn">➕ Create Company Account</button>
          <button class="btn btn-ghost w-full mt-2" id="signOutBtn">Sign out</button>
        </div>
      ${authClose()}
    `;
    container.querySelector('#registerBtn').addEventListener('click', () => { mode = 'register'; draw(); });
    container.querySelector('#signOutBtn').addEventListener('click', async () => { await signOutProduction(); mode = 'signin'; draw(); });
  }

  function drawRegister() {
    container.innerHTML = `
      ${authOpen()}
        <h1 class="auth-title">Create Company Account</h1>
        <p class="auth-sub">Welcome to BuildGuard. Let's set up your company.</p>
        <div class="card auth-card">
          <div class="field"><label>Company Name</label><input type="text" id="regCompany" placeholder="e.g. Ubuntu Construction"></div>
          <div class="field"><label>Company Registration Number</label><input type="text" id="regRegNo" placeholder="e.g. 2024/123456/07"></div>
          <div class="field"><label>Owner Name</label><input type="text" id="regOwnerName" placeholder="Your full name"></div>
          <div class="field"><label>Owner Email</label><input type="email" id="regEmail" autocomplete="email" placeholder="you@company.co.za"></div>
          <div class="field"><label>Phone Number</label><input type="tel" id="regPhone" placeholder="082 000 0000"></div>
          <div class="field"><label>Password</label><input type="password" id="regPassword" autocomplete="new-password" placeholder="Minimum 8 characters"></div>
          <div class="field"><label>Confirm Password</label><input type="password" id="regPassword2" autocomplete="new-password"></div>
          <button class="btn btn-primary w-full" id="createBtn">CREATE COMPANY</button>
          <button class="btn btn-ghost w-full mt-2" id="backBtn">← Back to sign in</button>
        </div>
      ${authClose()}
    `;
    container.querySelector('#backBtn').addEventListener('click', () => { mode = 'signin'; draw(); });
    container.querySelector('#createBtn').addEventListener('click', register);
  }

  async function register() {
    const companyName = container.querySelector('#regCompany').value.trim();
    const registrationNumber = container.querySelector('#regRegNo').value.trim();
    const ownerName = container.querySelector('#regOwnerName').value.trim();
    const ownerEmail = container.querySelector('#regEmail').value.trim();
    const phone = container.querySelector('#regPhone').value.trim();
    const password = container.querySelector('#regPassword').value;
    const password2 = container.querySelector('#regPassword2').value;

    if (!companyName || !ownerName || !ownerEmail) { toast('Company name, owner name and email are required', 'error'); return; }
    if (password.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
    if (password !== password2) { toast('Passwords do not match', 'error'); return; }

    const btn = container.querySelector('#createBtn');
    btn.disabled = true; btn.textContent = 'Creating…';

    try {
      const sb = await getSupabase();

      // 1. Create (or reuse) the login. If the person is already signed in
      //    (came from the "no company" screen), skip sign-up.
      const pendingDetails = { companyName, registrationNumber, ownerName, ownerEmail, phone };
      let { data: { session } } = await sb.auth.getSession();
      let authUser = session?.user || null;
      if (!authUser) {
        // The company/owner details go into the auth user's own metadata,
        // NOT this browser's storage — so whichever device this person next
        // signs in from (after confirming their email) can finish the job.
        // See resolveLogin's pending_company branch.
        const { data, error } = await sb.auth.signUp({
          email: ownerEmail, password,
          options: { data: { full_name: ownerName, pending_company: pendingDetails } }
        });
        if (error) throw error;
        authUser = data.user;
        if (!data.session) {
          // Email confirmation is switched on in this Supabase project.
          toast("Check your email to confirm your address. Your company will be set up automatically the moment you sign in.", 'warn', 8000);
          mode = 'signin'; draw();
          return;
        }
      }

      // 2. Insert company, THEN owner — awaited in order because of the FK.
      const { owner } = await finishCompanyRegistration(authUser, pendingDetails);

      // 3. Load it like any other login.
      await resolveLogin(authUser);
      toast(`Welcome to BuildGuard, ${ownerName.split(' ')[0]}!`, 'success');
      location.hash = '#/dashboard';
    } catch (e) {
      toast(e.message || 'Registration failed', 'error', 6000);
      btn.disabled = false; btn.textContent = 'CREATE COMPANY';
    }
  }

  draw();
}

// ===========================================================================
// DEMO
// ===========================================================================

function renderDemoLogin(container) {
  let selectedCompanyId = null;
  let mode = 'login';

  function draw() {
    if (mode === 'register') { drawRegister(); return; }
    const companies = listCompanies();
    container.innerHTML = `
      ${authOpen()}
        <h1 class="auth-title">BuildGuard</h1>
        <p class="auth-sub">Your company's financial control centre.</p>
        <div class="card auth-card">
          <div class="eyebrow mb-2">Step 1 · Choose a company</div>
          ${companies.map((c) => {
            const projectCount = listProjects(c.id).length;
            const userCount = listUsers(c.id).length;
            return `
              <div class="role-card ${selectedCompanyId === c.id ? 'selected' : ''}" data-company="${c.id}">
                <span class="r-icon">🏢</span>
                <div>
                  <div class="r-title">${escapeHtml(c.company_name)}</div>
                  <div class="r-sub">${projectCount} project${projectCount === 1 ? '' : 's'} · ${userCount} user${userCount === 1 ? '' : 's'}</div>
                </div>
              </div>`;
          }).join('')}
        </div>
        ${selectedCompanyId ? renderUserStep(selectedCompanyId) : ''}
        <div class="auth-divider">Or</div>
        <div class="auth-alt"><button class="btn btn-outline" id="registerBtn">➕ Create Company Account</button></div>
        <p class="auth-foot">🧪 DEMO MODE — sample South African construction data, nothing leaves your device.</p>
      ${authClose()}
    `;
    container.querySelectorAll('[data-company]').forEach((el) => {
      el.addEventListener('click', () => { selectedCompanyId = el.dataset.company; draw(); });
    });
    if (selectedCompanyId) {
      container.querySelectorAll('[data-user]').forEach((el) => {
        el.addEventListener('click', () => login(selectedCompanyId, el.dataset.user));
      });
    }
    container.querySelector('#registerBtn').addEventListener('click', () => { mode = 'register'; draw(); });
  }

  function renderUserStep(companyId) {
    const users = listUsers(companyId).filter((u) => u.status !== 'inactive');
    const grouped = ['owner', 'project_manager', 'site_manager', 'supervisor']
      .map((role) => ({ role, users: users.filter((u) => u.role === role) })).filter((g) => g.users.length);
    return `
      <div class="card mt-3">
        <div class="eyebrow mb-2">Step 2 · Continue as</div>
        ${grouped.map((g) => `
          <div class="faint mb-1" style="font-weight:700;">${escapeHtml(ROLE_LABELS[g.role])}</div>
          ${g.users.map((u) => `
            <div class="role-card" data-user="${u.id}">
              <span class="r-icon">${ROLE_ICON[u.role] || '👤'}</span>
              <div><div class="r-title">${escapeHtml(u.name)}</div><div class="r-sub">${escapeHtml(ROLE_LABELS[u.role] || u.role)}</div></div>
            </div>`).join('')}
        `).join('')}
      </div>`;
  }

  function drawRegister() {
    container.innerHTML = `
      ${authOpen()}
        <h1 class="auth-title">Create Company Account</h1>
        <p class="auth-sub">Welcome to BuildGuard. Let's set up your company.</p>
        <div class="card auth-card">
          <div class="field"><label>Company Name</label><input type="text" id="regCompany" placeholder="e.g. Ubuntu Construction"></div>
          <div class="field"><label>Company Registration Number</label><input type="text" id="regRegNo" placeholder="e.g. 2024/123456/07"></div>
          <div class="field"><label>Owner Name</label><input type="text" id="regOwnerName" placeholder="Your full name"></div>
          <div class="field"><label>Owner Email</label><input type="email" id="regEmail" placeholder="you@company.co.za"></div>
          <div class="field"><label>Phone Number</label><input type="tel" id="regPhone" placeholder="082 000 0000"></div>
          <div class="field"><label>Password</label><input type="password" id="regPassword" placeholder="Minimum 8 characters"></div>
          <div class="field"><label>Confirm Password</label><input type="password" id="regPassword2" placeholder="Re-enter password"></div>
          <button class="btn btn-primary w-full" id="createBtn">CREATE COMPANY</button>
          <button class="btn btn-ghost w-full mt-2" id="backToLoginBtn">← Back to login</button>
        </div>
        <p class="auth-foot">🧪 DEMO MODE — this creates a real company record in your browser's local storage; no email or password backend is connected.</p>
      ${authClose()}
    `;
    container.querySelector('#backToLoginBtn').addEventListener('click', () => { mode = 'login'; draw(); });
    container.querySelector('#createBtn').addEventListener('click', submitRegistration);
  }

  function submitRegistration() {
    const companyName = container.querySelector('#regCompany').value.trim();
    const registrationNumber = container.querySelector('#regRegNo').value.trim();
    const ownerName = container.querySelector('#regOwnerName').value.trim();
    const ownerEmail = container.querySelector('#regEmail').value.trim();
    const phone = container.querySelector('#regPhone').value.trim();
    const password = container.querySelector('#regPassword').value;
    const password2 = container.querySelector('#regPassword2').value;
    if (!companyName || !ownerName || !ownerEmail) { toast('Company name, owner name and email are required', 'error'); return; }
    if (password.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
    if (password !== password2) { toast('Passwords do not match', 'error'); return; }
    try {
      const { companyId, userId } = createCompanyAccount({ companyName, registrationNumber, ownerName, ownerEmail, phone });
      setSession({ companyId, userId, role: 'owner' });
      toast(`Welcome to BuildGuard, ${ownerName.split(' ')[0]}!`, 'success');
      location.hash = '#/dashboard';
    } catch (e) { toast(e.message, 'error'); }
  }

  function login(companyId, userId) {
    const user = listUsers(companyId).find((u) => u.id === userId);
    setSession({ companyId, userId, role: user.role });
    location.hash = '#/dashboard';
  }

  draw();
}
