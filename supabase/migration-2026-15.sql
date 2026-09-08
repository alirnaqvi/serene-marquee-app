-- ============================================================================
-- SERENE MARQUEE — MIGRATION 2026-15
-- Run AFTER migrations 08 through 14. Safe to re-run.
--
--   1. FIX: an approved discount could not actually be saved. The permit is
--      spent by a trigger that UPDATEs the approval row, and that update was
--      being re-validated as if the requester were the approver — so a Manager
--      holding a Rs. 116,250 approval was told "Rs. 116250 is above your own
--      limit of Rs. 100000" at the moment of saving.
--   2. Draft bookings: a booking form can be parked half-finished and resumed.
--      Drafts are private to whoever started them and never reach the calendar.
--   3. Discount request history: decisions are kept instead of deleted, so the
--      Pending / Approved / Declined record survives being dismissed.
--   4. Menus, venues, add-ons and the owner's charge rules become editable by
--      the Admin in the app, and new bookings read those figures live.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. THE PERMIT BUG
--
--    check_approved_amount() fires BEFORE UPDATE on discount_approvals and
--    refuses any approved_amount above the CURRENT USER's own ceiling. That is
--    correct when an approver is deciding a request. It is wrong for every
--    other update of the row — in particular the one enforce_discount_limit()
--    makes to stamp consumed_booking_id when the booking is saved, which runs
--    as the requester. A Manager spending a Rs. 116,250 permit was therefore
--    checked against the Manager's own Rs. 100,000 limit and refused.
--
--    The check now only runs on the transition into 'approved', or when the
--    approved figure itself is being changed. Consuming, dismissing and every
--    other later touch pass straight through.
-- ---------------------------------------------------------------------------
create or replace function public.check_approved_amount()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  approver_limit numeric;
begin
  if new.status <> 'approved' then
    return new;
  end if;

  -- Already approved, and the granted figure isn't being touched: this is a
  -- later housekeeping update (spending the permit, dismissing the notice),
  -- not a decision. Nothing to re-check.
  if TG_OP = 'UPDATE'
     and old.status = 'approved'
     and new.approved_amount is not distinct from old.approved_amount then
    return new;
  end if;

  -- Default to the full amount when the approver didn't name a figure.
  if new.approved_amount is null then
    new.approved_amount := new.requested_amount;
  end if;

  if new.approved_amount <= 0 then
    raise exception 'An approved discount must be more than zero. Decline the request instead.';
  end if;

  if new.approved_amount > new.requested_amount then
    raise exception
      'You cannot approve more than was requested (Rs. % was asked for).',
      new.requested_amount;
  end if;

  -- An approver may not grant beyond their own authority.
  approver_limit := public.discount_limit_for_role(public.my_role());
  if approver_limit is not null and new.approved_amount > approver_limit then
    raise exception
      'Rs. % is above your own limit of Rs. %. Pass this request up to the Admin instead.',
      new.approved_amount, approver_limit;
  end if;

  return new;
end;
$$;

drop trigger if exists discount_approvals_check_amount on public.discount_approvals;
create trigger discount_approvals_check_amount
  before update on public.discount_approvals
  for each row execute procedure public.check_approved_amount();


-- ---------------------------------------------------------------------------
-- 2. DRAFT BOOKINGS
--
--    A form that has been started but not finished is saved as a Draft so the
--    person can come back to it. A Draft is not a booking yet: it holds no
--    date on the calendar, blocks nothing, and counts towards no figure. It
--    becomes Tentative or Confirmed only when the form is properly saved.
-- ---------------------------------------------------------------------------
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check
  check (status in ('Draft','Tentative','Confirmed','Cancelled'));

-- A draft is the property of whoever started it. Everyone else — including
-- other staff who would otherwise see every booking — sees nothing until it
-- is saved for real. Admin and Developer can see them for support purposes.
drop policy if exists "bookings_select" on public.bookings;
create policy "bookings_select" on public.bookings
  for select using (
    auth.role() = 'authenticated'
    and (
      status <> 'Draft'
      or created_by = auth.uid()
      or public.my_role() in ('admin','developer')
    )
  );

-- Drafts skip the discount ceiling — nothing has been promised to anyone yet.
-- The check is applied in full the moment the draft leaves Draft, whether or
-- not the discount figure itself changed at that point.
create or replace function public.enforce_discount_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r text;
  lim numeric;
  permit_id uuid;
  leaving_draft boolean := false;
begin
  -- A parked draft is not a commitment; let any figure sit in it.
  if new.status = 'Draft' then
    return new;
  end if;

  if TG_OP = 'UPDATE' and old.status = 'Draft' then
    leaving_draft := true;
  end if;

  -- Nothing to check if the discount isn't going up (unless this is the
  -- moment a draft turns into a real booking, when it must be checked).
  if TG_OP = 'UPDATE'
     and not leaving_draft
     and coalesce(new.discount, 0) <= coalesce(old.discount, 0) then
    return new;
  end if;

  select role into r from public.profiles where id = auth.uid();
  lim := public.discount_limit_for_role(r);

  -- null limit = unlimited (admin / developer)
  if lim is null or coalesce(new.discount, 0) <= lim then
    return new;
  end if;

  select a.id into permit_id
  from public.discount_approvals a
  where a.requested_by = auth.uid()
    and a.status = 'approved'
    and a.consumed_booking_id is null
    -- the approved figure is the ceiling, so a 200,000 request granted at
    -- 150,000 lets 150,000 through and refuses 150,001
    and coalesce(a.approved_amount, a.requested_amount) >= coalesce(new.discount, 0)
    and (
      (a.booking_id is not null and a.booking_id = new.id)
      or (
        a.booking_id is null
        and a.client_name is not null
        and lower(regexp_replace(btrim(a.client_name), '\s+', ' ', 'g'))
            = lower(regexp_replace(btrim(new.client), '\s+', ' ', 'g'))
        and a.event_date = new.event_date
      )
      or (a.booking_id is null and a.client_name is null and a.event_date = new.event_date)
    )
  order by a.created_at
  limit 1;

  if permit_id is null then
    raise exception
      'Discount of Rs. % is over your Rs. % limit for this booking, and no approval covering that amount is in hand. Request approval from the person above you.',
      coalesce(new.discount, 0), lim;
  end if;

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
-- 3. DISCOUNT REQUEST HISTORY
--
--    Dismissing a decision used to delete the row, which meant the record of
--    what was asked for and what was granted disappeared with it. (It also
--    silently failed: the delete policy only allows pending rows.) Dismissal
--    now just hides the dashboard notice; the request itself is kept forever.
-- ---------------------------------------------------------------------------
alter table public.discount_approvals add column if not exists dismissed_at timestamptz;

create index if not exists discount_approvals_history_idx
  on public.discount_approvals (requested_by, created_at desc);

-- A requester may now update their OWN row, but only to dismiss the notice —
-- the guard trigger below refuses any other change from them.
drop policy if exists "discount_approvals_update" on public.discount_approvals;
create policy "discount_approvals_update" on public.discount_approvals
  for update using (
    (
      public.my_role() = any (approver_roles)
      or requested_by = auth.uid()
    )
    and public.can_write_data()
  );

create or replace function public.guard_approval_self_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Approvers (and the trigger-driven internal updates, which run as security
  -- definer with no role of their own) are unaffected.
  if public.my_role() = any (old.approver_roles) then
    return new;
  end if;

  if auth.uid() = old.requested_by then
    -- The requester may only mark the notice as seen.
    if new.status is distinct from old.status
       or new.approved_amount is distinct from old.approved_amount
       or new.requested_amount is distinct from old.requested_amount
       or new.decision_note is distinct from old.decision_note
       or new.decided_by is distinct from old.decided_by
       or new.approver_roles is distinct from old.approver_roles then
      raise exception 'You can only dismiss your own request, not change its decision.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists discount_approvals_guard_self on public.discount_approvals;
create trigger discount_approvals_guard_self
  before update on public.discount_approvals
  for each row execute procedure public.guard_approval_self_update();


-- ---------------------------------------------------------------------------
-- 4. OWNER CHARGE RULES, EDITABLE BY THE ADMIN
--
--    KPRA tax, cooling, heating, the confirmation token and the extra-hour
--    charge stopped being constants baked into the code. They live here, the
--    Admin edits them on Menus & Venues, and every NEW booking form, quote and
--    agreement reads the current figure. Bookings already saved are untouched:
--    their totals were agreed at the old rate and stay at it.
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  label text not null,
  value numeric not null,
  unit text not null default 'rs' check (unit in ('rs','percent','rs_per_hour','rs_per_head')),
  hint text,
  sort_order int not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, label, value, unit, hint, sort_order) values
  ('kpra_rate',        'KPRA Tax on food',                          15,     'percent',      'Applied to the food subtotal on every new booking.', 1),
  ('cooling_charge',   'Cooling (per hall)',                        100000, 'rs',           'Charged once per selected hall.', 2),
  ('heater_charge',    'Heating (per heater)',                      8000,   'rs',           'Multiplied by the number of heaters.', 3),
  ('token_minimum',    'Token to confirm booking (non-refundable)', 50000,  'rs',           'Quoted on the rate card.', 4),
  ('extra_hour',       'Extra hour beyond the 4-hour slot',         25000,  'rs_per_hour',  'Quoted on the rate card.', 5),
  ('confirmation_min', 'Advance needed to confirm a booking',       25000,  'rs',           'Below this a booking stays Tentative.', 6),
  ('entry_test_rate',  'Entry Test rate',                           600,    'rs_per_head',  'Flat per-head rate for entry-test bookings — no menu.', 7)
on conflict (key) do nothing;   -- never clobber a figure the Admin has already changed

alter table public.app_settings enable row level security;

drop policy if exists "app_settings_select" on public.app_settings;
create policy "app_settings_select" on public.app_settings
  for select using (auth.role() = 'authenticated');

drop policy if exists "app_settings_write" on public.app_settings;
create policy "app_settings_write" on public.app_settings
  for all using (public.my_role() in ('admin','developer'))
  with check (public.my_role() in ('admin','developer'));

-- Keep the confirmation minimum the database enforces in step with the figure
-- the Admin sets, instead of the hard-coded 25,000 it used to carry.
create or replace function public.enforce_advance_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  min_advance numeric;
begin
  -- Drafts are not bookings yet — leave their status alone.
  if new.status = 'Draft' then
    return new;
  end if;

  select value into min_advance from public.app_settings where key = 'confirmation_min';
  min_advance := coalesce(min_advance, 25000);

  if new.status = 'Confirmed' and coalesce(new.advance, 0) < min_advance then
    new.status := 'Tentative';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_advance_status on public.bookings;
create trigger bookings_advance_status
  before insert or update on public.bookings
  for each row execute procedure public.enforce_advance_status();


-- ---------------------------------------------------------------------------
-- 5. MENUS, VENUES AND ADD-ONS BECOME EDITABLE IN THE APP
--    Read stays open to every signed-in staff member; writing is the Admin's
--    (and the Developer's) alone. Owner accounts remain monitor-only.
-- ---------------------------------------------------------------------------
alter table public.menus       alter column rate set default 0;
alter table public.addon_items alter column price set default 0;

drop policy if exists "venues_write" on public.venues;
create policy "venues_write" on public.venues
  for all using (public.my_role() in ('admin','developer'))
  with check (public.my_role() in ('admin','developer'));

drop policy if exists "menus_write" on public.menus;
create policy "menus_write" on public.menus
  for all using (public.my_role() in ('admin','developer'))
  with check (public.my_role() in ('admin','developer'));

drop policy if exists "addon_items_write" on public.addon_items;
create policy "addon_items_write" on public.addon_items
  for all using (public.my_role() in ('admin','developer'))
  with check (public.my_role() in ('admin','developer'));

-- A menu still in use by a booking must not vanish underneath it.
alter table public.bookings drop constraint if exists bookings_menu_id_fkey;
alter table public.bookings add constraint bookings_menu_id_fkey
  foreign key (menu_id) references public.menus(id) on delete set null;

do $$
begin
  begin execute 'alter publication supabase_realtime add table public.app_settings'; exception when others then null; end;
end $$;
-- ============================================================================
