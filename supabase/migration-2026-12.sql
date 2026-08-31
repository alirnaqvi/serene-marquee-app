-- ============================================================================
-- SERENE MARQUEE — MIGRATION 2026-12
-- Run AFTER migration-2026-11.sql. Safe to re-run.
--
-- Tightens discount approvals so a permit can only be spent on the booking it
-- was actually requested for.
--
-- THE GAP THIS CLOSES
--   Migration 11 matched a permit on requester + status + amount only. An
--   approval granted for one client's booking could therefore be spent on a
--   different booking that happened to be saved first. It was still limited to
--   a single booking, but not necessarily the intended one — and because the
--   amount check was ">=", a Rs. 500,000 approval could be burnt by an
--   unrelated Rs. 120,000 discount.
--
-- THE RULE NOW
--   A permit is only valid for:
--     * the exact booking it was raised against (when editing an existing
--       booking, where booking_id is known at request time), or
--     * a booking for the same client name AND the same function date (when
--       the request was raised while creating a new booking).
--   Client names are compared ignoring case and stray spacing.
--   The amount still has to be within what was approved.
-- ============================================================================

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

  -- Over the ceiling: find an approved permit that belongs to THIS booking.
  select a.id into permit_id
  from public.discount_approvals a
  where a.requested_by = auth.uid()
    and a.status = 'approved'
    and a.consumed_booking_id is null
    and coalesce(a.approved_amount, a.requested_amount) >= coalesce(new.discount, 0)
    and (
      -- raised while editing a specific booking
      (a.booking_id is not null and a.booking_id = new.id)
      -- raised while creating a new booking: bind to client + date
      or (
        a.booking_id is null
        and a.client_name is not null
        and lower(regexp_replace(btrim(a.client_name), '\s+', ' ', 'g'))
            = lower(regexp_replace(btrim(new.client), '\s+', ' ', 'g'))
        and a.event_date = new.event_date
      )
      -- raised before a client name had been typed: bind to the date at least
      or (a.booking_id is null and a.client_name is null and a.event_date = new.event_date)
    )
  order by a.created_at
  limit 1;

  if permit_id is null then
    raise exception
      'Discount of Rs. % is over your Rs. % limit for this booking. Request approval from the person above you — an approval granted for a different booking or date cannot be used here.',
      coalesce(new.discount, 0), lim;
  end if;

  -- Spend the permit so it cannot be reused.
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
-- ============================================================================
