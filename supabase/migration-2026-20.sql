-- 2026-20: Admin can manage staff roles + ledger access; General Manager can be
--          granted ledger access (e.g. Ikram Abbasi). Safe to re-run.
--
-- 1. has_ledger_access(): no longer excludes general_manager. A GM sees the
--    ledger only when can_view_ledger is switched on for them.
-- 2. Admin joins Developer in being able to UPDATE profiles (role / ledger).
-- 3. A trigger guards those updates so the wider policy can't be abused:
--      Developer : anything, except changing their own role
--      Admin     : may only set staff / manager / general_manager roles and the
--                  ledger flag, never on Admin/Developer/Owner rows or their own row
--      anyone else: cannot change role or can_view_ledger at all
--    (This also closes the old hole where profiles_update_self let any signed-in
--     user edit their own role. Service-role / SQL-editor changes, where
--     auth.uid() is null, are unaffected.)

-- 1 ------------------------------------------------------------------------
create or replace function public.has_ledger_access()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role in ('owner','admin','manager') or p.can_view_ledger = true)
  );
$$;

-- These two SELECT policies were still the inline, GM-excluding versions.
drop policy if exists "ledger_select_restricted" on public.ledger_entries;
create policy "ledger_select_restricted" on public.ledger_entries
  for select using (public.has_ledger_access());

drop policy if exists "employees_select_restricted" on public.employees;
create policy "employees_select_restricted" on public.employees
  for select using (public.has_ledger_access());

-- 2 ------------------------------------------------------------------------
drop policy if exists "profiles_update_by_developer" on public.profiles;
drop policy if exists "profiles_update_by_admin" on public.profiles;
drop policy if exists "profiles_update_by_access_admins" on public.profiles;
create policy "profiles_update_by_access_admins" on public.profiles
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','developer'))
  );

-- 3 ------------------------------------------------------------------------
create or replace function public.guard_profile_access_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor_role text;
begin
  -- Service role / SQL editor: no signed-in user, nothing to guard.
  if auth.uid() is null then
    return new;
  end if;

  -- Name, username etc. are not access settings.
  if new.role is not distinct from old.role
     and new.can_view_ledger is not distinct from old.can_view_ledger then
    return new;
  end if;

  select role into actor_role from public.profiles where id = auth.uid();

  if actor_role = 'developer' then
    if new.id = auth.uid() and new.role is distinct from old.role then
      raise exception 'You cannot change your own role.';
    end if;
    return new;
  end if;

  if actor_role = 'admin' then
    if new.id = auth.uid() then
      raise exception 'You cannot change your own role or access.';
    end if;
    if old.role not in ('staff','manager','general_manager')
       or new.role not in ('staff','manager','general_manager') then
      raise exception 'Only the Developer can change Admin, Developer or Owner accounts.';
    end if;
    return new;
  end if;

  raise exception 'Only the Admin or Developer can change roles and ledger access.';
end;
$$;

drop trigger if exists profiles_guard_access on public.profiles;
create trigger profiles_guard_access
  before update on public.profiles
  for each row execute function public.guard_profile_access_changes();
