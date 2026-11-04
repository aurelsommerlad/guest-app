-- L — PRÜFUNG TESTZUGANG (nur lesend, Supabase Staging). Ändert nichts.
-- Läuft auch auf einem älteren Stand: fehlt eine Tabelle, steht in der Spalte NULL bzw.
-- *_table = false, statt dass die Abfrage abbricht.
-- Erwartet für einen funktionierenden Testzugang mit JTKQSYFX-1 (Apaleo-Objekt TEST):
--   applied_migrations = 11, last_migration_when = 1791320712081 (0010),
--   journey_tables = true, contact_columns_0010 = true,
--   tenant_ok = true, test_property_mapped = true, test_units_mapped = 2,
--   checkin_config_test_run = true, checkin_sync_targets = [] (nichts wird übertragen),
--   checkin_enabled_real_properties = 0 (kein Check-in für echte Objekte),
--   guide_published_for_test_run > 0 oder guide_published_tenant_wide > 0 (sonst ist GUIDE leer),
--   revoked_links_for_reservation = 0 (sonst ist die Reservierung gesperrt).
WITH t AS (
  SELECT to_regclass('public.property_journey_settings') IS NOT NULL
         AND to_regclass('public.guest_registrations') IS NOT NULL AS journey
)
SELECT
  (SELECT count(*) FROM drizzle.__drizzle_migrations)                      AS applied_migrations,
  (SELECT max(created_at) FROM drizzle.__drizzle_migrations)               AS last_migration_when,
  t.journey                                                                AS journey_tables,
  EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'guest_registration_guests'
              AND column_name = 'prefilled_fields')                        AS contact_columns_0010,
  EXISTS (SELECT 1 FROM tenants WHERE id = 'unique-places')                AS tenant_ok,
  EXISTS (SELECT 1 FROM external_mappings WHERE provider = 'apaleo'
            AND entity_type = 'property' AND external_id = 'TEST'
            AND internal_entity_id = 'test-run')                           AS test_property_mapped,
  (SELECT count(*) FROM external_mappings WHERE provider = 'apaleo'
     AND entity_type = 'unit'
     AND (internal_entity_id, external_id) IN (('test-ap-1', 'TEST-ZHF'),
                                               ('test-ap-2', 'TEST-WEZ'))) AS test_units_mapped,
  -- Tabellen aus 0008 nur abfragen, wenn es sie gibt (query_to_xml wird erst dann geplant).
  CASE WHEN t.journey THEN (xpath('/row/v/text()', query_to_xml(
    $q$SELECT EXISTS (SELECT 1 FROM property_journey_settings WHERE property_id = 'test-run'
         AND registration->>'enabled' = 'true') AS v$q$, false, true, '')))[1]::text END
                                                                           AS checkin_config_test_run,
  CASE WHEN t.journey THEN (xpath('/row/v/text()', query_to_xml(
    $q$SELECT registration->'targets' AS v FROM property_journey_settings
         WHERE property_id = 'test-run'$q$, false, true, '')))[1]::text END AS checkin_sync_targets,
  CASE WHEN t.journey THEN (xpath('/row/v/text()', query_to_xml(
    $q$SELECT count(*) AS v FROM property_journey_settings WHERE property_id <> 'test-run'
         AND registration->>'enabled' = 'true'$q$, false, true, '')))[1]::text END
                                                                           AS checkin_enabled_real_properties,
  (SELECT count(*) FROM guide_sections WHERE status = 'published'
     AND property_id = 'test-run')                                         AS guide_published_for_test_run,
  (SELECT count(*) FROM guide_sections WHERE status = 'published'
     AND property_id IS NULL)                                              AS guide_published_tenant_wide,
  (SELECT count(*) FROM guest_access WHERE reservation_provider = 'apaleo'
     AND external_reservation_id = 'JTKQSYFX-1' AND revoked_at IS NOT NULL) AS revoked_links_for_reservation
FROM t;
