begin;

-- Backend-only credential material. The migration deliberately inserts no key;
-- deployment tooling must provision a random 256-bit key hash through DML.
create table thadingyut_moderation.thadingyut_admin_access (
  id boolean primary key default true check (id is true),
  key_hash bytea not null check (pg_catalog.octet_length(key_hash) = 32)
);
alter table thadingyut_moderation.thadingyut_admin_access enable row level security;
revoke all privileges on table thadingyut_moderation.thadingyut_admin_access from public, anon, authenticated, service_role;

create table thadingyut_moderation.thadingyut_wish_visibility_overrides (
  wish_id text primary key check (wish_id ~ '^[0-9a-f]{32}$'),
  hidden boolean not null,
  notes text not null default '' check (pg_catalog.char_length(notes) <= 1000),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  reviewer text not null default 'admin' check (reviewer = 'admin')
);
alter table thadingyut_moderation.thadingyut_wish_visibility_overrides enable row level security;
revoke all privileges on table thadingyut_moderation.thadingyut_wish_visibility_overrides from public, anon, authenticated, service_role;

create or replace function thadingyut_moderation._require_admin_key(p_admin_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected bytea;
begin
  if p_admin_key is null or p_admin_key !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '28000', message = 'Invalid admin key';
  end if;
  select a.key_hash into v_expected
    from thadingyut_moderation.thadingyut_admin_access a
   where a.id is true;
  if v_expected is null
     or pg_catalog.sha256(pg_catalog.convert_to(p_admin_key, 'UTF8')) is distinct from v_expected then
    raise exception using errcode = '28000', message = 'Invalid admin key';
  end if;
end;
$$;
revoke all privileges on function thadingyut_moderation._require_admin_key(text) from public, anon, authenticated, service_role;

-- Public sky shape and privileges remain unchanged; manual hides are additive
-- to, and never replace, the three-distinct-active-reporter threshold.
create or replace view public.thadingyut_sky_wishes
with (security_barrier = true, security_invoker = false) as
select w.id,
  pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'source_id', w.wish -> 'source_id',
    'text', w.wish -> 'text',
    'dedication', w.wish -> 'dedication',
    'hue', w.wish -> 'hue',
    'shape', w.wish -> 'shape',
    'position', w.wish -> 'position',
    'blessings', w.wish -> 'blessings',
    'at', w.wish -> 'at'
  )) as wish
from public.thadingyut_public_wishes w
where not exists (
  select 1
    from thadingyut_moderation.thadingyut_wish_reports r
   where r.wish_id = w.id
     and r.status in ('pending', 'reviewed')
   group by r.wish_id
  having pg_catalog.count(distinct r.reporter_id) >= 3
)
and not exists (
  select 1
    from thadingyut_moderation.thadingyut_wish_visibility_overrides o
   where o.wish_id = w.id and o.hidden is true
);
revoke all privileges on table public.thadingyut_sky_wishes from public, anon, authenticated;
grant select on table public.thadingyut_sky_wishes to anon, authenticated;

-- Preserve the prior owner-only identity scope, canonical paging, and legacy
-- local_wish shape. A manual hide only adds to the derived report threshold.
create or replace function public.thadingyut_own_wish_visibility(
  p_after text default '',
  p_limit integer default 500
) returns table(id text, source_id text, hidden boolean, local_wish jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_after is null or (p_after <> '' and p_after !~ '^[0-9a-f]{32}$') then
    raise exception using errcode = '22023', message = 'Invalid cursor';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'Limit must be between 1 and 500';
  end if;

  return query
  with own_wishes as (
    select distinct extracted.id as wish_id,
           case when nullif(entries.item ->> 'id', '') is null
                then entries.item else null end as legacy_wish
      from public.thadingyut_profiles p
      cross join lateral pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(p.wishes) = 'array' then p.wishes else '[]'::jsonb end
      ) entries(item)
      cross join lateral public.thadingyut_extract_public_wishes(v_owner, pg_catalog.jsonb_build_array(entries.item)) extracted
     where p.owner_id = v_owner
       and extracted.id > p_after
     order by extracted.id
     limit p_limit
  )
  select own_wishes.wish_id,
         archived.wish ->> 'source_id',
         (exists (
           select 1
             from thadingyut_moderation.thadingyut_wish_reports r
            where r.wish_id = archived.id
              and r.status in ('pending', 'reviewed')
            group by r.wish_id
           having pg_catalog.count(distinct r.reporter_id) >= 3
         ) or exists (
           select 1 from thadingyut_moderation.thadingyut_wish_visibility_overrides o
            where o.wish_id = archived.id and o.hidden is true
         )),
         own_wishes.legacy_wish
    from own_wishes
    join public.thadingyut_public_wishes archived on archived.id = own_wishes.wish_id
   order by own_wishes.wish_id;
end;
$$;
revoke all privileges on function public.thadingyut_own_wish_visibility(text, integer) from public, anon, authenticated;
grant execute on function public.thadingyut_own_wish_visibility(text, integer) to authenticated;

create or replace function public.thadingyut_admin_wishes(
  p_admin_key text,
  p_offset integer default 0,
  p_limit integer default 25,
  p_search text default '',
  p_filter text default 'all'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_count bigint;
  v_has_more boolean;
  v_search text := coalesce(p_search, '');
begin
  perform thadingyut_moderation._require_admin_key(p_admin_key);
  if p_offset is null or p_offset < 0 or p_offset > 10000
     or p_limit is null or p_limit < 1 or p_limit > 50
     or pg_catalog.char_length(v_search) > 200
     or p_filter is null or p_filter not in ('all', 'hidden', 'visible') then
    raise exception using errcode = '22023', message = 'Invalid admin wish query';
  end if;

  with rows as (
    select w.id, w.wish,
           coalesce(active.report_count, 0)::bigint as report_count,
           coalesce(active.total_report_count, 0)::bigint as total_report_count,
           coalesce(override_row.hidden, false) as manual_hidden,
           override_row.notes as moderator_note,
           (coalesce(active.report_count, 0) >= 3 or coalesce(override_row.hidden, false)) as hidden
      from public.thadingyut_public_wishes w
      left join (
        select r.wish_id,
               pg_catalog.count(distinct r.reporter_id) filter (where r.status in ('pending', 'reviewed'))::bigint as report_count,
               pg_catalog.count(*)::bigint as total_report_count
          from thadingyut_moderation.thadingyut_wish_reports r
         group by r.wish_id
      ) active on active.wish_id = w.id
      left join thadingyut_moderation.thadingyut_wish_visibility_overrides override_row on override_row.wish_id = w.id
     where (v_search = '' or pg_catalog.strpos(pg_catalog.lower(w.id), pg_catalog.lower(v_search)) > 0
            or pg_catalog.strpos(pg_catalog.lower(coalesce(w.wish ->> 'text', '')), pg_catalog.lower(v_search)) > 0
            or pg_catalog.strpos(pg_catalog.lower(coalesce(w.wish ->> 'dedication', '')), pg_catalog.lower(v_search)) > 0)
       and (p_filter = 'all'
            or (p_filter = 'hidden' and (coalesce(active.report_count, 0) >= 3 or coalesce(override_row.hidden, false)))
            or (p_filter = 'visible' and (coalesce(active.report_count, 0) < 3 and not coalesce(override_row.hidden, false))))
     order by w.id
     offset p_offset limit (p_limit + 1)
  ), numbered as (
    select rows.*, pg_catalog.row_number() over (order by rows.id) as row_number
      from rows
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', numbered.id,
           'text', numbered.wish -> 'text',
           'dedication', numbered.wish -> 'dedication',
           'at', numbered.wish -> 'at',
           'hidden', numbered.hidden,
           'manual_hidden', numbered.manual_hidden,
           'active_report_count', numbered.report_count,
           'report_count', numbered.total_report_count,
           'moderator_note', numbered.moderator_note
         ) order by numbered.row_number) filter (where numbered.row_number <= p_limit), '[]'::jsonb),
         pg_catalog.count(*) > p_limit
    into v_items, v_has_more
    from numbered;
  return pg_catalog.jsonb_build_object('items', v_items, 'has_more', v_has_more);
end;
$$;
revoke all privileges on function public.thadingyut_admin_wishes(text, integer, integer, text, text) from public, authenticated;
grant execute on function public.thadingyut_admin_wishes(text, integer, integer, text, text) to anon, authenticated;

create or replace function public.thadingyut_admin_reports(
  p_admin_key text,
  p_wish_id text default '',
  p_offset integer default 0,
  p_limit integer default 25
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_has_more boolean;
  v_wish_id text := coalesce(p_wish_id, '');
begin
  perform thadingyut_moderation._require_admin_key(p_admin_key);
  if p_offset is null or p_offset < 0 or p_offset > 10000
     or p_limit is null or p_limit < 1 or p_limit > 50
     or (v_wish_id <> '' and v_wish_id !~ '^[0-9a-f]{32}$') then
    raise exception using errcode = '22023', message = 'Invalid admin report query';
  end if;

  with rows as (
    select r.id, r.wish_id, r.reason, r.details, r.wish_text_snapshot,
           r.wish_dedication_snapshot, r.status, r.created_at, r.reviewed_at, r.reviewer_notes
      from thadingyut_moderation.thadingyut_wish_reports r
     where v_wish_id = '' or r.wish_id = v_wish_id
     order by r.created_at desc, r.id desc
     offset p_offset limit (p_limit + 1)
  ), numbered as (
    select rows.*, pg_catalog.row_number() over (order by rows.created_at desc, rows.id desc) as row_number
      from rows
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', numbered.id::text,
           'wish_id', numbered.wish_id,
           'reason', numbered.reason,
           'details', numbered.details,
           'wish_text_snapshot', numbered.wish_text_snapshot,
           'wish_dedication_snapshot', numbered.wish_dedication_snapshot,
           'status', numbered.status,
           'created_at', numbered.created_at,
           'reviewed_at', numbered.reviewed_at,
           'reviewer_notes', numbered.reviewer_notes
         ) order by numbered.created_at desc, numbered.id desc) filter (where numbered.row_number <= p_limit), '[]'::jsonb),
         pg_catalog.count(*) > p_limit
    into v_items, v_has_more
    from numbered;
  return pg_catalog.jsonb_build_object('items', v_items, 'has_more', v_has_more);
end;
$$;
revoke all privileges on function public.thadingyut_admin_reports(text, text, integer, integer) from public, authenticated;
grant execute on function public.thadingyut_admin_reports(text, text, integer, integer) to anon, authenticated;

create or replace function public.thadingyut_admin_review_report(
  p_admin_key text,
  p_report_id bigint,
  p_status text,
  p_notes text default ''
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform thadingyut_moderation._require_admin_key(p_admin_key);
  if p_status is null or p_status not in ('reviewed', 'dismissed') then
    raise exception using errcode = '22023', message = 'Invalid review status';
  end if;
  return thadingyut_moderation.thadingyut_review_wish_report(p_report_id, p_status, 'admin', coalesce(p_notes, ''));
end;
$$;
revoke all privileges on function public.thadingyut_admin_review_report(text, bigint, text, text) from public, authenticated;
grant execute on function public.thadingyut_admin_review_report(text, bigint, text, text) to anon, authenticated;

create or replace function public.thadingyut_admin_set_wish_visibility(
  p_admin_key text,
  p_wish_id text,
  p_hidden boolean,
  p_notes text default ''
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notes text := coalesce(p_notes, '');
begin
  perform thadingyut_moderation._require_admin_key(p_admin_key);
  if p_wish_id is null or p_wish_id !~ '^[0-9a-f]{32}$'
     or p_hidden is null or pg_catalog.char_length(v_notes) > 1000 then
    raise exception using errcode = '22023', message = 'Invalid wish visibility override';
  end if;
  if not exists (select 1 from public.thadingyut_public_wishes w where w.id = p_wish_id) then
    raise exception using errcode = 'P0002', message = 'Wish not found';
  end if;

  insert into thadingyut_moderation.thadingyut_wish_visibility_overrides (wish_id, hidden, notes, updated_at, reviewer)
  values (p_wish_id, p_hidden, v_notes, pg_catalog.clock_timestamp(), 'admin')
  on conflict (wish_id) do update
    set hidden = excluded.hidden,
        notes = excluded.notes,
        updated_at = excluded.updated_at,
        reviewer = 'admin';
  return pg_catalog.jsonb_build_object('updated', true);
end;
$$;
revoke all privileges on function public.thadingyut_admin_set_wish_visibility(text, text, boolean, text) from public, authenticated;
grant execute on function public.thadingyut_admin_set_wish_visibility(text, text, boolean, text) to anon, authenticated;

commit;
