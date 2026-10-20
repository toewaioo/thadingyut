begin;

-- Temporary, derived hiding only: reports remain private records and dismissal
-- immediately restores the wish without changing the archive or owner profile.
create index if not exists thadingyut_wish_reports_visibility_idx
  on thadingyut_moderation.thadingyut_wish_reports (wish_id, status, reporter_id);

create or replace view public.thadingyut_sky_wishes
with (security_barrier = true, security_invoker = false) as
select w.id,
  jsonb_strip_nulls(jsonb_build_object(
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
  having count(distinct r.reporter_id) >= 3
);
revoke all privileges on table public.thadingyut_sky_wishes from public, anon, authenticated;
grant select on table public.thadingyut_sky_wishes to anon, authenticated;

-- Return only the caller's currently canonical, archived wishes. Visibility is
-- derived from active (pending/reviewed) distinct reporters, never persisted.
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
         exists (
           select 1
             from thadingyut_moderation.thadingyut_wish_reports r
            where r.wish_id = archived.id
              and r.status in ('pending', 'reviewed')
            group by r.wish_id
           having count(distinct r.reporter_id) >= 3
         ),
         own_wishes.legacy_wish
    from own_wishes
    join public.thadingyut_public_wishes archived on archived.id = own_wishes.wish_id
   order by own_wishes.wish_id;
end;
$$;
revoke all privileges on function public.thadingyut_own_wish_visibility(text, integer) from public, anon, authenticated;
grant execute on function public.thadingyut_own_wish_visibility(text, integer) to authenticated;

commit;
