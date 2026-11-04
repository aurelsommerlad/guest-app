-- M — ONLINE-CHECK-IN-KONFIGURATION FÜR DAS APALEO-TESTOBJEKT "TEST" (Supabase Staging)
-- Legt genau EINEN Datensatz in property_journey_settings an: Objekt test-run (Apaleo TEST).
-- Nur für Tests: Die Felder sind ein Beispiel, keine Rechtsaussage für ein echtes Objekt.
--
-- Sicherheit:
--   * targets = []  → beim Absenden entstehen KEINE Sync-Zeilen: nichts geht an Apaleo
--     oder Feratel, unabhängig von APALEO_REGISTRATION_WRITEBACK.
--   * ON CONFLICT DO NOTHING → eine vorhandene Konfiguration wird nie überschrieben.
--   * Bricht ab, wenn test-run nicht existiert, nicht auf Apaleo TEST zeigt oder
--     Migration 0010 fehlt. Andere Objekte werden nicht berührt.
--   * Zugang: manuell (kein Code, keine Schlüsselbox).
--   * Personenbezogene Testdaten werden 30 Tage nach Abreise löschbar.
-- Mehrfaches Ausführen ist unschädlich.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = 'unique-places') THEN
    RAISE EXCEPTION 'Tenant unique-places fehlt';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM properties WHERE tenant_id = 'unique-places' AND id = 'test-run') THEN
    RAISE EXCEPTION 'Objekt test-run fehlt – zuerst Skript N (Testobjekt-Zuordnung) ausführen';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM external_mappings WHERE tenant_id = 'unique-places'
                   AND provider = 'apaleo' AND entity_type = 'property'
                   AND internal_entity_id = 'test-run' AND external_id = 'TEST') THEN
    RAISE EXCEPTION 'test-run ist nicht dem Apaleo-Testobjekt TEST zugeordnet – Abbruch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'guest_registrations' AND column_name = 'guest_count_changed_at') THEN
    RAISE EXCEPTION 'Migration 0010 fehlt – zuerst Skript J ausführen';
  END IF;
END
$$;

INSERT INTO property_journey_settings (tenant_id, property_id, registration, access)
VALUES (
  'unique-places',
  'test-run',
  '{
    "enabled": true,
    "country": "DE",
    "targets": [],
    "primaryGuest": {
      "required": ["firstName", "lastName", "birthDate", "nationality", "street", "postalCode", "city", "country"],
      "optional": []
    },
    "companions": { "required": ["firstName", "lastName", "birthDate", "nationality"], "optional": [] },
    "children": { "underAge": 16, "required": ["firstName", "lastName", "birthDate"], "optional": [] },
    "guestCardRelevant": false,
    "providerSettings": {},
    "retentionDaysAfterDeparture": 30
  }'::jsonb,
  '{
    "mode": "manual",
    "release": "arrival-day",
    "requiresCompletedRegistration": false,
    "instructions": {
      "de": "Testobjekt: Hier stehen später die Anreise-Hinweise des Objekts.",
      "en": "Test property: arrival instructions of the property will appear here."
    }
  }'::jsonb
)
ON CONFLICT (tenant_id, property_id) DO NOTHING;

-- Ergebnis: zeigt, ob die (neue oder bereits vorhandene) Konfiguration aktiv ist.
SELECT property_id,
       registration->>'enabled'   AS checkin_enabled,
       registration->'targets'    AS sync_targets,
       access->>'mode'            AS access_mode,
       created_at, updated_at
FROM property_journey_settings
WHERE tenant_id = 'unique-places' AND property_id = 'test-run';

COMMIT;
