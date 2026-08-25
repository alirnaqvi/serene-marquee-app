-- ============================================================================
-- SERENE MARQUEE — MIGRATION 2026-09
-- Run this AFTER migration-2026-08.sql.
-- Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run.
--
-- Covers:
--   1. Discount limits raised: Manager 50,000 / General Manager 100,000
--   2. Every menu add-on is now priced per head
--   3. Vendor account ledger (date / debit / credit / running balance)
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. DISCOUNT LIMITS — new ceilings
--      Manager .............. Rs.  50,000 per booking   (was 30,000)
--      General Manager ...... Rs. 100,000 per booking   (was 50,000)
--      Staff / Owner ........ no discount authority
--      Admin / Developer .... unlimited
-- ---------------------------------------------------------------------------
create or replace function public.enforce_discount_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r text;
  lim numeric;
begin
  select role into r from public.profiles where id = auth.uid();

  lim := case r
    when 'manager'          then 50000
    when 'general_manager'  then 100000
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


-- ---------------------------------------------------------------------------
-- 2. MENU — everything is charged per head.
--    A handful of items (cold drinks, lamb roast, mutton leg, the stalls) had
--    been entered with the wrong quantity mode and were being multiplied per
--    unit instead of per head. In practice they are charged per head at the
--    same rate as everything else, so this only corrects the mode.
--
--    PRICES ARE NOT CHANGED. Every item keeps the exact rate it has today;
--    the only difference is that quantity now follows the guaranteed guest
--    count, the way the rest of the menu already worked.
-- ---------------------------------------------------------------------------
update public.addon_items set default_qty_mode = 'guests';


-- ---------------------------------------------------------------------------
-- 3. VENDOR ACCOUNT LEDGER
--    Mirrors the shop diary the office already keeps: one row per entry, with
--    a debit column, a credit column, and a running balance.
--
--      credit = a bill/purchase from the vendor  -> increases what we owe
--      debit  = a payment made to the vendor     -> reduces what we owe
--      balance = running (credits - debits), i.e. outstanding payable
--
--    Multiple entries per day are expected and fully supported.
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_transactions (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  txn_date date not null default current_date,
  description text,
  debit numeric not null default 0,    -- payment made to the vendor
  credit numeric not null default 0,   -- bill received from the vendor
  ledger_entry_id uuid references public.ledger_entries(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists vendor_transactions_vendor_idx
  on public.vendor_transactions (vendor_id, txn_date, created_at);

alter table public.vendor_transactions enable row level security;

drop policy if exists "vendor_transactions_select" on public.vendor_transactions;
create policy "vendor_transactions_select" on public.vendor_transactions
  for select using (public.has_ledger_access());

drop policy if exists "vendor_transactions_write" on public.vendor_transactions;
create policy "vendor_transactions_write" on public.vendor_transactions
  for all using (public.has_ledger_access() and public.can_write_data())
  with check (public.has_ledger_access() and public.can_write_data());

-- Backfill: vendor payments already recorded through the ledger become debit
-- entries, so no history is lost when the diary view goes live.
insert into public.vendor_transactions (vendor_id, txn_date, description, debit, credit, ledger_entry_id, created_by, created_at)
select le.vendor_id, le.entry_date, le.description, le.amount, 0, le.id, le.created_by, le.created_at
from public.ledger_entries le
where le.vendor_id is not null
  and le.category = 'vendor'
  and not exists (
    select 1 from public.vendor_transactions vt where vt.ledger_entry_id = le.id
  );

do $$
begin
  begin execute 'alter publication supabase_realtime add table public.vendor_transactions'; exception when others then null; end;
end $$;
-- ============================================================================
