-- Custom migration (ADR 0016/0017): keep the Supabase Data API closed for every table in
-- `public`, including the Phase 11 tables (property_journey_settings, guest_registrations,
-- guest_registration_guests, guest_registration_syncs, unit_access_codes). They hold
-- personal data and encrypted access codes. RLS without policies already denies
-- `anon`/`authenticated`; this revokes their privileges as the independent second layer.
-- No-op on plain Postgres.
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
