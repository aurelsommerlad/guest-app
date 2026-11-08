# Extras-Migration: Bericht M2 – Extras-Administration in STAY

Stand: 08.11.2026 · Branch `claude/sharp-rubin-hwfdyt` · nur Entwicklung und Staging.

**Verbindlich eingehalten:**

- Extras bleibt bis zum gemeinsamen Go-live uneingeschränkt in Betrieb.
- Keine Umstellung einzelner Standorte.
- Keine produktiven Schreibzugriffe aus STAY: kein Apaleo-Schreiben, keine Slack-Nachricht.
- Keine Änderung an guest-services; keine Stilllegung.
- Online-Check-in unverändert.

## 1. Ergebnis in Kürze

| Bereich                                                    | Stand                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Abweichungen (M1-Bericht)                                  | korrigiert, siehe Abschnitt 2                                                  |
| M0 produktive Inventur                                     | **nicht ausgeführt** – Read-only-Zugang fehlt in der Sitzung (Abschnitt 3)     |
| Servicekatalog                                             | umgesetzt                                                                      |
| Preise und Buchungsregeln                                  | umgesetzt                                                                      |
| Verlängerungsnächte                                        | umgesetzt                                                                      |
| Anfragen, Bestellungen, Verlängerungen, Audit, Datenimport | umgesetzt                                                                      |
| Rollen/Standortrechte in allen neuen Funktionen            | umgesetzt, getestet                                                            |
| Datenmigration und Vergleich                               | erweitert (Normalisierungen/Fehler im Bericht, getrennte Aufbewahrung)         |
| Sync- und Rückfallkonzept                                  | `docs/concepts/extras-go-live.md`                                              |
| Tests                                                      | 1195 grün (Monorepo), Produktions-Build des Admins erfolgreich                 |
| Browserprüfung                                             | 31 Screenshots Desktop + Mobil, drei Rollen (`docs/staging/m2-screenshots/`)   |
| Datenbank                                                  | keine Schemaänderung in M2 (Migration 0018 aus M1 genügt), Staging unverändert |

## 2. Korrigierte Abweichungen

| Vorgabe                                        | Umsetzung                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Zusatzperson ohne gültigen Preis nie kostenlos | Fehlender oder ungültiger Preis ist ein **Konfigurationsfehler**: Er wird im Katalog, in der Standort-Konfiguration und im Importbericht markiert, und die Zusatzperson ist nicht buchbar. Ein ausdrücklich eingetragener Preis von 0 € bleibt möglich.                                                                                                                                    |
| Leere Verlängerungsrabatte einheitlich         | Ein leerer Wert gilt als 0 %. Nur ein fehlendes Feld fällt zurück, und zwar zuerst auf das ausdrücklich gespeicherte Altfeld, dann auf den dokumentierten Standard. Das entspricht exakt dem Verhalten von Extras. Im Admin-Formular gilt ebenfalls „leer = 0 %“.                                                                                                                          |
| Historische Wahrheitswerte                     | `"true"`, `"1"`, `1`, `"ja"` usw. werden beim Import normalisiert; jeder Fall steht im Bericht. Die M0-Bestandsaufnahme meldet solche Felder vorab.                                                                                                                                                                                                                                        |
| Kennzeichen als Text                           | `normalizeVehiclePlate` (Großschreibung, einfache Leerzeichen, 2–12 Zeichen, Buchstaben inkl. Umlaute, Ziffern, Leerzeichen, Bindestrich); Nicht-Text wird abgewiesen.                                                                                                                                                                                                                     |
| Keine stille Veränderung                       | Der Import übernimmt die Werte so, wie Extras sie gespeichert hat. Alles, was STAY anders darstellen muss, erscheint als Warnung je Datensatz, z. B. „Zusatzperson immer sofort“, „Kapazitätsregel gesetzt“, „ungültige Apartmenttyp-ID verworfen“ oder „unbekannte Buchungsregel“. Ein Abschnitt „Abweichungen, Normalisierungen und Konfigurationsfehler“ im Bericht fasst sie zusammen. |

## 3. M0 – produktive Inventur

**Nicht ausgeführt, weil der Read-only-Zugang in dieser Sitzung nicht bereitsteht.**

- Im Vercel-Projekt `guest-services` sind `KV_REST_API_URL` und `KV_REST_API_READ_ONLY_TOKEN` vorhanden. Beide sind als „sensitive“ hinterlegt und deshalb nicht auslesbar. Das ist richtig so; ich habe sie weder entschlüsselt noch angefordert.
- In der Umgebung dieser Sitzung sind beide Variablen nicht gesetzt.
- Was nötig ist: In den Einstellungen der Cloud-Umgebung (Umgebungsmenü in der Titelleiste der Sitzung → Bearbeiten) unter „Network secrets“ bzw. als Umgebungsvariablen eintragen:
  - `KV_REST_API_URL`;
  - `KV_REST_API_READ_ONLY_TOKEN`;
  - **nicht** `KV_REST_API_TOKEN`: Das Werkzeug bricht ab, wenn nur der Schreib-Token vorhanden ist.

  Eine neue Sitzung übernimmt die Werte. Bitte die Werte nicht in den Chat kopieren.

- Ablauf danach:
  1. `extras:export --source kv --confirm-production-read --out <außerhalb des Repositorys>`; das Werkzeug sendet nur Lesebefehle.
  2. Dateien mit Rechten 0600; Snapshot, Manifest und Bericht werden nicht committet.
  3. Prüfsummen prüfen.
  4. Bericht ohne Personendaten vorlegen.
  5. Danach Probelauf des Imports auf Staging.

## 4. Funktionsvergleich: Extras-Administration ↔ STAY-Admin

| Extras-Funktion                                                    | STAY-Admin (M2)                                                                                                                                                                                                                                                                              | Status                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Login, Ersteinrichtung                                             | E-Mail + Passwort, Server-Sitzungen, Login-Limit (M1)                                                                                                                                                                                                                                        | ✅ (strenger)                          |
| Benutzer anlegen / Rolle ändern / löschen                          | Team: Einladung per Einmal-Link, Rolle + Standorte, Deaktivieren (beendet Sitzungen), letzte Inhaberin geschützt                                                                                                                                                                             | ✅ (mit Standortrechten)               |
| Eigenes Passwort ändern                                            | –                                                                                                                                                                                                                                                                                            | ❌ offen (M3)                          |
| Rollen admin/manager/viewer                                        | owner/admin/manager/viewer, je Standort beschränkbar, Viewer nur lesend                                                                                                                                                                                                                      | ✅                                     |
| Objekt-Auswahl                                                     | Objektauswahl in der Kopfzeile, nur zugängliche Objekte                                                                                                                                                                                                                                      | ✅                                     |
| Katalog je Objekt aus der Apaleo-Serviceliste (`onlySoldAsExtras`) | zentraler Service + Standort-Konfiguration; Apaleo-Serviceliste des Objekts (nur lesend), sonst manuelle ID; nicht mehr vorhandene Services werden markiert                                                                                                                                  | ✅ (ein Katalog statt Doppelpflege)    |
| Im Gäste-Portal anzeigen (`active`)                                | „Gästen an diesem Objekt anzeigen“ je Standort; Gäste sehen ausgeblendete Services nicht                                                                                                                                                                                                     | ✅                                     |
| Anzeigename/Beschreibung DE/EN                                     | zentrale Texte DE/EN + abweichender Titel/Kurzbeschreibung je Standort                                                                                                                                                                                                                       | ✅                                     |
| Kategorie                                                          | feste Kategorien                                                                                                                                                                                                                                                                             | ✅ (anderes Modell)                    |
| Bild                                                               | Titelbild mit Alternativtext DE/EN, signierter Upload in den Storage-Bereich `offers`                                                                                                                                                                                                        | ✅                                     |
| Reihenfolge                                                        | je Standort                                                                                                                                                                                                                                                                                  | ✅                                     |
| Aktion Service/Zusatzperson                                        | ✅                                                                                                                                                                                                                                                                                           | ✅                                     |
| Zusatzpersonenpreis                                                | in EUR, ohne Preis als Fehler markiert                                                                                                                                                                                                                                                       | ✅ (strenger)                          |
| Buchungsregel pro Aufenthalt/Nacht/Anreise/Abreise                 | ✅                                                                                                                                                                                                                                                                                           | ✅                                     |
| Sofort/Anfrage (Zusatzperson immer sofort)                         | ✅                                                                                                                                                                                                                                                                                           | ✅                                     |
| Preiseinheit DE/EN                                                 | ✅                                                                                                                                                                                                                                                                                           | ✅                                     |
| Kapazitätsregel, max. 1, Kennzeichenpflicht                        | ✅                                                                                                                                                                                                                                                                                           | ✅                                     |
| Apartmenttypen (Unit-Groups aus Apaleo)                            | Auswahl aus Apaleo, sonst IDs; unbekannte IDs markiert                                                                                                                                                                                                                                       | ✅                                     |
| Live-Preise                                                        | Gäste sehen Live-Preise aus Apaleo (Buchungslogik M3); Admin zeigt den Apaleo-Listenpreis                                                                                                                                                                                                    | 🟡 Anzeige vorbereitet                 |
| Verlängerungsnacht: Aktivierung, vier Rabatte, Mindestbelegung     | je Standort, Übersicht aller Standorte                                                                                                                                                                                                                                                       | ✅                                     |
| Bestellungen ansehen                                               | Liste + Detail je Standort (ohne Gastnamen)                                                                                                                                                                                                                                                  | ✅                                     |
| Anfragen ansehen, bestätigen, ablehnen                             | Warteschlange mit Filter, Detail. Bestätigen läuft über das zentrale Gateway: Solange es deaktiviert ist, bleibt die Anfrage offen und der Versuch wird protokolliert; auf Staging ist der Modus „simuliert“ möglich. Ablehnen funktioniert ohne Apaleo. Extras-Anfragen bleiben bei Extras. | 🟡 vorbereitet (kein echtes Schreiben) |
| Zähler offener Anfragen in der Navigation                          | –                                                                                                                                                                                                                                                                                            | ❌ offen                               |
| Verlängerungen ansehen                                             | Liste + Detail mit Ergebnis je Schritt                                                                                                                                                                                                                                                       | ✅                                     |
| Slack bei neuen Anfragen                                           | Outbox vorbereitet, kein Versand                                                                                                                                                                                                                                                             | 🟡 (M4)                                |
| – (neu)                                                            | Protokoll aller Änderungen, Import-Läufe mit Konflikten, Konfigurationsfehler sichtbar                                                                                                                                                                                                       | ➕                                     |

## 5. Rechte in den neuen Funktionen

| Funktion                                            | owner | admin              | manager                                    | viewer           |
| --------------------------------------------------- | ----- | ------------------ | ------------------------------------------ | ---------------- |
| Servicekatalog ansehen                              | alle  | alle               | eigene Standorte                           | eigene Standorte |
| Service anlegen, Texte/Bild/Status ändern (zentral) | ✔     | ✔                  | nur ohne Standort-Beschränkung             | –                |
| Standort-Konfiguration bearbeiten                   | ✔     | ✔                  | eigene Standorte                           | –                |
| Verlängerungsnächte bearbeiten                      | ✔     | ✔                  | – (lesen)                                  | – (lesen)        |
| Anfragen entscheiden                                | ✔     | ✔                  | eigene Standorte                           | –                |
| Bestellungen/Verlängerungen ansehen                 | ✔     | ✔                  | eigene Standorte                           | eigene Standorte |
| Protokoll                                           | alles | alles              | eigene Standorte + mandantenweite Einträge | dito             |
| Datenimport                                         | ✔     | ✔ (alle Standorte) | –                                          | –                |

Jede Aktion prüft die Rechte auf dem Server. Fehlt ein Recht, erscheint „Kein Zugriff“. Formulare sind für Lesende deaktiviert, und Aktionsknöpfe werden nicht angezeigt.

## 6. Tests und Browserprüfung

- **Monorepo:** 1195 Tests grün; Formatprüfung, Typprüfung und Lint grün.

  | Paket        | Tests |
  | ------------ | ----- |
  | core         | 499   |
  | db           | 203   |
  | integrations | 89    |
  | admin        | 128   |
  | guest        | 231   |
  | ui           | 45    |

  Produktions-Build des Admins: erfolgreich.

- **Neue Tests:**
  - Normalisierung (Wahrheitswerte, Kennzeichen, Preise, Rabatte);
  - Importwarnungen;
  - Katalog-Repository (Standortfilter, Eindeutigkeit des Apaleo-Services, Datenbankregel Zusatzperson, Sichtbarkeit für Gäste, Audit, Mandantentrennung);
  - Betrieb (Entscheidung genau einmal, Extras-Anfragen gesperrt);
  - Katalog-Dienst (Rechte-Matrix, Validierung, Konfigurationsfehler, Apaleo-Fallback);
  - Betriebs-Dienst (Freigabe gesperrt bzw. simuliert, ohne Apaleo-Aufruf; Viewer/fremder Standort).
- **Browserprüfung:**
  - Umgebung: lokale, isolierte Postgres-16-Datenbank (Migrationen + Seed + synthetischer Extras-Import); Apaleo-Testliste nur für TEST; Gateway „disabled“.
  - Rollen: Owner, Manager (nur HØV) und Viewer.
  - Viewports: Desktop 1440 px und iPhone 13; kein horizontales Scrollen.
  - Gefunden und behoben:
    - mobil gestreckte Status-Badges;
    - 404 statt „Kein Zugriff“;
    - Testdaten-Fallback für Standorte ohne Apaleo-Testliste.
  - Der Login-Rate-Limit griff korrekt, als das Testskript sich wiederholt anmeldete.
- **Sprache:** Die Admin-Oberfläche ist (wie bisher) deutsch. Alle Gästetexte werden DE/EN gepflegt.
- **Bestehende STAY-Funktionen:** unverändert. Einzige Verhaltensänderung für Gäste: Je Standort ausgeblendete Services werden nicht mehr angezeigt. Bestehende Zuordnungen sind standardmäßig sichtbar.

**Screenshots** (`docs/staging/m2-screenshots/`, nur synthetische Daten):

| Nr.   | Inhalt                                                             |
| ----- | ------------------------------------------------------------------ |
| 01–02 | Katalog (alle Objekte / HØV)                                       |
| 03    | Service-Detail                                                     |
| 04    | Konfiguration mit manueller ID                                     |
| 05–06 | Konfiguration mit Apaleo-Auswahl und Apartmenttypen                |
| 07–08 | Zusatzperson ohne Preis (markiert)                                 |
| 09    | Neuer Service                                                      |
| 10–11 | Verlängerungsnächte                                                |
| 12–14 | Anfragen, Detail, Bestätigen gesperrt                              |
| 15–18 | Bestellungen und Verlängerungen                                    |
| 19    | Protokoll                                                          |
| 20–21 | Import-Läufe                                                       |
| 22–24 | Manager (nur HØV, fremder Standort gesperrt, Einstellungen lesend) |
| 25–27 | Viewer (lesend, ohne Aktionen, kein Import)                        |
| 28–31 | Mobil                                                              |

## 7. Offene Punkte

1. **M0:** Read-only-Zugang in der Umgebung hinterlegen (Abschnitt 3). Danach Export, Bericht und Probelauf auf Staging mit echten Daten.
2. **Bilder aus Extras:** werden beim Import vorgemerkt; der Upload nach Storage (mit Prüfsumme und Abmessungen) folgt, sobald der echte Export vorliegt.
3. **Eigenes Passwort ändern** und **Zähler offener Anfragen** in der Navigation fehlen noch.
4. **Navigation nach Rechten filtern:** Heute sieht z. B. ein Manager den Menüpunkt „Datenimport“ und erhält dann „Kein Zugriff“.
5. **Import aus der Oberfläche starten:** heute per Werkzeug `extras:import`; der Admin zeigt die Läufe. Für große Snapshots (Bilder) ist das Werkzeug der sichere Weg.
6. **Apaleo-Lesezugang für den Admin auf Staging:** `APALEO_CLIENT_ID/SECRET` (Scope `setup.read`, `reservations.read`). Ohne sie wird die Service-ID von Hand eingetragen.
7. **Entscheidungen:**
   - Aufbewahrung der Nachweise (Vorschlag 10 Jahre; operative Daten 180 Tage);
   - automatisches Rückschreiben nach Extras im Rückfall (Vorschlag: nein, Liste aus dem Protokoll);
   - Slack-Routen je Standort.

## 8. Vorschlag M3 – eigene Buchungslogik im Schattenbetrieb

**Ziel:** STAY berechnet für Gäste Angebot, Preis, Daten und Einschränkungen selbst, mit der portierten Extras-Logik und den M2-Einstellungen. Das Ergebnis wird neben die Extras-Brücke gelegt, bis keine Abweichung mehr auftritt. Es gibt keine Schreibzugriffe.

1. **Gast-Katalog aus STAY:**
   - Services und Standort-Konfiguration aus der Datenbank;
   - Apaleo-Lesezugriffe: Reservierung, Service-Angebote, gebuchte Services, Unit-Group;
   - Regeln aus `packages/core/booking`: Daten, Preis, Kapazität, Apartmenttyp, Hund, Kennzeichen, Zusatzperson, Verlängerungsangebot.
2. **Paritätsbericht:** Für jede Gästeansicht auf TEST/Staging werden die Ergebnisse von STAY und der Brücke verglichen (Preis, Daten, Sichtbarkeit, Einschränkungen) und ohne Personendaten protokolliert. Daraus entsteht eine Admin-Ansicht „Abgleich“.
3. **Buchungsablauf hinter dem Gateway:**
   - Sofortbuchung, Zusatzperson und Verlängerung als vollständige Abläufe im Gateway (Modus „simuliert“);
   - Idempotenzschlüssel je Absenden, Live-Prüfung „bereits gebucht“, `service_bookings` und Outbox.
4. **Live-Preis-Vorschau im Admin:** für eine Test-Reservierung (TEST) über die Apaleo-Lesezugriffe.
5. **Offene M2-Punkte:** Passwort ändern, Zähler offener Anfragen, Navigation nach Rechten, Bild-Import.
6. **Abnahme:** festgelegter Zeitraum ohne Abweichung im Paritätsbericht, alle Extras-Referenztests grün, weiterhin keine Schreibzugriffe.

Danach folgen M4 (Anfragen/Slack), M5 (Generalprobe TEST mit Freigabe für echte Schreibzugriffe nur auf TEST) und M6 (gemeinsamer Go-live).
