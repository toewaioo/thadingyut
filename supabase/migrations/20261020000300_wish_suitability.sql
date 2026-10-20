-- Deterministic suitability gate for newly added/edited public wishes only.
-- Existing saved content is grandfathered by stable wish ID; ID-less legacy
-- entries are grandfathered only when their full JSON object is unchanged.
begin;

create or replace function public.thadingyut_wish_suitability_allowed(p_text text, p_dedication text default '')
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
  v_dedication text;
  v_compact text;
  v_term text;
  v_pattern text;
  v_char text;
  v_separator_class constant text := '[[:space:]' || U&'\0021-\002F\003A-\0040\005B-\0060\007B-\007E\104A-\104B\2000-\206F\2E00-\2E7F\3000-\303F\FE10-\FE1F\FE30-\FE4F\FF00-\FF65' || ']';
  v_english_terms constant text[] := array[
    'fuck','fuckyou','fuckoff','motherfucker','fucker',
    'asshole','bitch','whore','slut','cunt','dickhead','suckmydick','eatshit',
    'killyou','iwillkillyou','illkillyou','iamgoingtokillyou',
    'iwillhurtyou','illhurtyou','iwillbeatyou','illbeatyou'
  ];
begin
  if p_text is null or p_dedication is null then return false; end if;
  if char_length(p_text) > 80 or char_length(p_dedication) > 20 then return false; end if;
  if p_text !~ '[^[:space:]]' then return false; end if;

  foreach v_text in array array[p_text, p_dedication] loop
    v_text := regexp_replace(
      lower(normalize(v_text, NFKC)),
      U&'[\200B-\200F\202A-\202E\2060-\206F\FEFF]', '', 'g'
    );
    -- Keep category-M combining marks (especially Burmese vowels); only
    -- discard whitespace and the deterministic punctuation/separator set.
    v_compact := regexp_replace(v_text, v_separator_class, '', 'g');

    if v_compact ~ 'မအေလိုး|မိအေလိုး|မေလိုး|စောက်ပတ်|စောက်ဖုတ်|လီးစုပ်|လီးစား|သတ်ပစ်မယ်' then
      return false;
    end if;

    foreach v_term in array v_english_terms loop
      v_pattern := '(^|' || v_separator_class || ')';
      for v_char in select regexp_split_to_table(v_term, '') loop
        v_pattern := v_pattern || v_char || v_separator_class || '*';
      end loop;
      v_pattern := v_pattern || '(' || v_separator_class || '|$)';
      if v_text ~ v_pattern then return false; end if;
    end loop;
  end loop;
  return true;
end;
$$;
revoke all on function public.thadingyut_wish_suitability_allowed(text,text) from public, anon, authenticated;

create or replace function public.thadingyut_enforce_wish_suitability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_baseline jsonb;
  v_item jsonb;
  v_old_item jsonb;
  v_old text;
  v_text text;
  v_dedication text;
  v_grandfathered boolean;
begin
  -- PostgREST invokes this as authenticated. Migration/test/admin operations
  -- with no browser role remain possible; browser sessions must own the row.
  if current_setting('role', true) in ('anon','authenticated') then
    if auth.uid() is null or auth.uid() <> new.owner_id then
      raise insufficient_privilege using message = 'Profile owner mismatch';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.wishes is not distinct from old.wishes then return new; end if;
    v_baseline := old.wishes;
  else
    -- A profile upsert arrives as INSERT before the conflict UPDATE trigger.
    -- Read its persisted wishes here so unchanged legacy content stays usable.
    select p.wishes into v_baseline
      from public.thadingyut_profiles p
     where p.owner_id = new.owner_id;
  end if;

  for v_item in
    select e.value
      from jsonb_array_elements(case when jsonb_typeof(new.wishes) = 'array' then new.wishes else '[]'::jsonb end) as e(value)
  loop
    if jsonb_typeof(v_item) <> 'object' then continue; end if;

    v_grandfathered := false;
    if jsonb_typeof(v_baseline) = 'array' then
      if jsonb_typeof(v_item->'id') = 'string' and coalesce(v_item->>'id','') <> '' then
        for v_old_item in
          select e.value
            from jsonb_array_elements(v_baseline) as e(value)
           where jsonb_typeof(e.value) = 'object'
             and jsonb_typeof(e.value->'id') = 'string'
             and e.value->>'id' = v_item->>'id'
        loop
          if v_item->'text' is not distinct from v_old_item->'text'
             and v_item->'dedication' is not distinct from v_old_item->'dedication' then
            v_grandfathered := true;
            exit;
          end if;
        end loop;
      else
        select exists (
          select 1 from jsonb_array_elements(v_baseline) as e(value)
           where jsonb_typeof(e.value) = 'object' and e.value = v_item
        ) into v_grandfathered;
      end if;
    end if;
    if v_grandfathered then continue; end if;

    if jsonb_typeof(v_item->'text') is distinct from 'string'
       or (v_item ? 'dedication' and jsonb_typeof(v_item->'dedication') is distinct from 'string') then
      raise exception using message = 'WISH_UNSUITABLE', detail = 'WISH_UNSUITABLE';
    end if;
    v_text := v_item->>'text';
    v_dedication := case when v_item ? 'dedication' then v_item->>'dedication' else '' end;
    if not public.thadingyut_wish_suitability_allowed(v_text, v_dedication) then
      raise exception using message = 'WISH_UNSUITABLE', detail = 'WISH_UNSUITABLE';
    end if;
  end loop;

  return new;
end;
$$;
revoke all on function public.thadingyut_enforce_wish_suitability() from public, anon, authenticated;

create trigger thadingyut_enforce_wish_suitability
  before insert or update of wishes on public.thadingyut_profiles
  for each row execute function public.thadingyut_enforce_wish_suitability();

commit;
