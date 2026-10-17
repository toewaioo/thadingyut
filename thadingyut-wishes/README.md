# Thadingyut Wish Sky

A React/Vite rebuild of the supplied Burmese Thadingyut lantern experience. The original Three.js scene and interactions are retained as a scene module, mounted by React. Preferences, day/night settings, wishes, and streaks continue to save locally and sync to an owner-isolated Supabase profile when anonymous sign-in is enabled.

## Supabase setup

1. Select the intended Supabase project.
2. Apply `supabase/migrations/20261015000000_thadingyut_profiles.sql`.
3. Enable anonymous sign-ins in Supabase Authentication settings.
4. Copy `.env.example` to `.env.production.local` and set the project URL and publishable key.
5. Build with Bun. The publishable/anon key is intentionally public and protected by the table's row-level security policies; never put a service-role key in the browser bundle.

The app creates an anonymous Supabase account for the current browser. Its cloud data remains tied to that browser's auth session; clearing browser storage or switching devices loses access to that anonymous identity. If Supabase or anonymous sign-in is unavailable, the app still works and saves to local storage.

## Build and run with Bun

```sh
bun install --frozen-lockfile
bun run build
PORT=4173 bun run start
```

The production server serves `dist/` on `0.0.0.0` and provides `GET /healthz` for health checks.

## VPS deployment

The provided systemd template `deploy/thadingyut-wishes.service` runs the app as a dedicated `wishlantern` user on port 80 with only the low-port bind capability. Install it at `/etc/systemd/system/thadingyut-wishes.service` after placing the project at `/opt/thadingyut-wishes`, then run:

```sh
systemctl daemon-reload
systemctl enable --now thadingyut-wishes.service
curl http://127.0.0.1/healthz
```

This uses a standalone Bun server and does not require or modify the Telegram bot's directories or systemd units. It serves plain HTTP directly; a custom domain and HTTPS certificate can be added separately if needed.
