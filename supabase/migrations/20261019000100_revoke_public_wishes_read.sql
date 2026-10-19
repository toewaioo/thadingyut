-- Close the archive itself; the sky uses a separate, allowlisted projection.
alter table public.thadingyut_public_wishes enable row level security;
revoke all privileges on table public.thadingyut_public_wishes from public, anon, authenticated;
drop policy if exists thadingyut_public_wishes_read_all on public.thadingyut_public_wishes;
-- Keep all wish records, archive triggers, and owner profile policies intact.
