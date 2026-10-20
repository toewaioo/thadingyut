\set ON_ERROR_STOP on
-- Run ONLY in a fresh, disposable local database ending in _test:
-- psql -d thadingyut_reporting_test -f tests/reporting-database.sql
-- This bootstraps a minimal local auth stub; never run it on a hosted project.
do $$ begin
  if current_database() not like '%\_test' then
    raise exception 'Use a disposable database ending in _test';
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
\ir ../supabase/migrations/20261015000000_thadingyut_profiles.sql
\ir ../supabase/migrations/20261018000100_public_wishes.sql
\ir ../supabase/migrations/20261019000100_revoke_public_wishes_read.sql
\ir ../supabase/migrations/20261019000200_sky_wishes_projection.sql
\ir ../supabase/migrations/20261020000100_wish_reports.sql
insert into auth.users values ('00000000-0000-0000-0000-000000000001');
insert into public.thadingyut_public_wishes(id,wish)
select md5(n::text),jsonb_build_object('text','Wish '||n, 'dedication','Family') from generate_series(1,12) n;
create temporary table original_sky as select * from public.thadingyut_sky_wishes;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$ begin
 if public.thadingyut_submit_wish_report(md5('1'),'spam','Test') <> '{"accepted":true}'::jsonb then raise exception 'Not accepted'; end if;
 perform public.thadingyut_submit_wish_report(md5('1'),'hate','Duplicate');
 begin
  perform public.thadingyut_submit_wish_report('source-id','spam','');
  raise exception 'Invalid ID accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.thadingyut_submit_wish_report(md5('missing'),'spam','');
  raise exception 'Missing wish accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.thadingyut_submit_wish_report(md5('2'),'invalid','');
  raise exception 'Invalid reason accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.thadingyut_submit_wish_report(md5('2'),'spam',repeat('x',1001));
  raise exception 'Oversize details accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform id from thadingyut_moderation.thadingyut_wish_reports limit 1;
  raise exception 'Client can read reports';
 exception when insufficient_privilege then null; end;
 begin
  perform wish_id from thadingyut_moderation.thadingyut_wish_report_queue limit 1;
  raise exception 'Client can read moderation queue';
 exception when insufficient_privilege then null; end;
 begin
  perform thadingyut_moderation.thadingyut_review_wish_report(1,'reviewed','attacker','');
  raise exception 'Client can moderate';
 exception when insufficient_privilege then null; end;
 begin
  perform id from public.thadingyut_public_wishes limit 1;
  raise exception 'Archive became public';
 exception when insufficient_privilege then null; end;
 for n in 2..10 loop
  perform public.thadingyut_submit_wish_report(md5(n::text),'other','');
 end loop;
 begin
  perform public.thadingyut_submit_wish_report(md5('11'),'spam','');
  raise exception 'Rate limit bypassed';
 exception when program_limit_exceeded then null; end;
 perform public.thadingyut_submit_wish_report(md5('1'),'spam','Duplicate at cap');
end $$;
reset role;
set role anon;
do $$ begin
 begin
  perform public.thadingyut_submit_wish_report(md5('12'),'spam','');
  raise exception 'Unsigned visitor can report';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub='';
do $$ begin
 begin
  perform public.thadingyut_submit_wish_report(md5('12'),'spam','');
  raise exception 'Missing identity accepted';
 exception when invalid_authorization_specification then null; end;
end $$;
reset role;
do $$ begin
 if (select count(*) from thadingyut_moderation.thadingyut_wish_reports) <> 10 then raise exception 'Duplicate or rate-limit failure'; end if;
 if (select details from thadingyut_moderation.thadingyut_wish_reports where wish_id=md5('1')) <> 'Test' then raise exception 'Duplicate overwrote report'; end if;
 if (select count(*) from thadingyut_moderation.thadingyut_wish_report_queue) <> 10 then raise exception 'Queue missing'; end if;
 perform thadingyut_moderation.thadingyut_review_wish_report(1,'reviewed','local-test','Examined only');
 if (select status from thadingyut_moderation.thadingyut_wish_reports where id=1) <> 'reviewed' then raise exception 'Review failed'; end if;
 if exists((select * from original_sky except select * from public.thadingyut_sky_wishes) union all (select * from public.thadingyut_sky_wishes except select * from original_sky)) then raise exception 'Sky visibility changed'; end if;
end $$;
\echo 'PASS: submission, duplicates, validation, rate cap, role isolation, review, unchanged sky.'
