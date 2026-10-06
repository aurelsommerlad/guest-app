# 0016 – Guest Journey, Online-Check-in und Registrierungs-Sync

**Status:** Akzeptiert (2026-10-06, Phase 11). Ergänzt [ADR 0003](0003-provider-integrations.md), [ADR 0011](0011-guest-access.md), [ADR 0012](0012-guest-context.md). Zugang: [ADR 0017](0017-provider-neutral-access.md).

## Kontext

STAY zeigte bisher nur Phase (vor/während/nach dem Aufenthalt) und Check-out. Der Online-Check-in soll die **zentrale Quelle der Gästedaten** werden: Daten, die der Gast einmal eingibt, gehen an das PMS (Apaleo) und an die Gästemeldung (Feratel bei HŪSLE/ΛLPILΛ in Österreich, je nach Gemeinde weitere). Zugang (Türcode, Schlüsselbox) und Registrierung hängen fachlich zusammen, dürfen technisch aber nicht verklebt werden.

### Vorhandenes System (Analyse) und Wiederverwendung

| Baustein                                                                                          | Wiederverwendet für                                                                           |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Guest Context (`resolveGuestContext`, ADR 0012)                                                   | einzige Quelle für Tenant, Objekt, Unit, Reservierung – auch für Check-in und Zugang          |
| Gastsession (`guest_access`, `guest_sessions`, ADR 0011)                                          | Autorisierung: Registrierung = Reservierung der Session, nie eine ID aus dem Browser          |
| `PmsProvider` / `ApaleoProvider` / `ApaleoClient`                                                 | Reservierung lesen (jetzt mit Personenzahl), Write-back über denselben Client (PATCH ergänzt) |
| `deriveStayPhase`                                                                                 | bleibt für Sichtbarkeit (ADR 0005); neue Journey-Phasen auf Basis lokaler Tage zusätzlich     |
| STAY-View-Model (`buildStayViewModel`), `InfoTile`, Karten, Bottom-Navigation                     | Design unverändert; Status-Kachel und Zugangspanel lesen die Journey                          |
| Repository-Muster GUIDE/EXPLORE (TenantContext, Composite-FKs, RLS ohne Policies, Lock-Migration) | alle neuen Tabellen                                                                           |
| `hitRateLimit` (Postgres), Logger mit Redaction, `safe-error`                                     | Rate-Limits für Check-in/Code-Anzeige; Redaction um Melde- und Zugangsfelder erweitert        |
| Admin-Property-Kontext, Modul-Registry                                                            | später Diagnoseansichten – Datenmodell ist vorbereitet, keine Fake-Ansicht gebaut             |
| Extras-Karte (STAY) → `/extras`                                                                   | bleibt; `/extras` verlinkt die separate App über `EXTRAS_APP_URL` ohne Reservierungsdaten     |

Keine Parallelarchitektur: kein zweiter Kontext, kein zweiter PMS-Client, keine eigene Session.

## Entscheidung

### 1. Guest Journey (`@up/core/journey`)

Drei getrennte Achsen, jeweils abgeleitet und nie gespeichert:

- **Zeitphase** `before-arrival | arrival-day | in-stay | departure-day | after-departure` – aus Check-in/Check-out und der **Zeitzone des Objekts** (lokale Kalendertage; ein Tagesaufenthalt ist bis zum Check-in Anreisetag, danach Abreisetag).
- **Registrierungsfortschritt** `not-required | not-started | in-progress | completed` – nur unser kanonischer Datensatz, unabhängig von Provider-Syncs.
- **Zugangsstatus** `available | pending | manual` – aus `getAccessForStay` (ADR 0017).

Die primäre Aktion auf STAY (`online-check-in | check-in-info | show-access | check-out | none`) ist eine reine Funktion dieser drei Werte. Der vorgeschlagene Einzel-Enum wurde bewusst nicht übernommen: Er hätte Zeit, Prozess und Zugang vermischt. Spätere Automationen (Erinnerung „Check-in fehlt“, Code-Freigabe, Check-out-Hinweis) hängen sich an dieselben abgeleiteten Werte.

### 2. Kanonisches Registrierungsmodell

Eigenes, provider-neutrales Modell (`@up/core/registration`). Felder: `firstName`, `lastName`, `email`, `phone`, `birthDate`, `nationality` (ISO 3166-1 alpha-2), `street`, `postalCode`, `city`, `country`, `documentType`, `documentNumber`. Kein Freitext. Kontaktdaten (Migration `0010`): siehe Abschnitt 4a. Ausweisdaten nur, wenn ein Objekt sie konfiguriert. Feratel- oder Apaleo-Feldnamen kommen im Modell nicht vor; Mapping nur im Adapter.

Tabellen (Migration `0008`, Lock `0009`):

- `guest_registrations` – eine pro Reservierung (`UNIQUE (tenant_id, reservation_provider, external_reservation_id)`), `status draft|submitted`, `guest_count` + Quelle (`reservation` oder `guest`), Aufenthaltsfenster, `submitted_at`, `purge_after`, `purged_at`, `version` (optimistische Sperre).
- `guest_registration_guests` – Reisende, Position 0 = Hauptgast (Check: Position 0 ⇔ Rolle `primary`), nur konfigurierte Felder gefüllt, Längen- und Formatchecks.
- `guest_registration_syncs` – eine Zeile pro Registrierung und Ziel (`UNIQUE (registration_id, provider)`): `status pending|processing|synced|failed|retry_required`, `attempts`, `last_attempt_at`, `next_attempt_at`, `last_error_code` (feste Codes), `external_reference`, `fingerprint` (SHA-256), `synced_at`. **Keine Provider-Responses, keine Gästedaten.**
- `property_journey_settings` – je Objekt zwei getrennte, per Zod validierte Dokumente: `registration` und `access` (ADR 0017).

Alle Fremdschlüssel enthalten `tenant_id`; RLS aktiv ohne Policies; `anon`/`authenticated` ohne Rechte.

### 3. Konfiguration pro Objekt

`PropertyRegistrationConfig`: `enabled`, `country`, `targets` (`apaleo`, `feratel`), `primaryGuest`/`companions` (`required`/`optional`), `children` (`underAge` + eigene Regeln, Alter am Anreisetag), `guestCardRelevant`, `providerSettings` (nur nicht geheime Werte, z. B. ein Feratel-Destinationsschlüssel – Zugangsdaten nie hier), `retentionDaysAfterDeparture`. Vor- und Nachname sind immer Pflicht. Ohne Datensatz ist der Online-Check-in **aus**.

Bewusst **keine** Standardkonfiguration für HØV/LÆKE (DE) oder HŪSLE/ΛLPILΛ (AT): Welche Felder rechtlich nötig sind, bestätigt der Betrieb je Objekt bzw. Gemeinde; die Lösung erfindet keine Pflichtfelder. Kurtaxe ist nicht Teil von Phase 11 (Konfiguration additiv erweiterbar).

### 4. Ablauf in der Guest App

`/check-in` → Schritte `trip` (Deine Reise) · `guests` (Hauptgast + Mitreisende in einem Schritt) · `address` (Meldedaten des Hauptgasts) · `review` (Prüfen & absenden). Keine Adressfelder → kein Meldedaten-Schritt. Die alten URLs `/check-in/primary` und `/check-in/companions` leiten auf `/check-in/guests` um. Die Personenzahl kommt **immer** aus der Reservierung (Abschnitt 4a); der Gast wird nie danach gefragt.

- Server Actions (Next.js prüft Origin → CSRF-Schutz), Formulare funktionieren ohne JavaScript.
- Jeder Schritt speichert: gültige Werte werden behalten, fehlende Pflichtangaben gemeldet; ungültige Werte speichern nichts. Fortsetzen über STAY („Weiter ausfüllen · Noch n Schritte“).
- Nur konfigurierte Felder werden angenommen; alles andere wird verworfen.
- Absenden ist idempotent (Statuswechsel einmal, Sync-Zeilen einmal pro Ziel). Danach unveränderlich für den Gast.
- Der Gast sieht **nie** einen Provider-Status. Ein Ausfall von Apaleo/Feratel erzeugt keine Meldung „Check-in fehlgeschlagen“ – der Check-in ist mit dem kanonischen Datensatz abgeschlossen.
- Rate-Limit: 60 Schreibvorgänge je Reservierung und 15 Minuten.

### 4a. Vorbefüllung, Kontaktdaten und Belegung (Phase 11.2)

**Belegung = Quelle der Wahrheit.** `PmsProvider.getReservationGuests()` liefert `occupancy {adults, children, childrenAges?}` (Apaleo: `adults`, `childrenAges`) und die bekannten Gäste. Der Check-in legt genau `adults + children` Personen an (Position 0 = Hauptgast). Ohne bekannte Belegung ist der Check-in nicht verfügbar (`occupancy-unknown`) – keine Rückfrage beim Gast.

**Vorbefüllung** (`prefillGuests`, `@up/core`): Index 0 = `primaryGuest`, danach `additionalGuests` in PMS-Reihenfolge. Übernommen werden nur Felder, die das Objekt erhebt, und nur plausible Werte (dieselbe Normalisierung wie bei Gasteingaben; Unplausibles wird verworfen und erfragt). Unbekannte Personen bleiben leer. `booker` wird bewusst **nicht** verwendet (kann eine Agentur sein). Ein PMS-Ausfall bedeutet nur „keine Vorbefüllung“. Geschrieben wird einmalig per `seedRegistrationGuests` (`ON CONFLICT DO NOTHING`, nur Entwurf) – Gasteingaben werden nie überschrieben.

**Pflichtfelder unabhängig von der Objektkonfiguration** (`ROLE_MANDATORY_FIELDS`): Hauptgast Vor-/Nachname, **echte E-Mail**, **Mobilnummer**; Mitreisende Vor-/Nachname, **Mobilnummer** – keine E-Mail.

**Relay-E-Mails:** `isRelayEmail`/`usableContactEmail` (`@up/core`, `contact/email.ts`) erkennen positiv bekannte Weiterleitungsadressen (heute `guest.booking.com` inkl. Subdomains; Liste `RELAY_EMAIL_DOMAINS` erweiterbar). Sie werden nicht vorbefüllt, bei Eingabe abgelehnt (`relay-email`) und per DB-Check `guest_registration_guests_email_valid` ausgeschlossen. Andere OTA-Adressen werden nicht pauschal verworfen.

**Telefon:** `libphonenumber-js` (MIT, offline, keine externe API). Eingabe = Ländervorwahl + Nummer; „+“/„00“ in der Nummer gewinnt. Gespeichert wird E.164 (DB-Check `^\+[1-9][0-9]{6,14}$`). Festnetz/Sondernummern werden als `not-mobile` abgelehnt; Typen, die die Metadaten nicht unterscheiden können (`FIXED_LINE_OR_MOBILE`), werden angenommen. Ländervorschlag beim Vorbefüllen: Land bzw. Staatsangehörigkeit der Person. Die Metadaten liegen nur serverseitig bzw. im Unterpfad `@up/core/phone`; `@up/core` ist `sideEffects: false`, damit Client-Bundles sie nicht mitladen.

**Herkunft (A/B/C):** A = PMS-Daten (`guest_registration_guests.prefilled_fields`, ein Feld bleibt „aus PMS“ nur solange sein Wert unverändert ist), B = vom Gast ergänzt/geändert (alle übrigen Felder), C = zu übertragen: die kanonische Registrierung nach dem Absenden, nur über die Sync-Schicht – Apaleo nur bei `APALEO_REGISTRATION_WRITEBACK=enabled`, Feratel ist ein Skelett und sendet nichts.

**Belegungsänderung:** Ändert sich die Belegung eines Entwurfs, setzt `syncRegistrationOccupancy` die neue Personenzahl, `guest_count_changed_at` und erhöht die Version (offene Formulare bekommen einen Konflikt statt still falscher Daten). Der Gast sieht einen Hinweis im Gäste-Schritt; neue Personen werden ggf. vorbefüllt. Überzählige Personen bleiben bis zum Absenden erhalten (keine Datenverluste bei Rückänderung) und werden erst dann entfernt. Abgesendete Registrierungen bleiben unverändert; eine spätere Abweichung zeigt STAY im Abschluss-Hinweis. Keine Merge-Engine.

### 5. Sync-Schicht

`GuestRegistrationProvider.submit(submission, memory) → SyncOutcome` (`synced | retry | failed` + Code). Der Worker (`processRegistrationSyncs`) beansprucht fällige Zeilen atomar (`FOR UPDATE SKIP LOCKED`, Lease 5 Minuten für abgestürzte Läufe), ruft den Provider, schreibt das Ergebnis mit Backoff (1 min, 5 min, 15 min, 1 h, 3 h, 6 h; nach 8 Versuchen `failed` für einen Menschen). Er läuft nach dem Absenden im Hintergrund (`after()`) und periodisch über `GET /api/registration-sync` (Bearer `CRON_SECRET`). Nur **aktivierte und implementierte** Ziele werden aufgerufen; alle anderen Sync-Zeilen bleiben sichtbar `pending` – nichts geht verloren.

**Datenfluss 1 – PMS-Write-back:** Guest App → `guest_registrations` (+ Gäste) → Sync-Zeile `apaleo` → `ApaleoRegistrationWriteBack` → `PATCH /booking/v1/reservations/{id}`. Details und Quellen: [Apaleo-Write-back](../integrations/apaleo-registration-writeback.md). Standardmäßig **aus** (`APALEO_REGISTRATION_WRITEBACK=disabled`).

**Datenfluss 2 – Gästemeldung:** Guest App → `guest_registrations` → Sync-Zeile `feratel` → `FeratelRegistrationProvider` (**Skelett**, sendet nichts) → später Feratel-Meldeschnittstelle. Offene Anforderungen: [Feratel](../integrations/feratel-guest-registration.md).

### 6. Datenschutz

Datenminimierung über die Konfiguration (plus die Kontaktdaten aus 4a); keine Pass-/Ausweisdaten ohne Konfiguration; keine personenbezogenen Daten in Logs (Logger-Redaction um Geburtsdatum, Staatsangehörigkeit, Adresse, Dokument, PIN/Code erweitert; geloggt werden nur IDs, Schritte, Codes). Aufbewahrung vorbereitet: `purge_after` = Abreise + `retentionDaysAfterDeparture`; `purgeExpiredRegistrationData` löscht die Gästezeilen und behält Status/Sync-Metadaten. Die Frist muss je Land bestätigt werden – ohne Konfiguration wird nichts automatisch gelöscht.

### 7. Extras

Extras bleibt eine eigene App. `/extras` verlinkt sie über `EXTRAS_APP_URL` (`rel="noopener noreferrer"`, kein Referrer) **ohne** Reservierungs- oder Gästedaten in der URL. Vorschlag für eine spätere sichere Übergabe: kurzlebiges, einmal verwendbares, signiertes Token (Audience `extras`, ≤ 5 min, nur Tenant/Reservierungs-Referenz serverseitig auflösbar, per POST oder Fragment übergeben, serverseitiger Austausch gegen eine Extras-Session). Nicht gebaut, bis die Extras-App eine Gegenstelle anbietet.

### 8. Admin

Kein Admin-UI in Phase 11 (keine Fake-Kennzahlen). Das Datenmodell trägt spätere Ansichten: Registrierungsstatus je Reservierung, Sync-Status je Ziel inkl. Fehlercode und Versuche, Zugangsmodus je Objekt. `saveJourneySettings`/`setUnitAccessCode` sind die Repository-Schnittstellen für die spätere Pflege.

## Konsequenzen

- Gästedaten existieren einmal, kanonisch; neue Ziele brauchen nur einen Adapter und einen Eintrag in `REGISTRATION_TARGETS`.
- Feratel ist erst nutzbar, wenn die offizielle Schnittstelle, Zugangsdaten und eine Testumgebung vorliegen.
- Der Online-Check-in ist pro Objekt erst aktiv, wenn dessen Konfiguration gepflegt ist (heute per SQL/Repository, später Admin).
