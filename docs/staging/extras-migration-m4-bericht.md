# M4-Bericht: Anfragen und Freigaben, Slack-Vorbereitung, STAY-Engine in der Gästeoberfläche

Stand: 09.11.2026 · Branch `claude/sharp-rubin-hwfdyt`.

**Extras bleibt uneingeschränkt in Betrieb.** Folgendes gab es in M4 nicht:

- keine Änderung an Production
- keine produktiven Apaleo-Schreibzugriffe
- keine Slack-Nachricht (Versand nur simuliert)
- keine Änderung an guest-services (unverändert auf 6c5e5af)
- keine Objektumstellung
- kein Online-Check-in

Unterlagen:

- Paritätsbericht mit Abschnitt „Stand M4“: [`extras-migration-m3-paritaet.md`](extras-migration-m3-paritaet.md)
- Screenshots: [`m4-screenshots/`](m4-screenshots/), nur Testdaten

## Feature-Schalter (Gästeoberfläche)

| Ebene     | Regel                                                                                                                                                                                                                                                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Umgebung  | `GUEST_SERVICE_ENGINE=off` (Standard) oder `test`. In Production wird `test` beim Start abgewiesen.                                                                                                                                                                                                                                                              |
| Objekt    | Die STAY-Engine bedient nur ein Testobjekt (`testOnly`), das dem Apaleo-Objekt **TEST** zugeordnet ist. Dafür gibt es eine feste Liste im Code (`STAY_ENGINE_APALEO_PROPERTIES`). Jedes echte Objekt bleibt auf der unveränderten Extras-Brücke, auch bei gesetztem Schalter (getestet). Eine Freischaltung braucht die Go-live-Freigabe und eine Code-Änderung. |
| Schreiben | `APALEO_SERVICE_WRITES=disabled` (Standard) oder `simulated`. Es gibt keinen Live-Modus. Erlaubte Apaleo-Objekte: nur `TEST`.                                                                                                                                                                                                                                    |

Die Gäste-App spricht weiter dieselbe Schnittstelle wie bisher. Eine Weiche wählt je Objekt zwischen STAY-Engine und Extras-Brücke. Die bestehenden STAY-Komponenten (Services, Detailseite, Buchungsformular, Anfrage, Verlängerungsnacht, „Gebucht & angefragt“) sind unverändert. Es gibt keine zweite Gästeoberfläche.

## 1. Was jetzt vollständig eigenständig in STAY läuft (TEST, simuliert)

| Funktion                    | Stand                                                                                                                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Services und Preise         | aus der STAY-Engine: Extras-Regeln, M2-Konfiguration, Apaleo-Angebote                                                                                                                                                                                                   |
| Verfügbarkeit und Kapazität | Buchungsregeln, vollständige Datumsmengen, Restkapazität, Apartmenttyp, vergangener Aufenthalt                                                                                                                                                                          |
| Mengen und Zusatzangaben    | Mengenlimits, Hund genau 1, Kennzeichen je Parkplatz (erstes in Apaleo, weitere im Kommentar)                                                                                                                                                                           |
| Sofortbuchung               | verbindliche Preisprüfung, „bereits gebucht“, Sperre je Reservierung und Service, Idempotenz (Doppelklick), Gateway „simuliert“                                                                                                                                         |
| Zusatzpersonen              | Apaleo-Amend innerhalb der Kapazität. 0 € ist nur bei ausdrücklicher Konfiguration erlaubt.                                                                                                                                                                             |
| Verlängerungsnacht          | Angebot (Phase, Lücke, Rabatt, Leistungen, Kurtaxe), Bestätigung mit Preisprüfung, Verlängerung der Leistungen, Verschiebung des Late Check-out, Prüfung                                                                                                                |
| Anfragen                    | Anlegen mit Prüfung von Menge, Kapazität, Verfügbarkeit, Doppelanfrage und „bereits gebucht“; Idempotenz; Benachrichtigung                                                                                                                                              |
| Freigaben                   | Live-Vorschau für das Team; Bestätigung über die zentrale Engine; Preisänderung nur mit ausdrücklicher Übernahme; Ablehnung mit optionaler interner Begründung; Schutz gegen doppelte und gleichzeitige Entscheidungen; Audit jeder Entscheidung (ohne Begründungstext) |
| Status für Gäste            | „Gebucht & angefragt“: Apaleo-Leistungen jeder Quelle, Zusatzpersonen, Anfragen („angefragt“, „bestätigt“, „leider nicht möglich“), Verlängerungen. Die interne Begründung sieht der Gast nicht.                                                                        |
| Slack (vorbereitet)         | Ziel je Standort, Statusmeldungen je Standort zuschaltbar, Warteschlange mit Claim, 5 Wiederholungen mit Backoff, eine Meldung je Ereignis, Fehlerprotokoll (Status, Fehlercode, Audit bei endgültigem Fehler), Admin-Seite „Benachrichtigungen“                        |
| M3-Abweichungen             | `"false"` gilt als aus, Zusatzperson ohne Preis ist gesperrt, 0 € ist erlaubt, `onlyDefaultDates` ist geprüft, EN-Texte kommen aus Apaleo                                                                                                                               |

## 2. Was noch von Extras abhängt

- **Alle echten Objekte:** Katalog, Buchung, Anfrage und Verlängerung laufen ausschließlich über die Extras-Brücke bzw. die Extras-App.
- **Entscheidungen über importierte Extras-Anfragen:** Sie werden nur in Extras getroffen; in STAY sind sie nur lesbar (getestet).
- **Schreiben nach Apaleo:** produktiv weiterhin ausschließlich durch Extras. STAY hat keinen Live-Executor.
- **Slack:** produktive Meldungen kommen weiter von Extras. STAY versendet nur simuliert.
- **Datenstand:** Bis zum Go-live bleibt Extras führend. Die Übernahme nach STAY läuft über den M1-Import.

## 3. Ergebnisse der Paritätsprüfung

Echter Extras-Code gegen dieselbe simulierte Apaleo-Instanz wie STAY, 17 Szenarien.

- **14 identisch,** einschließlich Texten und Apaleo-Endzustand. Die Textabweichung P-3 aus M3 ist behoben.
- **3 bewusste Abweichungen,** dokumentiert:
  - **P-1:** `"false"` gilt in STAY als aus.
  - **P-2:** Zusatzperson ohne Preis bleibt gesperrt.
  - **P-4:** Eine Anfrage mit zu wenig Verfügbarkeit lehnt STAY schon beim Anlegen ab.

## 4. Gäste- und Admin-Browsertests

Aufbau:

- Gäste-App und Admin lokal gegen den guest-services-Apaleo-Simulator, kein Apaleo-Zugriff.
- Engine im Modus „simuliert“; die simulierten Befehle verändern den Simulatorzustand, damit Gast und Admin dasselbe Ergebnis sehen.
- Reservierung JTKQSYFX-1, Testdatenbank.

### Gast, Deutsch, Desktop

| Schritt                                                  | Ergebnis                                                                                                      | Bild    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------- |
| Services und Preise aus der STAY-Engine                  | 6 Services und Verlängerungsnacht                                                                             | g01     |
| Preisänderung zwischen Anzeige und Buchung (20 € → 25 €) | „Der Preis hat sich gerade geändert …“, **0 Schreibvorgänge**. Danach mit 25 € gebucht.                       | g02–g04 |
| Hund, Doppelklick                                        | genau ein Buchungsbefehl, ein Eintrag in Apaleo                                                               | g05     |
| Hund erneut                                              | als gebucht angezeigt, keine zweite Buchung                                                                   | g06     |
| Parkplatz ×2 mit zwei Kennzeichen                        | gebucht. Kennzeichen 1 in Apaleo, Kennzeichen 2 im Kommentar.                                                 | g07–g08 |
| Zusatzperson ×2                                          | gebucht, Erwachsene 2 → 4                                                                                     | g09     |
| Late Check-out, dann Verlängerung                        | Nacht hinzugefügt; Hund und Parkplatz auf 3 Nächte verlängert; Late Check-out auf die neue Abreise verschoben | g10–g12 |
| Babybett-Anfrage                                         | „Anfrage gesendet“                                                                                            | g13     |
| „Gebucht & angefragt“                                    | alle Positionen mit Daten und Beträgen                                                                        | g14     |

Apaleo-Endzustand:

- Abreise 15.01.
- 4 Erwachsene
- Früher Check-in 25 €
- Hund 12.–14.01.
- Parkplatz 2 × 3 Nächte
- Late Check-out 15.01.
- Endreinigung mitverschoben
- Kommentare wie in Extras

### Gast, Englisch und mobil

| Prüfung                                                            | Bild                       |
| ------------------------------------------------------------------ | -------------------------- |
| Services auf Englisch mit englischen Texten                        | g15 (mobil), g19 (Desktop) |
| Hund bereits gebucht                                               | g16                        |
| Keine Verlängerung, wenn die Folgenacht ausgebucht ist             | g17                        |
| Deutsch mobil                                                      | g18                        |
| Status auf Englisch: Booked, Confirmed, Unfortunately not possible | g15                        |

### Admin mit Rollen

| Rolle             | Prüfung                                                                                                                      | Bild        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Owner             | Zähler offener Anfragen                                                                                                      | a01         |
| Owner             | Vorschau mit Preisänderung 15 € → 18 €                                                                                       | a02         |
| Owner             | Bestätigung nur mit Häkchen „Neuen Preis übernehmen“                                                                         | a03         |
| Owner             | Ablehnung mit interner Begründung; danach keine zweite Entscheidung möglich                                                  | a04–a05     |
| Owner             | Benachrichtigungen: Warteschlange simuliert verarbeitet (5 gesendet; 5 Sofortbuchungen wie in Extras unterdrückt); Protokoll | a06–a08     |
| Viewer            | keine Knöpfe zum Entscheiden, Speichern oder Verarbeiten                                                                     | a09–a10     |
| Manager (nur HØV) | Anfrage von TEST wird nicht angezeigt                                                                                        | a11 (mobil) |

### Im Browsertest gefunden und behoben

- **Doppelte Anfrage in „Gebucht & angefragt“:** Die Phase-1-Partnerliste las Service-Anfragen mit. g14 zeigt den Zustand **vor** der Korrektur mit doppeltem „Babybett angefragt“, g15 den korrigierten Stand.
- **Slack-Worker:** Nur unter echtem Postgres scheiterte ein Datumsparameter im Roh-SQL (PGlite in den Tests akzeptiert ihn). Korrigiert. Dieselbe latente Stelle in der M1-Übernahme hängender Schreibvorgänge ist ebenfalls korrigiert.

### Automatisch getestet

Diese Szenarien sind im Browser nur schwer auszulösen und laufen deshalb automatisch:

- Gleichzeitige Buchungsversuche aus zwei Tabs: genau eine Buchung.
- Teilfehler: Apaleo-503 bei einer Position, die anderen werden gebucht.
- Wiederholung nach Abbruch: Fortsetzung derselben Bestellung nach Ablauf der Sperre.
- Gleichzeitige Entscheidungen: genau eine wirkt.
- Mehrtägige Leistungen.

### Testsummen

| Paket        | Tests                                                 |
| ------------ | ----------------------------------------------------- |
| core         | 502                                                   |
| db           | 206                                                   |
| integrations | 91                                                    |
| shadow       | 28                                                    |
| admin        | 132                                                   |
| guest        | 241 (neu: Engine-Adapter, Feature-Schalter, Umgebung) |
| ui           | 45                                                    |

Typecheck und Lint laufen in allen Paketen, Prettier ist sauber. Die Design-Token-Prüfung meldet nur den Altbefund `message-text.ts` „#666“ aus der Zeit vor M1.

## 5. Bekannte Abweichungen und Risiken

| Thema                                | Bewertung                                                                                                                                                                                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-1, P-2, P-4                        | bewusst und dokumentiert. Extras-Verhalten unverändert.                                                                                                                                                                                                                           |
| Simulator statt Apaleo               | Der Simulator bucht bei Bestätigungen ohne Betrag den Standardpreis (15 € statt der simulierten 18 €). Echtes Apaleo bucht den aktuellen Preis. Die Preisprüfung in STAY ist davon nicht betroffen. Vor dem Go-live ist ein lesender Schattenlauf gegen echtes Apaleo TEST nötig. |
| Slack „at-least-once“                | Stürzt der Worker zwischen Senden und Speichern ab, kann eine Meldung einmal doppelt erscheinen. Slack-Webhooks kennen keine Idempotenz. Das ist dokumentiert und vor dem Live-Versand zu bewerten.                                                                               |
| Kein Live-Schreiben, kein Live-Slack | gewollt. Beides braucht eine eigene Freigabe und Umsetzung.                                                                                                                                                                                                                       |
| Ganzseiten-Screenshots               | Der Leerraum in der Mitte entsteht durch die Einblend-Animation und die fixierte Navigation bei der Aufnahme. Das ist kein Darstellungsfehler.                                                                                                                                    |
| Zahlungsübersicht im Simulator       | Die Folios des Simulators haben ein Feld weniger als Apaleo. Die Zahlungsübersicht meldet das lokal. Das betrifft die Services nicht.                                                                                                                                             |

## 6. Status von M0

**Weiterhin blockiert.** `KV_REST_API_URL` und `KV_REST_API_READ_ONLY_TOKEN` sind in dieser Umgebung nicht gesetzt (erneut geprüft am 09.11.2026). Die Zugriffsrechte wurden nicht umgangen.

Sobald die Werte in den Umgebungseinstellungen hinterlegt sind (nicht im Chat), folgen:

1. Export und Inventur
2. Prüfung der Boolean- und Preiswerte (P-1, P-2)
3. Bildplan (`extras:import --images`)
4. Paritätslauf mit den echten Katalogen

## 7. Vorschlag für M5: Generalprobe mit TEST und Rückfall-Simulation

1. **Staging-Aufbau**
   - Migrationen 0019 und 0020 auf Staging.
   - Gäste-App mit `GUEST_SERVICE_ENGINE=test` und `APALEO_SERVICE_WRITES=simulated`.
   - Lesender Apaleo-Zugang für TEST.
   - Admin mit `SLACK_DELIVERY=simulated`.
2. **Generalprobe nach Drehbuch** (alle Schritte aus Abschnitt 4 gegen echtes Apaleo TEST lesend, Schreiben simuliert)
   - Gast, DE/EN, Desktop/Mobil.
   - Team mit allen Rollen.
   - Protokoll der simulierten Schreibbefehle je Schritt gegen die Erwartung.
3. **Go-live-Ablauf simulieren**
   - Zustände `extras_active → syncing → extras_locked → stay_active` auf einer Kopie (Staging-Datenbank).
   - Delta-Import, Abgleich, Prüfliste.
   - Rückfall `stay_active → extras_locked → extras_active` mit Prüfung, dass zu keinem Zeitpunkt beide Systeme schreiben.
4. **Rückfall-Übung**
   - Offene STAY-Anfragen und Bestellungen während des Rückfalls.
   - Liste für das Team.
   - Nachtrag von Konfigurationsänderungen.
5. **M0 und echte Konfigurationen** (sobald die Zugangsdaten vorliegen)
   - Paritätslauf mit allen echten Katalogen.
   - P-1/P-2-Fälle mit den Objekten klären.
   - Bilder hochladen (Staging).
6. **Vorbereitende Entscheidungen für den Go-live**
   - Live-Executor (Konzept und Tests).
   - Slack-Live-Versand mit Testkanal.
   - Freigabe der Extras-Sperre in guest-services.

Alle drei erfordern eigene Freigaben.
