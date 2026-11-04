-- L — PRÜFUNG TESTZUGANG (nur lesend, Supabase Staging). Ändert nichts.
-- Erwartet für einen funktionierenden Testzugang mit JTKQSYFX-1 (Apaleo-Objekt TEST):
--   applied_migrations = 11, last_migration_when = 1791320712081 (0010),
--   tenant_ok = true, test_property_mapped = true, test_units_mapped = 2,
--   checkin_config_test_run = true, checkin_sync_targets = [] (nichts wird übertragen),
--   checkin_enabled_real_properties = 0 (kein Check-in für echte Objekte),
--   guide_published_for_test_run > 0 oder guide_published_tenant_wide > 0 (sonst ist GUIDE leer),
--   revoked_links_for_reservation = 0 (sonst ist die Reservierung gesperrt).
SELECT
  (SELECT count(*) FROM drizzle.__drizzle_migrations)                      AS applied_migrations,
  (SELECT max(created_at) FROM drizzle.__drizzle_migrations)               AS last_migration_when,
  EXISTS (SELECT 1 FROM tenants WHERE id = 'unique-places')                AS tenant_ok,
  EXISTS (SELECT 1 FROM external_mappings WHERE provider = 'apaleo'
            AND entity_type = 'property' AND external_id = 'TEST'
            AND internal_entity_id = 'test-run')                           AS test_property_mapped,
  (SELECT count(*) FROM external_mappings WHERE provider = 'apaleo'
     AND entity_type = 'unit'
     AND (internal_entity_id, external_id) IN (('test-ap-1', 'TEST-ZHF'),
                                               ('test-ap-2', 'TEST-WEZ'))) AS test_units_mapped,
  EXISTS (SELECT 1 FROM property_journey_settings
            WHERE property_id = 'test-run'
              AND registration->>'enabled' = 'true')                       AS checkin_config_test_run,
  (SELECT registration->'targets' FROM property_journey_settings
     WHERE property_id = 'test-run')                                       AS checkin_sync_targets,
  (SELECT count(*) FROM property_journey_settings
     WHERE property_id <> 'test-run'
       AND registration->>'enabled' = 'true')                              AS checkin_enabled_real_properties,
  (SELECT count(*) FROM guide_sections WHERE status = 'published'
     AND property_id = 'test-run')                                         AS guide_published_for_test_run,
  (SELECT count(*) FROM guide_sections WHERE status = 'published'
     AND property_id IS NULL)                                              AS guide_published_tenant_wide,
  (SELECT count(*) FROM guest_access WHERE reservation_provider = 'apaleo'
     AND external_reservation_id = 'JTKQSYFX-1' AND revoked_at IS NOT NULL) AS revoked_links_for_reservation;
