-- ============================================================================
-- SERENE MARQUEE — MIGRATION 2026-11
-- Run AFTER migrations 08, 09 and 10.
-- Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run.
--
-- Covers:
--   1. New discount limits — Manager Rs. 100,000, General Manager Rs. 200,000
--   2. Discount approval requests up the chain of command
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. WHO CAN APPROVE WHOSE REQUEST
--
--    Admin (high)  ->  General Manager  ->  Manager (low)
--
--    A request goes to everyone ABOVE the requester, and the first of them to
--    act on it decides it. So a Manager's request appears for both the General
--    Manager and the Admin; a General Manager's request appears for the Admin.
-- ---------------------------------------------------------------------------
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.discount_limit_for_role(r text)
returns numeric language sql immutable as $$
  select case r
    when 'manager'         then 100000
    when 'general_manager' then 200000
    when 'staff'           then 0
    when 'owner'           then 0
    else null                    -- admin / developer: unlimited
  end;
$$;

create or replace function public.approver_roles_for(r text)
returns text[] language sql immutable as $$
  select case r
    when 'staff'           then array['manager','general_manager','admin']
    when 'manager'         then array['general_manager','admin']
    when 'general_manager' then array['admin']
    else array[]::text[]         -- admin / developer have no ceiling to clear
  end;
$$;


-- ---------------------------------------------------------------------------
-- 2. THE REQUESTS THEMSELVES
--
--    An approved request acts as a one-time permit: it lets its requester save
--    exactly one booking carrying a discount up to the approved amount, and is
--    then marked consumed so it cannot be reused on a second booking.
-- ---------------------------------------------------------------------------
create table if not exists public.discount_approvals (
  id uuid primary key default gen_random_uuid(),

  -- Context, so an approver can judge the request without hunting for it.
  booking_id uuid references public.bookings(id) on delete set null,  -- set when editing an existing booking
  client_name text,
  event_date date,
  booking_total numeric,

  requested_amount numeric not null,
  requester_limit numeric not null,
  reason text,

  requested_by uuid not null references public.profiles(id) on delete cascade,
  requester_role text not null,
  approver_roles text[] not null,

  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  approved_amount numeric,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,

  consumed_booking_id uuid references public.bookings(id) on delete set null,
  consumed_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists discount_approvals_status_idx on public.discount_approvals (status, created_at desc);
create index if not exists discount_approvals_requester_idx on public.discount_approvals (requested_by, status);

alter table public.discount_approvals enable row level security;

-- Requesters see their own; approvers see anything addressed to their role.
drop policy if exists "discount_approvals_select" on public.discount_approvals;
create policy "discount_approvals_select" on public.discount_approvals
  for select using (
    requested_by = auth.uid()
    or public.my_role() = any (approver_roles)
  );

-- You may only raise a request in your own name.
drop policy if exists "discount_approvals_insert" on public.discount_approvals;
create policy "discount_approvals_insert" on public.discount_approvals
  for insert with check (
    requested_by = auth.uid()
    and public.can_write_data()
  );

-- Only someone above the requester may decide it. Owner stays monitor-only.
drop policy if exists "discount_approvals_update" on public.discount_approvals;
create policy "discount_approvals_update" on public.discount_approvals
  for update using (
    public.my_role() = any (approver_roles)
    and public.can_write_data()
  );

-- A requester may withdraw their own request while it is still pending.
drop policy if exists "discount_approvals_delete" on public.discount_approvals;
create policy "discount_approvals_delete" on public.discount_approvals
  for delete using (requested_by = auth.uid() and status = 'pending');


-- ---------------------------------------------------------------------------
-- 3. THE LIMIT ITSELF
--
--    Unchanged in spirit: a discount above your ceiling is refused. What is
--    new is that an approved, unconsumed permit will clear it.
--
--    The check only runs when the discount is being introduced or increased,
--    so re-saving a booking that already carries an approved discount does not
--    demand a second approval.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_discount_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r text;
  lim numeric;
  permit_id uuid;
begin
  -- Nothing to check if the discount isn't going up.
  if TG_OP = 'UPDATE' and coalesce(new.discount, 0) <= coalesce(old.discount, 0) then
    return new;
  end if;

  select role into r from public.profiles where id = auth.uid();
  lim := public.discount_limit_for_role(r);

  -- null limit = unlimited (admin / developer)
  if lim is null or coalesce(new.discount, 0) <= lim then
    return new;
  end if;

  -- Over the ceiling: look for an approved permit big enough, oldest first.
  select id into permit_id
  from public.discount_approvals
  where requested_by = auth.uid()
    and status = 'approved'
    and coalesce(approved_amount, requested_amount) >= coalesce(new.discount, 0)
    and consumed_booking_id is null
  order by created_at
  limit 1;

  if permit_id is null then
    raise exception
      'Discount of Rs. % exceeds your limit of Rs. %. Request approval from the person above you before saving.',
      coalesce(new.discount, 0), lim;
  end if;

  -- Spend the permit so it cannot be reused on another booking.
  update public.discount_approvals
  set consumed_booking_id = new.id,
      consumed_at = now()
  where id = permit_id;

  return new;
end;
$$;

drop trigger if exists bookings_discount_limit on public.bookings;
create trigger bookings_discount_limit
  before insert or update on public.bookings
  for each row execute procedure public.enforce_discount_limit();


-- ---------------------------------------------------------------------------
-- 4. REALTIME — so a request lights up the approver's screen immediately
-- ---------------------------------------------------------------------------
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.discount_approvals'; exception when others then null; end;
end $$;
-- ============================================================================
