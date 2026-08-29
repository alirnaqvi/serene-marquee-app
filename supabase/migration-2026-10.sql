-- ============================================================================
-- SERENE MARQUEE — MIGRATION 2026-10
-- Run this AFTER migration-2026-08.sql and migration-2026-09.sql.
-- Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run.
--
-- Covers:
--   1. Mr. / Mrs. / Ms. title on the client name
--   2. A booking is Confirmed only once Rs. 25,000+ advance is received
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. CLIENT TITLE
--    Stored separately from the name so it can be shown or left off as needed
--    (an organization or "Ahmed Family" has no title). Nullable on purpose.
-- ---------------------------------------------------------------------------
alter table public.bookings add column if not exists title text;

alter table public.bookings drop constraint if exists bookings_title_check;
alter table public.bookings add constraint bookings_title_check
  check (title is null or title in ('Mr.', 'Mrs.', 'Ms.'));


-- ---------------------------------------------------------------------------
-- 2. ADVANCE BELOW Rs. 25,000 => TENTATIVE
--    A booking is only Confirmed once an advance of at least Rs. 25,000 has
--    actually been received. Anything less — including nothing at all — is
--    forced back to Tentative, and a booking later edited to drop below the
--    threshold returns to Tentative too.
--
--    Keep this figure in step with CONFIRMATION_MINIMUM in src/lib/constants.ts.
--
--    Cancelled bookings are left alone — cancelling is a deliberate act and
--    must not be undone by this rule. A cancelled booking whose advance has
--    been refunded therefore stays Cancelled rather than reverting.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_advance_status()
returns trigger language plpgsql set search_path = public as $$
declare
  min_advance numeric := 25000;   -- = CONFIRMATION_MINIMUM
begin
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

-- Bring existing rows in line: anything marked Confirmed on less than
-- Rs. 25,000 becomes Tentative. Cancelled bookings are untouched.
update public.bookings
set status = 'Tentative'
where status = 'Confirmed'
  and coalesce(advance, 0) < 25000;
-- ============================================================================
