-- ============================================================================
-- SERENE MARQUEE — MIGRATION 2026-08
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run (everything is idempotent).
--
-- Covers:
--   1. Hall charge = Rs. 50,000 for every venue
--   2. Advance refunds on cancelled bookings
--   3. Payroll: advances, loans, bonuses, salary changes, add/remove employees
--   4. Vendors (editable shop names)
--   5. Role policy: discount limits + Owner/CEO is view-only
--   6. Support tickets for every employee, worked by the Developer
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. HALL CHARGES — flat Rs. 50,000 across all venues
-- ---------------------------------------------------------------------------
update public.venues set hall_charge = 50000;


-- ---------------------------------------------------------------------------
-- 2. BOOKINGS — advance refund tracking (used when a booking is cancelled)
-- ---------------------------------------------------------------------------
alter table public.bookings add column if not exists advance_refunded boolean not null default false;
alter table public.bookings add column if not exists refund_amount numeric not null default 0;
alter table public.bookings add column if not exists refunded_at timestamptz;


-- ---------------------------------------------------------------------------
-- 3. PAYROLL
-- ---------------------------------------------------------------------------

-- 3a. Extra employee fields (joined/left dates, contact)
alter table public.employees add column if not exists phone text;
alter table public.employees add column if not exists joined_on date;
alter table public.employees add column if not exists left_on date;

-- 3b. Advances & loans given to an employee.
--     monthly_deduction is the agreed instalment cut from each month's salary.
create table if not exists public.employee_advances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  kind text not null default 'advance' check (kind in ('advance','loan')),
  amount numeric not null,
  monthly_deduction numeric not null default 0,
  issued_on date not null default current_date,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists employee_advances_emp_idx on public.employee_advances (employee_id);

-- 3c. Per-month adjustments to a salary: bonus (adds), deduction (subtracts),
--     repayment (subtracts, and is linked to the advance/loan it pays off).
create table if not exists public.employee_adjustments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  month text not null,                       -- 'YYYY-MM'
  kind text not null check (kind in ('bonus','deduction','repayment')),
  amount numeric not null,
  advance_id uuid references public.employee_advances(id) on delete set null,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists employee_adjustments_month_idx on public.employee_adjustments (employee_id, month);

-- 3d. Salary revision history — every change to monthly_salary is logged.
create table if not exists public.employee_salary_changes (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  old_salary numeric not null,
  new_salary numeric not null,
  effective_from date not null default current_date,
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists employee_salary_changes_emp_idx on public.employee_salary_changes (employee_id);


-- ---------------------------------------------------------------------------
-- 4. VENDORS — shop names are editable, these are just starting values
-- ---------------------------------------------------------------------------
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  category text not null,        -- e.g. Grocery, Beef, Chicken
  shop_name text,                -- null / blank = "no name yet"
  contact text,
  notes text,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Seed only if the table is still empty, so renames are never overwritten.
insert into public.vendors (category, shop_name, sort_order)
select v.category, v.shop_name, v.sort_order
from (values
  ('Grocery',       'Faisal Store',       1),
  ('Beef',          'Chaudhry Beef',      2),
  ('Mutton',        null,                 3),
  ('Chicken',       'Saqib Chicken',      4),
  ('Gas Cylinder',  'Asif Gas Cylinder',  5),
  ('Decoration',    'Abbasi Sahab',       6),
  ('Laundry',       'Danish',             7),
  ('Mineral Water', null,                 8),
  ('Cold Drinks',   null,                 9)
) as v(category, shop_name, sort_order)
where not exists (select 1 from public.vendors);


-- ---------------------------------------------------------------------------
-- 5. LEDGER — link entries to the employee / vendor / salary month they belong
--    to, so payroll and vendor pages can read their own rows back reliably
--    instead of pattern-matching on the description text.
-- ---------------------------------------------------------------------------
alter table public.ledger_entries add column if not exists employee_id uuid references public.employees(id) on delete set null;
alter table public.ledger_entries add column if not exists vendor_id   uuid references public.vendors(id)   on delete set null;
alter table public.ledger_entries add column if not exists salary_month text;   -- 'YYYY-MM'
alter table public.ledger_entries add column if not exists category text;       -- 'salary' | 'advance' | 'vendor' | 'refund' | null

create index if not exists ledger_employee_idx on public.ledger_entries (employee_id, salary_month);
create index if not exists ledger_vendor_idx   on public.ledger_entries (vendor_id);

-- Backfill: salary payments recorded by the old screen were only identifiable
-- by their description text ("Salary — Name (Designation) — June 2026").
-- Tag those rows properly so the new payroll screen still sees past months.
update public.ledger_entries le
set category = 'salary',
    employee_id = e.id
from public.employees e
where le.category is null
  and le.type = 'expense'
  and le.description like 'Salary — ' || e.full_name || ' (%';

do $$
begin
  update public.ledger_entries
  set salary_month = to_char(to_date(trim(split_part(description, ' — ', 3)), 'Month YYYY'), 'YYYY-MM')
  where category = 'salary'
    and salary_month is null
    and trim(split_part(description, ' — ', 3)) <> '';
exception when others then
  raise notice 'Salary month backfill skipped: %', sqlerrm;
end $$;


-- ---------------------------------------------------------------------------
-- 6. SUPPORT TICKETS — system_issues becomes a ticketing system every
--    employee can file into; the Developer works and closes them.
-- ---------------------------------------------------------------------------
alter table public.system_issues add column if not exists priority text not null default 'normal';
alter table public.system_issues drop constraint if exists system_issues_priority_check;
alter table public.system_issues add constraint system_issues_priority_check
  check (priority in ('low','normal','high','urgent'));

alter table public.system_issues add column if not exists category text;
alter table public.system_issues add column if not exists resolution_note text;
alter table public.system_issues add column if not exists resolved_by uuid references public.profiles(id) on delete set null;

alter table public.system_issues drop constraint if exists system_issues_status_check;
alter table public.system_issues add constraint system_issues_status_check
  check (status in ('open','in_progress','resolved'));

-- Threaded replies between the reporter and the developer.
create table if not exists public.system_issue_comments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.system_issues(id) on delete cascade,
  body text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists system_issue_comments_issue_idx on public.system_issue_comments (issue_id);


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.employee_advances        enable row level security;
alter table public.employee_adjustments     enable row level security;
alter table public.employee_salary_changes  enable row level security;
alter table public.vendors                  enable row level security;
alter table public.system_issue_comments    enable row level security;

-- Helper: does the current user have payroll/ledger visibility?
create or replace function public.has_ledger_access()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role in ('owner','admin','manager')
           or (p.can_view_ledger = true and p.role <> 'general_manager'))
  );
$$;

-- Helper: Owner/CEO accounts are monitor-only — they may read everything they
-- already could, but may not insert, update or delete anything anywhere.
create or replace function public.can_write_data()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role <> 'owner'
  );
$$;

-- --- payroll tables: same visibility as the ledger, no writes for Owner ---
drop policy if exists "employee_advances_select" on public.employee_advances;
create policy "employee_advances_select" on public.employee_advances
  for select using (public.has_ledger_access());
drop policy if exists "employee_advances_write" on public.employee_advances;
create policy "employee_advances_write" on public.employee_advances
  for all using (public.has_ledger_access() and public.can_write_data())
  with check (public.has_ledger_access() and public.can_write_data());

drop policy if exists "employee_adjustments_select" on public.employee_adjustments;
create policy "employee_adjustments_select" on public.employee_adjustments
  for select using (public.has_ledger_access());
drop policy if exists "employee_adjustments_write" on public.employee_adjustments;
create policy "employee_adjustments_write" on public.employee_adjustments
  for all using (public.has_ledger_access() and public.can_write_data())
  with check (public.has_ledger_access() and public.can_write_data());

drop policy if exists "employee_salary_changes_select" on public.employee_salary_changes;
create policy "employee_salary_changes_select" on public.employee_salary_changes
  for select using (public.has_ledger_access());
drop policy if exists "employee_salary_changes_write" on public.employee_salary_changes;
create policy "employee_salary_changes_write" on public.employee_salary_changes
  for all using (public.has_ledger_access() and public.can_write_data())
  with check (public.has_ledger_access() and public.can_write_data());

-- employees: deleting a leaver needs an explicit delete policy
drop policy if exists "employees_delete_restricted" on public.employees;
create policy "employees_delete_restricted" on public.employees
  for delete using (public.has_ledger_access() and public.can_write_data());

-- --- vendors: every logged-in staff member can see them; Owner can't edit ---
drop policy if exists "vendors_select" on public.vendors;
create policy "vendors_select" on public.vendors
  for select using (auth.role() = 'authenticated');
drop policy if exists "vendors_write" on public.vendors;
create policy "vendors_write" on public.vendors
  for all using (public.can_write_data()) with check (public.can_write_data());

-- --- bookings: Owner/CEO is read-only ---
drop policy if exists "bookings_insert" on public.bookings;
create policy "bookings_insert" on public.bookings
  for insert with check (auth.role() = 'authenticated' and public.can_write_data());
drop policy if exists "bookings_update" on public.bookings;
create policy "bookings_update" on public.bookings
  for update using (auth.role() = 'authenticated' and public.can_write_data());

drop policy if exists "booking_addons_insert" on public.booking_addons;
create policy "booking_addons_insert" on public.booking_addons
  for insert with check (auth.role() = 'authenticated' and public.can_write_data());
drop policy if exists "booking_addons_delete" on public.booking_addons;
create policy "booking_addons_delete" on public.booking_addons
  for delete using (auth.role() = 'authenticated' and public.can_write_data());

-- --- ledger + employees: Owner keeps read access, loses write access ---
drop policy if exists "ledger_insert_restricted" on public.ledger_entries;
create policy "ledger_insert_restricted" on public.ledger_entries
  for insert with check (public.has_ledger_access() and public.can_write_data());
drop policy if exists "ledger_update_restricted" on public.ledger_entries;
create policy "ledger_update_restricted" on public.ledger_entries
  for update using (public.has_ledger_access() and public.can_write_data());
drop policy if exists "ledger_delete_restricted" on public.ledger_entries;
create policy "ledger_delete_restricted" on public.ledger_entries
  for delete using (public.has_ledger_access() and public.can_write_data());

drop policy if exists "employees_insert_restricted" on public.employees;
create policy "employees_insert_restricted" on public.employees
  for insert with check (public.has_ledger_access() and public.can_write_data());
drop policy if exists "employees_update_restricted" on public.employees;
create policy "employees_update_restricted" on public.employees
  for update using (public.has_ledger_access() and public.can_write_data());

-- --- support tickets: anyone can file one and follow their own; the
--     Developer sees and works all of them ---
drop policy if exists "system_issues_all_developer" on public.system_issues;

drop policy if exists "system_issues_select" on public.system_issues;
create policy "system_issues_select" on public.system_issues
  for select using (
    created_by = auth.uid()
    or related_profile_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'developer')
  );

drop policy if exists "system_issues_insert" on public.system_issues;
create policy "system_issues_insert" on public.system_issues
  for insert with check (auth.role() = 'authenticated' and created_by = auth.uid());

drop policy if exists "system_issues_update" on public.system_issues;
create policy "system_issues_update" on public.system_issues
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'developer')
  );

drop policy if exists "system_issues_delete" on public.system_issues;
create policy "system_issues_delete" on public.system_issues
  for delete using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'developer')
  );

drop policy if exists "system_issue_comments_select" on public.system_issue_comments;
create policy "system_issue_comments_select" on public.system_issue_comments
  for select using (
    exists (
      select 1 from public.system_issues i
      where i.id = issue_id
        and (i.created_by = auth.uid()
             or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'developer'))
    )
  );

drop policy if exists "system_issue_comments_insert" on public.system_issue_comments;
create policy "system_issue_comments_insert" on public.system_issue_comments
  for insert with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.system_issues i
      where i.id = issue_id
        and (i.created_by = auth.uid()
             or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'developer'))
    )
  );


-- ============================================================================
-- DISCOUNT LIMITS — enforced in the database, not just hidden in the UI.
--   Manager .............. max Rs. 30,000 per booking
--   General Manager ...... max Rs. 50,000 per booking
--   Staff / Owner ........ no discount authority
--   Admin / Developer .... unlimited
-- ============================================================================
create or replace function public.enforce_discount_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r text;
  lim numeric;
begin
  select role into r from public.profiles where id = auth.uid();

  lim := case r
    when 'manager'          then 30000
    when 'general_manager'  then 50000
    when 'staff'            then 0
    when 'owner'            then 0
    else null                      -- admin / developer: unlimited
  end;

  if lim is not null and coalesce(new.discount, 0) > lim then
    raise exception
      'Discount limit exceeded — your role may approve a maximum of Rs. % per booking (you entered Rs. %).',
      lim, coalesce(new.discount, 0);
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_discount_limit on public.bookings;
create trigger bookings_discount_limit
  before insert or update on public.bookings
  for each row execute procedure public.enforce_discount_limit();


-- ============================================================================
-- REALTIME (optional but keeps open screens in sync)
-- ============================================================================
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.vendors'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.system_issues'; exception when others then null; end;
end $$;
-- ============================================================================
