-- Public sky projection only. Do not reopen the archive or private profiles.
alter table public.thadingyut_public_wishes enable row level security;
revoke all privileges on table public.thadingyut_public_wishes from public, anon, authenticated;
drop policy if exists thadingyut_public_wishes_read_all on public.thadingyut_public_wishes;

-- Deliberately owner-executed: clients may read only these explicit sky fields,
-- while the base archive remains inaccessible to anon/authenticated clients.
-- No owner_id, preferences, environment, streak, auth data, or wildcard JSON.
create or replace view public.thadingyut_sky_wishes
with (security_barrier = true, security_invoker = false) as
select id,
  jsonb_strip_nulls(jsonb_build_object(
    'source_id', wish -> 'source_id',
    'text', wish -> 'text',
    'dedication', wish -> 'dedication',
    'hue', wish -> 'hue',
    'shape', wish -> 'shape',
    'position', wish -> 'position',
    'blessings', wish -> 'blessings',
    'at', wish -> 'at'
  )) as wish
from public.thadingyut_public_wishes;
revoke all privileges on table public.thadingyut_sky_wishes from public, anon, authenticated;
grant select on table public.thadingyut_sky_wishes to anon, authenticated;
-- No data writes or changes to thadingyut_profiles / unrelated tables.
