-- Custom migration (ADR 0013): keep the Supabase Data API closed for every table in
-- `public`, including those added after 0001 (guest_access, guest_sessions,
-- rate_limit_buckets) and Phase 9 (guide_sections, admin_users,
-- admin_sessions). RLS without policies already denies `anon`/`authenticated`;
-- this revokes their privileges as the independent second layer. No-op on plain Postgres.
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
