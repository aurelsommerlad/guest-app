# SQL-Skripte für Supabase Staging

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

Neu erzeugen (nach neuen Migrationen) mit denselben Regeln: Inhalt der Migrationsdateien
unverändert, Hash = SHA-256 der Datei, `created_at` = `when` aus `meta/_journal.json`.
