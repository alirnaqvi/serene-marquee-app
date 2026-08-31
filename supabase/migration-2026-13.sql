-- ============================================================================
-- SERENE MARQUEE — MIGRATION 2026-13
-- Run AFTER migrations 08 through 12. Safe to re-run.
--
-- Three changes:
--   1. Every approval request now carries the booking's ORDER NUMBER plus the
--      details an approver needs: guests, menu, venue(s), sitting, function
--      type and the booking total.
--   2. An approver can grant a SMALLER amount than was asked for — approve
--      Rs. 120,000 against a request for Rs. 150,000.
--   3. A permit is bound to the booking's id, full stop. Requests are now
--      always raised against a saved booking, so the older client-name-and-
--      date fallback is gone.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. CONTEXT CARRIED WITH THE REQUEST
--    Snapshotted at request time rather than joined live, so the approver sees
--    exactly the figures the requester was looking at when they asked.
-- ---------------------------------------------------------------------------
alter table public.discount_approvals add column if not exists booking_number bigint;
alter table public.discount_approvals add column if not exists guests integer;
alter table public.discount_approvals add column if not exists menu_label text;
alter table public.discount_approvals add column if not exists venue_label text;
alter table public.discount_approvals add column if not exists session text;
alter table public.discount_approvals add column if not exists function_label text;
alter table public.discount_approvals add column if not exists current_discount numeric;


-- ---------------------------------------------------------------------------
-- 2. PARTIAL APPROVAL
--    approved_amount already exists. It may now be lower than
--    requested_amount, but never higher, and never above the approver's own
--    ceiling — an approver cannot grant more than they could give themselves.
-- ---------------------------------------------------------------------------
create or replace function public.check_approved_amount()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  approver_limit numeric;
begin
  if new.status <> 'approved' then
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
-- 3. PERMIT BINDING — the order number is the anchor
--
--    Because a request is now always raised from a saved booking, booking_id
--    is always known and the permit is tied to it exactly. No name matching,
--    no date matching, nothing to drift.
--
--    The permit ceiling is approved_amount, so a Rs. 150,000 request approved
--    at Rs. 120,000 lets Rs. 120,000 through and refuses Rs. 121,000.
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

  select a.id into permit_id
  from public.discount_approvals a
  where a.requested_by = auth.uid()
    and a.status = 'approved'
    and a.consumed_booking_id is null
    and a.booking_id = new.id
    and coalesce(a.approved_amount, a.requested_amount) >= coalesce(new.discount, 0)
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
-- 4. Requests must name a booking from here on.
--    Existing rows are left alone; only new ones are constrained.
-- ---------------------------------------------------------------------------
create or replace function public.require_booking_on_request()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.booking_id is null then
    raise exception
      'Save the booking first, then request the discount approval against its order number.';
  end if;
  return new;
end;
$$;

drop trigger if exists discount_approvals_require_booking on public.discount_approvals;
create trigger discount_approvals_require_booking
  before insert on public.discount_approvals
  for each row execute procedure public.require_booking_on_request();
-- ============================================================================
