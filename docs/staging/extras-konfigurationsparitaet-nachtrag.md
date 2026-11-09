# Konfigurationsparität – Nachtrag vor M5

Stand: 09.11.2026 · Ergänzt [`extras-konfigurationsparitaet-bericht.md`](extras-konfigurationsparitaet-bericht.md).

Vorgaben eingehalten:

- Die Extras-App ist unverändert (nur gelesen).
- Keine Schreibzugriffe auf Extras oder Apaleo.
- M5 nicht begonnen.

## 1. Sortierreihenfolge mit Dezimalwerten

- **In Extras zulässig: ja.** Das Feld „Reihenfolge“ im Extras-Admin ist ein Zahlenfeld ohne Schrittweite. Gespeichert wird `Number(eingabe)` (`CatalogManager.jsx`), und die Admin-Route übernimmt jede endliche Zahl (`optionalNumber`). Werte wie 1,5 oder −2 sind daher speicherbar. Extras sortiert sie exakt (`compareBySortOrder`).
- **Tatsächlich verwendet: nicht feststellbar ohne M0.** Das Vergleichswerkzeug weist es je Standort aus.
- **Umsetzung in STAY:**
  - `offer_properties.sort_order` ist jetzt eine Kommazahl (Migration 0022).
  - Der Import übernimmt Dezimalwerte exakt, ohne Rundung.
  - „Ohne Reihenfolge“ liegt bei 1e9 und damit hinter jedem Extras-Wert, auch hinter 10000.
  - Der STAY-Admin nimmt „1,5“ oder „1.5“ an und zeigt den Wert mit Komma.
  - Die Gästeansicht sortiert nach demselben Wert.
- **Nachweis:**
  - Paritätsszenario S21: Die Reihenfolge ist jetzt identisch (ECI 1, PKW 1,5, LCO 2).
  - Tests: Reihenfolge 1 / 1,5 / 2 / 10000 / leer, Datenbank-Rundlauf mit 2,5, Admin-Eingaben.

## 2. Historische Anfragen

- Anfragen zu Services, die **nicht mehr im Extras-Katalog** stehen, gehen nicht mehr verloren:
  - Sie werden an ein **archiviertes Angebot** je Apaleo-Service gehängt (`extras:history_<serviceId>`).
  - Dieses Angebot ist nie veröffentlicht und hat keine Objekt-Konfiguration, blockiert also keinen späteren Katalogeintrag.
  - Es trägt den ursprünglichen Servicenamen.
- Jede Anfrage behält außerdem ihre eigenen Servicedaten:
  - Apaleo-Service-ID
  - `service_name_snapshot` (Name laut Extras)
  - Menge, gewünschte und gebuchte Daten
  - angezeigter Preis
  - Status
- Anfragen zu **inaktiven** Services werden normal übernommen und mit `history:service_inactive` markiert.
- **Nicht rekonstruierbare Angaben** stehen je Anfrage im Importbericht:

  | Code                                                    | Bedeutung                                    |
  | ------------------------------------------------------- | -------------------------------------------- |
  | `history:service_removed_archived_offer`                | Service nicht mehr im Katalog                |
  | `history:service_name_missing`                          | kein Servicename gespeichert                 |
  | `history:service_id_missing`                            | keine Apaleo-Service-ID                      |
  | `history:decision_time_missing`                         | entschieden, aber ohne Zeitpunkt             |
  | `history:departure_missing_retention_from_created`      | keine Abreise; Aufbewahrungsfrist ab Eingang |
  | `history:requested_dates_missing`                       | keine gewünschten Daten                      |
  | `history:quantity_missing`, `history:quantity_adjusted` | Menge fehlte oder lag außerhalb von 1–50     |
  | `history:price_missing`                                 | kein Preis                                   |

  Gastname und E-Mail werden bewusst nicht übernommen.

- Weiterhin übersprungen und gemeldet werden nur:
  - Datensätze ohne ID oder mit unbekanntem Status (`invalid_record`)
  - Datensätze ohne Reservierung (`missing_reservation`)
  - Datensätze, deren Standort nicht zugeordnet ist (`property_not_mapped`)

  Das Vergleichswerkzeug listet auch diese Fälle vor dem Import.

## 3. Entscheidungszeitpunkte

- `approvedAt` und `rejectedAt` aus Extras werden in `offer_requests.handled_at` übernommen.
- Bearbeiter ist `handled_by_external = "Extras (migriert)"`. Es wird **kein künstlicher STAY-Admin** angelegt; Extras speichert ohnehin nicht, wer entschieden hat.
- Die Datenbank erzwingt:
  - entweder STAY-Admin **oder** externer Bearbeiter, nie beides;
  - ein Zeitpunkt nur zusammen mit einem Bearbeiter.
- Fehlt der Zeitpunkt in Extras, wird keiner erfunden (Meldung `history:decision_time_missing`).
- Eine spätere Entscheidung in Extras wird beim erneuten Import mit Zeitpunkt nachgeführt.
- Der Admin zeigt „Entschieden“, „Entschieden in: Extras (migriert)“ und „Service laut Extras“.

## 4. Tests

| Bereich             | Neu                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reihenfolge         | exakte Dezimalwerte, Extras-Reihenfolge 1 / 1,5 / 2 / 10000 / leer, Begrenzung bei ±1e9, Admin-Eingabe mit Komma und Punkt, ungültige Eingaben                        |
| Historie            | entfernter Service → archiviertes Angebot mit Originalname; zweite Anfrage nutzt dasselbe Angebot; inaktiver Service; fehlender Name, Zeitpunkt und Menge gemeldet    |
| Entscheidungen      | Zeitpunkt und externer Bearbeiter übernommen; spätere Entscheidung nachgeführt; dritter Import unverändert; Datenbank lehnt Admin und externen Bearbeiter zusammen ab |
| Wiederholter Import | keine neuen Datensätze, kein zweites Archiv-Angebot                                                                                                                   |
| Datenbank-Rundlauf  | alle drei Fälle gegen echte Postgres-Instanz (PGlite)                                                                                                                 |

Alle Pakete: Typecheck, Lint und Tests grün:

| Paket        | Tests            |
| ------------ | ---------------- |
| core         | 502              |
| db           | 316 (vorher 312) |
| integrations | 91               |
| shadow       | 34               |
| admin        | 135 (vorher 132) |
| guest        | 241              |
| ui           | 45               |

## 5. M0 – tatsächlicher Konfigurationsabgleich

**Weiterhin nicht möglich.** `KV_REST_API_URL` und `KV_REST_API_READ_ONLY_TOKEN` sind in dieser Ausführungsumgebung nicht vorhanden (geprüft am 09.11.2026, 0 von 2). Es wurde kein anderer Zugang verwendet.

Die folgenden Angaben des geforderten Berichts sind deshalb **offen und nicht geschätzt**. Das Werkzeug liefert jede davon automatisch, sobald der Export läuft:

| Angabe                            | Quelle im Werkzeug (`extras:config-parity`)                                         |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| Anzahl der Standorte und Services | `properties[]`, `services[]`                                                        |
| Vollständigkeit der Einstellungen | `summary` (Identisch / Bewusst abweichend / Fehlt / Fehlerhaft / Nicht verifiziert) |
| Tatsächliche Sonderwerte          | `affected.p1`, `affected.p2`, `affected.extensionEffect`, Felder mit `reason`       |
| Nicht migrierbare Felder          | Kategorie „Fehlerhaft“/„Fehlt“, `unknownFields`                                     |
| Konflikte                         | Trockenlauf `extras:import` (Aktion `conflict`)                                     |
| Fehlende Bilder                   | `images.issues`, `images.external`                                                  |
| Anfragen mit Importproblemen      | `operations.requestIssues`                                                          |

Ablauf, sobald die beiden Werte in den Umgebungseinstellungen hinterlegt sind:

1. Export (nur lesend):

   ```
   pnpm --filter @up/admin extras:export --source kv --confirm-production-read --out <außerhalb des Repos>
   ```

2. Vergleich:

   ```
   pnpm --filter @up/admin extras:config-parity --snapshot … --manifest … --json … --md …
   ```

3. Trockenlauf des Imports auf einer lokalen Testdatenbank für die Konflikte.

4. Kompakter Bericht mit den echten Zahlen. Die Exportdateien werden nicht eingecheckt.

Beispielausgabe (synthetisch, kein Nachweis): [`konfigurationsparitaet-synthetisch.md`](konfigurationsparitaet-synthetisch.md). Sie enthält jetzt auch Anfragen mit Importproblemen.

## 6. Konkrete Maßnahmen vor M5

1. **Read-only-Zugang hinterlegen:** `KV_REST_API_URL` und `KV_REST_API_READ_ONLY_TOKEN` in den Umgebungseinstellungen, danach eine neue Sitzung starten.
2. **M0-Export und Konfigurationsabgleich** aller Standorte ausführen; Bericht mit echten Zahlen abnehmen.
3. **Entscheidungen**, falls M0 sie zeigt:
   - Rabatte mit Nachkommastelle, über 90 % oder negativ (K-6)
   - Mindestbelegung über 30
   - Zusatzpersonen ohne Preis (P-2: Preis eintragen oder gesperrt lassen)
   - Wahrheitswerte als Text (P-1)
4. **Bilder:** externe Bild-URLs und nicht lesbare Bilder vor dem Go-live in STAY hochladen.
5. **Slack:** Ziel festlegen, ein gemeinsamer Kanal wie heute (`--slack-route`) oder je Standort.
6. **Migrationen** 0019–0022 sind für das Staging der M5-Generalprobe vorgesehen; noch nicht ausgeführt.
