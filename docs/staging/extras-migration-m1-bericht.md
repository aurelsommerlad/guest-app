# Extras-Migration: Bericht M0 und M1

Stand: 08.11.2026 · Branch `claude/sharp-rubin-hwfdyt` · nur Entwicklung und Staging.

## Übersicht der Ergebnisse

| #   | Ergebnis                                                                               | Ort                                                                                                              |
| --- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Aktualisiertes Migrationskonzept (gemeinsamer Go-live, Rückfall)                       | `docs/concepts/extras-migration.md`                                                                              |
| 2   | Technische Bestandsaufnahme (Funktionen) + Werkzeug für die Datenbestandsaufnahme (M0) | `docs/concepts/extras-migration.md` Abschnitt 1, `docs/staging/extras-m0-export.md`                              |
| 3   | Umgesetztes und getestetes Datenmodell                                                 | Migration `packages/db/drizzle/0018_extras_migration_m1.sql`, Staging-Skript `docs/staging/V-migration-0018.sql` |
| 4   | Rollen- und Berechtigungskonzept                                                       | Abschnitt „Rollen“ unten, `packages/core/src/admin/permissions.ts`                                               |
| 5   | Import- und Abgleichsverfahren                                                         | Abschnitt „Import“ unten, `packages/db/src/extras-import/`                                                       |
| 6   | Sicherheits- und Testbericht                                                           | Abschnitte „Sicherheit“ und „Tests“ unten                                                                        |
| 7   | Umsetzungsplan M2                                                                      | Abschnitt „Plan M2“ unten                                                                                        |
| 8   | Offene Entscheidungen und Freigaben                                                    | letzter Abschnitt                                                                                                |

Go-live-Mechanik (vorbereitet, nicht aktiv): `docs/concepts/extras-go-live.md`.

## Was nicht passiert ist

- Kein Zugriff auf den produktiven Extras-KV-Store; keine Änderung an guest-services (Repository unverändert, Stand `6c5e5af`).
- Keine Apaleo-Schreibzugriffe; das Gateway hat keinen Live-Executor.
- Keine Slack-Nachrichten; keine Produktionsänderung; keine STAY-Production-Datenbank; kein Schreiber-Wechsel; keine Objektumstellung; Online-Check-in unverändert.

## Datenmodell (Migration 0018)

- **Katalog:** `offers` bleibt zentraler Eintrag; `offer_properties` trägt die Objektkonfiguration aller Extras-Felder (Apaleo-Service, Sichtbarkeit, Aktionstyp, Buchungsregel, Modus, Zusatzpersonenpreis, Preis-Einheit, Kapazität, Kennzeichen, max. 1, Apartmenttypen, Reihenfolge, Text-/Bild-Overrides, Partner-Overrides, Import-Buchhaltung).
- **Rollen:** `admin_users.role`/`property_scope`, `admin_user_properties`, `admin_invitations`.
- **Betrieb:** `property_service_settings`, `tenant_service_settings` (Schreiber), `service_bookings`/`service_booking_items`, `stay_extensions`, erweiterte `offer_requests`.
- **Nachvollziehbarkeit:** `apaleo_write_operations`, `admin_audit_events` (nur anfügbar), `notification_outbox`, `migration_runs`/`migration_items`.
- Alle neuen Tabellen: `tenant_id NOT NULL`, zusammengesetzte Fremdschlüssel, CHECKs, RLS an, Data-API-Rechte entzogen.
- **Staging:** angewendet am 08.11.2026. Schema-Fingerabdruck (Constraints, Spalten, Indizes) identisch mit der lokal getesteten Datenbank; 19 Migrationen; 0 Tabellen ohne RLS; 0 Data-API-Rechte auf den betroffenen Tabellen; der bestehende Admin ist Owner. Advisors: nur der bekannte Hinweis „RLS ohne Policy“ (beabsichtigt).
- **Migrationstests:** frische Postgres-16-Datenbank (alle 19 Migrationen + Seed), Upgrade einer 0017-Datenbank mit bestehendem Admin (→ Owner), Staging-Skript lokal inkl. Abbruch beim zweiten Lauf.

## Rollen

| Recht (Schlüssel)                             | owner | admin           | manager | viewer |
| --------------------------------------------- | ----- | --------------- | ------- | ------ |
| Inhalte lesen/bearbeiten (`content.*`)        | ✔/✔   | ✔/✔             | ✔/✔     | ✔/–    |
| Katalog lesen/bearbeiten (`catalog.*`)        | ✔/✔   | ✔/✔             | ✔/✔     | ✔/–    |
| Anfragen lesen/entscheiden (`requests.*`)     | ✔/✔   | ✔/✔             | ✔/✔     | ✔/–    |
| Buchungen ansehen (`bookings.read`)           | ✔     | ✔               | ✔       | ✔      |
| Einstellungen lesen/bearbeiten (`settings.*`) | ✔/✔   | ✔/✔             | ✔/–     | ✔/–    |
| Benutzer lesen/verwalten (`users.*`)          | ✔/✔   | ✔/✔ (nie Owner) | –       | –      |
| Import (`migration.run`)                      | ✔     | ✔               | –       | –      |
| Schreiber-Wechsel (`writer.switch`)           | ✔     | –               | –       | –      |

Regeln (eine Funktion `can()`):

- Objektbezogene Rechte nur für zugängliche Objekte.
- Mandantenweite Schreibrechte (z. B. Explore-Orte) und Benutzer, Import, Schreiber verlangen Zugriff auf alle Objekte.
- Owner sehen immer alle Objekte.
- Umsetzung im Admin:
  - jede Guide-/Explore-Aktion und -Seite prüft serverseitig;
  - die Objektauswahl zeigt nur zugängliche Objekte;
  - Team-Seite mit Einladungen (Einmal-Link, 7 Tage, nur Hash gespeichert), Rollen-/Objektänderung, Deaktivieren (beendet alle Sitzungen);
  - Schutz der letzten aktiven Inhaberin bzw. des letzten aktiven Inhabers;
  - kein Selbst-Deaktivieren;
  - Admins ändern keine Owner.
- Rollen werden bei jeder Anfrage aus der Datenbank gelesen. Erstkonto (Setup) = Owner; CLI verlangt `--role`.

## Import

- **Export (M0):** Read-only-Leser mit Befehls-Allowlist, Minimierung an der Quelle, Manifest mit SHA-256, Integritätsprüfung, anonymisierter Bericht. Produktion gesperrt bis zur Freigabe.
- **Import (M1-D):**
  - Probelauf und Übernahme mit derselben Logik (der Probelauf rollt zurück).
  - Objektzuordnung nur über `external_mappings` (sonst „übersprungen“).
  - Gleiche Service-Codes → ein Angebot mit Konfiguration je Objekt; bestehende STAY-Angebote werden verknüpft (STAY-Texte bleiben). Neue Angebote als Entwurf.
  - Konflikt statt Überschreiben, wenn eine Konfiguration nach dem letzten Import in STAY geändert wurde.
  - Vorgänge einmalig je Extras-ID, ohne Namen/E-Mails, mit Löschfrist (Standard 180 Tage nach Abreise bzw. Bestellung).
  - Benutzer → Einladungs-Kandidaten (Rolle); Bilder → vorgemerkt für M2.
- **Abgleich:** Konfiguration je Objekt/Service (übereinstimmend, abweichend mit Feldnamen, fehlend, ohne Zuordnung, nur in STAY) und Zähler je Vorgangsart. Protokoll je Lauf in der Datenbank.
- **Probelauf** (synthetische Daten, isolierte Datenbank): Probelauf ohne Änderungen → Übernahme → zweite Übernahme vollständig „unverändert“; Produktionsziel wird abgewiesen.

## Apaleo

- **Lesend:** Service-Angebote, gebuchte Services, Service-Definitionen, Unit-Groups, Reservierung mit Zeitscheiben (nur GET).
- **Schreib-Gateway:**
  - kanonischer Anfrage-Hash und Idempotenzschlüssel (Wiederholung → gespeichertes Ergebnis; gleicher Schlüssel mit anderem Inhalt → abgelehnt);
  - Datenbank-Sperrfrist mit genau einer Übernahme nach Ablauf (Ergebnis unbekannt → vor erneutem Schreiben neu lesen);
  - Richtlinien in fester Reihenfolge: Modus → Schreiber → Objekt-Freigabeliste → Reservierung gehört zum Objekt und ist buchbar;
  - Fehlercodes statt Rohantworten;
  - Protokoll in `apaleo_write_operations`.
- **Modi:** nur `disabled` (Standard) und `simulated`; jeder andere Wert, auch „live“, bedeutet `disabled`.
- **Regeln:** Extras-Buchungsregeln 1:1 portiert (`packages/core/src/booking`).

## Sicherheit

- Autorisierung jeder Admin-Aktion auf dem Server; Mandant immer aus der Sitzung, nie aus dem Formular (Tests).
- Rechteentzug wirkt sofort (Rolle je Anfrage; Deaktivieren widerruft alle Sitzungen; Tests).
- Einladungen:
  - Token mit 256 Bit, nur SHA-256 gespeichert, einmalig (gleichzeitige Annahme → genau eine gewinnt, Test);
  - Ablauf, Widerruf, neue Einladung ersetzt die alte;
  - Rate-Limit;
  - Seite mit `no-referrer`;
  - weder Token noch E-Mail im Log (Test).
- Datenbank:
  - Audit-Log nur anfügbar (UPDATE/DELETE/TRUNCATE abgewiesen);
  - Schreiberwert nur über die Go-live-Prozedur änderbar (Trigger);
  - Katalogform durch Trigger abgesichert;
  - Personendaten-Schlüssel in Audit-Details und Outbox-Payloads werden abgewiesen.
- Export: nur Lesebefehle, nur Read-only-Token, https, Dateien 0600, Produktion nur mit Flag und außerhalb des Repositorys.
- Gateway: kein Code-Pfad, der in M1 an Apaleo schreibt.

## Tests

Vollständiger Lauf am 08.11.2026: Formatprüfung, Typprüfung und Lint in allen Paketen grün.

| Paket              | Tests                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `@up/core`         | 477 (davon 160 portierte Extras-Tests, 9 Rollen-Tests)                                                                     |
| `@up/db`           | 192 (Rollen, Einladungen, Mandantentrennung, Schreiber-Sperre, Idempotenz/Parallelität, Audit, Import mehrfach, Konflikte) |
| `@up/integrations` | 89 (Gateway, Leser, Export)                                                                                                |
| `@up/admin`        | 112 (Team-Dienst, Rechte in Aktionen, Routen)                                                                              |
| `@up/guest`        | 231 (keine Regression)                                                                                                     |
| `@up/ui`           | 45                                                                                                                         |
| **Summe**          | **1146 grün**                                                                                                              |

Bekannt und nicht durch M1 verursacht: Die Design-Token-Prüfung meldet eine Rohfarbe in der E-Mail-Vorlage `packages/core/src/verification/message-text.ts:49`. Dieselbe Meldung gibt es schon auf dem Stand vor M1 (`ff748a2`).

**Bewusste Abweichungen von Extras** (zur Bestätigung):

1. Zusatzperson ohne Preis: Extras rechnet 0 € (kostenlos); STAY verweigert die Buchung.
2. Leere Rabattwerte der Verlängerung: Extras rechnet 0 %; STAY nimmt das Altfeld bzw. den Standard.
3. Aktivierung der Verlängerung nur bei exakt `true` (Extras akzeptiert auch „wahre“ Werte wie `"true"`).
4. Kennzeichen müssen Text sein.

## Plan M2 – Extras-Administration vollständig in STAY

| Schritt                              | Inhalt                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M2.1 Services & Erlebnisse – Katalog | Modul im Admin: zentrale Angebote (Texte, Bilder, Kategorie, Status) und Konfiguration je Objekt. Apaleo-Serviceliste des Objekts als Auswahl (Leser vorhanden), Unit-Groups als Auswahl, alle Felder aus Extras, Vorschau des Gastpreises mit den portierten Regeln. Rechte `catalog.*` je Objekt; Audit je Änderung. |
| M2.2 Einstellungen                   | Verlängerungsnacht je Objekt (vier Rabatte, Mindestnächte), Slack-Route; Rechte `settings.*`.                                                                                                                                                                                                                          |
| M2.3 Bilder                          | Storage-Modul `offers` (vorhandener Upload-Dienst), Import der Extras-Bilder mit Prüfsumme und Abmessungen, Zuordnung zu Angeboten.                                                                                                                                                                                    |
| M2.4 Import-Oberfläche               | Snapshot hochladen (oder Pfad), Integritätsprüfung, Probelauf, Bericht, Übernahme, Konfliktliste mit „STAY behalten“/„Extras übernehmen“; Recht `migration.run`.                                                                                                                                                       |
| M2.5 Betrieb (lesend)                | Bestellungen, Anfragen, Verlängerungen (importiert und künftig STAY) je Objekt mit Filtern; Audit-Ansicht.                                                                                                                                                                                                             |
| M2.6 Team                            | Einladungs-Kandidaten aus dem Import vorbelegen (Rolle), Versand der Links durch die einladende Person.                                                                                                                                                                                                                |
| M2.7 Abnahme                         | Import auf Staging mit echtem Export (nach M0-Freigabe), Abgleich ohne Abweichung, Admin-Abnahme. Extras bleibt Schreiber.                                                                                                                                                                                             |

Danach: M3 eigene Buchungslogik im Schattenbetrieb (Paritätsbericht), M4 Anfragen/Freigaben/Slack, M5 Generalprobe TEST, M6 gemeinsamer Go-live.

## Offene Entscheidungen und Freigaben

**Freigaben** (vor dem jeweiligen Schritt):

1. **M0:** Lesender Zugriff auf den produktiven Extras-KV-Store mit Read-only-Token (Ablauf siehe `docs/staging/extras-m0-export.md`).
2. **guest-services:** Sperre für den Go-live (Sperrwert vor jedem Schreibzugriff) – Umsetzung erst nach eurer Freigabe.
3. **STAY-Production-Datenbank:** Einrichtung und Migration (für M6).
4. **Echte Apaleo-Schreibzugriffe:** zuerst nur Apaleo TEST (M5), später Produktion beim Go-live.
5. **Slack aus STAY:** Testkanal (M4), später Produktion.
6. **Go-live-Termin** sowie Dauer der Rückfallfrist bis zur Stilllegung.

**Entscheidungen:**

1. Aufbewahrung importierter Vorgänge: Vorschlag 180 Tage nach Abreise bzw. Bestellung für operative Daten. Getrennt davon: steuerlich relevante Buchungsnachweise liegen in Apaleo.
2. Gastnamen/E-Mails: werden nicht übernommen. Bestätigen, oder Anforderungen für den Betrieb nennen (z. B. Name in der Anfragen-Liste).
3. Neue Angebote aus dem Import als Entwurf – Veröffentlichung redaktionell in M2. Bestätigen.
4. Kategorie-Zuordnung neuer Angebote (Heuristik nach Regeln/Flags) – in M2 redaktionell prüfen.
5. Abweichungen 1–4 oben bestätigen (Zusatzperson ohne Preis usw.).
6. Rückschreiben von STAY-Änderungen nach Extras im Rückfall: nötig oder nicht.
7. Gast-Benachrichtigungen (E-Mail/Push) bei Bestätigung/Ablehnung: Inhalte und Zeitpunkt (vorbereitet, aus).
8. Slack-Routen je Objekt (Namen) und wo die Webhooks hinterlegt werden.
