-- ============================================================================
-- SERENE MARQUEE — MIGRATION 2026-19
-- Run AFTER migration 2026-18. Safe to re-run.
--
--   1. Public sign-up is closed. A login can only be created from Staff &
--      Access, and the database refuses any other.
--   2. Forgotten passwords: staff ask for a reset from the login page; the
--      Admin or Developer issues a one-time temporary password.
--
-- ALSO DO THIS in the Supabase dashboard:
--   Authentication -> Sign In / Providers -> turn OFF "Allow new users to sign up"
-- and add SUPABASE_SERVICE_ROLE_KEY to the app's environment (see CHANGES.md).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. NO SIGN-UP WITHOUT AN INVITE
--
--    Anyone with the public app key could call sign-up directly and get a
--    Staff account — that is where the random accounts came from. Hiding the
--    button doesn't stop that, so the database now checks every new login for
--    a single-use invite that only the server (holding the secret service key)
--    can create, seconds before it creates the account.
-- ---------------------------------------------------------------------------
create table if not exists public.account_invites (
  token text primary key,
  created_by uuid,
  expires_at timestamptz not null default now() + interval '10 minutes'
);

-- No policies at all: nobody reaches this table through the public API.
-- Only the server's service key (which bypasses RLS) can write to it.
alter table public.account_invites enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  invite text := new.raw_user_meta_data->>'invite_token';
begin
  if invite is null
     or not exists (
       select 1 from public.account_invites
       where token = invite and expires_at > now()
     ) then
    raise exception 'New accounts can only be created by the Developer from Staff & Access.';
  end if;

  -- Single use.
  delete from public.account_invites where token = invite or expires_at < now();

  -- Don't leave the token lying in the account's metadata.
  update auth.users
  set raw_user_meta_data = raw_user_meta_data - 'invite_token'
  where id = new.id;

  insert into public.profiles (id, full_name, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'username'
  );
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 2. PASSWORD RESET REQUESTS
--
--    Staff sign in with a username, not a real email address, so an emailed
--    reset link can't reach them. Instead the login page records a request,
--    and the Admin or Developer — who knows the person — issues a temporary
--    password that works once and must be changed at the next sign-in.
-- ---------------------------------------------------------------------------
create table if not exists public.password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  username text not null,
  note text,
  status text not null default 'pending' check (status in ('pending','done','dismissed')),
  requested_at timestamptz not null default now(),
  ip text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz
);

create index if not exists password_reset_requests_pending_idx
  on public.password_reset_requests (status, requested_at desc);

alter table public.password_reset_requests enable row level security;

-- Admin and Developer act on them; the Owner can see them. Nobody inserts
-- through the public API — the login page's server route does that.
drop policy if exists "reset_requests_select" on public.password_reset_requests;
create policy "reset_requests_select" on public.password_reset_requests
  for select using (public.my_role() in ('admin','developer','owner'));

drop policy if exists "reset_requests_update" on public.password_reset_requests;
create policy "reset_requests_update" on public.password_reset_requests
  for update using (public.my_role() in ('admin','developer'));

-- Look a login up by its internal email. Server only.
create or replace function public.user_id_for_login(p_email text)
returns uuid language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;
revoke all on function public.user_id_for_login(text) from public;
do $$
begin
  begin execute 'revoke all on function public.user_id_for_login(text) from anon, authenticated'; exception when others then null; end;
  begin execute 'grant execute on function public.user_id_for_login(text) to service_role'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.password_reset_requests'; exception when others then null; end;
end $$;


-- ---------------------------------------------------------------------------
-- FINDING THE RANDOM ACCOUNTS
-- Run on its own to list every login with its role and when it last signed in.
-- Remove the ones nobody recognises from Staff & Access.
--
--   select p.full_name, p.username, p.role, u.created_at, u.last_sign_in_at
--   from public.profiles p join auth.users u on u.id = p.id
--   order by u.created_at desc;
-- ============================================================================
