# Suitability and three-reporter release validation

## Passed

- Locked dependency installation (`npm ci`): succeeded; the dependency audit reported zero vulnerabilities.
- Node regression suite (`npm test`): **110 passed, 0 failed, 0 skipped**.
- Production build (`npm run build`): succeeded with Vite 6.4.4. The existing bundle-size advisory remains; it is not a build failure.
- Fresh disposable local PostgreSQL 16 database: `tests/reporting-database.sql` followed by `tests/three-report-database.sql` both passed; the new suitability migration and `tests/suitability-database.sql` also passed in a fresh local database.

## New suitability checks

Tests cover Burmese/English blocked expressions, punctuation/invisible obfuscation, Burmese vowel preservation, name/substring false positives, text/dedication limits, bounded server requests, same-origin restrictions, sanitized proxy error mapping, direct authenticated DB writes/upserts, and unchanged legacy batch sync. Client tests verify no spawn/save/streak on rejection, fail-closed network behavior, duplicate submission locking, checked-dedication snapshots, and compose cancellation.

## Existing behavior checked

The database tests validate private report submission, duplicate prevention, validation and hourly caps, client role boundaries, and operator-only review. New threshold checks establish that one/two distinct reporters leave a wish visible; three active distinct reporters remove it from the public sky while archive/profile/report records remain intact. Reviewing does not restore it; dismissal below three restores it; another distinct active report can hide it again. Existing profile-to-archive resync does not reset the hide.

The owner visibility RPC is identity-derived, bounded, cursor-paginated, and excludes other owners. Duplicate profile IDs do not produce duplicate pages. Its returned display fields are canonical wish ID, source ID, hidden flag, and a private matching JSON payload only for that owner's ID-less legacy records. Public sky columns and SELECT grants remain unchanged. Neither migration changes owner RLS policies or unrelated tables.

Frontend tests cover private visibility paging and malformed/error responses, suppression/restoration of hidden local display copies (including ID-less legacy records with reordered JSON keys) without modifying local wish arrays, existing 60/100-lantern limits, exact proxy route/query boundaries, report confirmation events, and integration wiring for stale-card/camera cleanup. These are automated source/DOM tests, not a live browser deployment test.

All historical SQL migrations are retained unchanged. The threshold is implemented in a new migration, `20261020000200_three_report_visibility.sql`.

## Not performed

Automated package tests do not create real user wishes/reports. Live health/deployment evidence is recorded separately by the deployment task. Local database tests use a minimal auth stub, not a complete hosted authentication stack.

Distinct authenticated UUIDs do not guarantee distinct humans. The live sky filter cannot revoke already copied, offline, downloaded, or old text-embedded shared content. Owners' saved records remain intact by design; connected clients learn visibility changes on refresh. See `MODERATION.md` for the private review and restoration workflow.

## Startup arrival waves

Existing sky lanterns are introduced in small 6–7-lantern waves (a final group can have 4–7), roughly one second apart, with short within-wave jitter, separated positions/heights, and baseline-like rise speeds. One hundred entries arrive within 20 seconds. New manual launches remain immediate. Tests execute the real worker code and main-thread fallback, comparing countdown and partial-frame motion; check hidden smoke/hit targets, wave sizing/spread, unchanged saved records, repeated-feed object identity, and immediate moderation disposal of still-waiting lanterns. No database migration is required. Tests do not claim a live WebGL visual inspection.

## Private admin console

110 local tests pass, including authenticated server-rendered UI, escaping, scoped backend RPCs, password/session/CSRF/rate/KDF bounds, and real PostgreSQL integration composing report, threshold, suitability and admin migrations in a disposable local test database. Public frontend source and build assets remain byte-identical to the preceding waves release. The admin migration leaves every saved wish/profile/report unchanged and creates an empty manual-visibility override table. HTTPS certificate issuance and trusted live login must be verified on the target VPS before declaring completion.
