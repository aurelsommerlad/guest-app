# SQL-Skripte für Supabase Staging

> **Regelfall: nicht mehr manuell.** Migrationen laufen über den GitHub-Workflow
> `Database · Staging` (`.github/workflows/db-staging.yml`); das Testobjekt richtet
> derselbe Workflow mit der Option „Apaleo-Testobjekt TEST einrichten“ ein
> (`pnpm db:test-property`, führt N und M aus). Die Skripte hier bleiben als geprüftes
> Notfall-Werkzeug für den Supabase SQL Editor.

Für den Supabase SQL Editor des **Staging**-Projekts – nie Production. Keine Secrets, keine
Gästedaten. Alle Skripte prüfen ihre Voraussetzungen, laufen in einer Transaktion und
überschreiben nichts; ein zweiter Lauf ist unschädlich (L ändert nie etwas).

## Testzugang für das Apaleo-Testobjekt `TEST` (Login + Online-Check-in)

| Schritt | Skript                       | Wann                                                                 |
| ------- | ---------------------------- | -------------------------------------------------------------------- |
| 1       | `L-check-testzugang.sql`     | immer zuerst – zeigt, was fehlt                                      |
| 2       | `H-migration-0008-0009.sql`  | nur wenn `applied_migrations` < 10                                   |
| 3       | `J-migration-0010.sql`       | nur wenn `applied_migrations` < 11                                   |
| 4       | `N-testobjekt-zuordnung.sql` | nur wenn `test_property_mapped` = false oder `test_units_mapped` < 2 |
| 5       | `M-checkin-config-test.sql`  | nur wenn `checkin_config_test_run` = false                           |
| 6       | `L-check-testzugang.sql`     | zur Bestätigung                                                      |

Erwartet am Ende (L): `applied_migrations` = 11, `test_property_mapped` = true,
`test_units_mapped` = 2, `checkin_config_test_run` = true, `checkin_sync_targets` = `[]`,
`checkin_enabled_real_properties` = 0, `revoked_links_for_reservation` = 0.

- **H/J** sind die unveränderten Drizzle-Migrationen plus Eintrag in
  `drizzle.__drizzle_migrations`; ein späteres `pnpm db:migrate` überspringt sie.
- **N** legt nur das Testobjekt `test-run` (Apaleo `TEST`) mit `test-ap-1` (`TEST-ZHF`) und
  `test-ap-2` (`TEST-WEZ`) an; echte Objekte werden nicht berührt.
- **M** schaltet den Online-Check-in nur für `test-run` ein, **ohne Sync-Ziele**: Beim
  Absenden entstehen keine Sync-Zeilen, nichts geht an Apaleo oder Feratel.

## Zahlungen (Phase 12 B1)

| Schritt | Skript                      | Wann                                                  |
| ------- | --------------------------- | ----------------------------------------------------- |
| 1       | `O-migration-0011-0012.sql` | nur wenn `applied_migrations` = 11 (Voraussetzung: J) |

- **O** legt `payment_requests`, `reservation_payment_states` und `payment_audit_events` an
  (IDs, Beträge in Cent, Status, Zeitpunkte – keine Karten- oder Linkdaten), sperrt die
  Data-API und setzt die Trigger: Prüfprotokoll nur anfügbar, `cleared_at` nur einmal setzbar.
  Rein additiv, keine bestehenden Daten werden geändert. Danach `applied_migrations` = 13.

## Feratel-Meldewesen (ADR 0022, F2)

| Schritt | Skript                      | Wann                                                  |
| ------- | --------------------------- | ----------------------------------------------------- |
| 1       | `P-migration-0013-0014.sql` | nur wenn `applied_migrations` = 13 (Voraussetzung: O) |

- **P** legt `official_registration_settings`, `official_registrations`, `official_guest_cards`
  und `official_registration_events` an. Die Tabellen enthalten nur IDs, Referenzen, Status,
  Codes, Fingerprints und Zeitpunkte, keine Gästedaten. Das Skript sperrt die Data-API und setzt
  die Trigger:
  - das Protokoll kann nur ergänzt werden;
  - die Feratel-Referenz ist nur einmal setzbar;
  - jede Meldung ist an ihren Check-in gebunden;
  - Löschen ist nur per Aufbewahrungs-Purge möglich;
  - in den Einstellungen sind keine Geheimnisse erlaubt.
- Rein additiv, keine Einstellungen und keine Zeilen. Kein Objekt wird aktiviert; eine Aktivierung
  ist ohnehin nur mit `environment = 'simulated'` möglich (CHECK).
- Angewendet am 2026-11-05. Danach `applied_migrations` = 15.

Neu erzeugen (nach neuen Migrationen) mit denselben Regeln: Inhalt der Migrationsdateien
unverändert, Hash = SHA-256 der Datei, `created_at` = `when` aus `meta/_journal.json`.
