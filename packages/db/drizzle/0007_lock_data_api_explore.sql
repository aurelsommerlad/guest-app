-- Custom migration (ADR 0015): keep the Supabase Data API closed for every table in
-- `public`, including the Phase 10 tables (explore_places, explore_place_properties).
-- RLS without policies already denies `anon`/`authenticated`; this revokes their
-- privileges as the independent second layer. No-op on plain Postgres.
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
