# BuildGuard

**A construction company's financial control centre — not a site app.** BuildGuard exists to answer one question for an Owner or Director: *"How is my company doing financially, which projects need attention, what needs my approval, and where could I be losing money?"* Site-level staff capture activity; management controls, approves and analyses the money. Data flows up.

> **v2 — Financial Control Amendment.** The original MVP (Phase 1) was a site-ops app with a flat role model. This amendment restructured it around financial authority: a real 4-role hierarchy, a configurable multi-stage approval chain, role-specific dashboards, company-wide money-leak visibility, notifications and a full audit trail.

> **v3 — Financial Intelligence (Phase 2, Priority 1 + selected Priority 2).** BuildGuard now forecasts rather than only reports. Added: committed-vs-actual-vs-forecast exposure, configurable budget thresholds, project forecasting and profitability, a savings ledger that banks real rands automatically, a money-at-risk register, an executive dashboard built around a daily briefing, spending insights with trend/top-spend/supplier-concentration analysis, and supplier intelligence with performance scoring and price history. **Priorities 3–5 of the Phase 2 brief are not built** — see *What is and isn't built* below.

---

## Running it

Static PWA (HTML/CSS/vanilla JS, ES modules) — no build step. Because it uses ES modules and a service worker, it **must** be served over HTTP — opening `index.html` directly (`file://`) will fail silently (module imports are blocked by the browser).

### In VS Code (recommended)

This repo has a `.vscode` folder already set up two ways:

1. **Live Server extension** (if installed — right-click `index.html` → *"Open with Live Server"*, or click *"Go Live"* in the status bar). Serves on `http://127.0.0.1:5500`. This is the simplest option and needs no debugger extension.
2. **Press F5** ("Run and Debug"). This runs the *"Start BuildGuard Server"* task (a Python server on port 8765, self-healing — it clears any stale process still holding the port before starting) and opens Chrome pointed at it. Requires a Chrome/Edge-debug-capable setup in VS Code; if F5 does nothing, use Live Server instead.

### From any terminal

```bash
cd BuildGuard
python -m http.server 8765
```

Open `http://localhost:8765`. Any static file server works (`npx serve`, etc.) — nothing in the app is hard-coded to a particular port.

**No setup needed beyond serving the folder.** The app boots into **DEMO MODE**: pick a company, pick who you are, and you're in — every role sees its own dashboard. To reset the demo data, clear the site's local storage (DevTools → Application → Local Storage) and reload.

Once Supabase is configured the same build runs in production mode — but you can still open the sample-data walkthrough on the live URL by adding **`?demo`** to the address (e.g. `https://app.yourdomain.co.za/?demo`). Nothing in demo mode touches the server, so it's safe to run on a prospect's screen.

**Navigation:** phones get a bottom bar; any mouse-driven device (a computer, even in a narrow window) always gets the sidebar — collapsing to an icon rail below ~1024px — so the bottom bar can never cover a form field on a desktop.

### Going live with real companies

Paste a Supabase project's URL and anon key into `js/config.js` and the app switches to **PRODUCTION MODE** automatically — real email/password logins, shared data across the whole team, and company isolation enforced by the database. Full walkthrough in **[GO-LIVE.md](GO-LIVE.md)** (about 30 minutes, no code changes).

---

## The org chart this runs on

```
OWNER / DIRECTOR                 ← company-wide financial control
   ↑ approves (above the PM limit)
PROJECT MANAGER                  ← controls spend on their own projects
   ↑ approves (financial/project review, always)
SITE MANAGER                     ← verifies operational need
   ↑ verifies (only when the requester is a Supervisor)
SUPERVISOR                       ← captures activity, requests materials/expenses
```

**Ubuntu Construction** (the flagship demo company): Owner **Sipho Mthembu**; Project Managers **Thabo Mokoena** (Summerstrand + Gqeberha) and **Nomsa Dlamini** (Walmer); Site Managers **John Smith** (Summerstrand) and **Peter Adams** (Walmer + Gqeberha); Supervisors **David Ndlovu** (Gqeberha) and **Sarah Jacobs** (Summerstrand + Walmer). Siyakhula Civils and Masakhane Projects are lighter companies seeded purely to prove data isolation when you switch company at login.

---

## The approval engine

Every material request **and** every generic expense request (Fuel, Transport, Equipment, Repairs, PPE, Tools, Other) flows through the same `requests` collection and the same chain, routed by each company's **configurable** approval limits (Settings → Approval Limits, Owner only):

- **Site Manager stage** — required only when the requester is a Supervisor (a Site Manager's own request skips straight to their PM; nobody reviews their own submission).
- **Project Manager stage** — always required; this is where supplier options, project budget context and the potential saving are shown.
- **Owner stage** — required once the amount reaches the company's PM limit (default R5,000). Above the second threshold (default R25,000) the amount is flagged as high-value.

A person can never act on their own request — enforced in `db.js` (`actOnRequest`) and mirrored in the UI (no action buttons render for your own item). Every decision — Verify, Approve, Reject, Request More Information — is timestamped and shows up in that request's **Approval History** timeline and in the company-wide **Audit Log**.

On final approval, a material request automatically becomes a real `purchase` (reusing the existing supplier/delivery/inventory pipeline from Phase 1); an expense request simply closes out as approved spend and rolls into "Company Spending → Other" (or "Fuel" if that was the category).

### Try the 10-step demo scenario live

The seed data ships with `req_cement_live` sitting at step 1, ready to click through end to end:

1. Log in as **David Ndlovu** (Supervisor, Gqeberha) → Dashboard → "Recent" shows his pending 100-bag cement request.
2. Log in as **Peter Adams** (Site Manager) → Approvals → open it → **VERIFY**.
3. Log in as **Thabo Mokoena** (Project Manager) → Approvals → open it → pick a supplier (PPC Cement Direct, R88, recommended) → **APPROVE**.
4. Log in as **Sipho Mthembu** (Owner) → Approvals → open it → **APPROVE**. A real `purchase` is created.
5. Still as Peter Adams (or any Site Manager for that project) → Deliveries → Receive Delivery → select the new purchase → enter **95** received (5 short).
6. Log back in as Sipho — the Owner dashboard's "Needs Your Attention" and Money Leaks totals have updated live, and the bell icon shows a fresh "New money leak detected" notification for exactly that shortage.

A second pre-built example (`req_diesel_500l`) starts already verified and PM-approved, sitting in the **Owner's** Approvals inbox at exactly R11,750 for 500L diesel at Walmer — a one-click way to see the Owner-approval step in isolation.

---

## Financial intelligence (v3)

### True financial exposure — the core idea

Most cost tracking only counts money already spent, which is why an owner can feel under budget right up until the invoices land. BuildGuard separates three numbers on every project:

| | What it means | Where it comes from |
|---|---|---|
| **Actual** | Money already spent | The company's own cost-to-date figure |
| **Committed** | Approved purchases not yet delivered | Calculated live from approved purchases with no delivery recorded |
| **Forecast** | Projected additional spend to completion | Straight-line burn rate over remaining project duration |

**Expected total = Actual + Committed + Forecast**, and the buffer is what's left of the budget after all three. Commitments are subtracted from the forecast so they're never counted twice.

The forecast is labelled **Management Estimate** everywhere it appears, and the project screen states the assumption inline (rand-per-day burn rate, % of timeline elapsed, days remaining). It is deliberately a simple straight-line projection — explainable to a site owner, and honest about the fact that real construction spend is S-curved, so it overstates on front-loaded projects. It's an early-warning signal, not an accounting forecast.

### Savings vs money at risk — kept strictly separate

- **Money Saved** is a real ledger. Every entry is itemised and traceable, and new entries are written **automatically** by the approval engine: when an approver picks a supplier cheaper than the one the company would otherwise have used, the difference is banked. In the demo, approving the live cement request at PPC's R88 over BuildMart's R95 books a R700 saving on the spot.
- **Money at Risk** is deliberately *not* added to savings and never called a loss. The wording throughout is "potential variance", "requires investigation".

Budget-threshold alerts intentionally carry **no rand amount**, so a budget overrun can't inflate the money-at-risk figure — an overrun is a signal to act, not money suspected missing.

### Project health is forecast-driven, and has one source of truth

A project can be comfortably under budget today and still be heading for an overrun. Health (🟢/🟠/🔴) is therefore driven by the forecast, not by spend-to-date. `computeProjectHealth()` is the single source of truth — the executive dashboard, project list and project detail all badge from it, so a project can never read "On Track" in one place and "forecast over budget" in another.

### Supplier intelligence

Each supplier is scored /100 (price competitiveness 40%, delivery accuracy 40%, trading history 20% — stated on the screen as BuildGuard's own measure, not an industry rating).

Two deliberate statistical choices:
- **Delivery scores use additive smoothing**, blending the observed shortage rate toward a neutral baseline. Without it, a supplier with one recorded short delivery scores 0/100 from a single data point — meaningless, and exactly the kind of number that gets a good supplier wrongly dropped.
- **Suppliers with no purchase history show "–" rather than a score**, marked *Provisional*. A score built only on quoted prices shouldn't look as solid as one earned over eight deliveries.

---

## What is and isn't built

Built in this pass — **Phase 2 Priority 1 in full**, plus the Priority 2 items where the data already existed:

- ✅ Executive dashboard with daily briefing (§1, §36, §37 partial)
- ✅ Committed vs actual vs forecast (§2)
- ✅ Configurable budget thresholds + alerts (§3)
- ✅ Project forecasting (§4) and profitability estimate (§25)
- ✅ Savings tracker (§40) and money-at-risk register (§41)
- ✅ Cost trend analysis, 7d–12m (§5)
- ✅ Supplier intelligence and scoring (§6), material price history (§7)
- ✅ Top expenses, top suppliers, supplier concentration (§28–§30)
- ✅ Month-on-month comparison (§39)
- ✅ Per-role approval limits (§22), approval performance metrics (§31)
- ✅ Multi-region project fields (§45), BuildGuard Impact panel (§54)

**Not built** — Priorities 3–5 and the remaining Priority 2 items:

- ⬜ Purchase orders + PDF export (§9), three-way matching (§10)
- ⬜ Quotation requests (§14), total landed cost (§15)
- ⬜ Document/receipt storage and verification (§12, §13)
- ⬜ Stock transfers between projects (§16, §17), asset cost & maintenance (§20, §21)
- ⬜ Emergency and recurring purchases (§23, §24)
- ⬜ Weekly/monthly report generation and CSV/PDF export (§37, §38, §48)
- ⬜ Global search (§33), "Ask BuildGuard" (§43)
- ⬜ Soft-delete/archive semantics (§49)

This split was deliberate — the brief said to prioritise rather than build everything at once, and shallow versions of twenty features would have been worth less than six that actually work end to end.

## Screens, by role

| Screen | Owner | Project Manager | Site Manager | Supervisor |
|---|:---:|:---:|:---:|:---:|
| Company Dashboard (health, spend, leaks, all projects) | ✅ | | | |
| Project dashboard (my projects, needs action) | | ✅ | | |
| Site dashboard (today's activity, verify queue) | | | ✅ | |
| My Requests + 5 big buttons | | | | ✅ |
| Approvals inbox / Request detail | ✅ | ✅ | ✅ | |
| All Projects / My Projects (health badges) | ✅ | ✅ | | |
| Money Leaks (company-wide, drill-down) | ✅ | scoped | | |
| Savings ledger + Money at Risk | ✅ | | | |
| Spending Insights (trends, top spend, concentration) | ✅ | ✅ | | |
| Supplier intelligence + price history | ✅ | | | |
| Team (invite/deactivate/reassign) | ✅ | | | |
| Audit Log | ✅ | | | |
| Settings (approval limits) | ✅ | | | |
| Buy Material / Request Expense / Record Fuel / Receive Delivery / Report Shortage / Check Stock | | ✅ | ✅ | ✅ |

---

## Architecture

```
index.html              App shell: topbar (+ notification bell), sidebar, bottom nav, modal/toast hosts
css/styles.css           Design system — mobile-first, large touch targets
js/
  app.js                 Bootstrap + hash router
  state.js                Session + the 4-role model (ROLES, ROLE_LABELS, ROLE_RANK)
  storage.js               localStorage wrapper — the only thing that changes in Phase 3/4
  demoData.js               Seed data: 3 companies, full Ubuntu org chart, projects, requests mid-pipeline
  db.js                    Data layer + the approval engine + anomaly detection + audit + notifications
  offline.js                IndexedDB pending-sync queue
  auth.js                  Demo login + Create Company Account (registration)
  nav.js / notifications.js  Role-based nav + the notification bell panel
  dashboard.js              4 distinct role dashboards
  approvals.js               Approvals inbox + Request Detail (supplier options, budget context, history, actions)
  purchases.js                Buy Material wizard + material-request list
  expenses.js                 Request Expense (generic, same approval chain)
  fuel.js / deliveries.js / inventory.js / suppliers.js   Field capture (mostly unchanged from Phase 1)
  projects.js                 All/My Projects with 🟢🟠🔴 health, per-project cost-control detail
  alerts.js / moneyleaks.js    Alert lifecycle + company-wide leak breakdown & drill-down
  savings.js                   Savings ledger + money-at-risk register (v3)
  insights.js                  Cost trends, top spend, supplier concentration (v3)
  activity.js / auditlog.js    Company activity feed (filterable) + formal audit table
  team.js                      Invite / view / deactivate / reassign users
  settings.js                  Configurable PM/Owner approval limits
  reports.js                   9 reports, scoped to the viewer's projects
sql/schema.sql             Phase 1 data model (companies/projects/purchases/etc. + RLS) — NOT yet updated
                            for the v2 requests/roles/audit/notifications model; see note below.
```

`db.js` remains the single seam to a real backend: every function already returns company/role-scoped data and is where Phase 3/4 Supabase calls would replace `storage.js` reads/writes.

---

## Assumptions & judgment calls made in this amendment

- **Owner threshold gives the second limit real meaning without adding sequencing complexity**: below the PM limit, the PM approves alone; between the two thresholds, PM then Owner, in order; at/above the Owner threshold the amount is surfaced as high-value in the UI. Full "Owner can bypass a waiting PM" sequencing was considered and intentionally left out of this MVP as unnecessary complexity — flagged here rather than silently simplified.
- **"Project Spent" on the Request Detail / budget-impact screen uses `project.total_spent_to_date`** (a company-entered figure covering the full contract cost — labour, subcontracts, everything), not BuildGuard's own itemized materials+fuel tracking, because the brief's worked examples (Summerstrand R1.45M/58%, Walmer R1.62M/90%) are clearly whole-project figures. BuildGuard's own materials/fuel drill-down is shown separately on the Project detail screen, clearly labeled as a subset.
- **Project health (🟢/🟠/🔴)** combines budget-spend% against that total figure with the count of open *critical* money-leak alerts on the project — a project can be flagged red on issue count alone even at moderate spend%, which is intentional (multiple unresolved critical leaks are themselves a reason for attention, independent of budget pace).
- **Registration and Invite User are fully functional against the demo data layer** (real company/user records get created in `localStorage`) but obviously don't send real email or store a real password — clearly marked as DEMO in the UI.
- **Forecast method**: straight-line burn rate, chosen over an S-curve model because it is explainable and defensible to a non-technical owner. It will overstate the final cost on front-loaded projects (materials bought early), which is stated on-screen rather than hidden — it's tuned to warn early rather than to be precise.
- **"Actual spend" is the company's own cost-to-date figure**, not BuildGuard's itemised purchases, because it must include labour and subcontracts to be meaningful against a contract budget. BuildGuard's own materials/fuel detail is shown separately and clearly labelled as a subset.
- **Demo savings are seeded to reconcile exactly** — R18,750 this month and R59,950 YTD are the literal sum of the itemised ledger entries, not headline numbers chosen for effect. A demo where drill-down doesn't add up destroys trust faster than a smaller number ever would.
- **Supplier score weightings (40/40/20) are a product judgement**, not an industry standard, and the UI says so.
- **`sql/schema.sql` now matches the running app** (v3): text primary keys to accept client-generated ids, jsonb for approval stages/limits/project lists, and Row Level Security with an invite-by-email claim flow that needs only the anon key. See **`GO-LIVE.md`** for the step-by-step production setup. Bringing it in line with v2 (a `role` enum matching the new 4 roles, a unified `requests` table with per-stage columns, `audit_log`, `notifications`, `pm_approval_limit`/`owner_solo_limit` on `companies`) is the natural next step before Phase 2 database work begins for real.

## Known limitation in this preview environment

The service worker fails to register inside this chat's sandboxed preview browser — sandboxed iframes can't hold a real top-level service-worker scope. It registers normally in a real browser tab.

## Deliberately left out of this MVP

AI purchasing recommendations, supplier marketplace/ratings, OCR receipt scanning, WhatsApp integration, GPS/equipment tracking, PO generation, accounting integrations, predictive cost overruns, multi-company benchmarking — all listed as future features in the original brief and untouched by this amendment.
