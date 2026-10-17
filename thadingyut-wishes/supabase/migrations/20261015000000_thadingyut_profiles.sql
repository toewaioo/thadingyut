create table if not exists public.thadingyut_profiles (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  environment jsonb not null default '{"mode":"auto","manualTime":18}'::jsonb,
  wishes jsonb not null default '[]'::jsonb,
  streak jsonb not null default '{"last":"","count":0,"total":0}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.thadingyut_profiles enable row level security;

revoke all on table public.thadingyut_profiles from anon, public;
grant select, insert, update on table public.thadingyut_profiles to authenticated;

drop policy if exists thadingyut_profiles_select_own on public.thadingyut_profiles;
create policy thadingyut_profiles_select_own
  on public.thadingyut_profiles
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists thadingyut_profiles_insert_own on public.thadingyut_profiles;
create policy thadingyut_profiles_insert_own
  on public.thadingyut_profiles
  for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists thadingyut_profiles_update_own on public.thadingyut_profiles;
create policy thadingyut_profiles_update_own
  on public.thadingyut_profiles
  for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
