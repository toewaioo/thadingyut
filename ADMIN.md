# Private admin console

Open `https://23.94.67.231/admin` and use the operator password supplied separately. HTTP `/admin` redirects to HTTPS before presenting a login form; credential POSTs on HTTP are rejected. Existing HTTP sky users retain their original browser storage and identity.

## What it can do

The wishes tab searches and paginates archived wishes, including hidden wishes, and shows active and total report counts. It can apply or clear a private manual visibility hold. It never edits or deletes the wish or its owner's saved copy.

The reports tab displays reason, details, wish snapshot, status and review notes, without exposing reporter or owner identities. Marking a report `reviewed` leaves it active; `dismissed` removes it from the three-distinct-identity threshold. Clearing a manual hold does not overrule that threshold. Owner-only visibility metadata also honors manual holds, so a hidden wish does not reappear from an owner's local copy.

There are no wish-deletion operations.

## Server-only authority

`THADINGYUT_ADMIN_PASSWORD_HASH` stores a salted scrypt verifier, not the plaintext password. `THADINGYUT_ADMIN_BACKEND_KEY` is a separate random 256-bit scoped credential. Its SHA-256 verifier lives in the private `thadingyut_moderation.thadingyut_admin_access` table; it authorizes only the four admin RPCs, not arbitrary database access. Neither credential is part of frontend configuration, source archives, assets or application logs.

The root-owned `/etc/thadingyut-wishes/admin.env` is loaded by a service-specific systemd drop-in. Do not place real credentials in this repository. Password changes require a newly salted verifier and an app restart. Backend-key rotation additionally updates the private singleton hash through an authorized database session.

The console uses random eight-hour HttpOnly/Secure/SameSite=Strict sessions, per-session CSRF tokens, same-origin POST checks, bounded form bodies, five login attempts per client address per 15 minutes plus a global bound, and at most two simultaneous password KDFs. Sessions are invalidated on logout, expiry and app restart. Browser data is rendered as escaped text with restrictive CSP and no external scripts or assets.

## Database deployment

Apply only the missing `20261020000400_private_admin.sql` migration after the existing reporting, threshold and suitability migrations. The migration creates empty private admin-access and override tables; it does not change any existing wish, profile or report. Provision the random backend-key hash through authorized DML after applying it. All admin RPCs fail closed while that singleton is empty. Do not expose the private moderation schema through the data API.

## HTTPS and renewal

The existing Bun service keeps HTTP port 80 for the public sky and HTTP-01 challenge files, and also serves TLS on 443. A browser-trusted IP certificate is issued with Certbot 5.8.0 using the short-lived profile. Certificate/key copies under `/etc/thadingyut-wishes-tls` are root-owned and readable only by the app's service group. The service reads `THADINGYUT_TLS_CERT` and `THADINGYUT_TLS_KEY`; once enabled it fails startup if admin authority exists without TLS configuration. `THADINGYUT_ADMIN_BOOTSTRAP_HTTP=true` is permitted only during initial certificate issuance, and is removed before the deployment is declared healthy; even then HTTP login is not allowed.

The application-owned `thadingyut-certbot-renew.timer` checks renewal twice daily. Its deploy hook copies only this certificate and restarts only `thadingyut-wishes.service` after successful renewal. Because these IP certificates last roughly six days, keep the timer and HTTP challenge route available. Renewal restarts invalidate admin sessions; simply sign in again. Telegram services are not part of the hook.

## Validation and rollback

Run `npm ci`, `npm test`, and `npm run build`. The test suite composes report, three-reporter, suitability and admin migrations in a fresh local database ending in `_test`; never run the bootstrap against production. Set `ADMIN_DATABASE_TEST=0` only when the runtime host lacks a disposable local PostgreSQL cluster; all other tests still run.

Keep the previous application directory backup. A code rollback need not remove the additive private tables or mutate reports/wishes. Do not roll back by deleting wishes, deleting reports or disabling owner isolation. Verify HTTPS trust, unauthenticated login, successful login/logout, read-only wishes/report pagination, HTTP credential rejection, public sky health, suitability rejection, and unchanged saved-data hashes before announcing completion.
