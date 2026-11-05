# 0022 – Direkte Feratel-Anbindung: elektronische Gästemeldung und digitale Gästekarten

**Status:** Akzeptiert für die Umsetzung in Phasen (2026-11-05).

- **F0 und F1 sind umgesetzt.** F1 läuft nur mit simulierten Antworten.
- **F2 ist umgesetzt** (Datenbank, nur Staging).
- F3 und alle weiteren Phasen brauchen eine eigene Freigabe.

Ergänzt [ADR 0016](0016-guest-journey-and-online-check-in.md) (Registrierungs-Sync) und [ADR 0021](0021-check-in-validation-and-billing-address.md) (Bestätigungen, Meldevorlagen). Recherche und Fragen: [docs/integrations/feratel-guest-registration.md](../integrations/feratel-guest-registration.md) und [Anfrage an feratel](../integrations/feratel-anfrage-visitor-registration-interface.md).

## Kontext

Die Meldedaten aus dem Online-Check-in sollen automatisch an das feratel-Meldewesen gehen. Die Gäste sollen ihre digitalen Gästekarten automatisch erhalten. Betroffen sind:

| Objekt | Standort           | Meldewesen                     |
| ------ | ------------------ | ------------------------------ |
| ΛLPILΛ | Gaschurn, Montafon | feratel                        |
| HŪSLE  | Bludenz            | feratel                        |
| LÆKE   | Lindau             | System offen: feratel oder AVS |

HØV braucht keine Übertragung.

Öffentlich belegt ist:

- Es gibt ein „Visitor Registration Interface“ (Deskline 3.0) für Hotelprogramme.
- Die Gemeinden vergeben „Mapping Codes“, und Hotelprogramme werden von feratel abgenommen.
- In Vorarlberg gilt:
  - Eine **Voranmeldung** ist änderbar und löschbar.
  - Ein **Meldeschein** ist verbindlich und nicht mehr änderbar.
  - Alle Gäste einer Meldung haben dieselben Reisedaten.
  - Liegt eine Gast-E-Mail vor, versendet das System den Link zur digitalen Gästekarte automatisch.

**Nicht** öffentlich belegt sind Endpunkte, Nachrichtenformate, Authentifizierung, Testumgebung und Rückgabewerte. Die Dokumentation unter `interfaces.deskline.net` ist aus der Cloud-Umgebung nicht erreichbar.

## Entscheidung

1. **Eigene, direkte Anbindung.** Es gibt keinen Drittanbieter. Apaleo hat nach unserer Recherche keine Feratel-Anbindung.
2. **Neues, providerneutrales Meldemodell** in `@up/core` (`official-registration/`). Der bestehende Registrierungs-Sync (ADR 0016) und `FeratelRegistrationProvider` bleiben **unverändert und inaktiv**.
3. **Zwei getrennte Spuren je Reservierung und Ziel:**
   - **Meldung:**
     - Stufe beim Ziel: `none`, `pre-registered`, `registered`, `checked-out`, `cancelled`.
     - Status für das Team: `pending` (ausstehend), `transmitted` (übertragen), `confirmed` (bestätigt, mit Referenz des Ziels), `failed` (Fehler), `manual` (manuelle Bearbeitung).
   - **Gästekarte:** `not-applicable`, `waiting`, `requested`, `issued`, `delivered`, `failed`, `manual`.
   - Eine Spur ändert nie die andere.
4. **Lebenszyklus** (`planOfficialRegistration`, eine Operation pro Lauf):
   - Vor der Anreise wird eine Voranmeldung angelegt (falls unterstützt). Bei Änderungen wird sie aktualisiert.
   - Am Anreisetag wird sie in einen verbindlichen Meldeschein umgewandelt. Ohne Voranmeldung wird der Meldeschein an diesem Tag direkt angelegt.
   - Während des Aufenthalts ist nur eine Änderung der Abreise erlaubt, und nur wenn sie dokumentiert unterstützt wird.
   - Nach der Abreise, oder wenn Apaleo „checked-out“ meldet, folgt die Abmeldung.
   - **Stornierung bzw. No-Show in Apaleo:**
     - Eine Voranmeldung wird gelöscht.
     - Ein verbindlicher Meldeschein wird storniert, wenn das dokumentiert ist; sonst übernimmt das Team.
   - Jede andere Änderung an einem verbindlichen Meldeschein übernimmt das Team (`registration-immutable`).
5. **Fähigkeiten statt Annahmen.** Jede Operation hat ein Flag in `ProviderCapabilities`. `FERATEL_DOCUMENTED_CAPABILITIES` ist komplett `false`, bis die offizielle Dokumentation vorliegt. Mit dem echten Adapter wird also nichts gesendet, sondern alles geht an das Team (`not-supported`). Nur die Simulation setzt Flags auf `true`.
6. **Freigabeschranke (Gate):** Gemeldet wird nur, wenn alle Bedingungen gelten:
   - Der globale Modus (`disabled`/`simulated`) passt zur Umgebung des Objekts.
   - Das Objekt ist freigeschaltet und ein **Testobjekt**.
   - Die Registrierung ist abgesendet.
   - Der Check-in ist vollständig: Daten, verantwortliche Person ≥ 18, E-Mail bestätigt oder freigestellt (ADR 0021).

   Die Modi `test` und `production` sind in F1 **nicht konfigurierbar**: Das Schema lehnt sie ab.

7. **Wann Änderungen erkannt werden:**
   - Die Aufenthaltsdaten kommen bei jedem Lauf neu aus Apaleo (`stayFactsFromReservation`). Maßgeblich sind die lokalen Daten in der Zeitzone des Objekts.
   - Ein Fingerprint der Nutzdaten zeigt, ob sich etwas geändert hat.
   - Ein zweiter Fingerprint ohne Reisedaten trennt „nur die Abreise hat sich geändert“ von „die Gästedaten haben sich geändert“.
8. **Idempotenz und doppelte Meldungen:**
   - Jede Operation bekommt einen Schlüssel: `sha256(Registrierung | Operation | Fingerprint)`.
   - Die eigene Referenz ist `up-<registrationId>` und enthält keine personenbezogenen Daten.
   - Ein **anlegender** Aufruf mit unklarem Ausgang (Zeitüberschreitung, Absturz) wird **nicht wiederholt**:
     - Er wird als `unresolved` gemerkt.
     - Danach folgt ein Abgleich per Referenzabfrage (falls unterstützt), sonst übernimmt das Team.
     - „Erneut übertragen“ ist erst möglich, wenn der unklare Fall aufgelöst ist.
9. **Fehler und Wiederholungen:**
   - Vorübergehende Fehler werden mit dem vorhandenen Backoff wiederholt (1 min bis 6 h, höchstens 8 Versuche, danach `failed`).
   - Abgelehnte Daten und Rechtefehler führen sofort zu `failed`.
   - Nicht unterstützte Operationen führen zu `manual`.
10. **Datenminimierung:**
    - Übertragen werden nur die Meldefelder der Reisenden und die _bestätigte_ E-Mail des Hauptgasts (für die Gästekarte).
    - Keine Telefonnummern.
    - Kinder werden über das Alter am Anreisetag markiert.
11. **Protokoll:**
    - Pro Vorgang wird festgehalten: Zeitpunkt, Operation, Ergebnis, Fehlercode, Versuch, Idempotenzschlüssel, Akteur (System oder Admin-ID) und die Stufe bzw. der Status danach.
    - Personenbezogene Daten und Antworttexte des Ziels werden nie protokolliert. Logs enthalten nur IDs und Codes.
12. **Admin-Aktionen** (`requestRetry`, `resolveManually`, `updateGuestCard`):
    - Erneut übertragen ist nur aus `failed` oder `manual` möglich.
    - Bei einer manuellen Erledigung (z. B. im Webclient) werden Stufe und optional eine Referenz erfasst.
    - Alle Aktionen werden mit Admin-ID protokolliert.

## Umsetzung F0 (2026-11-05)

- [Anfrage an feratel](../integrations/feratel-anfrage-visitor-registration-interface.md) ist versandfertig. Sie fragt nach:
  - Dokumentation, Testzugang, Mapping-Codes, Freigabeprozess und Kosten;
  - Voranmeldung, Meldeschein, Änderungen, Abmeldung, Storno, Referenzabfrage;
  - Gästekarten und Datenschutz.

  Dazu gibt es Kurzanfragen an Montafon Tourismus bzw. die Gemeinde Gaschurn, an Alpenregion Bludenz Tourismus bzw. die Stadt Bludenz und an die Stadt Lindau.

## Umsetzung F1 (2026-11-05, nur simuliert)

- `packages/core/src/official-registration/`:
  - `model.ts`: Stufen, Status, Gästekarte, Operationen, Fähigkeiten, Zustand, Protokoll
  - `stay-facts.ts`: Apaleo-Reservierung → lokale Daten, Storno und No-Show
  - `payload.ts`: Nutzdaten, Fingerprints, Idempotenzschlüssel
  - `gate.ts`: Freigabeschranke
  - `planner.ts`: nächster Schritt
  - `outcome.ts`: Ergebnis anwenden, Backoff, Unklarheit
  - `provider.ts`: Port
  - `admin-actions.ts`: Aktionen des Teams
  - `run.ts`: ein Lauf mit Planen, Ausführen und Anwenden
- `packages/integrations/src/feratel/`:
  - `feratel-transport.ts`: Port, **ohne** Endpunkte oder Formate
  - `feratel-capabilities.ts`: dokumentierte Fähigkeiten, derzeit keine
  - `feratel-official-registration-provider.ts`: eigener Adapter, akzeptiert nur den simulierten Transport
  - `simulated-feratel-transport.ts`: In-Memory-Simulation mit steuerbaren Fehlern

  Diese Teile sind nicht an Apps, Cron oder Datenbank angebunden.

## Umsetzung F2 (2026-11-05, Staging)

- **Migrationen:**
  - `0013_official_registrations` (generiert).
  - `0014_lock_and_audit_official_registrations` (eigene Migration mit Revoke und Triggern).
  - Getestet lokal mit PGlite und Postgres 16, sowohl frisch als auch als Upgrade von 13 Migrationen. Danach nur auf Staging angewendet (`docs/staging/P-migration-0013-0014.sql`).
- **`official_registration_settings`** (je Mandant, Objekt und Ziel):
  - Felder: `enabled`, `environment`, Zeitpunkt der verbindlichen Meldung (`binding_registration_rule` mit Anreisetag oder N Tage vorher), Vorlauf der Voranmeldung, `allowed_operations`, Gästekarte, Kinderalter, nicht geheime Provider-Werte, Aufbewahrungsfristen.
  - CHECK: `enabled` ⇒ `environment = 'simulated'`.
  - Ein Trigger lehnt geheimnisartige Schlüssel ab.
- **`official_registrations`** (je Check-in und Ziel):
  - Eindeutig je Check-in und Ziel und je Reservierung und Ziel.
  - `our_reference = 'up-' || registration_id`; die Feratel-Referenz ist eindeutig und nur einmal setzbar.
  - Unklare Anlage-Aufrufe werden gespeichert, dazu die Worker-Lease und die optimistische Versionierung.
  - Ein Trigger bindet die Zeile an Mandant, Objekt und Apaleo-Reservierung des Check-ins. Diese Identität ist unveränderlich.
- **`official_guest_cards`**: eigener Gästekartenstatus mit Kanal, Referenz und Anzahl.
- **`official_registration_events`**:
  - Nur Anhängen, ohne Freitext und ohne personenbezogene Daten.
  - Akteur ist das System oder ein Admin (mit Admin-ID).
  - Pro Check-in hat eine Anlage-Operation mit demselben Idempotenzschlüssel höchstens einmal Erfolg (partieller Unique-Index).
- **Aufbewahrung:** Gelöscht wird nur durch `purgeOfficialRegistrationData` mit `SET LOCAL up.official_retention_purge = 'on'`, und nur Zeilen mit abgelaufenem `purge_after`. Die Fristen kommen aus den Einstellungen; ohne Frist wird nichts gelöscht.
- **Bestehende Check-ins:** Sie lassen sich nicht löschen, solange ein Meldestatus existiert (`ON DELETE RESTRICT`), damit der Dublettenschutz nicht verloren geht. Bestehende Tabellen und Abläufe sind unverändert.
- **Core:**
  - `settings.ts` mit `bindingRegistrationDate`, `preRegistrationOpensOn` und `effectiveCapabilities` (dokumentiert ∩ für den Standort bestätigt).
  - Der Planer nutzt den konfigurierten Meldetag statt fest den Anreisetag.
- **Repository** `official-registration-repository.ts`:
  - Einstellungen lesen und speichern;
  - Meldestatus genau einmal anlegen;
  - Zustand und Protokoll atomar speichern;
  - fällige Zeilen nur aktivierter Objekte per Lease abholen;
  - Listen lesen;
  - Purge.

  Es ist an keine App und keinen Cron angebunden.

## Konsequenzen

- Die Meldelogik ist vollständig testbar, ohne dass Daten das System verlassen.
- F4 muss nur den Transport nach offizieller Doku schreiben und die Fähigkeiten setzen. Planer, Gate, Idempotenz und Protokoll bleiben gleich.
- Wenn Lindau AVS nutzt, kommt ein zweiter Adapter hinter denselben Port.
- Persistenz (Tabellen für Zustand, Protokoll und Gästekarte) folgt in F2. Bis dahin entsteht keine Meldung, auch nicht simuliert, in Staging oder Produktion.

## Abgleich mit den VT PMS Web Services (2026-11-05)

Grundlage: [Analyse](../integrations/feratel-vt-pms-web-services-analyse.md). Sie stützt sich auf die öffentliche Doku v1.0.4 (2018), den Abnahmetest und die aktuelle Live-WSDL/XSD. Diese wurden nur lesend abgerufen, ohne Aufruf einer Methode.

- **Eine Schreiboperation** (`ImportPMS`, SOAP 1.1) bildet alle Vorgänge über Attribute ab:
  - `reservierung=1`/`mblattnr=-1`: Voranmeldung, liefert eine `guid`;
  - mit `guid`: Änderung bzw. Umwandlung;
  - gleiche `mblattnr`: Update;
  - `abreise`: Abmeldung, danach endgültig;
  - `ankunft = abreise`: Storno.
- Unsere Operationen bleiben Planungsbegriffe, der Adapter übersetzt sie. Nicht dokumentiert und deshalb weiter **aus**: Storno einer Voranmeldung und Abfrage nach Referenz.
- **Meldescheinnummern** stammen aus Blöcken, die feratel je Betrieb zuteilt (eventuell je Jahr). Wir vergeben sie selbst per Write-ahead. Erneutes Senden derselben Nummer ist ein Update, also kein Duplikat.
- **Authentifizierung:** `companyCode` je Softwarehersteller (geheim), dazu `oestat` und `betriebnr` je Betrieb (nicht geheim, Mapping durch feratel).
- **Live-Zugang erst nach dem Abnahmetest** in der Testumgebung (`visitortaxtest`, derzeit 401).
- **Gästekarte:** Deskline gibt die Daten selbst an das Kartensystem weiter. Voraussetzungen:
  - Vor- und Nachname und Geburtsdatum je Gast;
  - `zustimmungkartenprod` (DSGVO-Einwilligung) je Gast.

  Ein Kartenstatus kommt nicht zurück.

- **Rückmeldung:** `answer/error` mit Code; `0` ist Erfolg. Die Abbildung aller Codes steht in der Analyse.

**Folgerungen für das Modell (F3):**

1. Zwei write-once-Referenzen: `pre_registration_guid` und `sheet_number` (+ Jahr), eindeutig je Objekt und Ziel. Dazu eine Nummernvergabe aus Blöcken.
2. Neuer Übergabegrund `rejected-after-arrival` für die Codes 16, 41 und 70.
3. Einwilligung zur Gästekarte je Reisendem im Check-in.
4. Pro Gast: Wohnsitzland und PLZ.
5. Personengruppe (`gastart`) und Kind (`KI`) nach der `gastartlist` der Gemeinde.
6. Abbildung der Dokumentart.
7. Geschlecht und Unterschrift (`signatur`) erst nach Klärung mit feratel.

`FERATEL_DOCUMENTED_CAPABILITIES` werden erst nach Bestätigung durch feratel und bestandenem Abnahmetest gesetzt, **nicht** auf Basis der Doku von 2018.

## Nächste Phasen (jeweils mit Freigabe)

| Phase | Inhalt                                                                                                                                                                                                                                                                                                                                                                     | Voraussetzung                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| F3a   | Modell und Migration (Staging): `pre_registration_guid`, `sheet_number`/`sheet_year` (write-once, eindeutig); Tabelle der Nummernblöcke mit Reservierung je Registrierung (Write-ahead); Grund `rejected-after-arrival`; Felder für Feratel-Stammdaten in den Einstellungen (`oestat`, `betriebnr`, `bearbeiter`, zwischengespeicherte `gastartlist`, `lschlnr`-Abbildung) | Freigabe F3                           |
| F3b   | Check-in-Erweiterungen hinter Konfiguration: Einwilligung zur Gästekarte je Reisendem, Wohnsitzland/PLZ je Gast, Dokumentart „Führerschein“; Vorlagen AT (Gaschurn, Bludenz) und Kartenregion                                                                                                                                                                              | Freigabe F3, offene Fragen 19, 22, 24 |
| F4a   | **XML-Builder und Antwort-Parser** (rein, ohne Netz): `gemeinde`/`betrieb`/`meldeblatt`/`landschl`/`gastart`/`gast`, Reihenfolge HG→MP→KI, Summenprüfung, Längen nach XSD (Text30/50/100/300), XML-Escaping; Parser für `answer`/`error`/`warnung` und SOAP-Fault; Abbildung der Fehlercodes; Validierung gegen die heruntergeladene XSD in Tests                          | keine                                 |
| F4b   | SOAP-Transport `DesklineVtTransport`: `fetch`, Timeout, `companyCode` aus Env; **Host-Allowlist nur `visitortaxtest.deskline.net`**; keine Bodies im Log; Antwort nur als Code/Referenz gespeichert                                                                                                                                                                        | Testzugang                            |
| F4c   | Lesende Verwaltungsaufrufe: `GetVTInfo` (Nummernblöcke, `gastartlist`, Karteninfo) und `GetVTCountryList` als Admin-Aktion mit Zwischenspeicher; `PMSAutoAssignVTBlock` nur als Admin-Aktion                                                                                                                                                                               | Testzugang                            |
| F4d   | **Abnahmetest** in der Testumgebung automatisiert: Szenarien 1–7 (neuer Meldeschein, Abreise, Verlängerung, Reisegruppe, Storno, Fehlerfälle, Voranmeldung → Umwandlung → Abreise); Ergebnis an feratel                                                                                                                                                                    | Testzugang                            |
| F4e   | Fähigkeiten aus der bestätigten Doku setzen; `allowed_operations` je Standort pflegen                                                                                                                                                                                                                                                                                      | Bestätigung feratel                   |
| F5    | Worker und Cron: Apaleo-Abgleich, fällige Meldungen, Wiederholungen, Purge                                                                                                                                                                                                                                                                                                 | Freigabe                              |
| F6    | Admin: Status je Reservierung, erneut übertragen, manuell erledigen, Protokoll, Filter je Objekt, Nummernblöcke                                                                                                                                                                                                                                                            | Freigabe                              |
| F7    | Gästekarte: Status und Hinweis in der App; ohne Kartenlink, solange feratel keinen freigibt                                                                                                                                                                                                                                                                                | Antwort feratel                       |
| F8    | Live-Zugang nach Abnahme; Pilot ΛLPILΛ, dann HŪSLE, dann LÆKE (falls Deskline)                                                                                                                                                                                                                                                                                             | ausdrückliche Freigabe                |
