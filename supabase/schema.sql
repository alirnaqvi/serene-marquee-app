-- ============================================================================
-- SERENE MARQUEE — Database Schema
-- Run this once in your Supabase project: Dashboard -> SQL Editor -> New query
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. STAFF PROFILES
-- Extends Supabase's built-in auth.users with role + permission info.
-- A row here is created automatically when a new user signs up (see trigger).
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  username text,
  role text not null default 'staff' check (role in ('owner','admin','manager','general_manager','developer','staff')),
  can_view_ledger boolean not null default false,
  created_at timestamptz not null default now()
);

-- Automatically create a profile row whenever a new auth user is created.
-- New staff default to role='staff', can_view_ledger=false — an owner/manager
-- must explicitly grant ledger access afterward (via the in-app Staff &
-- Access screen, or the Supabase Table Editor).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'username'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. VENUES  (Serene Diamond / Serene Gold / Open Area)
-- ---------------------------------------------------------------------------
create table if not exists public.venues (
  id text primary key,
  name text not null,
  capacity int not null,
  hall_charge numeric not null,
  min_waiver int not null,        -- guest count above which hall charge is waived
  decoration_from numeric not null
);

-- Hall charges are waived once guest count reaches 200, uniformly across
-- all three venues (owner policy, updated from the original per-venue tiers).
insert into public.venues (id, name, capacity, hall_charge, min_waiver, decoration_from) values
  ('v1','Serene Diamond', 500, 50000, 200, 60000),
  ('v2','Serene Gold',    400, 40000, 200, 60000),
  ('v3','Open Area (Lawns)', 300, 30000, 200, 80000)
on conflict (id) do update set
  name=excluded.name, capacity=excluded.capacity, hall_charge=excluded.hall_charge,
  min_waiver=excluded.min_waiver, decoration_from=excluded.decoration_from;

-- ---------------------------------------------------------------------------
-- 3. MENUS
-- ---------------------------------------------------------------------------
create table if not exists public.menus (
  id text primary key,
  name text not null,
  rate numeric not null,          -- Rs. per head
  items text not null
);

insert into public.menus (id, name, rate, items) values
  ('m1','Reception Menu 1', 1520, 'Yakhni Pulao, Chicken Qorma, Palak Gosht, Steam Roast (Platter), Fresh Salad, Channa Bean Salad, Variety of Nan, Kheer, Mineral Water, Green Tea'),
  ('m2','Reception Menu 2', 1880, 'Yakhni Pulao, Beef Qorma, Chicken Qorma/Karahi, Steam Roast (Buffet), Fresh Salad, Channa Bean Salad, Nan, Kheer, Fruit Trifle, Mineral Water, Green Tea'),
  ('m3','Reception Menu 3', 2360, 'Yakhni Pulao, Mutton Qorma, Chicken Qorma/Karahi, Steam Roast (Buffet), Fresh Salad, Channa Bean Salad, Nan, Kheer, Fruit Trifle, Mineral Water, Green Tea'),
  ('m4','Mehndi Menu', 1520, 'Fresh Salad, Channa Bean Salad, Vegetable Rice, Chicken Qorma, Aalo Achari, Lahori Channay, Halwa Poori, Naan, Raita, Mineral Water, Green Tea')
on conflict (id) do update set
  name=excluded.name, rate=excluded.rate, items=excluded.items;

-- ---------------------------------------------------------------------------
-- 3b. ADDON ITEMS  (à la carte items for the "Customized Menu" option)
-- Straight from the 2026 printed menu. default_qty_mode is just a UI hint for
-- what to pre-fill the quantity as when an item is picked in the Customized
-- Menu builder — 'guests' pre-fills with the booking's guest count (for
-- per-person items like appetizers or live counters), 'one' pre-fills with 1
-- (for flat/one-off items like stalls or a whole lamb roast). Staff can
-- always override the quantity either way, so this is a convenience default,
-- not an enforced rule.
-- ---------------------------------------------------------------------------
create table if not exists public.addon_items (
  id text primary key,
  category text not null,
  name text not null,
  price numeric not null,
  default_qty_mode text not null default 'guests' check (default_qty_mode in ('guests','one')),
  sort_order int not null default 0
);

insert into public.addon_items (id, category, name, price, default_qty_mode, sort_order) values
  -- Appetizers & Drinks
  ('a01','Appetizers & Drinks','Welcome Drinks',100,'guests',1),
  ('a02','Appetizers & Drinks','Hot & Sour Soup',260,'guests',2),
  ('a03','Appetizers & Drinks','Seafood Chowder Soup',360,'guests',3),
  ('a04','Appetizers & Drinks','Russian Salad',140,'guests',4),
  ('a05','Appetizers & Drinks','Ceaser Salad',190,'guests',5),
  ('a06','Appetizers & Drinks','Prawn Tempura',460,'guests',6),
  ('a07','Appetizers & Drinks','Cold Drinks – 1.5litre',90,'one',7),
  ('a08','Appetizers & Drinks','Sugarfree Cold Drinks – Tin',170,'one',8),
  ('a09','Appetizers & Drinks','Pink Tea',150,'guests',9),
  ('a10','Appetizers & Drinks','Milk Tea',100,'guests',10),
  -- Speciality Desserts
  ('d01','Speciality Desserts','Gajar ka Halwa',190,'guests',1),
  ('d02','Speciality Desserts','Chocolate Mousse',150,'guests',2),
  ('d03','Speciality Desserts','Kunafa',120,'guests',3),
  ('d04','Speciality Desserts','Hot Gulaab Jaman',150,'guests',4),
  ('d05','Speciality Desserts','Ice-Cream',120,'guests',5),
  ('d06','Speciality Desserts','Kulfi Stall',150,'guests',6),
  ('d07','Speciality Desserts','Dessert Bar',450,'guests',7),
  -- Popular Items
  ('p01','Popular Items','Karachi Biryani',200,'guests',1),
  ('p02','Popular Items','Kabli Pulao',220,'guests',2),
  ('p03','Popular Items','Fried Fish',780,'guests',3),
  ('p04','Popular Items','Lahori Fish',510,'guests',4),
  ('p05','Popular Items','Beef Qofta',280,'guests',5),
  ('p06','Popular Items','Palak Paneer',210,'guests',6),
  ('p07','Popular Items','Chicken Manchurian',250,'guests',7),
  ('p08','Popular Items','Chicken Handi',250,'guests',8),
  ('p09','Popular Items','Mix Vegetable',210,'guests',9),
  -- Grill & Live Items
  ('g01','Grill & Live Items','Live Chicken Tikka Boti',280,'guests',1),
  ('g02','Grill & Live Items','Live Chicken Malai Boti',340,'guests',2),
  ('g03','Grill & Live Items','Chicken Steam Roast (Platter)',150,'guests',3),
  ('g04','Grill & Live Items','Chicken Steam Roast (Buffet)',260,'guests',4),
  ('g05','Grill & Live Items','Beef Seekh Kabab (Buffet)',340,'guests',5),
  ('g06','Grill & Live Items','Beef Seekh Kabab (Platter)',260,'guests',6),
  ('g07','Grill & Live Items','Batair Tikka',290,'guests',7),
  ('g08','Grill & Live Items','Beef Foil Roast',410,'guests',8),
  ('g09','Grill & Live Items','Mutton Roast',780,'guests',9),
  -- Lamb Roast
  ('l01','Lamb Roast','Full Lamb Roast with Stuffed Rice (per Lamb)',40000,'one',1),
  ('l02','Lamb Roast','Mutton Leg Roast (per leg)',10000,'one',2),
  -- Live Counters
  ('c01','Live Counters','Desi Counter – Live',370,'guests',1),
  ('c02','Live Counters','Vilayti Counter – Live',370,'guests',2),
  ('c03','Live Counters','Tawa Counter – Live',370,'guests',3),
  -- Popular Mehndi Add-ons
  ('m01','Popular Mehndi Add-ons','Qofta Curry',280,'guests',1),
  ('m02','Popular Mehndi Add-ons','Bihari Chicken Tikka',280,'guests',2),
  ('m03','Popular Mehndi Add-ons','Gola Kabab',370,'guests',3),
  ('m04','Popular Mehndi Add-ons','Full Roast Fish',550,'guests',4),
  ('m05','Popular Mehndi Add-ons','Live Jaleebi',180,'guests',5),
  ('m06','Popular Mehndi Add-ons','Kahmiri Chai',150,'guests',6),
  -- Stalls
  ('s01','Stalls','Pan Stall',9500,'one',1),
  ('s02','Stalls','Mehndi Stall',8500,'one',2),
  ('s03','Stalls','Gol Gappay Stall (100 person)',8500,'one',3),
  -- Sauces
  ('sa01','Sauces','Plum Sauce',80,'guests',1),
  ('sa02','Sauces','Raita',40,'guests',2),
  ('sa03','Sauces','Tartar Sauce',130,'guests',3)
on conflict (id) do update set
  category=excluded.category, name=excluded.name, price=excluded.price,
  default_qty_mode=excluded.default_qty_mode, sort_order=excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 4. BOOKINGS
-- venues is an array so one booking can span two halls (e.g. Diamond + Gold).
-- ---------------------------------------------------------------------------
create sequence if not exists public.booking_number_seq;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_number bigint not null default nextval('public.booking_number_seq'), -- human-friendly ref, shown as SM-000123
  venues text[] not null,                     -- e.g. {'v1'} or {'v1','v2'}
  session text not null check (session in ('Lunch','Dinner')),
  event_date date not null,
  client text not null,
  phone text,
  phone2 text,                                -- optional second contact number
  cnic text,
  email text,
  function_type text not null,
  function_type_other text,
  guests int not null default 0,
  menu_id text references public.menus(id),   -- null when is_custom_menu = true
  is_custom_menu boolean not null default false,
  custom_menu_total numeric not null default 0,  -- fully custom menu total, replaces the regular rate
  addons_total numeric not null default 0,       -- extra items added on top of a regular menu's rate
  discount numeric not null default 0,        -- flat Rs. amount (not a percentage)
  reference text,
  filer text not null default 'Filer' check (filer in ('Filer','Non-Filer')),
  decoration numeric not null default 0,
  cooling boolean not null default false,
  heaters int not null default 0,
  advance numeric not null default 0,
  notes text,
  status text not null default 'Tentative' check (status in ('Tentative','Confirmed','Cancelled')),
  created_by uuid references public.profiles(id) on delete set null,

create index if not exists bookings_date_idx on public.bookings (event_date);
create index if not exists bookings_venues_idx on public.bookings using gin (venues);
create unique index if not exists bookings_number_idx on public.bookings (booking_number);

-- Keep updated_at current on every edit — used to show "last changed" and,
-- more importantly, lets the Edit Booking / Cancel Booking screens rely on
-- a real audit trail instead of just created_at.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4b. BOOKING ADDONS  (itemized selections when a booking uses a Customized Menu)
-- Price is snapshotted at booking time so later menu price changes don't
-- silently alter the total on an already-confirmed booking.
-- ---------------------------------------------------------------------------
create table if not exists public.booking_addons (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  addon_item_id text references public.addon_items(id),
  name text not null,          -- snapshot, survives even if the addon item is later renamed/removed
  unit_price numeric not null, -- snapshot
  quantity numeric not null,
  line_total numeric not null
);

create index if not exists booking_addons_booking_idx on public.booking_addons (booking_id);

-- ---------------------------------------------------------------------------
-- 5. LEDGER  (restricted table — see RLS policies below)
-- ---------------------------------------------------------------------------
create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  type text not null check (type in ('income','expense')),
  description text not null,
  amount numeric not null,
  booking_id uuid references public.bookings(id) on delete set null,
  handed_to text,              -- expenses only: who the money was physically handed to
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ledger_date_idx on public.ledger_entries (entry_date);

-- ---------------------------------------------------------------------------
-- 5b. EMPLOYEES  (for monthly salary payments recorded through the Ledger)
-- Seeded from the June 2026 salary sheet. monthly_salary is the base salary;
-- advances/deductions for a given month are just entered as the payment
-- amount when recording that month's salaries (see the app's Ledger ->
-- Salaries screen), not tracked as a running balance here.
-- ---------------------------------------------------------------------------
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null unique,
  designation text not null,
  monthly_salary numeric not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- system_issues: a lightweight issue/notes log for the Developer Console.
-- The Developer role (Syed Ali Raza Naqvi) uses this to track problems
-- found in the software or flagged against a specific staff member's
-- account, separate from day-to-day booking/ledger work which isn't their
-- domain. Only the developer role can see or use this table.
-- ---------------------------------------------------------------------------
create table if not exists public.system_issues (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  related_profile_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.system_issues enable row level security;
create policy "system_issues_all_developer" on public.system_issues
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'developer')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'developer')
  );

insert into public.employees (full_name, designation, monthly_salary) values
  ('Ikram Abbasi', 'General Manager', 86000),
  ('Zain Syed', 'Operation Manager', 35000),
  ('Abid Khushal', 'Administration', 6500),
  ('Asad', 'Waiter', 21000),
  ('Qadeer', 'Supervisor/Tea Boy', 21000),
  ('Kamran', 'Waiter', 21000),
  ('Awais', 'Waiter', 21000),
  ('Fawad', 'Waiter', 21000),
  ('Tahir', 'Waiter', 21000),
  ('Tayyab', 'Janitor', 23500),
  ('Siddeeq', 'Security Incharge', 23500),
  ('Murad Ali Shah', 'Store Assistant', 23500),
  ('Farooq', 'Store Assistant', 37000),
  ('Muneeb', 'Store Assistant', 28000),
  ('Gul Khan', 'Janitor', 24000),
  ('Bilal', 'Janitor', 21000),
  ('Humair', 'Janitor', 21000),
  ('Faisal', 'Cook Helper', 22000),
  ('Zubair', 'Dish Washer', 20000),
  ('Arshad', 'Dish Washer', 22000),
  ('Waleed', 'Cook', 58000),
  ('Hamar', 'Ass. Cook', 48000),
  ('Shokat', 'Roti Maker', 38000),
  ('Zahoor', 'BBQ Cook', 45000)
on conflict (full_name) do update set
  designation = excluded.designation, monthly_salary = excluded.monthly_salary;

-- ---------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
-- Everyone who is logged in can read/write venues, menus, and bookings.
-- Only profiles with can_view_ledger = true (or role in owner/manager) can
-- touch the ledger table at all — enforced here, not just hidden in the UI.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.venues enable row level security;
alter table public.menus enable row level security;
alter table public.addon_items enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_addons enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.employees enable row level security;

-- profiles: a user can read all staff profiles (for staff lists) but only
-- update their own row (an owner/manager can be given a future admin screen
-- with a service-role key to manage everyone else's roles).
create policy "profiles_select_all" on public.profiles
  for select using (auth.role() = 'authenticated');
create policy "profiles_update_self" on public.profiles
  for update using (auth.uid() = id);

-- Only the Developer role can update any staff member's role or ledger
-- access — this is what powers the in-app "Staff & Access" admin screen.
-- Owner and Admin can view that screen but not edit it; Manager and
-- General Manager cannot see it at all. This matches the owner's
-- finalized policy: one dedicated role (Developer) owns staff/access
-- changes so nobody else can accidentally re-permission someone.
drop policy if exists "profiles_update_by_owner" on public.profiles;
drop policy if exists "profiles_update_by_admin" on public.profiles;
create policy "profiles_update_by_developer" on public.profiles
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'developer'
    )
  );

-- venues / menus: read for any logged-in staff member. Editing left to the
-- Supabase dashboard for now (owner-only) rather than exposed in the app.
create policy "venues_select" on public.venues
  for select using (auth.role() = 'authenticated');
create policy "menus_select" on public.menus
  for select using (auth.role() = 'authenticated');
create policy "addon_items_select" on public.addon_items
  for select using (auth.role() = 'authenticated');

-- bookings: any logged-in staff member can view, create, and update bookings.
create policy "bookings_select" on public.bookings
  for select using (auth.role() = 'authenticated');
create policy "bookings_insert" on public.bookings
  for insert with check (auth.role() = 'authenticated');
create policy "bookings_update" on public.bookings
  for update using (auth.role() = 'authenticated');

-- booking_addons: same visibility as bookings — any logged-in staff member.
create policy "booking_addons_select" on public.booking_addons
  for select using (auth.role() = 'authenticated');
create policy "booking_addons_insert" on public.booking_addons
  for insert with check (auth.role() = 'authenticated');
create policy "booking_addons_delete" on public.booking_addons
  for delete using (auth.role() = 'authenticated');

-- ledger_entries: only staff whose profile has can_view_ledger = true
-- (or role owner/manager) may select or insert. This is the actual
-- enforcement point for "only some people can see the daily ledger."
create policy "ledger_select_restricted" on public.ledger_entries
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role in ('owner','admin','manager') or (p.can_view_ledger = true and p.role <> 'general_manager'))
    )
  );
create policy "ledger_insert_restricted" on public.ledger_entries
  for insert with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role in ('owner','admin','manager') or (p.can_view_ledger = true and p.role <> 'general_manager'))
    )
  );
create policy "ledger_delete_restricted" on public.ledger_entries
  for delete using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role in ('owner','admin','manager') or (p.can_view_ledger = true and p.role <> 'general_manager'))
    )
  );
create policy "ledger_update_restricted" on public.ledger_entries
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role in ('owner','admin','manager') or (p.can_view_ledger = true and p.role <> 'general_manager'))
    )
  );

-- employees: salary data is sensitive — same restriction as the ledger itself.
create policy "employees_select_restricted" on public.employees
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role in ('owner','admin','manager') or (p.can_view_ledger = true and p.role <> 'general_manager'))
    )
  );
create policy "employees_insert_restricted" on public.employees
  for insert with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role in ('owner','admin','manager') or (p.can_view_ledger = true and p.role <> 'general_manager'))
    )
  );
create policy "employees_update_restricted" on public.employees
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role in ('owner','admin','manager') or (p.can_view_ledger = true and p.role <> 'general_manager'))
    )
  );

-- ---------------------------------------------------------------------------
-- 7. REALTIME
-- Publish bookings + ledger so all open clients update live without a
-- manual refresh (used by the app's Supabase realtime subscriptions).
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.bookings;
alter publication supabase_realtime add table public.ledger_entries;

-- ============================================================================
-- After running this file:
-- 1. Go to Authentication -> Users in the Supabase dashboard and invite your
--    staff (or let them sign up from the app's login screen).
-- 2. For each staff member who should see the ledger, go to Table Editor ->
--    profiles and set can_view_ledger = true, or role = 'owner'/'manager'.
-- ============================================================================

-- ============================================================================
-- MIGRATION — for a database that already has the earlier schema running.
-- Running the whole file above again is safe (every insert/policy is
-- idempotent), EXCEPT new columns on existing tables, which need adding
-- explicitly since "create table if not exists" won't alter a table that's
-- already there. Run this block once, then the full file above can be
-- re-run any time without harm.
-- ============================================================================
alter table public.bookings add column if not exists phone2 text;
alter table public.bookings add column if not exists addons_total numeric not null default 0;
alter table public.bookings add column if not exists updated_at timestamptz not null default now();
alter table public.ledger_entries add column if not exists handed_to text;

update public.venues set min_waiver = 200;

-- Roles: allow admin / general_manager, booking_number sequence, and the
-- notifications-relevant realtime publication (already added for bookings
-- above, kept here for databases migrating from an older schema version).
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner','admin','manager','general_manager','staff'));

create sequence if not exists public.booking_number_seq;
alter table public.bookings add column if not exists booking_number bigint;
update public.bookings set booking_number = nextval('public.booking_number_seq') where booking_number is null;
alter table public.bookings alter column booking_number set not null;
alter table public.bookings alter column booking_number set default nextval('public.booking_number_seq');
create unique index if not exists bookings_number_idx on public.bookings (booking_number);

drop policy if exists "profiles_update_by_owner" on public.profiles;
create policy "profiles_update_by_admin" on public.profiles
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Re-create ledger/employees policies so General Manager is explicitly
-- excluded from ledger visibility even if can_view_ledger was ever set true.
drop policy if exists "ledger_select_restricted" on public.ledger_entries;
create policy "ledger_select_restricted" on public.ledger_entries for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid()
    and (p.role in ('owner','admin','manager') or (p.can_view_ledger = true and p.role <> 'general_manager'))));
drop policy if exists "ledger_insert_restricted" on public.ledger_entries;
create policy "ledger_insert_restricted" on public.ledger_entries for insert with check (
  exists (select 1 from public.profiles p where p.id = auth.uid()
    and (p.role in ('owner','admin','manager') or (p.can_view_ledger = true and p.role <> 'general_manager'))));
drop policy if exists "ledger_delete_restricted" on public.ledger_entries;
create policy "ledger_delete_restricted" on public.ledger_entries for delete using (
  exists (select 1 from public.profiles p where p.id = auth.uid()
    and (p.role in ('owner','admin','manager') or (p.can_view_ledger = true and p.role <> 'general_manager'))));
drop policy if exists "ledger_update_restricted" on public.ledger_entries;
create policy "ledger_update_restricted" on public.ledger_entries for update using (
  exists (select 1 from public.profiles p where p.id = auth.uid()
    and (p.role in ('owner','admin','manager') or (p.can_view_ledger = true and p.role <> 'general_manager'))));

drop policy if exists "employees_select_restricted" on public.employees;
create policy "employees_select_restricted" on public.employees for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid()
    and (p.role in ('owner','admin','manager') or (p.can_view_ledger = true and p.role <> 'general_manager'))));
drop policy if exists "employees_insert_restricted" on public.employees;
create policy "employees_insert_restricted" on public.employees for insert with check (
  exists (select 1 from public.profiles p where p.id = auth.uid()
    and (p.role in ('owner','admin','manager') or (p.can_view_ledger = true and p.role <> 'general_manager'))));
drop policy if exists "employees_update_restricted" on public.employees;
create policy "employees_update_restricted" on public.employees for update using (
  exists (select 1 from public.profiles p where p.id = auth.uid()
    and (p.role in ('owner','admin','manager') or (p.can_view_ledger = true and p.role <> 'general_manager'))));
-- ============================================================================

-- ============================================================================
-- MIGRATION: role redefinition — adds the Developer role and moves staff/
-- access editing to it exclusively (Owner/Admin can view but not edit;
-- Manager/General Manager can no longer see the Staff & Access screen at
-- all). Also adds the system_issues table for the new Developer Console.
-- Run this once against an existing database.
-- ============================================================================
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner','admin','manager','general_manager','developer','staff'));

drop policy if exists "profiles_update_by_owner" on public.profiles;
drop policy if exists "profiles_update_by_admin" on public.profiles;
create policy "profiles_update_by_developer" on public.profiles
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'developer')
  );

create table if not exists public.system_issues (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  related_profile_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.system_issues enable row level security;
drop policy if exists "system_issues_all_developer" on public.system_issues;
create policy "system_issues_all_developer" on public.system_issues
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'developer')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'developer')
  );
-- ============================================================================

-- ============================================================================
-- MIGRATION: fix created_by foreign keys so a profile (e.g. a test account)
-- can be deleted without being blocked by rows that reference it. Old bookings
-- / ledger entries / system issues just lose the "created by" attribution
-- (set to null) instead of preventing the delete. Run this once.
-- ============================================================================
alter table public.bookings drop constraint if exists bookings_created_by_fkey;
alter table public.bookings add constraint bookings_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.ledger_entries drop constraint if exists ledger_entries_created_by_fkey;
alter table public.ledger_entries add constraint ledger_entries_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.system_issues drop constraint if exists system_issues_created_by_fkey;
alter table public.system_issues add constraint system_issues_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
-- ============================================================================
