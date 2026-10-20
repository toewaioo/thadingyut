begin;

-- Reports are separate private records: creating or reviewing one never mutates
-- the public wish archive, sky projection, or any profile/policy.
create schema if not exists thadingyut_moderation;
revoke all on schema thadingyut_moderation from public, anon, authenticated;
grant usage on schema thadingyut_moderation to service_role;

create table thadingyut_moderation.thadingyut_wish_reports (
  id bigint generated always as identity primary key,
  -- The submission RPC validates existence; no FK changes archive deletion semantics.
  wish_id text not null,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam', 'harassment', 'hate', 'sexual', 'violence', 'personal_info', 'other')),
  details text not null default '' check (char_length(details) <= 1000),
  wish_text_snapshot text not null,
  wish_dedication_snapshot text,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  reviewed_at timestamptz,
  reviewer text,
  reviewer_notes text,
  constraint thadingyut_wish_reports_reporter_wish_key unique (reporter_id, wish_id)
);

alter table thadingyut_moderation.thadingyut_wish_reports enable row level security;
revoke all privileges on table thadingyut_moderation.thadingyut_wish_reports from public, anon, authenticated, service_role;

create index thadingyut_wish_reports_queue_idx
  on thadingyut_moderation.thadingyut_wish_reports (status, created_at desc, wish_id);

-- This view is for privileged operators only. It intentionally omits reporter
-- identities and report text/details while aggregating counts by wish snapshot.
create view thadingyut_moderation.thadingyut_wish_report_queue
with (security_barrier = true, security_invoker = false) as
select wish_id,
       wish_text_snapshot,
       wish_dedication_snapshot,
       count(*)::bigint as report_count,
       count(*) filter (where status = 'pending')::bigint as pending_count,
       count(*) filter (where status = 'reviewed')::bigint as reviewed_count,
       count(*) filter (where status = 'dismissed')::bigint as dismissed_count,
       max(created_at) as latest_report_at,
       (select pg_catalog.jsonb_object_agg(reason_totals.reason, reason_totals.reason_count)
          from (select r2.reason, count(*)::bigint as reason_count
                  from thadingyut_moderation.thadingyut_wish_reports r2
                 where r2.wish_id = r.wish_id
                 group by r2.reason) reason_totals) as reason_counts
  from thadingyut_moderation.thadingyut_wish_reports r
 group by wish_id, wish_text_snapshot, wish_dedication_snapshot;
revoke all privileges on table thadingyut_moderation.thadingyut_wish_report_queue from public, anon, authenticated;
grant select on table thadingyut_moderation.thadingyut_wish_report_queue to service_role;

create or replace function public.thadingyut_submit_wish_report(
  p_wish_id text,
  p_reason text,
  p_details text default ''
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reporter uuid;
  v_wish_text text;
  v_wish_dedication text;
  v_details text := coalesce(p_details, '');
  v_recent_count bigint;
begin
  v_reporter := auth.uid();
  if v_reporter is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  if p_wish_id is null or p_wish_id !~ '^[0-9a-f]{32}$' then
    raise exception using errcode = '22023', message = 'Invalid wish id';
  end if;
  if p_reason is null or p_reason not in ('spam', 'harassment', 'hate', 'sexual', 'violence', 'personal_info', 'other') then
    raise exception using errcode = '22023', message = 'Invalid report reason';
  end if;
  if pg_catalog.char_length(v_details) > 1000 then
    raise exception using errcode = '22023', message = 'Report details exceed 1000 characters';
  end if;

  -- Serialize each user's submissions so concurrent calls cannot bypass the cap.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_reporter::text, 0));

  -- Idempotent duplicates always receive the same generic response and do not
  -- consume another hourly allowance.
  if exists (
    select 1 from thadingyut_moderation.thadingyut_wish_reports r
     where r.reporter_id = v_reporter and r.wish_id = p_wish_id
  ) then
    return pg_catalog.jsonb_build_object('accepted', true);
  end if;

  select w.wish ->> 'text', w.wish ->> 'dedication'
    into v_wish_text, v_wish_dedication
    from public.thadingyut_public_wishes w
   where w.id = p_wish_id;
  if not found then
    raise exception using errcode = '22023', message = 'Wish not found';
  end if;

  select count(*) into v_recent_count
    from thadingyut_moderation.thadingyut_wish_reports r
   where r.reporter_id = v_reporter
     and r.created_at >= pg_catalog.clock_timestamp() - interval '1 hour';
  if v_recent_count >= 10 then
    raise exception using errcode = '54000', message = 'Report rate limit exceeded';
  end if;

  insert into thadingyut_moderation.thadingyut_wish_reports (
    wish_id, reporter_id, reason, details, wish_text_snapshot, wish_dedication_snapshot
  ) values (
    p_wish_id, v_reporter, p_reason, v_details, v_wish_text, v_wish_dedication
  );

  return pg_catalog.jsonb_build_object('accepted', true);
end;
$$;
revoke all privileges on function public.thadingyut_submit_wish_report(text, text, text) from public, anon, authenticated;
grant execute on function public.thadingyut_submit_wish_report(text, text, text) to authenticated;

-- Restricted database-side review operation. It records a decision only; it
-- has no visibility, archive, or sky-projection side effects.
create or replace function thadingyut_moderation.thadingyut_review_wish_report(
  p_report_id bigint,
  p_status text,
  p_reviewer text,
  p_notes text default ''
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notes text := coalesce(p_notes, '');
begin
  if p_status is null or p_status not in ('reviewed', 'dismissed') then
    raise exception using errcode = '22023', message = 'Invalid review status';
  end if;
  if p_reviewer is null or pg_catalog.btrim(p_reviewer) = '' or pg_catalog.char_length(p_reviewer) > 200 then
    raise exception using errcode = '22023', message = 'Reviewer label must be 1 to 200 characters';
  end if;
  if pg_catalog.char_length(v_notes) > 1000 then
    raise exception using errcode = '22023', message = 'Review notes exceed 1000 characters';
  end if;

  update thadingyut_moderation.thadingyut_wish_reports
     set status = p_status,
         reviewed_at = pg_catalog.clock_timestamp(),
         reviewer = p_reviewer,
         reviewer_notes = v_notes
   where id = p_report_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Report not found';
  end if;
  return pg_catalog.jsonb_build_object('updated', true);
end;
$$;
revoke all privileges on function thadingyut_moderation.thadingyut_review_wish_report(bigint, text, text, text) from public, anon, authenticated;
grant execute on function thadingyut_moderation.thadingyut_review_wish_report(bigint, text, text, text) to postgres, service_role;

commit;
