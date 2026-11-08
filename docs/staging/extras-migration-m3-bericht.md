# M3-Bericht: Extras-Buchungslogik in STAY, Schattenbetrieb und Parität

Stand: 08.11.2026 · Branch `claude/sharp-rubin-hwfdyt`.

**Extras bleibt produktiv und führend.** Folgendes gab es in M3 nicht:

- keine Änderung an Production
- keine produktiven Apaleo-Schreibzugriffe
- keine Slack-Nachricht
- keine Objektumstellung
- keine Änderung an guest-services (unverändert auf 6c5e5af)
- kein Online-Check-in

Das Gateway lief ausschließlich in den Modi `disabled` und `simulated`.

Weitere Unterlagen:

- Paritätsbericht mit Ursache und Lösung je Abweichung: [`extras-migration-m3-paritaet.md`](extras-migration-m3-paritaet.md)
- Rohdaten: [`extras-migration-m3-paritaet.json`](extras-migration-m3-paritaet.json)
- Screenshots: [`m3-screenshots/`](m3-screenshots/)

## Was gebaut wurde

| Baustein                | Ort                                                    | Kurz                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buchungsengine          | `packages/integrations/src/services/booking-engine.ts` | Die Extras-Abläufe in derselben Reihenfolge, auf den M1-Regeln (`@up/core`) und der M2-Konfiguration:<br>• `getGuestCatalog`<br>• `placeGuestOrder`<br>• Zusatzperson<br>• Kennzeichen<br>• Hund<br>• `createGuestRequest` und `approveRequest`<br>• Verlängerungsangebot und -bestätigung<br>Keine zweite Regelimplementierung. |
| Apaleo lesen wie Extras | `service-reader.ts`                                    | Service-Offers ohne Parameter, 422 bzw. Abreise vor heute = vergangener Aufenthalt, Verfügbarkeit je Nacht und Einheit, Folios, lokalisierte Namen, Reservierung mit `actions`/`assignedUnits`                                                                                                                                   |
| Schreiben               | `write-gateway.ts`                                     | Die Befehle tragen genau die Extras-Payloads: book-service, amend, Kennzeichen, Kommentar. Jedes Schreiben hat einen eigenen Idempotenzschlüssel.                                                                                                                                                                                |
| Sperren                 | Migration 0019 `service_locks`                         | Gegenstück zu den Extras-Sperren, mit 120 s Ablauf statt nie                                                                                                                                                                                                                                                                     |
| Speicherung             | `service-engine-repository.ts`                         | Bestellungen mit Positionen und Client-Idempotenzschlüssel, Anfragen, Verlängerungen, Slack nur in die Warteschlange                                                                                                                                                                                                             |
| Schattenbetrieb         | `packages/shadow`                                      | Apaleo-Double, 20 simulierte Abläufe, Paritäts-Harness gegen den echten Extras-Code                                                                                                                                                                                                                                              |
| Admin                   | `apps/admin`                                           | • Seite „Schattenbetrieb“<br>• Anfrage-Bestätigung über die Engine<br>• „Mein Konto“ mit Passwortänderung<br>• Zähler offener Anfragen<br>• Navigation nach Rechten<br>• Bildmigration im Import-CLI                                                                                                                             |

## 1. Vollständig übernommene Extras-Funktionen

| Bereich                                           | Umfang                                                                                                                                                                                                                                                                                                                                                                                                                               | Prüfung                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Gast-Katalog                                      | • nur aktive Einträge<br>• Apaleo-Angebote<br>• vergangener Aufenthalt<br>• Buchungsregeln pro Aufenthalt, pro Nacht, Anreise, Abreise<br>• unvollständige Daten → ausgeblendet<br>• Preis je Datum × Nächte<br>• Reihenfolge, Preiseinheit<br>• Apartmenttyp: angezeigt, aber gesperrt<br>• Restkapazität<br>• `maxQuantity`<br>• Hund bereits gebucht<br>• Kennzeichen-Vorbelegung                                                 | Parität S01–S06, S16, S17                                        |
| Sofortbuchung                                     | • mehrere Positionen<br>• nur Sofort-Services<br>• dieselben Fehlergründe<br>• Kennzeichen vor der Buchung (erstes in Apaleo, weitere im Kommentar)<br>• ein book-service mit allen Daten<br>• Kommentar „[Gäste-Portal …] Extras gebucht“                                                                                                                                                                                           | Parität S07, S08 (gleiche Folge von 7 Schreibvorgängen); Abläufe |
| Zusatzpersonen                                    | amend mit `requote:false`, Kapazität frisch geprüft                                                                                                                                                                                                                                                                                                                                                                                  | S07, S08, Abläufe                                                |
| Hund                                              | Menge genau 1, frische Prüfung unter Sperre, parallele Versuche                                                                                                                                                                                                                                                                                                                                                                      | S02, S08, Ablauf „zwei Tabs“                                     |
| Parken                                            | Pflichtkennzeichen je Fahrzeug                                                                                                                                                                                                                                                                                                                                                                                                       | S07, S08                                                         |
| Early Check-in / Late Check-out                   | über Anreise- und Abreiseregel. Late Check-out wird bei Verlängerung verschoben, wenn Apaleo `Departure` + `postNextDay` meldet                                                                                                                                                                                                                                                                                                      | S07, S09                                                         |
| Verlängerungsnacht                                | • Phase (vor Anreise / im Haus)<br>• Lücke über Unit-Group- und Einheitenverfügbarkeit<br>• alle vier Rabatte, Mindestnächte<br>• Durchschnittspreis<br>• Zusatzleistungen und Kurtaxe in der Vorschau<br>• Bestätigung mit erneuter Prüfung<br>• Schutz bei geänderter Abreise<br>• Leistungen verlängern<br>• Endreinigung und Pflichtleistungen<br>• Prüfung nach dem Schreiben<br>• Status `confirmed` / `confirmed_with_issues` | S01, S09–S12, Abläufe                                            |
| Anfragen                                          | • Anlegen (nur Anfrage-Services, Apartmenttyp)<br>• Bestätigung mit Live-Prüfung (Angebot, Katalog, Hund, Apartmenttyp, Kapazität, Daten, Verfügbarkeit)<br>• vorhandene Buchung erkennen (vollständig / Konflikt)<br>• ein book-service, Kommentar<br>• Ablehnung                                                                                                                                                                   | S13, S14, Abläufe, Admin                                         |
| Bereits gebuchte Leistungen                       | aus Apaleo, jede Quelle                                                                                                                                                                                                                                                                                                                                                                                                              | S02                                                              |
| Doppel- und Parallelbuchungen, Idempotenz, Fehler | Sperren, Gateway-Idempotenz, Client-Schlüssel, Fortsetzung nach Abbruch, Teilfehler je Position                                                                                                                                                                                                                                                                                                                                      | Abläufe                                                          |
| M2-Reste                                          | • eigenes Passwort ändern<br>• Zähler offener Anfragen<br>• Navigation nach Rolle und Objektrecht<br>• Bildmigration vorbereitet (Plan mit SHA-256, Typ, Abmessungen, Verweisen; Upload nur mit `--upload-images --apply`; STAY-Bilder bleiben)                                                                                                                                                                                      | Tests, Browser                                                   |

## 2. Noch fehlende Funktionen

| Thema                                | Stand                                                                                                                                                                     | Wann                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Gäste-Oberfläche auf die STAY-Engine | Die Gäste-App bucht weiter über die Extras-Brücke (Extras führend). Die Engine ist fertig, aber noch nicht in der Gäste-App angeschlossen.                                | mit dem Go-live, vorbereitend in M4 |
| Slack-Versand                        | Benachrichtigungen landen nur in der Warteschlange (`pending`), es gibt keinen Versand                                                                                    | M4                                  |
| Texte aus Apaleo vorbelegen          | Befund P-3                                                                                                                                                                | M4                                  |
| Benutzer-Übernahme                   | nur Einladungsliste (M1)                                                                                                                                                  | Go-live-Vorbereitung                |
| Datenimport im Admin                 | bleibt bewusst CLI                                                                                                                                                        | –                                   |
| Live-Executor (echtes Schreiben)     | nicht vorhanden                                                                                                                                                           | eigene Freigabe                     |
| M0 (produktiver Export)              | **blockiert**: `KV_REST_API_URL` und `KV_REST_API_READ_ONLY_TOKEN` sind in dieser Umgebung nicht gesetzt. Bitte in den Umgebungseinstellungen hinterlegen, nicht im Chat. | sobald verfügbar                    |

## 3. Ergebnisse des Schattenbetriebs

**Parität:** 17 Szenarien mit echtem Extras-Code und STAY-Engine gegen denselben Apaleo-Simulator. In Preisen, Verfügbarkeit, Mengen, Einschränkungen, Zusatzpersonen, Verlängerung, bereits gebuchten Leistungen und im Apaleo-Endzustand sind 15 identisch. 2 echte Befunde (P-1, P-2), dazu Textunterschiede (P-3).

**Simulierte Abläufe** (`packages/shadow/src/flows.test.ts`, 20 Tests, Gateway „simuliert“):

- Preisänderung zwischen Anzeige und Buchung
- Doppelklick
- paralleler Doppelklick
- gleichzeitige Hundebuchung aus zwei Tabs
- Teilfehler (ungültige Positionen und Apaleo-503)
- Fortsetzung nach Abbruch
- mehrtägige Leistungen
- Reservierungsänderung (Abreise, Apartmenttyp)
- Zusatzpersonen innerhalb der Kapazität
- Schreiben deaktiviert
- Verlängerung mit Hund und bestehendem Late Check-out, auch zweiter Versuch
- kein Angebot bei ausgebuchter Nacht, ohne AmendDeparture oder ohne sichere Einheit
- Anfragen anlegen, bestätigen und ablehnen
- zu geringe Verfügbarkeit
- Extras-Anfragen gesperrt
- fremdes Objekt

**Browser** (Admin, lokal, Testdaten, Desktop 1440 px und iPhone 13):

- Schattenbetrieb für JTKQSYFX-1: 6 Services mit Preisen und Regeln, ein ausgeblendeter Service mit Grund, Verlängerung 89,10 €. Das sind dieselben Werte wie im Paritätslauf.
- Anfrage simuliert bestätigt, der Zähler sinkt von 2 auf 1.
- Falsches Passwort wird abgewiesen.
- Viewer: kein Bestätigen-Knopf, kein Team-Modul, Team gibt „Kein Zugriff“.
- Manager mit nur HOV: Schattenbetrieb für TEST wird abgewiesen.
- Mobile Navigation.

Gefunden und behoben:

- Die Zahl im Zähler war nicht lesbar.
- Der Zähler aktualisierte sich nach einer Entscheidung nicht.
- „1 Kinder“.

## 4. Bekannte Abweichungen

Ausführlich im Paritätsbericht. Nichts wurde still angeglichen.

- **P-1:** `extensionNightEnabled: "false"` (Text) schaltet in Extras die Verlängerung ein, in STAY aus. STAY ist fachlich richtig. Vor dem Go-live in M0 prüfen und klären.
- **P-2:** Eine Zusatzperson mit leerem Preis bietet Extras für 0 € an, STAY blendet sie als Konfigurationsfehler aus. Das ist ein Extras-Fehler. In M0 prüfen und korrigieren.
- **P-3:** Texte. Extras zeigt ohne eigene Beschreibung die Apaleo-Übersetzung, STAY den redaktionellen Text. Fehlendes Englisch fällt auf Deutsch zurück. Vorschlag: beim Import aus Apaleo vorbelegen, im Admin „Übersetzung fehlt“ markieren.
- **P-0 (behoben):** Service-Offers wurden mit `onlyDefaultDates=false` abgefragt und sind jetzt wie in Extras.
- **Bewusste Unterschiede:**
  - Gateway mit Idempotenz
  - Sperren mit Ablauf
  - Client-Idempotenz der Bestellung
  - optionale Preisprüfung `expectedUnitPrice`
  - Veröffentlichung als Freigabe
  - Slack nur Warteschlange
  - Zeitstempel in Europe/Berlin
  - „nicht prüfbar“ statt „bestätigt“ bei simulierten Schreibvorgängen ohne Zustand

## 5. Offene Risiken

| Risiko                                              | Bewertung / Maßnahme                                                                                                                                                                                                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Produktivdaten nicht geprüft (M0 blockiert)         | P-1/P-2 könnten in echten Katalogen vorkommen. Vor dem Go-live M0 ausführen und den Paritätslauf mit dem echten Export wiederholen. Der Harness nimmt jeden Katalog.                                                                                                   |
| Simulator statt echtem Apaleo                       | Die Daten entsprechen dem Apaleo-TEST-Objekt (gelesen am 08.11.). Sonderfälle anderer Objekte (Kurtaxe, mehrere Einheiten, OTA-Reservierungen) vor dem Go-live auf Staging mit lesendem Zugriff im Schattenbetrieb prüfen. Die Seite „Schattenbetrieb“ zeigt das live. |
| Nach dem Live-Schalten                              | Echte Schreibvorgänge wurden nie ausgeführt. Der Live-Executor muss eigens gebaut, geprüft und freigegeben werden.                                                                                                                                                     |
| Bestätigung zum aktuellen Apaleo-Preis              | wie in Extras übernommen, Vorschlag für M4                                                                                                                                                                                                                             |
| Anfragen ohne Mengen- und Hundeprüfung beim Anlegen | wie in Extras übernommen, Vorschlag für M4                                                                                                                                                                                                                             |
| Gäste-Oberfläche noch auf Extras                    | gewollt. Die Umstellung braucht einen eigenen Browser-Durchgang (Gast DE/EN, Desktop/Mobil). In M3 wurde die Gäste-App nicht geändert, die Gäste-Tests (231) laufen grün.                                                                                              |
| Design-Token-Prüfung                                | ein Altbefund `message-text.ts` „#666“ (vor M1), nicht aus M3                                                                                                                                                                                                          |

## 6. Vorschlag für M4: Anfragen, Freigaben, Slack

1. **Anfragen im Admin vervollständigen**
   - Filter nach Zeitraum.
   - Detail mit Live-Prüfung vor der Entscheidung: Vorschau „würde buchen: Daten, Menge, aktueller Preis gegenüber angezeigtem Preis“.
   - Hinweis bei Preisabweichung.
   - Beim Anlegen bereits gegen `maxQuantity` und das Hundelimit prüfen.
2. **Freigaben**
   - Bestätigen und Ablehnen mit optionalem internem Grund.
   - Ablehnungsgrund im Protokoll.
   - Mehrfachauswahl nur zum Ablehnen.
   - Gästebenachrichtigung als eigene Freigabe; Extras hat keine.
3. **Slack**
   - Worker für `notification_outbox` mit Kanal je Objekt (`slack_route`) und Dedup.
   - Wiederholversuch mit Backoff.
   - Knopf „Anfrage bearbeiten“ mit Link in den STAY-Admin.
   - Zuerst nur Test-Kanal auf Staging.
   - Produktiver Kanal erst mit dem Go-live und deiner Freigabe.
4. **Texte (P-3)**
   - Apaleo-Übersetzungen beim Import vorbelegen.
   - Markierung „Übersetzung fehlt“ im Admin.
5. **M0, sobald die Zugangsdaten da sind**
   - Export.
   - Bestandsaufnahme mit P-1/P-2-Prüfung.
   - Paritätslauf mit echten Katalogen.
   - Bildplan.
6. **Gäste-Oberfläche hinter Schalter**
   - Engine an die Gäste-App anschließen, standardmäßig aus.
   - Auf Staging gegen Apaleo TEST im Modus „simuliert“.
   - Browser-Durchgang DE/EN, Desktop/Mobil, Vergleich mit der Extras-App.

## Tests

| Paket        | Tests                                                        |
| ------------ | ------------------------------------------------------------ |
| core         | 499                                                          |
| db           | 206 (neu: Bildmigration; Tabellenzahl wegen `service_locks`) |
| integrations | 89                                                           |
| shadow       | 20 (neu)                                                     |
| admin        | 132 (neu: Passwort, Navigation, Bestätigung über die Engine) |
| guest        | 231                                                          |
| ui           | 45                                                           |

Typecheck und Lint laufen in allen Paketen (21/21 Tasks). Prettier ist sauber.
