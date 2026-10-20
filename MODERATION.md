# Wish reports: temporarily hide at three distinct reporters

## Current policy

A database-backed wish is automatically excluded from the public sky after reports from **three distinct authenticated Supabase user IDs**. Two reports do not hide it. Repeated submissions by one identity count once. Signed-in anonymous identities count, but an unsigned visitor cannot submit.

Hiding is temporary and reversible: it is a filter on `public.thadingyut_sky_wishes`, not deletion. The archive record, the owner's private wish record, local storage, profile sync, and unrelated tables remain intact. No report count or reporter identity is exposed publicly. There is no public moderator UI.

The filter counts reports with status `pending` or `reviewed`; `dismissed` reports do not count. A human operator restores a wish by dismissing enough reports to bring the active distinct-reporter count below three. Marking a report `reviewed` alone does not restore it. There is no automatic time expiry, because no duration was chosen. Further valid distinct reports can hide a restored wish again.

Existing reports immediately participate when the threshold migration is applied. No historical report is deleted or rewritten. The new visibility migration is additive except for replacing the existing sky view definition; it does not alter archive/profile tables, owner RLS policies, or archive-sync triggers.

## Deploy before releasing the client

Follow `DEPLOYMENT.md`. Apply the reporting migration first if it has not been applied, then the new threshold migration:

```text
20261020000100_wish_reports.sql
20261020000200_three_report_visibility.sql
```

Both are in `supabase/migrations/`. Do not edit or rerun an already-applied migration. Keep `thadingyut_moderation` out of exposed API schemas. Only an authorized database operator (`postgres`) or a protected service-role backend can use its queue/review operation; never ship service-role credentials to browsers.

The submission RPC remains `public.thadingyut_submit_wish_report(p_wish_id, p_reason, p_details)`. It requires `auth.uid()`, a canonical 32-character lowercase hexadecimal wish ID, and one reason from `spam`, `harassment`, `hate`, `sexual`, `violence`, `personal_info`, or `other`. Details are at most 1,000 characters. It returns only `{"accepted":true}` for either a new report or that user's duplicate. A per-user advisory lock serializes submissions, and no identity may create more than 10 new reports per rolling hour; duplicates do not consume the cap.

The owner-only `public.thadingyut_own_wish_visibility(p_after, p_limit)` RPC returns a bounded page of that authenticated owner's canonical wish IDs, source IDs, and hidden flags. For an ID-less legacy wish only, it also returns that owner's original wish JSON as private matching metadata, so the local copy can be recognized without modifying it. It accepts no owner ID argument and exposes no other owner's private data or reports. It prevents an owner's locally saved copy from repopulating the online sky after the public row disappears. It is display metadata only; it does not delete, filter, or rewrite the owner's synced wish array.

## Review privately

Run detailed inspection in an authorized SQL session as `postgres`. A protected service-role backend may use the aggregate queue and review function but has no direct report-table grant. Use bounded queries, with a maximum of 50 queue rows per page and a nonnegative offset:

```sql
select wish_id,
       wish_text_snapshot,
       wish_dedication_snapshot,
       report_count,
       pending_count,
       reviewed_count,
       dismissed_count,
       latest_report_at,
       reason_counts
from thadingyut_moderation.thadingyut_wish_report_queue
where pending_count + reviewed_count > 0
order by (pending_count + reviewed_count) desc, latest_report_at desc, wish_id
limit 50 offset 0;
```

The queue includes snapshots and all report statuses; `report_count` includes dismissed reports. Because each identity has one report per wish, pending plus reviewed is the active count for a stable wish snapshot. If an owner edited the wish and reports have different snapshots, the queue may have multiple rows for one wish: inspect that wish's report records together before deciding. The actual visibility filter always counts distinct active identities across all snapshots for that wish.

For one selected canonical wish ID, inspect up to 25 reports, selecting only necessary fields:

```sql
select id,
       wish_id,
       reason,
       details,
       wish_text_snapshot,
       wish_dedication_snapshot,
       status,
       created_at
from thadingyut_moderation.thadingyut_wish_reports
where wish_id = '0123456789abcdef0123456789abcdef'
order by created_at asc, id asc
limit 25;
```

Wish text, details, reviewer labels, and notes are untrusted input. Never interpolate them into SQL or unsafe HTML rendering.

Record a human examination without restoring a hidden wish:

```sql
select thadingyut_moderation.thadingyut_review_wish_report(
  123,
  'reviewed',
  'moderator-label',
  'Reviewed; report remains active for the three-reporter threshold.'
);
```

Dismiss a report judged not actionable; if this reduces the active count below three, the wish automatically returns to the public sky:

```sql
select thadingyut_moderation.thadingyut_review_wish_report(
  123,
  'dismissed',
  'moderator-label',
  'Dismissed after human review.'
);
```

Use the actual selected report ID, not the example. Reviewer labels are limited to 200 characters and notes to 1,000. Review updates report metadata only; the derived sky filter reflects those statuses. Do not restore by deleting reports or editing wish records. To restore a wish with four active reports, at least two must be dismissed so the count falls below three.

## Limits to understand

- Distinct user IDs are not necessarily distinct people. Anonymous users can create new identities; the cap is **not Sybil protection**. Three coordinated identities can cause a temporary hide, so timely operator review matters.
- This release filters the live database-backed public sky, not content someone already downloaded, copied, screenshotted, or embedded in an old text-bearing share link. It cannot revoke those copies. Locally stored owner records remain recoverable by design.
- Open online clients normally update on the next 10-second sky poll, or shortly after a report submission. A stale/offline client cannot learn new moderation decisions until it reconnects. A failed private visibility refresh retains its last confirmed display state and retries at the next refresh; it never discards wish records.
- A hide is a review signal, not a finding of wrongdoing. There is no timed unhide, deletion, public report list, or public admin endpoint.

## Local verification

Run `npm ci`, `npm test`, and `npm run build`. For database integration use only a fresh disposable **local** PostgreSQL database ending in `_test`:

```sh
psql -X -d thadingyut_reporting_test -f tests/reporting-database.sql
psql -X -d thadingyut_reporting_test -f tests/three-report-database.sql
```

The first test creates a minimal local auth stub and applies historical migrations. The second applies the new threshold migration and tests visibility/reversal and record preservation. **Never run this test bootstrap on a hosted or existing app database.** No hosted database was accessed or changed while preparing this ZIP, and it has **not** been deployed to a live database.
