\set ON_ERROR_STOP on
-- Fresh disposable local DB only. This composes the established report bootstrap
-- and threshold fixtures before applying the new migration under test.
do $$ begin
  if current_database() not like '%\_test' then
    raise exception 'Use a disposable database ending in _test';
  end if;
end $$;
\ir reporting-database.sql
\ir three-report-database.sql
\ir ../supabase/migrations/20261020000300_wish_suitability.sql
\ir ../supabase/migrations/20261020000400_private_admin.sql

-- An initially empty secret store proves there is no credential in migration SQL.
do $$ begin
  if exists (select 1 from thadingyut_moderation.thadingyut_admin_access) then
    raise exception 'Admin access table must be empty after migration';
  end if;
  if has_table_privilege('anon','thadingyut_moderation.thadingyut_admin_access','select')
     or has_table_privilege('authenticated','thadingyut_moderation.thadingyut_admin_access','select')
     or has_table_privilege('service_role','thadingyut_moderation.thadingyut_admin_access','select')
     or has_table_privilege('anon','thadingyut_moderation.thadingyut_wish_visibility_overrides','select')
     or has_table_privilege('authenticated','thadingyut_moderation.thadingyut_wish_visibility_overrides','select')
     or has_table_privilege('service_role','thadingyut_moderation.thadingyut_wish_visibility_overrides','select') then
    raise exception 'Private admin table grants were exposed';
  end if;
end $$;

create temporary table admin_fixture as
select f.wish_a, f.wish_b from three_report_fixture f;
grant select on admin_fixture to authenticated;
create temporary table admin_baseline as
select 'archive'::text as kind, a.id as key, a.wish as value
  from public.thadingyut_public_wishes a
 where a.id in (select wish_a from admin_fixture union select wish_b from admin_fixture)
union all
select 'profile', p.owner_id::text, p.wishes
  from public.thadingyut_profiles p
 where p.owner_id in ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000011');
create table public.admin_migration_sentinel (sentinel_id integer primary key, payload text not null);
insert into public.admin_migration_sentinel values (1, 'untouched');

-- A well-formed key cannot authenticate while the singleton is unprovisioned.
set role anon;
do $$ begin
  begin
    perform public.thadingyut_admin_wishes(repeat('0',64));
    raise exception 'Admin call succeeded with an empty secret store';
  exception when invalid_authorization_specification then null; end;
  begin
    perform public.thadingyut_admin_wishes('not-a-key');
    raise exception 'Malformed key accepted';
  exception when invalid_authorization_specification then null; end;
end $$;
reset role;

-- This is test-only DML. Production provisions a random 256-bit backend key hash.
insert into thadingyut_moderation.thadingyut_admin_access(id, key_hash)
values (true, pg_catalog.sha256(pg_catalog.convert_to('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'UTF8')));

do $$ begin
  if has_function_privilege('public','thadingyut_moderation._require_admin_key(text)','execute')
     or has_function_privilege('anon','thadingyut_moderation._require_admin_key(text)','execute')
     or has_function_privilege('authenticated','thadingyut_moderation._require_admin_key(text)','execute')
     or has_function_privilege('service_role','thadingyut_moderation._require_admin_key(text)','execute') then
    raise exception 'Private key guard execution was granted';
  end if;
end $$;

set role anon;
do $$ declare v jsonb; begin
  begin
    perform public.thadingyut_admin_wishes(repeat('f',64));
    raise exception 'Wrong admin key accepted';
  exception when invalid_authorization_specification then null; end;
  v := public.thadingyut_admin_wishes('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 0, 1, '', 'all');
  if jsonb_typeof(v->'items') <> 'array' or jsonb_array_length(v->'items') <> 1 or v->>'has_more' <> 'true' then
    raise exception 'Wish pagination contract failed: %', v;
  end if;
  if (v->'items'->0 ? 'owner_id') or (v->'items'->0 ? 'reporter_id') then
    raise exception 'Admin wishes exposed identities';
  end if;
  begin perform public.thadingyut_admin_wishes('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',0,51,'','all');
    raise exception 'Oversize wish page accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.thadingyut_admin_wishes('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',0,25,repeat('x',201),'all');
    raise exception 'Oversize search accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.thadingyut_admin_wishes('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',0,25,'','unknown');
    raise exception 'Invalid wish filter accepted';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;

-- Test audit/count output for the report-threshold wish; only three of its four
-- records are active after the existing review/dismiss fixtures.
do $$ declare v jsonb; v_id text; begin
  v := public.thadingyut_admin_wishes('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',0,50,'','hidden');
  if not exists (
    select 1 from jsonb_array_elements(v->'items') item
     where item->>'id' = (select wish_a from admin_fixture)
       and item->>'hidden' = 'true'
       and item->>'manual_hidden' = 'false'
       and item->>'active_report_count' = '3'
       and item->>'report_count' = '4'
  ) then raise exception 'Admin hidden/count data incorrect: %', v; end if;
  v := public.thadingyut_admin_reports('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',(select wish_a from admin_fixture),0,1);
  if jsonb_array_length(v->'items') <> 1 or v->>'has_more' <> 'true'
     or jsonb_typeof(v->'items'->0->'id') <> 'string'
     or v::text like '%reporter_id%' or v::text like '%owner_id%' then
    raise exception 'Admin reports contract/privacy/pagination failed: %', v;
  end if;
  v_id := v->'items'->0->>'id';
  if v_id !~ '^[0-9]+$' then raise exception 'Report ID is not serialized as decimal text'; end if;
  if jsonb_typeof(public.thadingyut_admin_reports('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',(select wish_a from admin_fixture),0,25)->'items') <> 'array' then
    raise exception 'Reports response malformed';
  end if;
  begin perform public.thadingyut_admin_reports('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef','not-canonical');
    raise exception 'Invalid report wish filter accepted';
  exception when invalid_parameter_value then null; end;
end $$;

-- Manual hide only writes the private override; owner visibility reflects it.
select public.thadingyut_admin_set_wish_visibility(
 '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
 (select wish_b from admin_fixture), true, 'manual moderation note');
do $$ begin
  if exists(select 1 from public.thadingyut_sky_wishes where id=(select wish_b from admin_fixture)) then
    raise exception 'Manual hide did not hide the sky wish';
  end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',false);
do $$ begin
  if not exists(select 1 from public.thadingyut_own_wish_visibility('',500)
    where id=(select wish_b from admin_fixture) and hidden is true and local_wish is null) then
    raise exception 'Owner visibility RPC did not report manual hide';
  end if;
end $$;
reset role;
select public.thadingyut_admin_set_wish_visibility(
 '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
 (select wish_b from admin_fixture), false, 'restored');
do $$ begin
  if not exists(select 1 from public.thadingyut_sky_wishes where id=(select wish_b from admin_fixture)) then
    raise exception 'Clearing manual hide did not restore the wish';
  end if;
end $$;

-- Clearing a manual flag cannot override three active reports. Dismissing one
-- through the existing review function then restores the wish automatically.
select public.thadingyut_admin_set_wish_visibility(
 '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
 (select wish_a from admin_fixture), true, 'manual flag on threshold-hidden wish');
select public.thadingyut_admin_set_wish_visibility(
 '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
 (select wish_a from admin_fixture), false, 'clear manual flag');
do $$ declare v_report bigint; begin
  if exists(select 1 from public.thadingyut_sky_wishes where id=(select wish_a from admin_fixture)) then
    raise exception 'Clearing manual flag overrode three active reports';
  end if;
  select id into v_report from thadingyut_moderation.thadingyut_wish_reports
   where wish_id=(select wish_a from admin_fixture) and status='pending'
   order by id limit 1;
  perform public.thadingyut_admin_review_report('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',v_report,'dismissed','test restore');
  if not exists(select 1 from public.thadingyut_sky_wishes where id=(select wish_a from admin_fixture)) then
    raise exception 'Review dismissal did not restore threshold-hidden wish';
  end if;
end $$;

-- Invalid visibility changes and direct private-table access are rejected.
set role anon;
do $$ begin
  begin perform id from thadingyut_moderation.thadingyut_admin_access; raise exception 'Anon read admin config';
  exception when insufficient_privilege then null; end;
  begin perform wish_id from thadingyut_moderation.thadingyut_wish_visibility_overrides; raise exception 'Anon read overrides';
  exception when insufficient_privilege then null; end;
  begin perform public.thadingyut_admin_set_wish_visibility('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',repeat('a',32),true,repeat('x',1001));
    raise exception 'Oversize notes accepted';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;

-- No admin operation mutates archived/profile wish JSON or unrelated data.
do $$ begin
  if exists (
    (select kind,key,value from admin_baseline except
       (select 'archive'::text,a.id,a.wish from public.thadingyut_public_wishes a where a.id in (select wish_a from admin_fixture union select wish_b from admin_fixture)
        union all
        select 'profile'::text,p.owner_id::text,p.wishes from public.thadingyut_profiles p where p.owner_id in ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000011')))
    union all
    ((select 'archive'::text,a.id,a.wish from public.thadingyut_public_wishes a where a.id in (select wish_a from admin_fixture union select wish_b from admin_fixture)
      union all
      select 'profile'::text,p.owner_id::text,p.wishes from public.thadingyut_profiles p where p.owner_id in ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000011')) except select kind,key,value from admin_baseline)
  ) then raise exception 'Profile/archive JSON changed'; end if;
  if (select payload from public.admin_migration_sentinel where sentinel_id=1) <> 'untouched' then
    raise exception 'Unrelated sentinel changed';
  end if;
  if (select count(*) from thadingyut_moderation.thadingyut_wish_reports where wish_id=(select wish_a from admin_fixture)) <> 4 then
    raise exception 'Admin operations deleted a report';
  end if;
  if (select reviewer from thadingyut_moderation.thadingyut_wish_visibility_overrides where wish_id=(select wish_a from admin_fixture)) <> 'admin' then
    raise exception 'Override reviewer was not fixed to admin';
  end if;
end $$;
\echo 'PASS: admin key guard, private storage, bounded identity-free inspection, manual visibility, review, and preserved archive/profile/unrelated data.'
