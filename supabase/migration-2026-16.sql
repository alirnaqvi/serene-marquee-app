-- ============================================================================
-- SERENE MARQUEE — MIGRATION 2026-16
-- Run AFTER migrations 08 through 15. Safe to re-run.
--
--   1. Discarding a draft actually deletes it (there was no delete policy at
--      all, so every "discard" was silently refused by the database).
--   2. Priced extras — Lamb Roast and anything else charged by the piece
--      rather than covered by the agreed per-head rate.
--   3. Discount approvals: a request can no longer be addressed to the person
--      who raised it, and the chain of command is decided by the database
--      instead of being trusted from the browser.
--   4. Role spellings are normalised, and an unrecognised role no longer means
--      "unlimited discount authority".
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. DISCARDING A DRAFT
--
--    bookings had policies for select, insert and update — and none for
--    delete. Under row level security that means every delete is refused, and
--    Supabase reports it as "0 rows affected" rather than as an error, so the
--    app looked like it had discarded the draft while the row sat there.
--
--    A delete is now allowed, and only for the one thing that is safe to
--    delete: an unfinished Draft, by the person who started it. A real
--    booking is still never deleted — it is Cancelled, which keeps the record.
-- ---------------------------------------------------------------------------
drop policy if exists "bookings_delete" on public.bookings;
create policy "bookings_delete" on public.bookings
  for delete using (
    status = 'Draft'
    and public.can_write_data()
    and (created_by = auth.uid() or public.my_role() in ('admin', 'developer'))
  );

-- The draft's item rows have to go with it rather than being orphaned.
alter table public.booking_addons drop constraint if exists booking_addons_booking_id_fkey;
alter table public.booking_addons add constraint booking_addons_booking_id_fkey
  foreign key (booking_id) references public.bookings(id) on delete cascade;

-- Sweep up drafts abandoned before this migration existed. Only drafts, only
-- ones nothing else points at.
delete from public.bookings b
where b.status = 'Draft'
  and b.created_at < now() - interval '30 days'
  and not exists (select 1 from public.ledger_entries l where l.booking_id = b.id);


-- ---------------------------------------------------------------------------
-- 2. PRICED EXTRAS (LAMB ROAST)
--
--    Nearly everything on the menu has no rate of its own: the booking carries
--    one agreed per-head figure that covers the lot. A Lamb Roast can't work
--    that way — one roast at Rs. 40,000 would have to be smeared across the
--    guest count and would move every time the count changed.
--
--    So a menu item may now be PRICED: charged by the piece, at its own rate,
--    on top of the per-head total. The per-head rate is still typed in by hand
--    exactly as before. Nothing about existing items changes — they all come
--    through as priced = false.
-- ---------------------------------------------------------------------------
alter table public.addon_items add column if not exists priced boolean not null default false;
alter table public.addon_items add column if not exists unit_label text;

-- What was actually charged, frozen onto the booking's own item rows, so a
-- later price change never rewrites an agreement that has been signed.
alter table public.booking_addons add column if not exists unit_label text;

-- The sum of those lines, kept on the booking so every list, summary, export
-- and ledger figure is right without joining the item rows.
alter table public.bookings add column if not exists extras_total numeric not null default 0;

-- The two Lamb Roast rows already exist (l01, l02) and already carry the right
-- prices in the price column — they were simply never charged, because nothing
-- read that column. They are flagged priced here rather than re-created, so
-- every booking that already references them stays intact.
--
-- NOTE: l02 was seeded at Rs. 10,000 per leg. The figure below is Rs. 1,200 as
-- given. If Rs. 10,000 is the correct one, change it here before running.
insert into public.addon_items (id, category, name, price, priced, unit_label, default_qty_mode, sort_order)
values
  ('l01', 'Lamb Roast', 'Full Lamb Roast with Stuffed Rice (per Lamb)', 40000, true, 'lamb',      'one', 1),
  ('l02', 'Lamb Roast', 'Mutton Leg Roast (per leg)',                    1200, true, 'leg piece', 'one', 2)
on conflict (id) do update
  set category    = excluded.category,
      name        = excluded.name,
      price       = excluded.price,
      priced      = true,
      unit_label  = excluded.unit_label,
      sort_order  = excluded.sort_order;

-- Everything else stays exactly as it is: covered by the per-head rate.
update public.addon_items set priced = false where category <> 'Lamb Roast';


-- ---------------------------------------------------------------------------
-- 3. DISCOUNT APPROVALS — NOBODY IS THEIR OWN APPROVER
--
--    A General Manager raised a request and it landed in his own inbox. That
--    is possible because requester_role and approver_roles were both sent up
--    from the browser and stored as given. If the requester's role was wrong
--    or stale, the list of approvers computed from it was wrong too, and could
--    contain the requester's own role.
--
--    Both fields are now decided here, from the profiles table, at the moment
--    the request is written. Whatever the browser sends is ignored.
-- ---------------------------------------------------------------------------
create or replace function public.approver_roles_for(r text)
returns text[] language sql immutable as $$
  -- Admin (high) -> General Manager -> Manager -> Staff (low).
  -- A request goes to everyone ABOVE the requester and to nobody at the
  -- requester's own level, so it can never come back to them.
  select case r
    when 'staff'           then array['manager','general_manager','admin']
    when 'manager'         then array['general_manager','admin']
    when 'general_manager' then array['admin']
    else array[]::text[]         -- admin / developer have no ceiling to clear
  end;
$$;

create or replace function public.stamp_approval_requester()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actual_role text;
begin
  select role into actual_role from public.profiles where id = auth.uid();

  -- The request belongs to whoever is signed in, at whatever rank they
  -- actually hold. The browser does not get a say in either.
  new.requested_by  := coalesce(auth.uid(), new.requested_by);
  new.requester_role := coalesce(actual_role, new.requester_role);
  new.approver_roles := public.approver_roles_for(new.requester_role);
  new.requester_limit := coalesce(public.discount_limit_for_role(new.requester_role), 0);

  if array_length(new.approver_roles, 1) is null then
    raise exception
      'There is nobody above a % to approve this. Apply the discount directly instead.',
      new.requester_role;
  end if;

  return new;
end;
$$;

drop trigger if exists discount_approvals_stamp_requester on public.discount_approvals;
create trigger discount_approvals_stamp_requester
  before insert on public.discount_approvals
  for each row execute procedure public.stamp_approval_requester();

-- Repair any request already sitting in the table with the wrong chain.
update public.discount_approvals a
set approver_roles = public.approver_roles_for(p.role),
    requester_role = p.role
from public.profiles p
where p.id = a.requested_by
  and a.status = 'pending'
  and (a.requester_role is distinct from p.role
       or a.approver_roles is distinct from public.approver_roles_for(p.role));

-- An approver sees requests addressed to their role — never their own, however
-- the row was written.
drop policy if exists "discount_approvals_select" on public.discount_approvals;
create policy "discount_approvals_select" on public.discount_approvals
  for select using (
    requested_by = auth.uid()
    or (
      public.my_role() = any (approver_roles)
      and requested_by <> auth.uid()
      and public.my_role() <> requester_role
    )
  );

drop policy if exists "discount_approvals_update" on public.discount_approvals;
create policy "discount_approvals_update" on public.discount_approvals
  for update using (
    (
      requested_by = auth.uid()                 -- may only dismiss; see the guard trigger
      or (
        public.my_role() = any (approver_roles)
        and requested_by <> auth.uid()
        and public.my_role() <> requester_role
      )
    )
    and public.can_write_data()
  );

-- Belt and braces: refuse the decision itself if it is being made by the
-- person who asked for it.
create or replace function public.block_self_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('approved', 'rejected')
     and old.status = 'pending'
     and auth.uid() = old.requested_by then
    raise exception 'You cannot decide your own discount request.';
  end if;
  return new;
end;
$$;

drop trigger if exists discount_approvals_block_self on public.discount_approvals;
create trigger discount_approvals_block_self
  before update on public.discount_approvals
  for each row execute procedure public.block_self_approval();


-- ---------------------------------------------------------------------------
-- 4. ROLES — SPELLING, AND WHAT AN UNKNOWN ONE MEANS
--
--    discount_limit_for_role() returned NULL for anything it didn't recognise,
--    and NULL was read everywhere as "no limit". So a profile whose role was
--    misspelt — 'gm', 'General Manager', a stray capital — quietly became an
--    unlimited account in the database while the app, which read the same role
--    through a lookup table that returned 0, told the person they could not
--    give any discount at all. That mismatch is the shape of the bug the
--    General Manager hit.
--
--    Only admin and developer are unlimited now, by name. Anything else is
--    zero until someone fixes the profile.
-- ---------------------------------------------------------------------------
update public.profiles
set role = case
    when lower(btrim(role)) in ('general manager','general-manager','generalmanager','gm')
      then 'general_manager'
    when lower(btrim(role)) in ('manager','mgr')          then 'manager'
    when lower(btrim(role)) in ('admin','administrator')  then 'admin'
    when lower(btrim(role)) in ('owner','ceo')            then 'owner'
    when lower(btrim(role)) in ('developer','dev')        then 'developer'
    else role
  end
where role is distinct from case
    when lower(btrim(role)) in ('general manager','general-manager','generalmanager','gm')
      then 'general_manager'
    when lower(btrim(role)) in ('manager','mgr')          then 'manager'
    when lower(btrim(role)) in ('admin','administrator')  then 'admin'
    when lower(btrim(role)) in ('owner','ceo')            then 'owner'
    when lower(btrim(role)) in ('developer','dev')        then 'developer'
    else role
  end;

create or replace function public.discount_limit_for_role(r text)
returns numeric language sql immutable as $$
  select case r
    when 'admin'           then null      -- null = no ceiling
    when 'developer'       then null
    when 'general_manager' then 200000
    when 'manager'         then 100000
    else 0                                -- staff, owner, and anything unrecognised
  end;
$$;

do $$
begin
  begin execute 'alter publication supabase_realtime add table public.addon_items'; exception when others then null; end;
end $$;


-- ---------------------------------------------------------------------------
-- CHECK THE GENERAL MANAGER'S ACCOUNT
-- Run this on its own afterwards. Every row should show a limit of 200000 for
-- the General Manager and an approver list of exactly {admin}.
-- ---------------------------------------------------------------------------
--   select full_name,
--          role,
--          public.discount_limit_for_role(role)  as limit_rs,
--          public.approver_roles_for(role)       as goes_to
--   from public.profiles
--   order by role, full_name;
-- ============================================================================
