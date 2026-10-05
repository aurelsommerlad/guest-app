-- Custom migration (ADR 0010): close the Supabase Data API for our tables.
--
-- The guest app accesses Postgres only server-side as the table owner. The Supabase
-- roles `anon` and `authenticated` (PostgREST / Data API) must not read or write anything.
-- RLS without policies already denies them every row (migration 0000); revoking the
-- privileges is the second, independent layer and also covers tables created later by
-- this role. On plain Postgres (local, tests) these roles do not exist: no-op.
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.tenants, public.properties, public.units, public.external_mappings FROM %I',
        api_role
      );
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
