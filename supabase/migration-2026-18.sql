-- ============================================================================
-- SERENE MARQUEE — MIGRATION 2026-18
-- Run AFTER migration 2026-17. Safe to re-run.
--
--   1. Booking advances post to the daily ledger on their own, dated the day
--      the money was taken — not the function date, and not only when the
--      person saving happened to have ledger access.
--   2. Client payments after the advance: any number of instalments recorded
--      against a booking, each one posted to the ledger as income.
--   3. An approved discount is written onto its booking the moment it is
--      approved, so nobody has to type the figure in again.
--   4. "Recorded by" is the person who actually saved the booking, stamped at
--      the moment it stopped being a draft.
--   5. Payroll: advances come off that month's salary in full; loans come off
--      in a fixed monthly instalment. Both are worked out automatically.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. HELPERS
-- ---------------------------------------------------------------------------

-- Today's date in Pakistan. The database clock runs on UTC, so between
-- midnight and 5 a.m. local time "current_date" would still be yesterday.
create or replace function public.pk_today()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Karachi')::date;
$$;

create or replace function public.booking_ref(n bigint)
returns text language sql immutable as $$
  select 'SM-' || lpad(coalesce(n, 0)::text, 6, '0');
$$;

-- "Mr. Ahmed Khan (SM-000123, Walima)" — how a booking is named in the ledger.
create or replace function public.booking_ledger_label(b public.bookings)
returns text language sql stable as $$
  select concat_ws(' ', b.title, b.client)
      || ' (' || public.booking_ref(b.booking_number) || ', '
      || case when b.function_type = 'Other'
              then coalesce(nullif(btrim(b.function_type_other), ''), 'Other')
              else b.function_type end
      || ')';
$$;


-- ---------------------------------------------------------------------------
-- 1. BOOKING ADVANCE -> LEDGER
--
--    The booking form used to insert the ledger row itself. Two things went
--    wrong with that:
--      - it dated the entry on the FUNCTION date, so an advance taken today
--        for a December wedding sat in December's ledger, invisible in this
--        month's view;
--      - it ran as the person saving, so for anyone without ledger access the
--        insert was silently refused and the advance never reached the ledger.
--    Editing the advance afterwards never touched the ledger at all.
--
--    The database now keeps exactly one advance entry per booking, dated the
--    day it was recorded, and keeps its amount in step with the booking.
-- ---------------------------------------------------------------------------
create or replace function public.sync_booking_advance_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  led uuid;
  descr text;
begin
  -- A draft is not a booking yet, so no money has been recorded against it.
  if new.status = 'Draft' then
    return null;
  end if;

  -- Only act when the advance changes, or when a draft becomes a booking.
  if TG_OP = 'UPDATE'
     and new.advance is not distinct from old.advance
     and old.status <> 'Draft' then
    return null;
  end if;

  select id into led
  from public.ledger_entries
  where booking_id = new.id and category = 'booking_advance'
  order by created_at
  limit 1;

  descr := 'Advance — ' || public.booking_ledger_label(new);

  if coalesce(new.advance, 0) > 0 then
    if led is null then
      insert into public.ledger_entries
        (entry_date, type, description, amount, booking_id, category, created_by)
      values
        (public.pk_today(), 'income', descr, new.advance, new.id, 'booking_advance',
         coalesce(auth.uid(), new.created_by));
    else
      update public.ledger_entries
      set amount = new.advance, description = descr
      where id = led;
    end if;
  elsif led is not null then
    delete from public.ledger_entries where id = led;
  end if;

  return null;
end;
$$;

drop trigger if exists bookings_sync_advance_ledger on public.bookings;
create trigger bookings_sync_advance_ledger
  after insert or update on public.bookings
  for each row execute procedure public.sync_booking_advance_ledger();

-- Tag the advance rows the old booking form wrote, so the trigger above
-- recognises them and doesn't add a second one.
update public.ledger_entries
set category = 'booking_advance'
where booking_id is not null
  and category is null
  and type = 'income'
  and description like 'Advance —%';

-- Move them to the day they were actually recorded instead of the function
-- date, so each one shows in the month the money came in.
update public.ledger_entries
set entry_date = (created_at at time zone 'Asia/Karachi')::date
where category = 'booking_advance'
  and entry_date <> (created_at at time zone 'Asia/Karachi')::date;

-- Advances that never reached the ledger (saved by someone without ledger
-- access, or entered later on the edit screen) are added now, dated the day
-- the booking was recorded.
insert into public.ledger_entries
  (entry_date, type, description, amount, booking_id, category, created_by, created_at)
select (b.created_at at time zone 'Asia/Karachi')::date,
       'income',
       'Advance — ' || public.booking_ledger_label(b),
       b.advance,
       b.id,
       'booking_advance',
       b.created_by,
       b.created_at
from public.bookings b
where b.status <> 'Draft'
  and coalesce(b.advance, 0) > 0
  and not exists (
    select 1 from public.ledger_entries l
    where l.booking_id = b.id and l.category = 'booking_advance'
  );

-- An advance edited after the booking was first saved left the ledger on the
-- old figure. Bring every one in line with what the booking says.
update public.ledger_entries l
set amount = b.advance
from public.bookings b
where l.booking_id = b.id
  and l.category = 'booking_advance'
  and coalesce(b.advance, 0) > 0
  and l.amount <> b.advance;


-- ---------------------------------------------------------------------------
-- 2. CLIENT PAYMENTS AFTER THE ADVANCE
--
--    Works like a vendor's account: any number of payments on any dates, each
--    posted to the daily ledger as income, with the booking's balance due
--    reduced by the running total.
-- ---------------------------------------------------------------------------
alter table public.bookings add column if not exists payments_total numeric not null default 0;

create table if not exists public.booking_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  paid_on date not null default public.pk_today(),
  amount numeric not null check (amount > 0),
  method text,                 -- Cash, Bank transfer, Cheque, Online...
  note text,
  ledger_entry_id uuid references public.ledger_entries(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists booking_payments_booking_idx
  on public.booking_payments (booking_id, paid_on, created_at);

alter table public.booking_payments enable row level security;

-- Every signed-in staff member can see a booking, so they can see what has
-- been paid against it. Owner accounts stay monitor-only.
drop policy if exists "booking_payments_select" on public.booking_payments;
create policy "booking_payments_select" on public.booking_payments
  for select using (auth.role() = 'authenticated');

drop policy if exists "booking_payments_insert" on public.booking_payments;
create policy "booking_payments_insert" on public.booking_payments
  for insert with check (auth.role() = 'authenticated' and public.can_write_data());

drop policy if exists "booking_payments_update" on public.booking_payments;
create policy "booking_payments_update" on public.booking_payments
  for update using (auth.role() = 'authenticated' and public.can_write_data());

drop policy if exists "booking_payments_delete" on public.booking_payments;
create policy "booking_payments_delete" on public.booking_payments
  for delete using (auth.role() = 'authenticated' and public.can_write_data());

-- Before a payment is written: check it, and post it to the ledger. Runs as
-- the definer so the ledger row is written whatever the recorder's access.
create or replace function public.booking_payment_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  b public.bookings%rowtype;
  led uuid;
  descr text;
begin
  select * into b from public.bookings where id = new.booking_id;
  if not found then
    raise exception 'That booking no longer exists.';
  end if;
  if b.status = 'Draft' then
    raise exception 'Save the booking before recording payments against it.';
  end if;
  if coalesce(new.amount, 0) <= 0 then
    raise exception 'Enter an amount above zero.';
  end if;

  descr := 'Payment received — ' || public.booking_ledger_label(b)
        || coalesce(' — ' || nullif(btrim(new.method), ''), '');

  if TG_OP = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    insert into public.ledger_entries
      (entry_date, type, description, amount, booking_id, category, created_by)
    values
      (new.paid_on, 'income', descr, new.amount, b.id, 'booking_payment', new.created_by)
    returning id into led;
    new.ledger_entry_id := led;
  elsif new.ledger_entry_id is not null then
    update public.ledger_entries
    set entry_date = new.paid_on, amount = new.amount, description = descr
    where id = new.ledger_entry_id;
  end if;

  return new;
end;
$$;

drop trigger if exists booking_payments_before on public.booking_payments;
create trigger booking_payments_before
  before insert or update on public.booking_payments
  for each row execute procedure public.booking_payment_before();

-- After a payment changes: keep the booking's running total right, and take
-- a deleted payment back out of the ledger.
create or replace function public.booking_payment_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  bid uuid;
begin
  if TG_OP = 'DELETE' then
    bid := old.booking_id;
    if old.ledger_entry_id is not null then
      delete from public.ledger_entries where id = old.ledger_entry_id;
    end if;
  else
    bid := new.booking_id;
  end if;

  update public.bookings
  set payments_total = coalesce(
    (select sum(amount) from public.booking_payments where booking_id = bid), 0)
  where id = bid;

  return null;
end;
$$;

drop trigger if exists booking_payments_after on public.booking_payments;
create trigger booking_payments_after
  after insert or update or delete on public.booking_payments
  for each row execute procedure public.booking_payment_after();

-- Payments received count towards the advance needed to confirm a booking.
create or replace function public.enforce_advance_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  min_advance numeric;
begin
  if new.status = 'Draft' then
    return new;
  end if;

  select value into min_advance from public.app_settings where key = 'confirmation_min';
  min_advance := coalesce(min_advance, 25000);

  if new.status = 'Confirmed'
     and coalesce(new.advance, 0) + coalesce(new.payments_total, 0) < min_advance then
    new.status := 'Tentative';
  end if;
  return new;
end;
$$;

do $$
begin
  begin execute 'alter publication supabase_realtime add table public.booking_payments'; exception when others then null; end;
end $$;


-- ---------------------------------------------------------------------------
-- 3. AN APPROVED DISCOUNT APPLIES ITSELF
--
--    Approving Rs. 135,000 used to leave the requester to open the booking,
--    type 135000 into the discount box and save. The approval now writes the
--    granted figure onto the booking itself, in the same step as the decision.
-- ---------------------------------------------------------------------------

-- Before the decision is stored: work out which booking it belongs to and
-- mark the permit as spent on it. Named "zz" so it runs after the other
-- BEFORE triggers, once the granted figure has been settled.
create or replace function public.autoapply_discount_prepare()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  matches int;
  found_id uuid;
  found_no bigint;
begin
  if not (old.status = 'pending' and new.status = 'approved') then
    return new;
  end if;

  -- A request raised before the booking had been saved even once carries no
  -- booking id. Find it by client and date — but only if exactly one fits.
  if new.booking_id is null and new.event_date is not null then
    select count(*) into matches
    from public.bookings b
    where b.status <> 'Cancelled'
      and b.event_date = new.event_date
      and (
        new.client_name is null
        or lower(regexp_replace(btrim(b.client), '\s+', ' ', 'g'))
           = lower(regexp_replace(btrim(new.client_name), '\s+', ' ', 'g'))
      );
    if matches = 1 then
      select b.id, b.booking_number into found_id, found_no
      from public.bookings b
      where b.status <> 'Cancelled'
        and b.event_date = new.event_date
        and (
          new.client_name is null
          or lower(regexp_replace(btrim(b.client), '\s+', ' ', 'g'))
             = lower(regexp_replace(btrim(new.client_name), '\s+', ' ', 'g'))
        );
      new.booking_id := found_id;
      new.booking_number := coalesce(new.booking_number, found_no);
    end if;
  end if;

  if new.booking_id is not null and new.consumed_booking_id is null then
    new.consumed_booking_id := new.booking_id;
    new.consumed_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists discount_approvals_zz_autoapply on public.discount_approvals;
create trigger discount_approvals_zz_autoapply
  before update on public.discount_approvals
  for each row execute procedure public.autoapply_discount_prepare();

-- After the decision is stored: write the granted figure onto the booking.
create or replace function public.autoapply_discount_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'pending'
     and new.status = 'approved'
     and new.consumed_booking_id is not null then
    update public.bookings
    set discount = coalesce(new.approved_amount, new.requested_amount)
    where id = new.consumed_booking_id
      and status <> 'Cancelled';
  end if;
  return null;
end;
$$;

drop trigger if exists discount_approvals_zz_autoapply_write on public.discount_approvals;
create trigger discount_approvals_zz_autoapply_write
  after update on public.discount_approvals
  for each row execute procedure public.autoapply_discount_write();

-- The discount ceiling check. Unchanged from 2026-15 except for one rule: a
-- booking that already carries an approval covering its discount passes, no
-- matter who saves it. That is what lets the approval above write the figure
-- in, and what lets the requester go on editing the booking afterwards
-- without being told the (already approved) discount is over their limit.
create or replace function public.enforce_discount_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r text;
  lim numeric;
  permit_id uuid;
  leaving_draft boolean := false;
begin
  if new.status = 'Draft' then
    return new;
  end if;

  if TG_OP = 'UPDATE' and old.status = 'Draft' then
    leaving_draft := true;
  end if;

  if TG_OP = 'UPDATE'
     and not leaving_draft
     and coalesce(new.discount, 0) <= coalesce(old.discount, 0) then
    return new;
  end if;

  select role into r from public.profiles where id = auth.uid();
  lim := public.discount_limit_for_role(r);

  if lim is null or coalesce(new.discount, 0) <= lim then
    return new;
  end if;

  -- Already approved for this booking.
  if exists (
    select 1 from public.discount_approvals a
    where a.status = 'approved'
      and (a.booking_id = new.id or a.consumed_booking_id = new.id)
      and coalesce(a.approved_amount, a.requested_amount) >= coalesce(new.discount, 0)
  ) then
    return new;
  end if;

  select a.id into permit_id
  from public.discount_approvals a
  where a.requested_by = auth.uid()
    and a.status = 'approved'
    and a.consumed_booking_id is null
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

-- Approvals already granted but never used: apply them now, so the backlog
-- clears the same way new approvals will.
update public.bookings b
set discount = coalesce(a.approved_amount, a.requested_amount)
from public.discount_approvals a
where a.status = 'approved'
  and a.consumed_booking_id is null
  and a.booking_id = b.id
  and b.status <> 'Cancelled'
  and coalesce(b.discount, 0) < coalesce(a.approved_amount, a.requested_amount);

update public.discount_approvals a
set consumed_booking_id = a.booking_id,
    consumed_at = now()
where a.status = 'approved'
  and a.consumed_booking_id is null
  and a.booking_id is not null
  and exists (
    select 1 from public.bookings b
    where b.id = a.booking_id
      and coalesce(b.discount, 0) = coalesce(a.approved_amount, a.requested_amount)
  );


-- ---------------------------------------------------------------------------
-- 4. WHO RECORDED THE BOOKING, AND WHEN
--
--    A draft is created the moment someone starts typing, so its created_at
--    is when the form was opened, not when the booking was made. The moment
--    it is saved for real, stamp the time and the person who saved it.
-- ---------------------------------------------------------------------------
create or replace function public.stamp_booking_recorded()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'Draft' and new.status <> 'Draft' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_stamp_recorded on public.bookings;
create trigger bookings_stamp_recorded
  before update on public.bookings
  for each row execute procedure public.stamp_booking_recorded();


-- ---------------------------------------------------------------------------
-- 5. PAYROLL — ADVANCES AND LOANS
--
--    advance: the whole amount comes off the salary of the month it is given
--    loan:    a fixed instalment comes off every month from `deduct_from`
--             until it is paid back
--
--    The app works both out on its own, so Net Payable already reflects them.
--    When a month's salary is paid, the amounts actually deducted are saved as
--    'repayment' rows, which fixes that month for good.
-- ---------------------------------------------------------------------------
alter table public.employee_advances add column if not exists deduct_from text;  -- 'YYYY-MM'

-- Anything already on the books starts being deducted automatically from this
-- month (or the month it was given, if later). Earlier months keep exactly
-- the instalments that were applied by hand at the time.
update public.employee_advances
set deduct_from = greatest(to_char(issued_on, 'YYYY-MM'), to_char(public.pk_today(), 'YYYY-MM'))
where deduct_from is null;

do $$
begin
  begin execute 'alter publication supabase_realtime add table public.employee_advances'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.employee_adjustments'; exception when others then null; end;
end $$;
-- ============================================================================
