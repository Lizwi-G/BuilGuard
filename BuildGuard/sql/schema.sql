-- =============================================================================
-- BuildGuard — Supabase / PostgreSQL schema  (v3 — matches the running app)
--
-- HOW TO APPLY
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
--   Safe to run on a brand-new project. Do NOT run on a database that already
--   has data without reading the DROP section first.
--
-- DESIGN NOTES
--   * Primary keys are TEXT, not uuid. The app generates ids like
--     "req_msx7k2..." on the client (so it works offline) — the database
--     accepts them as-is. Uniqueness is enforced by the primary key.
--   * users.auth_id is the Supabase Auth user id. It is NULLABLE because an
--     Owner can invite someone before that person has signed up; the row is
--     created with status 'invited' and claimed at sign-up by email match.
--   * Every business table carries company_id, and Row Level Security below
--     is the ONLY thing that keeps one construction company from reading
--     another's records. The client never filters by company itself.
--   * Flexible fields (approval stages, alert metadata, project lists per
--     user, per-company limits) are jsonb — exactly the shape the app writes.
--   * Money is numeric(14,2), never float.
--   * Nothing is ever hard-deleted by the app. Rows carry status/archived
--     flags instead (financial records should not casually disappear).
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- DROP (only if re-running on a fresh project — comment out otherwise)
-- -----------------------------------------------------------------------------
drop table if exists savings, notifications, audit_log, alerts, fuel_transactions,
  inventory, deliveries, purchases, requests, vehicles, supplier_prices, suppliers,
  materials, projects, users, companies cascade;
drop function if exists current_company_id() cascade;
drop function if exists current_app_role() cascade;

-- =============================================================================
-- COMPANIES
-- =============================================================================
create table companies (
  id                    text primary key,
  company_name          text not null,
  registration_number   text,
  contact_information   text,
  pm_approval_limit     numeric(14,2) not null default 5000,
  owner_solo_limit      numeric(14,2) not null default 25000,
  role_limits           jsonb not null default '{"site_manager": 2500}'::jsonb,
  budget_thresholds     jsonb not null default '{"watch":75,"high":90,"over":100,"critical":110}'::jsonb,
  archived              boolean not null default false,
  created_at            timestamptz not null default now()
);

-- =============================================================================
-- USERS   (one row per team member; auth_id links to Supabase Auth)
-- =============================================================================
create table users (
  id                 text primary key,
  company_id         text not null references companies(id) on delete cascade,
  auth_id            uuid unique references auth.users(id) on delete set null,
  name               text not null,
  email              text not null,
  phone              text,
  role               text not null check (role in ('owner','project_manager','site_manager','supervisor')),
  status             text not null default 'active' check (status in ('active','invited','inactive')),
  manages_projects   jsonb not null default '[]'::jsonb,   -- project ids, for project managers
  assigned_projects  jsonb not null default '[]'::jsonb,   -- project ids, for site managers / supervisors
  created_at         timestamptz not null default now()
);
create index idx_users_company on users(company_id);
create index idx_users_email on users(lower(email));

-- =============================================================================
-- PROJECTS
-- =============================================================================
create table projects (
  id                   text primary key,
  company_id           text not null references companies(id) on delete cascade,
  project_name         text not null,
  location             text,
  province             text,
  city                 text,
  region               text,
  client_name          text,
  contract_value       numeric(14,2) not null default 0,
  budget               numeric(14,2) not null default 0 check (budget >= 0),
  total_spent_to_date  numeric(14,2) not null default 0,   -- company's cost-to-date incl. labour/subcontracts
  manager_id           text references users(id) on delete set null,
  start_date           date,
  end_date             date,
  status               text not null default 'active' check (status in ('active','on_hold','completed','cancelled')),
  archived             boolean not null default false,
  created_at           timestamptz not null default now()
);
create index idx_projects_company on projects(company_id);

-- =============================================================================
-- MATERIALS / SUPPLIERS / QUOTES / VEHICLES
-- =============================================================================
create table materials (
  id                   text primary key,
  company_id           text not null references companies(id) on delete cascade,
  name                 text not null,
  category             text,
  unit                 text not null,
  minimum_stock_level  numeric(12,2) not null default 0,
  archived             boolean not null default false,
  created_at           timestamptz not null default now()
);
create index idx_materials_company on materials(company_id);

create table suppliers (
  id               text primary key,
  company_id       text not null references companies(id) on delete cascade,
  supplier_name    text not null,
  contact_person   text,
  phone            text,
  email            text,
  address          text,
  status           text not null default 'active' check (status in ('active','inactive')),
  created_at       timestamptz not null default now()
);
create index idx_suppliers_company on suppliers(company_id);

create table supplier_prices (
  id               text primary key default ('sp_' || replace(gen_random_uuid()::text, '-', '')),
  company_id       text references companies(id) on delete cascade,
  supplier_id      text not null references suppliers(id) on delete cascade,
  material_id      text not null references materials(id) on delete cascade,
  price            numeric(12,2) not null check (price > 0),
  previous_price   numeric(12,2),
  quoted_at        timestamptz not null default now(),
  unique (supplier_id, material_id)
);
create index idx_supplier_prices_material on supplier_prices(material_id);

create table vehicles (
  id                   text primary key,
  company_id           text not null references companies(id) on delete cascade,
  registration_number  text not null,
  vehicle_name         text not null,
  vehicle_type         text,
  fuel_type            text not null default 'Diesel',
  assigned_project     text references projects(id) on delete set null,
  status               text not null default 'active' check (status in ('active','maintenance','inactive')),
  baseline_km_per_l    numeric(6,2),
  baseline_l_per_hr    numeric(6,2),
  created_at           timestamptz not null default now()
);
create index idx_vehicles_company on vehicles(company_id);

-- =============================================================================
-- REQUESTS  — the unified approval workflow (materials + expenses)
-- =============================================================================
create table requests (
  id                  text primary key,
  company_id          text not null references companies(id) on delete cascade,
  project_id          text not null references projects(id) on delete cascade,
  request_type        text not null check (request_type in ('material','expense')),
  material_id         text references materials(id),
  quantity            numeric(12,2),
  category            text,
  amount              numeric(14,2) not null check (amount >= 0),
  urgency             text not null default 'normal' check (urgency in ('normal','soon','urgent')),
  reason              text,
  requested_by        text not null references users(id),
  status              text not null default 'pending'
                        check (status in ('pending','approved','rejected','info_requested')),
  stages              jsonb not null default '{}'::jsonb,   -- {site_manager:{required,status,actor,...}, project_manager:{...}, owner:{...}}
  supplier_id         text references suppliers(id),
  unit_price          numeric(12,2),
  rejection_reason    text,
  info_request_note   text,
  created_at          timestamptz not null default now()
);
create index idx_requests_company_status on requests(company_id, status);
create index idx_requests_project on requests(project_id);

-- =============================================================================
-- PURCHASES / DELIVERIES / INVENTORY / FUEL
-- =============================================================================
create table purchases (
  id                  text primary key,
  company_id          text not null references companies(id) on delete cascade,
  project_id          text not null references projects(id) on delete cascade,
  supplier_id         text references suppliers(id),
  material_id         text not null references materials(id),
  quantity            numeric(12,2) not null check (quantity > 0),
  unit_price          numeric(12,2) not null check (unit_price >= 0),
  total_price         numeric(14,2) not null check (total_price >= 0),
  purchase_date       date not null default current_date,
  approved_by         text references users(id),
  source_request_id   text references requests(id),
  created_at          timestamptz not null default now()
);
create index idx_purchases_company on purchases(company_id);
create index idx_purchases_material on purchases(company_id, material_id, purchase_date);

create table deliveries (
  id                  text primary key,
  purchase_id         text not null references purchases(id) on delete cascade,
  expected_quantity   numeric(12,2) not null,
  received_quantity   numeric(12,2) not null,
  shortage_quantity   numeric(12,2) not null default 0,
  received_by         text references users(id),
  delivery_date       date not null default current_date,
  notes               text,
  photo_url           text,
  created_at          timestamptz not null default now()
);
create index idx_deliveries_purchase on deliveries(purchase_id);

-- The app tracks the six inventory figures directly (see README "assumptions").
create table inventory (
  id              text primary key,
  company_id      text not null references companies(id) on delete cascade,
  project_id      text not null references projects(id) on delete cascade,
  material_id     text not null references materials(id) on delete cascade,
  purchased       numeric(12,2) not null default 0,
  received        numeric(12,2) not null default 0,
  used            numeric(12,2) not null default 0,
  actual_counted  numeric(12,2) not null default 0,
  counted_at      date,
  counted_by      text references users(id),
  updated_at      timestamptz not null default now()
);
create index idx_inventory_company on inventory(company_id);

create table fuel_transactions (
  id                 text primary key,
  company_id         text not null references companies(id) on delete cascade,
  project_id         text not null references projects(id) on delete cascade,
  vehicle_id         text not null references vehicles(id),
  user_id            text references users(id),
  litres             numeric(10,2) not null check (litres > 0),
  price_per_litre    numeric(10,2) not null check (price_per_litre > 0),
  total_cost         numeric(12,2) not null,
  odometer_reading   numeric(10,1),
  hour_meter         numeric(10,1),
  supplier           text,
  receipt_photo      text,
  transaction_date   date not null default current_date,
  created_at         timestamptz not null default now()
);
create index idx_fuel_company on fuel_transactions(company_id);
create index idx_fuel_vehicle_date on fuel_transactions(vehicle_id, transaction_date);

-- =============================================================================
-- ALERTS (money leaks) / AUDIT / NOTIFICATIONS / SAVINGS
-- =============================================================================
create table alerts (
  id             text primary key,
  company_id     text not null references companies(id) on delete cascade,
  project_id     text references projects(id) on delete cascade,
  alert_type     text not null check (alert_type in
                   ('inventory_variance','price_variance','delivery_shortage','fuel_anomaly','budget_variance')),
  severity       text not null check (severity in ('critical','warning','info')),
  message        text not null,
  amount         numeric(12,2),
  status         text not null default 'open' check (status in ('open','acknowledged','resolved')),
  meta           jsonb,
  reported_by    text references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);
create index idx_alerts_company_status on alerts(company_id, status);

create table audit_log (
  id            text primary key,
  company_id    text not null references companies(id) on delete cascade,
  project_id    text references projects(id) on delete set null,
  user_id       text references users(id) on delete set null,
  user_name     text,
  action        text not null,
  details       text,
  entity_type   text,
  entity_id     text,
  amount        numeric(14,2),
  created_at    timestamptz not null default now()
);
create index idx_audit_company_time on audit_log(company_id, created_at desc);

create table notifications (
  id            text primary key,
  company_id    text not null references companies(id) on delete cascade,
  user_id       text not null references users(id) on delete cascade,
  type          text not null,
  title         text not null,
  message       text,
  project_id    text references projects(id) on delete set null,
  entity_type   text,
  entity_id     text,
  read          boolean not null default false,
  created_at    timestamptz not null default now()
);
create index idx_notifications_user on notifications(user_id, read);

create table savings (
  id                 text primary key,
  company_id         text not null references companies(id) on delete cascade,
  project_id         text references projects(id) on delete set null,
  saving_type        text not null check (saving_type in
                       ('supplier_comparison','negotiation','duplicate_prevented','bulk_discount')),
  description        text,
  amount             numeric(12,2) not null check (amount > 0),
  source_entity_id   text,
  created_at         timestamptz not null default now()
);
create index idx_savings_company_time on savings(company_id, created_at desc);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- Which company does the logged-in person belong to? SECURITY DEFINER so it
-- can read `users` without recursing into users' own RLS policy.
create or replace function current_company_id()
returns text language sql security definer stable as $$
  select company_id from public.users where auth_id = auth.uid() limit 1
$$;

create or replace function current_app_role()
returns text language sql security definer stable as $$
  select role from public.users where auth_id = auth.uid() limit 1
$$;

alter table companies          enable row level security;
alter table users              enable row level security;
alter table projects           enable row level security;
alter table materials          enable row level security;
alter table suppliers          enable row level security;
alter table supplier_prices    enable row level security;
alter table vehicles           enable row level security;
alter table requests           enable row level security;
alter table purchases          enable row level security;
alter table deliveries         enable row level security;
alter table inventory          enable row level security;
alter table fuel_transactions  enable row level security;
alter table alerts             enable row level security;
alter table audit_log          enable row level security;
alter table notifications      enable row level security;
alter table savings            enable row level security;

-- ---- companies ---------------------------------------------------------------
-- Any signed-in person may CREATE a company (that's how a new customer joins).
-- They can only ever READ/UPDATE the one they belong to.
create policy companies_insert on companies for insert to authenticated with check (true);
create policy companies_select on companies for select to authenticated using (id = current_company_id());
create policy companies_update on companies for update to authenticated
  using (id = current_company_id() and current_app_role() = 'owner');

-- ---- users ---------------------------------------------------------------------
-- Read: your colleagues, yourself, or a pending invite addressed to your email.
create policy users_select on users for select to authenticated using (
  company_id = current_company_id()
  or auth_id = auth.uid()
  or (auth_id is null and lower(email) = lower(auth.jwt() ->> 'email'))
);
-- Insert: registering yourself as the owner of a brand-new company, or an
-- owner inviting a colleague into their own company.
create policy users_insert on users for insert to authenticated with check (
  auth_id = auth.uid()
  or (company_id = current_company_id() and current_app_role() = 'owner')
);
-- Update: yourself, claiming an invite sent to your email, or an owner
-- managing their team.
create policy users_update on users for update to authenticated using (
  auth_id = auth.uid()
  or (auth_id is null and lower(email) = lower(auth.jwt() ->> 'email'))
  or (company_id = current_company_id() and current_app_role() = 'owner')
);

-- ---- generic "your company only" pattern for every business table -------------
create policy projects_all on projects for all to authenticated
  using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy materials_all on materials for all to authenticated
  using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy suppliers_all on suppliers for all to authenticated
  using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy vehicles_all on vehicles for all to authenticated
  using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy requests_all on requests for all to authenticated
  using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy purchases_all on purchases for all to authenticated
  using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy inventory_all on inventory for all to authenticated
  using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy fuel_all on fuel_transactions for all to authenticated
  using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy alerts_all on alerts for all to authenticated
  using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy audit_all on audit_log for all to authenticated
  using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy notifications_all on notifications for all to authenticated
  using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy savings_all on savings for all to authenticated
  using (company_id = current_company_id()) with check (company_id = current_company_id());

-- supplier_prices may lack company_id on older rows; scope via the supplier.
create policy supplier_prices_all on supplier_prices for all to authenticated
  using (supplier_id in (select id from suppliers where company_id = current_company_id()))
  with check (supplier_id in (select id from suppliers where company_id = current_company_id()));

-- deliveries are scoped through their purchase.
create policy deliveries_all on deliveries for all to authenticated
  using (purchase_id in (select id from purchases where company_id = current_company_id()))
  with check (purchase_id in (select id from purchases where company_id = current_company_id()));

-- =============================================================================
-- DONE. Next: js/config.js -> paste Project URL + anon key -> reload the app.
-- =============================================================================
