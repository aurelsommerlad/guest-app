# 0008 – PMS-Provider und Apaleo-Anbindung

**Status:** Akzeptiert (Phase 4)

## Kontext

Apaleo ist die Source of Truth für Reservierungen. Die Guest App soll echte Aufenthalte zeigen, ohne von Apaleo-Strukturen abhängig zu werden, und später ggf. andere PMS anbinden können. Gast-Zugang und Datenbank gibt es noch nicht.

## Entscheidung

### Schichten

```
@up/core            PmsProvider (Port), PmsReservation, PmsError
@up/integrations    ApaleoProvider (fetch + Zod), MockPmsProvider
apps/guest          Property-Registry (config/properties.ts), toStaySource(),
                    getStay() wählt die Datenquelle (mock | apaleo)
```

`getStay()` → Provider → `PmsReservation` → `toStaySource()` (Registry) → `buildStayViewModel()` → UI. Die UI kennt die Datenquelle nicht. Mock- und Apaleo-Modus gehen denselben Weg.

### Apaleo (verifiziert gegen die offizielle Dokumentation)

- **Authentifizierung:** OAuth 2.0 Client Credentials („Simple Client“)
  - Endpunkt: `POST https://identity.apaleo.com/connect/token`
  - HTTP Basic mit `clientId:clientSecret` (Base64)
  - Body `grant_type=client_credentials`
  - Der Token wird im Prozess bis kurz vor Ablauf wiederverwendet (single-flight). Nach einem 401 wird einmal ein neuer Token geholt.
- **Endpunkt:** `GET https://api.apaleo.com/booking/v1/reservations/{id}`, ohne `expand`. Gast, Property und Unit sind im Basismodell enthalten.
- **Scope:** `reservations.read`. Weitere Scopes werden nicht benötigt, weil Property-Daten (Zeitzone, Anzeige) aus der Registry kommen.
- **Validierung:** Zod. Es werden nur genutzte Felder deklariert. Alle anderen Felder (E-Mail, Telefon, Adresse, Zahlungsdaten …) werden beim Parsen verworfen.
- **Robustheit:**
  - Timeout 8 s pro Request
  - genau eine Wiederholung bei Netzwerkfehler, 429 oder 5xx (alle Aufrufe sind idempotent)
  - keine Wiederholung bei 4xx
  - Fehlerarten: `auth`, `not-found`, `timeout`, `unavailable`, `invalid-response`

### Mapping

| Apaleo (`ReservationModel`)                                 | intern                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `id`                                                        | `PmsReservation.externalId`                                                    |
| `status` (Confirmed, InHouse, CheckedOut, Canceled, NoShow) | `confirmed`, `in-house`, `checked-out`, `canceled`, `no-show`                  |
| `arrival` / `departure` (Datum + Uhrzeit mit Offset)        | geplanter Check-in / Check-out (`StaySource.reservation.checkInAt/checkOutAt`) |
| `property.id`                                               | über Registry → interne Property (Name, Ort, Zeitzone)                         |
| `unit.id` (optional)                                        | über Registry → interne Unit (Anzeigename)                                     |
| `primaryGuest.firstName` (optional)                         | Begrüßung; ohne Vorname „Hallo, …“                                             |

- **Nicht übernommen** (Datensparsamkeit): Nachname, Kontaktdaten, Adresse, Ausweis- und Zahlungsdaten, Preise, Kommentare.
- `checkInTime` / `checkOutTime` von Apaleo sind die _tatsächlichen_ Check-in- und Check-out-Zeitpunkte. Sie werden vorerst nicht benötigt.

### Property-/Unit-Zuordnung

- Zentrale, typisierte Registry (`apps/guest/src/config/properties.ts`): Apaleo-Property-ID → interne Property und Apaleo-Unit-ID → interne Unit. Die Zuordnung läuft nie über Anzeigenamen.
- **Fehlerfälle:**
  - unbekannte Property bzw. Unit, noch nicht zugewiesene Unit, stornierte oder No-Show-Reservierung → `StayMappingError`
  - die Test-Property `TEST` ist nur außerhalb von Production erlaubt
- **Migration:** Tabellen `properties`, `units`, `pms_mappings` (tenant_id, provider, external_property_id → property_id, external_unit_id → unit_id).

### Datenquelle und Umgebungen

- `STAY_DATA_SOURCE=mock` (Standard): keine externen Aufrufe. Tests und Builds laufen immer so.
- `STAY_DATA_SOURCE=apaleo`: nur local/staging, mit `APALEO_PREVIEW_RESERVATION_ID` aus der Server-Konfiguration. Es gibt keine Reservierungs-ID aus der URL und keine Suche.
- Die Env-Validierung lehnt in **production** den Apaleo-Modus und jede Preview-Reservierung ab.
- Im Apaleo-Modus wird STAY pro Request gerendert (`connection()`), nie zur Build-Zeit.

### Fehlerverhalten

- Provider- und Mapping-Fehler werden strukturiert geloggt: Datenquelle, Art bzw. Grund, Status, Dauer. Es gibt keine Secrets, Tokens, Response-Bodies oder Gastdaten im Log.
- Die UI erhält nur `StayUnavailableError`. STAY zeigt dann eine ruhige Fehlerseite mit „Erneut versuchen“ (`stay/error.tsx`).
- GUIDE ruft Apaleo nie auf und bleibt verfügbar, wenn Apaleo ausfällt.

### Ergänzung Phase 7 (Gastzugang)

- Der Port hat zusätzlich `findReservationsByBookingReference()` für den Login per Buchungsnummer. Apaleo nutzt dafür denselben Endpunkt per exakter Reservation-ID. Der Nachname wird nur für den einmaligen Vergleich gelesen. OTA-Nummern sind noch nicht implementiert, Details in [ADR 0011](0011-guest-access.md).
- Mit Session lädt STAY die Reservierung des Guest Access (`reservation_provider` + `external_reservation_id`). `STAY_DATA_SOURCE` gilt nur noch für die Preview ohne Session.

## Konsequenzen

- Ein weiteres PMS braucht nur einen neuen Adapter und Registry-Einträge für dessen Provider.
- Bis zum Gast-Zugang zeigt Production weiterhin die Mock-Daten.
- Die Registry ist Code. Neue Units erfordern bis zur Datenbank einen Commit.
