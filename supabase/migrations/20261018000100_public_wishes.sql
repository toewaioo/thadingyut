-- Public wishes are separate from private preferences, environment and streak.
create table if not exists public.thadingyut_public_wishes (
  id text primary key,
  wish jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.thadingyut_public_wishes enable row level security;
revoke all on public.thadingyut_public_wishes from public, anon, authenticated;
grant select on public.thadingyut_public_wishes to anon, authenticated;
create policy thadingyut_public_wishes_read_all
  on public.thadingyut_public_wishes for select to anon, authenticated using (true);

-- Use an explicit allowlist: no owner IDs, auth data or profile settings leak.
create or replace function public.thadingyut_extract_public_wishes(p_owner uuid, p_wishes jsonb)
returns table(id text, wish jsonb)
language sql immutable set search_path = '' as $$
  select md5(p_owner::text || ':' || coalesce(nullif(item->>'id',''), md5(item::text))),
    jsonb_strip_nulls(jsonb_build_object(
      'source_id', coalesce(nullif(item->>'id',''), md5(item::text)),
      'text', left(item->>'text', 2000),
      'dedication', case when jsonb_typeof(item->'dedication')='string' then left(item->>'dedication', 300) end,
      'hue', case when jsonb_typeof(item->'hue')='number' then item->'hue' end,
      'shape', case when item->>'shape' in ('classic','round','lotus','star','diamond','heart','cylinder') then item->>'shape' else 'classic' end,
      'position', case when jsonb_typeof(item->'position')='object' then jsonb_build_object(
        'x', case when jsonb_typeof(item->'position'->'x')='number' then item->'position'->'x' end,
        'z', case when jsonb_typeof(item->'position'->'z')='number' then item->'position'->'z' end) end,
      'blessings', case when jsonb_typeof(item->'blessings')='number' then item->'blessings' else '0'::jsonb end,
      'at', case when jsonb_typeof(item->'at')='number' then item->'at' else '0'::jsonb end
    ))
  from jsonb_array_elements(case when jsonb_typeof(p_wishes)='array' then p_wishes else '[]'::jsonb end) as entries(item)
  where jsonb_typeof(item)='object' and jsonb_typeof(item->'text')='string' and btrim(item->>'text')<>'';
$$;
revoke all on function public.thadingyut_extract_public_wishes(uuid,jsonb) from public, anon, authenticated;

create or replace function public.thadingyut_archive_public_wishes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.thadingyut_public_wishes(id,wish)
  select distinct on (w.id) w.id,w.wish
  from public.thadingyut_extract_public_wishes(new.owner_id,new.wishes) w
  on conflict(id) do update set wish=excluded.wish;
  return new;
end;
$$;
revoke all on function public.thadingyut_archive_public_wishes() from public, anon, authenticated;
create trigger thadingyut_archive_public_wishes
  after insert or update of wishes on public.thadingyut_profiles
  for each row execute function public.thadingyut_archive_public_wishes();

-- Backfill every currently cloud-saved wish. Future profile saves are automatic.
insert into public.thadingyut_public_wishes(id,wish)
select distinct on(w.id) w.id,w.wish
from public.thadingyut_profiles p
cross join lateral public.thadingyut_extract_public_wishes(p.owner_id,p.wishes) w
on conflict(id) do update set wish=excluded.wish;
