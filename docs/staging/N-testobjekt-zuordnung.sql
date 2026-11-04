-- N — ZUORDNUNG DES APALEO-TESTOBJEKTS "TEST" (Supabase Staging, nie Production)
-- Entspricht den Preview-Fixtures (packages/db/src/seed/preview-fixtures.ts), aber NUR einfügend:
-- Objekt test-run, Apartments test-ap-1 (Apaleo TEST-ZHF) und test-ap-2 (TEST-WEZ) und deren
-- Apaleo-Zuordnungen. Vorhandene Zeilen werden nie geändert (ON CONFLICT DO NOTHING); die
-- Stammdaten der echten Objekte (HØV, LÆKE, HŪSLE, ΛLPILΛ) werden nicht berührt.
-- Am Ende wird geprüft, dass die Zuordnung exakt stimmt – sonst Abbruch und nichts gespeichert.
-- Mehrfaches Ausführen ist unschädlich.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = 'unique-places') THEN
    RAISE EXCEPTION 'Tenant unique-places fehlt – Stammdaten-Seed (Skript B) fehlt';
  END IF;
END
$$;

INSERT INTO properties (id, tenant_id, slug, display_name, spoken_name, location_name, timezone)
VALUES ('test-run', 'unique-places', 'test-run', 'TEST', 'Test', 'Testumgebung', 'Europe/Berlin')
ON CONFLICT DO NOTHING;

INSERT INTO units (id, tenant_id, property_id, slug, display_name) VALUES
  ('test-ap-1', 'unique-places', 'test-run', 'test-ap-1', 'Ap. 1'),
  ('test-ap-2', 'unique-places', 'test-run', 'test-ap-2', 'Ap. 2')
ON CONFLICT DO NOTHING;

INSERT INTO external_mappings (tenant_id, provider, entity_type, internal_entity_id, external_id) VALUES
  ('unique-places', 'apaleo', 'property', 'test-run',  'TEST'),
  ('unique-places', 'apaleo', 'unit',     'test-ap-1', 'TEST-ZHF'),
  ('unique-places', 'apaleo', 'unit',     'test-ap-2', 'TEST-WEZ')
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM units WHERE tenant_id = 'unique-places' AND property_id = 'test-run'
        AND id IN ('test-ap-1', 'test-ap-2')) <> 2 THEN
    RAISE EXCEPTION 'Apartments test-ap-1/test-ap-2 gehören nicht zu test-run – Abbruch';
  END IF;
  IF (SELECT count(*) FROM external_mappings WHERE tenant_id = 'unique-places' AND provider = 'apaleo'
        AND (entity_type, internal_entity_id, external_id) IN
            (('property', 'test-run', 'TEST'), ('unit', 'test-ap-1', 'TEST-ZHF'), ('unit', 'test-ap-2', 'TEST-WEZ'))) <> 3 THEN
    RAISE EXCEPTION 'Apaleo-Zuordnung für TEST weicht ab (bestehende Zeile?) – Abbruch, nichts gespeichert';
  END IF;
END
$$;

SELECT entity_type, internal_entity_id, external_id
FROM external_mappings
WHERE tenant_id = 'unique-places' AND provider = 'apaleo'
  AND internal_entity_id IN ('test-run', 'test-ap-1', 'test-ap-2')
ORDER BY entity_type, internal_entity_id;

COMMIT;
