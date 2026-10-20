\set ON_ERROR_STOP on
-- Run after reporting-database.sql in the same fresh disposable *_test database.
-- Example: psql -d thadingyut_reporting_test -f tests/reporting-database.sql
--         psql -d thadingyut_reporting_test -f tests/three-report-database.sql
do $$ begin
  if current_database() not like '%\_test' then
    raise exception 'Use a disposable database ending in _test';
  end if;
end $$;
\ir ../supabase/migrations/20261020000200_three_report_visibility.sql

insert into auth.users(id) values
 ('00000000-0000-0000-0000-000000000010'), -- owner A
 ('00000000-0000-0000-0000-000000000011'), -- owner B
 ('00000000-0000-0000-0000-000000000020'), -- reporter 1
 ('00000000-0000-0000-0000-000000000021'), -- reporter 2
 ('00000000-0000-0000-0000-000000000022'), -- reporter 3
 ('00000000-0000-0000-0000-000000000023'); -- reporter 4

insert into public.thadingyut_profiles(owner_id, wishes) values
 ('00000000-0000-0000-0000-000000000010', '[{"id":"three-report-owned-a","text":"Owned wish A","dedication":"Family","hue":42,"shape":"lotus","position":{"x":1,"z":2},"blessings":1,"at":100}]'),
 ('00000000-0000-0000-0000-000000000011', '[{"id":"three-report-owned-b","text":"Owned wish B"}]');

create temporary table three_report_fixture as
select md5('00000000-0000-0000-0000-000000000010:three-report-owned-a') as wish_a,
       md5('00000000-0000-0000-0000-000000000011:three-report-owned-b') as wish_b;
grant select on three_report_fixture to authenticated;
create temporary table three_report_before as
select a.id, a.wish, p.wishes, p.owner_id
from public.thadingyut_public_wishes a
join public.thadingyut_profiles p on p.owner_id = '00000000-0000-0000-0000-000000000010'
where a.id = (select wish_a from three_report_fixture);

-- The submit RPC's idempotency rule means a duplicate from one identity never
-- becomes an additional distinct reporter.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000020',false);
select public.thadingyut_submit_wish_report((select wish_a from three_report_fixture),'spam','first');
select public.thadingyut_submit_wish_report((select wish_a from three_report_fixture),'hate','duplicate must not count');
set role anon;
do $$ begin
  begin
    perform wish_id from thadingyut_moderation.thadingyut_wish_report_queue limit 1;
    raise exception 'Anonymous role read private queue';
  exception when insufficient_privilege then null; end;
  begin
    perform id from thadingyut_moderation.thadingyut_wish_reports limit 1;
    raise exception 'Anonymous role read private reports';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.thadingyut_own_wish_visibility();
    raise exception 'Anonymous role executed owner visibility RPC';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$ begin
  if (select count(*) from thadingyut_moderation.thadingyut_wish_reports where wish_id=(select wish_a from three_report_fixture)) <> 1 then
    raise exception 'Duplicate submission created a second report';
  end if;
  if not exists(select 1 from public.thadingyut_sky_wishes where id=(select wish_a from three_report_fixture)) then
    raise exception 'Wish should remain visible with one distinct reporter';
  end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000021',false);
select public.thadingyut_submit_wish_report((select wish_a from three_report_fixture),'other','second');
do $$ begin
  if not exists(select 1 from public.thadingyut_sky_wishes where id=(select wish_a from three_report_fixture)) then
    raise exception 'Wish should remain visible with two distinct reporters';
  end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000022',false);
select public.thadingyut_submit_wish_report((select wish_a from three_report_fixture),'violence','third');
reset role;

do $$ begin
  if exists(select 1 from public.thadingyut_sky_wishes where id=(select wish_a from three_report_fixture)) then
    raise exception 'Wish was not hidden at three distinct active reporters';
  end if;
  if (select count(*) from public.thadingyut_public_wishes where id=(select wish_a from three_report_fixture)) <> 1 then
    raise exception 'Archive row was deleted';
  end if;
  if not exists(select 1 from public.thadingyut_profiles where owner_id='00000000-0000-0000-0000-000000000010' and wishes=(select wishes from three_report_before)) then
    raise exception 'Report submissions changed owner profile';
  end if;
  if not exists(select 1 from three_report_before b join public.thadingyut_public_wishes a using(id) where a.wish=b.wish) then
    raise exception 'Report submissions changed archived wish';
  end if;
  if (select count(*) from thadingyut_moderation.thadingyut_wish_reports where wish_id=(select wish_a from three_report_fixture)) <> 3 then
    raise exception 'Reports were deleted or changed during hiding';
  end if;
end $$;

-- The owner RPC reports only the authenticated owner's current canonical IDs;
-- it exposes a boolean but no counts, report records, or reporter identity.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000010',false);
do $$ declare v_row record; v_count integer := 0; begin
  for v_row in select * from public.thadingyut_own_wish_visibility('',500) loop
    v_count := v_count + 1;
    if v_row.id <> (select wish_a from three_report_fixture)
       or v_row.source_id <> 'three-report-owned-a' or v_row.hidden is not true then
      raise exception 'Owner A visibility RPC returned incorrect or foreign data';
    end if;
  end loop;
  if v_count <> 1 then raise exception 'Owner A should receive exactly one own wish'; end if;
  if (select count(*) from public.thadingyut_own_wish_visibility('',1)) <> 1 then
    raise exception 'Bounded owner RPC failed';
  end if;
  begin perform * from public.thadingyut_own_wish_visibility('not-a-canonical-id',5); raise exception 'Invalid cursor accepted';
  exception when invalid_parameter_value then null; end;
  begin perform * from public.thadingyut_own_wish_visibility('',501); raise exception 'Oversize limit accepted';
  exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',false);
do $$ begin
  if exists(select 1 from public.thadingyut_own_wish_visibility('',500) where id=(select wish_a from three_report_fixture)) then
    raise exception 'Owner B could inspect owner A wish';
  end if;
  if (select count(*) from public.thadingyut_own_wish_visibility('',500)) <> 1 then
    raise exception 'Owner B own-wish result incorrect';
  end if;
end $$;
reset role;

-- A review does not reduce the active threshold; dismissing one does.
do $$ declare v_report bigint; begin
  select id into v_report from thadingyut_moderation.thadingyut_wish_reports
   where wish_id=(select wish_a from three_report_fixture) and reporter_id='00000000-0000-0000-0000-000000000020';
  perform thadingyut_moderation.thadingyut_review_wish_report(v_report,'reviewed','local-test','review only');
  if exists(select 1 from public.thadingyut_sky_wishes where id=(select wish_a from three_report_fixture)) then
    raise exception 'Reviewing alone should leave wish hidden';
  end if;
  select id into v_report from thadingyut_moderation.thadingyut_wish_reports
   where wish_id=(select wish_a from three_report_fixture) and reporter_id='00000000-0000-0000-0000-000000000021';
  perform thadingyut_moderation.thadingyut_review_wish_report(v_report,'dismissed','local-test','dismissed');
  if not exists(select 1 from public.thadingyut_sky_wishes where id=(select wish_a from three_report_fixture)) then
    raise exception 'Dismissal should restore wish below threshold';
  end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000023',false);
select public.thadingyut_submit_wish_report((select wish_a from three_report_fixture),'harassment','fourth active reporter');
reset role;
do $$ begin
  if exists(select 1 from public.thadingyut_sky_wishes where id=(select wish_a from three_report_fixture)) then
    raise exception 'Fourth active reporter did not re-hide wish';
  end if;
end $$;

-- Updating the profile runs the pre-existing archive upsert trigger; it cannot
-- override the report-derived visibility decision.
update public.thadingyut_profiles
   set wishes = jsonb_set(wishes, '{0,text}', '"Updated owner text"'::jsonb)
 where owner_id='00000000-0000-0000-0000-000000000010';
do $$ begin
  if exists(select 1 from public.thadingyut_sky_wishes where id=(select wish_a from three_report_fixture)) then
    raise exception 'Profile/archive resync improperly unhid wish';
  end if;
  if not exists(select 1 from public.thadingyut_public_wishes where id=(select wish_a from three_report_fixture) and wish->>'text'='Updated owner text') then
    raise exception 'Profile archive upsert did not run';
  end if;
end $$;

-- Same selected columns and role grants as the previous sky view.
-- Duplicate local IDs must not produce nonadvancing owner-visibility pages.
update public.thadingyut_profiles set wishes = wishes || wishes
 where owner_id='00000000-0000-0000-0000-000000000010';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000010',false);
do $$ begin
  if (select count(*) from public.thadingyut_own_wish_visibility('',500)) <> 1 then
    raise exception 'Duplicate owner IDs broke visibility paging';
  end if;
  if exists(select 1 from public.thadingyut_own_wish_visibility((select wish_a from three_report_fixture),500)) then
    raise exception 'Owner visibility cursor did not advance';
  end if;
end $$;
reset role;

do $$ begin
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='thadingyut_sky_wishes') <> array['id','wish']::text[] then
    raise exception 'Sky view column contract changed';
  end if;
  if not has_table_privilege('anon','public.thadingyut_sky_wishes','select')
     or not has_table_privilege('authenticated','public.thadingyut_sky_wishes','select') then
    raise exception 'Sky view select grants changed';
  end if;
end $$;
\echo 'PASS: threshold hiding is derived/reversible; owner RPC is scoped, bounded, and private; archive/profile/reports remain intact.'

-- Legacy ID-less records use md5(item::text) in the historical archive trigger.
-- Return their own JSON only to the owner so the local display copy can match it.
update public.thadingyut_profiles
set wishes = wishes || '[{"text":"Legacy ID-less wish","at":120,"position":{"x":1,"z":2}}]'::jsonb
where owner_id='00000000-0000-0000-0000-000000000011';
create temporary table legacy_visibility_fixture as
select e.id, p.wishes
from public.thadingyut_profiles p
cross join lateral public.thadingyut_extract_public_wishes(p.owner_id,p.wishes) e
where p.owner_id='00000000-0000-0000-0000-000000000011'
  and e.wish->>'text'='Legacy ID-less wish';
grant select on legacy_visibility_fixture to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000020',false);
select public.thadingyut_submit_wish_report((select id from legacy_visibility_fixture),'spam','legacy first');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000021',false);
select public.thadingyut_submit_wish_report((select id from legacy_visibility_fixture),'spam','legacy second');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000022',false);
select public.thadingyut_submit_wish_report((select id from legacy_visibility_fixture),'spam','legacy third');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',false);
do $$ begin
  if exists(select 1 from public.thadingyut_sky_wishes where id=(select id from legacy_visibility_fixture)) then
    raise exception 'Legacy wish was not hidden';
  end if;
  if not exists(select 1 from public.thadingyut_own_wish_visibility('',500)
    where id=(select id from legacy_visibility_fixture) and hidden
      and local_wish='{"text":"Legacy ID-less wish","at":120,"position":{"x":1,"z":2}}'::jsonb) then
    raise exception 'Owner cannot match hidden legacy local copy';
  end if;
  if exists(select 1 from public.thadingyut_own_wish_visibility('',500)
    where source_id='three-report-owned-b' and local_wish is not null) then
    raise exception 'Nonlegacy record unexpectedly includes legacy matching payload';
  end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000010',false);
do $$ begin
  if exists(select 1 from public.thadingyut_own_wish_visibility('',500)
    where id=(select id from legacy_visibility_fixture)) then
    raise exception 'Legacy matching payload leaked to another owner';
  end if;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.thadingyut_profiles p, legacy_visibility_fixture f
    where p.owner_id='00000000-0000-0000-0000-000000000011' and p.wishes=f.wishes) then
    raise exception 'Legacy reports changed stored owner wishes';
  end if;
end $$;
\echo 'PASS: ID-less legacy hiding, private owner matching, and unchanged saved records.'
