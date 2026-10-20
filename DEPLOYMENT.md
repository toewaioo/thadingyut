# Deploy suitability checks and three-reporter temporary hiding

## New-wish suitability gate

The browser checks text and dedication, then waits for `POST /api/wish-check` before spawning a lantern, saving a wish, or updating the streak. Network/invalid responses fail closed with a Burmese notice. PostgreSQL independently checks new/changed wish content on profile INSERT/UPDATE/upsert, including direct API writes that skip the VPS proxy. Unchanged saved content is grandfathered by stable ID and unchanged text/dedication; ID-less legacy entries must match their full saved JSON. No old wish is deleted, edited, re-scanned, or hidden by this migration.

This is a versioned, conservative **rule-based** filter for specified Burmese/English vulgar insults and direct threats, not semantic AI. It normalizes NFKC, selected invisible characters, and agreed separators while preserving Burmese vowel marks. It does not guarantee detection of every harmful phrase, other language, or creative evasion. The existing three-reporter/private-review system remains necessary. Benign references to healing, violence, hate, or survivors are not banned merely for those words.

Local database check: after the existing reporting/three-report test scripts, apply the new suitability migration and run `tests/suitability-database.sql` in the same new disposable `_test` database. Never run test fixtures on production. Application rollback must leave the database guard intact; removing or weakening it needs a separately approved migration.

## Existing sky moderation behavior

Three distinct authenticated reporter IDs automatically hide a wish from the live public sky. Duplicate submissions by one identity count once. Wishes are **not deleted**: archive records, private owner wish arrays, local records, and owner-scoped sync remain intact. Reports and human review stay private. Pending and reviewed reports count; dismissed reports do not. Dismissing enough reports to reduce the active count below three restores visibility. There is no timed expiry.

The only intentional visibility change is this approved moderation filter. The existing 60/100-lantern selection rules continue to operate on visible feed rows. No unrelated table or owner RLS policy is changed. Existing active reports count immediately after migration.

The existing three-reporter release is already deployed on the VPS. For this suitability update, apply only `20261020000300_wish_suitability.sql` if its guard functions and trigger are absent, then deploy the full source and rebuild. Do not replay previous migrations. Keep the current VPS `.env` and systemd unit unchanged. No new secrets or AI service are required.

## 1. Review and apply database migrations

Use the existing project's normal backup and reviewed migration process. Check migration history first.

| Existing database state | Apply in this order |
| --- | --- |
| Sky projection already deployed, reporting not yet applied | `20261020000100_wish_reports.sql`, then `20261020000200_three_report_visibility.sql` |
| Reporting migration already applied | Only `20261020000200_three_report_visibility.sql` |
| Completely new database | All files in `supabase/migrations/`, in filename order |

Run as the authorized database operator using the SQL editor or your established migration runner, keeping its migration history consistent. The migrations are transactional but must not be rerun after success. Do not replace or rerun historical migrations on an existing project. If an object already exists unexpectedly, inspect migration history rather than dropping it.

The threshold migration replaces `public.thadingyut_sky_wishes` with the same explicit two-column public projection plus a private active-report-count filter. Its existing client SELECT access is preserved. It also adds a bounded owner-only visibility RPC to stop hidden wishes from reappearing via an owner's local display copy. It does not expose report tables or reporter identities.

Keep `thadingyut_moderation` outside API-exposed schemas. Never grant browser roles access to the report table, queue, or review operation. Do not run test bootstrap SQL against production.

## 2. Test and release the full project

Use the extracted `thadingyut-wishes/` folder as project root. Node.js 22 or newer is recommended.

```sh
npm ci
npm test
npm run build
```

For Vercel, redeploy the **full source**, including `api/`, `server/`, `src/`, and `vercel.json`; use Vite and `dist` output as configured. Do not upload only `dist/` to static hosting: cloud sync and report/visibility RPCs need the server functions. Apply both required database migrations before releasing this client. Older clients still receive the filtered public feed, but may retain a local owner copy; the updated client checks owner-only visibility too.

Keep existing `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (or supported legacy public-key aliases). Use only the project's publishable/anon key, never a service-role or secret key. Retain existing anonymous sign-in settings. No new browser secrets or moderation environment variables are required.

## 3. Verify on staging

Use a staging project with test wishes and three separate authenticated identities. Do not report real user wishes just to test production behavior.

1. Open a database-backed test lantern card. The report form should explain temporary hiding at three distinct users.
2. Submit from identity A: wish remains visible. Submit A's duplicate: one report record, still visible.
3. Submit from identity B: wish remains visible.
4. Submit from identity C: the database public sky view excludes the wish. An open updated app removes it on refresh (normally within the 10-second poll or shortly after submission), including any open card/camera-follow display.
5. Verify the archive record, the owner's private wish array, other wishes, and unrelated table contents remain intact. Reload and resync the owner's profile: it must not reset the hide.
6. In the private operator workflow in `MODERATION.md`, mark one report reviewed: the wish remains hidden. Dismiss one of the three: the active count drops to two and the wish returns on refresh. With four active reports, dismissing only one is insufficient.
7. Check unsigned visitors cannot submit; browser roles cannot read report records/queue or call review. The owner visibility RPC returns only the current authenticated owner's IDs, hidden flags, and matching JSON for that owner's ID-less legacy wishes, never report counts or another owner's data.
8. Confirm normal owner-profile sync and existing 60/100-lantern behavior still work.

Distinct authenticated UUIDs do not guarantee distinct people; creating multiple anonymous identities can trigger false reports. Private human review is important. The per-identity cap remains 10 new reports per rolling hour, with duplicates excluded.

## Local database integration tests

Use a new disposable **local** PostgreSQL 16 database ending in `_test`, as a local superuser:

```sh
createdb thadingyut_reporting_test
psql -X -d thadingyut_reporting_test -f tests/reporting-database.sql
psql -X -d thadingyut_reporting_test -f tests/three-report-database.sql
```

The first script supplies a minimal local auth stub and applies migrations through the original reporting release. The second applies the new threshold migration and checks hiding/restoration and privacy. Never run these test scripts on a hosted or existing application database.

## Rollback without data loss

If an application rollback is necessary, redeploy the previous source but leave migrations and reports intact. The database filter continues to protect the public feed; previous clients may not suppress owner-local display copies. Do not drop report tables, delete reports/wishes, rerun historical migrations, or remove owner policies.

Changing the approved moderation threshold or disabling the database filter is a separate policy change, not a routine UI rollback: obtain explicit approval and use a new reviewed migration. To restore one falsely reported wish under the approved policy, dismiss enough invalid reports through the restricted review function; never delete the wish.

## Visibility limitations

Hiding applies to the live database-backed public sky. It cannot retract screenshots, downloads, copied wish text, old text-bearing share links, or already cached/offline content. Owners retain their own saved wish records by design. Connected clients refresh public visibility on polling; private owner-visibility failures retain the last confirmed display state and retry without deleting or rewriting any wishes.

See `MODERATION.md` for bounded private inspection queries and review examples. See `VALIDATION.md` for results from this package.
