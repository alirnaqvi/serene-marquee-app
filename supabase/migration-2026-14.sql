-- ============================================================================
-- SERENE MARQUEE — MIGRATION 2026-14
-- Run AFTER migrations 08 through 13. Safe to re-run.
--
-- Restores requesting a discount approval straight from a brand-new booking,
-- before it has been saved and before it has an order number.
--
-- Migration 13 required every request to name a booking, which meant staff had
-- to save first and come back. That was the wrong trade. A permit is instead
-- bound by whichever anchor is available:
--
--   * raised while EDITING a saved booking  -> bound to that booking's id
--     (and its order number is shown to the approver)
--   * raised while CREATING a booking       -> bound to the client name and
--     the function date on the request
--
-- Either way the permit still covers exactly one booking and is spent on use.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Requests no longer have to name a booking.
-- ---------------------------------------------------------------------------
drop trigger if exists discount_approvals_require_booking on public.discount_approvals;
drop function if exists public.require_booking_on_request();


-- ---------------------------------------------------------------------------
-- 2. Permit matching accepts either anchor.
--    Client names are compared ignoring case and stray spacing.
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
    -- the approved figure is the ceiling, so a 200,000 request granted at
    -- 150,000 lets 150,000 through and refuses 150,001
    and coalesce(a.approved_amount, a.requested_amount) >= coalesce(new.discount, 0)
    and (
      -- raised against a saved booking
      (a.booking_id is not null and a.booking_id = new.id)
      -- raised while creating: bound to this client on this date
      or (
        a.booking_id is null
        and a.client_name is not null
        and lower(regexp_replace(btrim(a.client_name), '\s+', ' ', 'g'))
            = lower(regexp_replace(btrim(new.client), '\s+', ' ', 'g'))
        and a.event_date = new.event_date
      )
      -- raised before a name was typed: the date is the only anchor there is
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
-- 3. Once a permit is spent on a booking, record which booking that was, so
--    the approver's record points at the real order number afterwards.
-- ---------------------------------------------------------------------------
create or replace function public.backfill_approval_booking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.consumed_booking_id is not null and new.booking_id is null then
    new.booking_id := new.consumed_booking_id;
    select b.booking_number into new.booking_number
    from public.bookings b where b.id = new.consumed_booking_id;
  end if;
  return new;
end;
$$;

drop trigger if exists discount_approvals_backfill_booking on public.discount_approvals;
create trigger discount_approvals_backfill_booking
  before update on public.discount_approvals
  for each row execute procedure public.backfill_approval_booking();
-- ============================================================================
