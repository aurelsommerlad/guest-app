-- R — Check-in-Validierung (ADR 0021, C2/C3) für das Apaleo-Testobjekt TEST (Supabase Staging)
-- Ändert ausschließlich die Check-in-Konfiguration von property_id = 'test-run'. Keine Gästedaten,
-- keine anderen Objekte. Voraussetzung: Q-migration-0015.sql.
-- - Meldevorlage at-meldeg (Entwurf; offene Prüfpunkte siehe ADR 0021), Land AT
-- - Prüfregeln: verantwortliche Person ≥ 18 am Anreisetag, gemeinsame Anschrift erlaubt,
--   Firmen-Rechnungsadresse angeboten, kein Adressvorschlagsdienst, kein SMS-Versand,
--   E-Mail-Bestätigung „erforderlich“ (nur Status – es ist noch kein Versanddienst aktiv),
--   Rechnungs-Rückschreiben an Apaleo aus.
-- - Kontaktdaten 7 Tage, Meldedaten 30 Tage nach Abreise.

UPDATE property_journey_settings
SET registration = registration
  || jsonb_build_object(
    'country', 'AT',
    'legalTemplate', 'at-meldeg',
    'contactRetentionDaysAfterDeparture', 7,
    'validation', jsonb_build_object(
      'emailVerification', 'required',
      'smsVerification', jsonb_build_object('mode', 'off', 'supportedCountries', jsonb_build_array('DE', 'AT', 'CH')),
      'responsibleAdultMinAge', 18,
      'sharedAddress', 'allowed',
      'addressSuggestions', 'off',
      'identityCheck', 'not-required',
      'companyBilling', true,
      'billingWriteBack', false
    )
  ),
  updated_at = now()
WHERE tenant_id = 'unique-places' AND property_id = 'test-run';
