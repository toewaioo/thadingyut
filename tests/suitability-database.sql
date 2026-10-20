\set ON_ERROR_STOP on
-- Run after reporting-database.sql and three-report-database.sql in a fresh
-- disposable *_test database. This file contains local fixtures only.
do $$ begin
  if current_database() not like '%\_test' then
    raise exception 'Use a disposable database ending in _test';
  end if;
end $$;

insert into auth.users(id) values
 ('00000000-0000-0000-0000-000000000099'),
 ('00000000-0000-0000-0000-000000000098');
insert into public.thadingyut_profiles(owner_id,wishes) values
 ('00000000-0000-0000-0000-000000000099', '[{"id":"suit-safe","text":"May our family be peaceful","dedication":"Family"}]');

-- Seed pre-existing unsuitable rows with only the new guard disabled, modeling
-- content already stored before the migration. The archive trigger still runs.
alter table public.thadingyut_profiles disable trigger thadingyut_enforce_wish_suitability;
update public.thadingyut_profiles
   set wishes = wishes || '[{"id":"suit-legacy-bad","text":"မအေလိုး","dedication":"Old friend"},{"text":"စောက်ဖုတ်","at":100}]'::jsonb
 where owner_id='00000000-0000-0000-0000-000000000099';
alter table public.thadingyut_profiles enable trigger thadingyut_enforce_wish_suitability;
create temporary table suitability_before as
select owner_id, wishes from public.thadingyut_profiles
 where owner_id='00000000-0000-0000-0000-000000000099';

-- SQL rule corpus mirrors tests/suitability-policy.test.js.
do $$ begin
  if not public.thadingyut_wish_suitability_allowed('May our family be peaceful and healthy','For my parents') then raise exception 'Safe English wish rejected'; end if;
  if not public.thadingyut_wish_suitability_allowed('အေးချမ်းသာယာပါစေ','မိသားစု') then raise exception 'Safe Burmese wish rejected'; end if;
  if not public.thadingyut_wish_suitability_allowed('Wishing healing to survivors of violence','') then raise exception 'Benign mention of violence rejected'; end if;
  if not public.thadingyut_wish_suitability_allowed('A world without hate or rape','') then raise exception 'Benign mention of hate/rape rejected'; end if;
  if public.thadingyut_wish_suitability_allowed('မအေလိုး','') then raise exception 'Explicit Burmese insult accepted'; end if;
  if public.thadingyut_wish_suitability_allowed('မိအေလိုး','') then raise exception 'Burmese explicit phrase variant accepted'; end if;
  if public.thadingyut_wish_suitability_allowed('မေလိုး','') then raise exception 'Burmese insult accepted'; end if;
  if public.thadingyut_wish_suitability_allowed('စောက်ပတ်','') then raise exception 'Burmese vulgarity accepted'; end if;
  if public.thadingyut_wish_suitability_allowed('စောက်ဖုတ်','') then raise exception 'Burmese vulgarity accepted'; end if;
  if public.thadingyut_wish_suitability_allowed('လီးစုပ်','') then raise exception 'Burmese vulgarity accepted'; end if;
  if public.thadingyut_wish_suitability_allowed('လီးစား','') then raise exception 'Burmese vulgarity accepted'; end if;
  if public.thadingyut_wish_suitability_allowed('သတ်ပစ်မယ်','') then raise exception 'Burmese direct threat accepted'; end if;
  if public.thadingyut_wish_suitability_allowed(U&'f\200B.u.c.k','') then raise exception 'Format-obfuscated English insult accepted'; end if;
  if public.thadingyut_wish_suitability_allowed('I will kill you','') then raise exception 'Direct English threat accepted'; end if;
  if not public.thadingyut_wish_suitability_allowed('Scunthorpe class assessment','') then raise exception 'English substring false positive'; end if;
  if not public.thadingyut_wish_suitability_allowed('လီလီ ပန်းလေးများ ပွင့်ပါစေ','') then raise exception 'Burmese name false positive'; end if;
  if public.thadingyut_wish_suitability_allowed(repeat('😀',81),'') then raise exception '80-codepoint text limit missing'; end if;
  if public.thadingyut_wish_suitability_allowed('valid',repeat('😀',21)) then raise exception '20-codepoint dedication limit missing'; end if;
  if public.thadingyut_wish_suitability_allowed('   ','') then raise exception 'Empty wish accepted'; end if;
end $$;

-- An unchanged legacy bad item is accepted, and a benign new item can be
-- appended through a whole-profile synchronization without touching old data.
update public.thadingyut_profiles
   set wishes = wishes || '[{"id":"suit-safe-2","text":"A bright and peaceful Thadingyut","dedication":"My family"}]'::jsonb
 where owner_id='00000000-0000-0000-0000-000000000099';
insert into public.thadingyut_profiles(owner_id,wishes)
select owner_id, wishes from public.thadingyut_profiles where owner_id='00000000-0000-0000-0000-000000000099'
on conflict(owner_id) do update set wishes=excluded.wishes;
do $$ begin
  if (select wishes from public.thadingyut_profiles where owner_id='00000000-0000-0000-0000-000000000099')
       is distinct from (select wishes from suitability_before) || '[{"id":"suit-safe-2","text":"A bright and peaceful Thadingyut","dedication":"My family"}]'::jsonb then
    raise exception 'Existing wishes were modified during good append/upsert';
  end if;
  if not exists(select 1 from public.thadingyut_public_wishes where id=md5('00000000-0000-0000-0000-000000000099:suit-legacy-bad')) then
    raise exception 'Grandfathered legacy archive row was removed';
  end if;
end $$;

-- Failed UPDATE and failed INSERT/UPSERT are atomic: profile and archive remain
-- exactly as they were. The database trigger, not a proxy filter, enforces it.
do $$ declare v_before jsonb; v_archive_count bigint; begin
  select wishes into v_before from public.thadingyut_profiles where owner_id='00000000-0000-0000-0000-000000000099';
  select count(*) into v_archive_count from public.thadingyut_public_wishes;
  begin
    update public.thadingyut_profiles
       set wishes = wishes || '[{"id":"suit-new-bad","text":"fuck you","dedication":""}]'::jsonb
     where owner_id='00000000-0000-0000-0000-000000000099';
    raise exception 'TEST: new bad wish was accepted';
  exception when raise_exception then
    if sqlerrm = 'TEST: new bad wish was accepted' or sqlerrm <> 'WISH_UNSUITABLE' then raise; end if;
  end;
  if (select wishes from public.thadingyut_profiles where owner_id='00000000-0000-0000-0000-000000000099') is distinct from v_before then
    raise exception 'Rejected UPDATE changed the stored profile';
  end if;
  if (select count(*) from public.thadingyut_public_wishes) <> v_archive_count then
    raise exception 'Rejected UPDATE reached the archive trigger';
  end if;
  begin
    insert into public.thadingyut_profiles(owner_id,wishes) values
      ('00000000-0000-0000-0000-000000000098','[{"id":"suit-post-bad","text":"I will kill you","dedication":""}]');
    raise exception 'TEST: bad direct INSERT was accepted';
  exception when raise_exception then
    if sqlerrm = 'TEST: bad direct INSERT was accepted' or sqlerrm <> 'WISH_UNSUITABLE' then raise; end if;
  end;
  if exists(select 1 from public.thadingyut_profiles where owner_id='00000000-0000-0000-0000-000000000098') then
    raise exception 'Rejected INSERT created a profile';
  end if;
  begin
    insert into public.thadingyut_profiles(owner_id,wishes) values
      ('00000000-0000-0000-0000-000000000099', v_before || '[{"id":"suit-upsert-bad","text":"မေလိုး","dedication":""}]')
    on conflict(owner_id) do update set wishes=excluded.wishes;
    raise exception 'TEST: bad upsert was accepted';
  exception when raise_exception then
    if sqlerrm = 'TEST: bad upsert was accepted' or sqlerrm <> 'WISH_UNSUITABLE' then raise; end if;
  end;
  if (select wishes from public.thadingyut_profiles where owner_id='00000000-0000-0000-0000-000000000099') is distinct from v_before then
    raise exception 'Rejected UPSERT changed the stored profile';
  end if;
  if (select count(*) from public.thadingyut_public_wishes) <> v_archive_count then
    raise exception 'Rejected UPSERT reached the archive trigger';
  end if;
end $$;

-- Same ID but changed dedication is new content and must be evaluated. For an
-- ID-less legacy row only the entire unchanged JSON object is grandfathered.
do $$ declare v_before jsonb; begin
  select wishes into v_before from public.thadingyut_profiles where owner_id='00000000-0000-0000-0000-000000000099';
  begin
    update public.thadingyut_profiles
       set wishes = jsonb_set(wishes, '{1,dedication}', '"fuck you"'::jsonb)
     where owner_id='00000000-0000-0000-0000-000000000099';
    raise exception 'TEST: bad dedication edit was accepted';
  exception when raise_exception then
    if sqlerrm = 'TEST: bad dedication edit was accepted' or sqlerrm <> 'WISH_UNSUITABLE' then raise; end if;
  end;
  begin
    update public.thadingyut_profiles
       set wishes = jsonb_set(wishes, '{2,at}', '101'::jsonb)
     where owner_id='00000000-0000-0000-0000-000000000099';
    raise exception 'TEST: edited ID-less legacy bad item was grandfathered';
  exception when raise_exception then
    if sqlerrm = 'TEST: edited ID-less legacy bad item was grandfathered' or sqlerrm <> 'WISH_UNSUITABLE' then raise; end if;
  end;
  if (select wishes from public.thadingyut_profiles where owner_id='00000000-0000-0000-0000-000000000099') is distinct from v_before then
    raise exception 'Rejected edits changed legacy profile';
  end if;
end $$;

-- A malformed non-string wish or dedication cannot be introduced as new data.
do $$ begin
  begin
    update public.thadingyut_profiles set wishes = wishes || '[{"id":"bad-type","text":17}]'::jsonb
     where owner_id='00000000-0000-0000-0000-000000000099';
    raise exception 'TEST: non-string wish text accepted';
  exception when raise_exception then
    if sqlerrm = 'TEST: non-string wish text accepted' or sqlerrm <> 'WISH_UNSUITABLE' then raise; end if;
  end;
  begin
    update public.thadingyut_profiles set wishes = wishes || '[{"id":"bad-dedication","text":"Good wish","dedication":null}]'::jsonb
     where owner_id='00000000-0000-0000-0000-000000000099';
    raise exception 'TEST: non-string dedication accepted';
  exception when raise_exception then
    if sqlerrm = 'TEST: non-string dedication accepted' or sqlerrm <> 'WISH_UNSUITABLE' then raise; end if;
  end;
end $$;

-- Browser-role security remains owner-scoped, and internal policy functions are
-- not directly callable by authenticated clients.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',false);
do $$ begin
  if (select count(*) from public.thadingyut_profiles where owner_id='00000000-0000-0000-0000-000000000099') <> 1 then raise exception 'Owner cannot read own profile'; end if;
  if exists(select 1 from public.thadingyut_profiles where owner_id='00000000-0000-0000-0000-000000000098') then raise exception 'Owner can read foreign profile'; end if;
  begin
    perform public.thadingyut_wish_suitability_allowed('safe','');
    raise exception 'TEST: browser can execute internal rule function';
  exception when insufficient_privilege then null; end;
end $$;
do $$ declare v_before jsonb; begin
  select wishes into v_before from public.thadingyut_profiles
   where owner_id=auth.uid() limit 1;
  -- Exact first Burmese term must be blocked by the actual browser-role write.
  begin
    update public.thadingyut_profiles
       set wishes=wishes || '[{"id":"browser-direct-burmese","text":"မအေလိုး","dedication":""}]'::jsonb
     where owner_id=auth.uid();
    raise exception 'TEST: browser direct Burmese write bypassed guard';
  exception when raise_exception then
    if sqlerrm <> 'WISH_UNSUITABLE' then raise; end if;
  end;
  -- Reusing the old bad text with a NEW ID must not inherit grandfathering.
  begin
    insert into public.thadingyut_profiles(owner_id,wishes)
    values(auth.uid(),v_before || '[{"id":"browser-new-id-bad","text":"မအေလိုး","dedication":"Old friend"}]'::jsonb)
    on conflict(owner_id) do update set wishes=excluded.wishes;
    raise exception 'TEST: new ID inherited grandfathering';
  exception when raise_exception then
    if sqlerrm <> 'WISH_UNSUITABLE' then raise; end if;
  end;
  -- The same whole saved batch, including old bad entries, remains syncable.
  insert into public.thadingyut_profiles(owner_id,wishes) values(auth.uid(),v_before)
  on conflict(owner_id) do update set wishes=excluded.wishes;
  if (select wishes from public.thadingyut_profiles where owner_id=auth.uid() limit 1) is distinct from v_before then
    raise exception 'Browser sync rewrote existing saved wishes';
  end if;
end $$;
reset role;

-- Existing archive and profile rows are retained, with no report/anniversary/bot
-- schema or policy touched by this migration.
do $$ begin
  if (select wishes from public.thadingyut_profiles where owner_id='00000000-0000-0000-0000-000000000099')
       is distinct from (select wishes from suitability_before) || '[{"id":"suit-safe-2","text":"A bright and peaceful Thadingyut","dedication":"My family"}]'::jsonb then
    raise exception 'Saved profile wishes were not preserved';
  end if;
  if not exists(select 1 from public.thadingyut_public_wishes where id=md5('00000000-0000-0000-0000-000000000099:suit-legacy-bad')) then
    raise exception 'Legacy public archive row disappeared';
  end if;
  if not exists(select 1 from public.thadingyut_public_wishes where id=md5('00000000-0000-0000-0000-000000000099:suit-safe-2')) then
    raise exception 'Good new wish was not archived';
  end if;
end $$;
\echo 'PASS: SQL policy parity, direct write enforcement, atomic archive rejection, legacy grandfathering, and owner RLS.'
