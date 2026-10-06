# Apaleo-Write-back des Online-Check-ins

Stand: Phase 11. Architektur: [ADR 0016](../adr/0016-guest-journey-and-online-check-in.md).

## Verifizierte Grundlage

Quelle: offizieller, von apaleo gepflegter Client `@apaleo/angular-api-proxy-booking` **19.0.29** (npm, Maintainer `apaleo-operations`, generiert aus der Booking-API-Spezifikation, Stand 2026-08). Die Dokumentationsseiten api.apaleo.com/apaleo.dev waren aus der Entwicklungsumgebung nicht erreichbar (Proxy); eine Websuche bestätigte dieselbe Operationsliste für `/booking/v1`.

- `PATCH /booking/v1/reservations/{id}` – JSON Patch, Scope **`reservations.manage`**. Erlaubte Operationen laut Spezifikation u. a.: „Replace PrimaryGuest“, „Add, replace and remove AdditionalGuests“, „Add, replace and remove Comment/GuestComment/TravelPurpose“ (weitere: PaymentAccount, Company, Commission, ValidationMessages; in der v0-nsfw-Fassung zusätzlich ExternalReferences, MarketSegment, IsOpenForCharges, IsPreCheckedIn).
- `GuestModel`: `firstName`, `lastName` (Pflicht), `birthDate`, `nationalityCountryCode` (ISO 3166-1 alpha-2), `address { addressLine1, addressLine2, postalCode, city, regionCode, countryCode }`, `identificationNumber`, `identificationType` (`PassportNumber | IdNumber | … | Other`; erlaubte Werte je Land über `/types/IdentificationType/allowed-values`), außerdem E-Mail, Telefon, Firma u. v. m.
- `ReservationModel`: `adults` (Pflicht), `childrenAges`, `primaryGuest`, `additionalGuests`, `status`.

## Umsetzung (`ApaleoRegistrationWriteBack`)

1. `GET` der Reservierung (Gast-Objekte nur im Speicher).
2. Storniert/No-Show → `failed: rejected`, nichts geschrieben.
3. `replace /primaryGuest` mit dem **zusammengeführten** Objekt: unsere Felder überschreiben, alle anderen (E-Mail, Telefon, Firma, Präferenzen …) werden unverändert zurückgeschrieben.
4. `additionalGuests` nur, wenn keine vorhanden sind oder genau die zuletzt von uns geschriebenen (SHA-256-Fingerprint in `guest_registration_syncs.fingerprint`). Sonst `failed: conflict` – **nichts** wird geschrieben, ein Mensch entscheidet.
5. Idempotent: gleiche Daten → gleicher Patch; Wiederholung schadet nicht. Ein Retry bei Netzwerk/5xx/429 im Client.
6. Fehler → Codes: 401/403 `auth` (failed), 404 `not_found` (failed), 400/422 `rejected` (failed), 409 `conflict` (retry), 429 `rate_limited` (retry), 5xx/Timeout (retry).
7. Logs: nur Registrierungs-ID, Tenant, Ergebnis-Code.

Tests: `packages/integrations/src/apaleo/apaleo-registration-writeback.test.ts` (gescriptete HTTP-Antworten, keine echten Aufrufe).

## Aktivierung (noch nicht erfolgt)

1. Apaleo-Client mit Scope `reservations.manage` (der bestehende hat `reservations.read`).
2. Test gegen das Apaleo-Testobjekt „TEST“ mit einer Testreservierung – **keine echten Gästedaten**.
3. `APALEO_REGISTRATION_WRITEBACK=enabled` nur im getesteten Environment.

## Offene Punkte

- Verhalten von `replace /primaryGuest` bei eingecheckten/ausgecheckten Reservierungen im Sandbox-Test bestätigen.
- Ob `birthDate`/`identification*` in `/booking/v1` identisch zum v0-nsfw-Modell akzeptiert werden, im Test bestätigen (Write-back bleibt bis dahin aus).
- `isPreCheckedIn` nur in v0-nsfw dokumentiert – bewusst nicht genutzt.
