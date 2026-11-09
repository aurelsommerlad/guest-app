# Sammelbuchung, Mengenwahl, Verlängerungsrabatte, Staging-Isolation

Stand: 09.11.2026 · Branch `claude/sharp-rubin-hwfdyt` · Screenshots: [`extras-ui-screenshots/`](extras-ui-screenshots/) (c01–c07)

Vorgaben eingehalten:

- Keine produktiven Apaleo-Schreibzugriffe.
- Keine Änderung an Extras (guest-services unverändert auf `6c5e5af`).
- Keine Daten auf Staging oder Production verändert.
- M5 nicht begonnen.

## 1. Sammelbuchung

Auf „Services & Erlebnisse“ (`/v2/services`, Kapitel 01) hat jeder sofort buchbare Service eine Mengenwahl direkt in der Liste. Die Detailseite bleibt über „Details“ erreichbar und funktioniert unverändert, ebenso das Magazin-Design.

**Ablauf:**

1. Sobald etwas ausgewählt ist, erscheint unten eine Leiste mit Anzahl, Gesamtpreis, dem Hinweis „Sofort und verbindlich gebucht“ und dem Button „Auswahl verbindlich buchen“.
2. Kennzeichen werden je Parkplatz direkt in der Zeile erfasst. Der Button bleibt gesperrt, bis alle Kennzeichen ausgefüllt sind.
3. Gebucht wird wie in Extras (`placeGuestOrder`): jede Zeile einzeln, mit eigener Prüfung (Preis, Regeln, Kapazität, Verfügbarkeit).
4. Das Ergebnis erscheint je Zeile:
   - Gebuchte Zeilen verlassen die Auswahl und erscheinen als „Bereits gebucht“ bzw. unter „Gebucht & angefragt“.
   - Abgelehnte Zeilen bleiben ausgewählt, mit Grund und, falls geänderter Preis, mit dem neuen Preis zur erneuten Bestätigung.

**Schutz vor Doppelbuchungen:**

- Jede Bestätigung erhält einen Schlüssel, daraus entsteht je Zeile ein fester Idempotenzschlüssel. Ein wiederholter Klick oder Request bucht nichts doppelt.
- Gleichzeitige Buchungen derselben Reservierung sind durch die Sperre der Engine serialisiert.

**Nicht im Warenkorb:** Anfrage-Services (z. B. Babybett) laufen weiter über die Detailseite, wie in Extras, wo Anfragen ebenfalls nicht Teil von „Jetzt buchen“ sind. Gleiches gilt für eingeschränkte Services (Grund wird angezeigt) und die Verlängerungsnacht (eigener Block oben).

## 2. Mengenwahl ohne Pauschalgrenze

Die Obergrenze 4 ist entfallen. Die zulässige Menge ergibt sich je Service:

| Quelle                                    | Wirkung                                                         |
| ----------------------------------------- | --------------------------------------------------------------- |
| „Einmal pro Reservierung“ (Einstellung)   | genau 1                                                         |
| „Benötigt freie Kapazität“ (Zusatzperson) | höchstens die freien Plätze der Einheit (maxPersons − Belegung) |
| Apaleo `availableCount` (je Datum)        | höchstens das Minimum über alle Leistungstage                   |
| Kapazität 0 oder Verfügbarkeit 0          | Status „Leider nicht verfügbar“, keine Mengenwahl               |
| keine der Grenzen                         | keine Obergrenze (wie Extras: `Number.isFinite(maxQuantity)`)   |

Die Server-Validierung erlaubt bis 999. Die eigentliche Grenze prüft die Engine bei jeder Buchung neu, dieselben Regeln wie in Extras.

## 3. Verlängerungsnächte: alle vier Rabattkonfigurationen

Die Darstellung bleibt oben im Kapitel: neue Abreise, durchgestrichener Originalpreis, Rabatt, Endpreis, „Nacht hinzufügen“.

**Automatisch geprüft** (`packages/shadow/src/extension-discounts.test.ts`):

- Gespeicherte Standorteinstellung → Engine → Angebot.
- Jede Einstellung hat einen anderen Wert, sodass eine vertauschte Spalte oder Phase sofort auffiele.

**Im Browser** geprüft (c07, Basis 189 € pro Nacht, Rabatte lokal auf 11/12/13/14 % gesetzt):

| Phase / Lücke                           | Einstellung                               | Ergebnis       |
| --------------------------------------- | ----------------------------------------- | -------------- |
| vor Anreise, Restlücke verkaufbar       | `discount_pre_arrival_standard` 12 %      | 166,32 € ✔     |
| vor Anreise, genau eine freie Nacht     | `discount_pre_arrival_one_night_gap` 11 % | 168,21 € ✔     |
| im Haus (InHouse), Restlücke verkaufbar | `discount_in_house_standard` 14 %         | 162,54 € ✔     |
| im Haus, genau eine freie Nacht         | `discount_in_house_one_night_gap` 13 %    | 164,43 € ✔     |
| Lücke = Mindestaufenthalt (2)           | –                                         | kein Angebot ✔ |

Die Phase richtet sich wie in Extras nach dem Apaleo-Status „InHouse“. Nach dem Test wurden die lokalen Werte zurückgesetzt.

## 4. Staging-Preview: Isolation von Production

Geprüft über die Vercel-, Supabase- und GitHub-Konfiguration. Es wurden keine Werte ausgegeben.

**Vercel-Projekt `guest-app` (Gäste-App):**

- Alle zehn Umgebungsvariablen gelten ausschließlich für **Preview**. Für Production ist keine einzige gesetzt (`hiddenProductionEnvCount` 0).
- Die einzige Production-Bereitstellung (`stay.unique-places.com`) ist ein alter, fehlgeschlagener Build. Production nutzt weder Datenbank noch Apaleo-Zugang.
- Die Preview nutzt die Staging-Datenbank `unique-places-guest-staging` und `APP_ENV=staging`.

**Vercel-Projekt `guest-app-admin`:**

- Production- und Preview-Ziel zeigen beide auf die Staging-Datenbank.
- Domain `guest-app-admin.vercel.app`, ausschließlich mit diesem Branch bereitgestellt.
- Es gibt kein produktives STAY-Admin.

**Extras (`guest-services`):**

- Eigenes Vercel-Projekt mit eigener KV-Datenbank, eigenem Apaleo-Zugang, eigenem `JWT_SECRET` und eigenem Slack-Webhook (nur Production).
- STAY teilt weder Datenbank noch KV noch Secrets mit Extras.
- Die Extras-Brücke ist in der STAY-Preview nicht konfiguriert.

**Supabase:** Zwei getrennte Projekte. STAY nutzt nur `unique-places-guest-staging`; das andere Projekt (`space-anfrage`) gehört nicht dazu.

**Apaleo-Schreibschutz (im Code, unabhängig von der Konfiguration):**

- `APALEO_SERVICE_WRITES` kennt nur `disabled` und `simulated`. Einen Live-Modus gibt es nicht.
- Das Schreib-Gateway lässt nur die Apaleo-Property `TEST` zu.
- Das Env-Schema verweigert `GUEST_SERVICE_ENGINE=test` bei `APP_ENV=production`.

**Ergebnis:** Staging und Production sind vollständig getrennt. Eine STAY-Bereitstellung kann weder produktive Daten noch Extras verändern.

### TEST-Feature-Schalter (gesetzt)

Erst nach dieser Prüfung im Projekt `guest-app` gesetzt, **nur Ziel Preview**:

| Variable                | Wert        | Wirkung                                                      |
| ----------------------- | ----------- | ------------------------------------------------------------ |
| `GUEST_SERVICE_ENGINE`  | `test`      | STAY-Engine nur für das Objekt TEST; alle anderen wie bisher |
| `APALEO_SERVICE_WRITES` | `simulated` | Buchungen werden nur protokolliert, nie an Apaleo gesendet   |

Hinweise:

- Die Werte wirken ab der nächsten Preview-Bereitstellung, also ab dem nächsten Push.
- Die Engine greift nur, wenn `APALEO_PREVIEW_RESERVATION_ID` eine Reservierung des Objekts TEST ist. Sonst bleibt die Vorschau wie bisher.
- Der Apaleo-Zugang der Preview bekommt für Folios weiterhin 403. Das betrifft nur die Kurtaxe in der Verlängerungsvorschau; Lesezugriff auf Folios ergänzen.
- Rückgängig machen: beide Variablen in Vercel → `guest-app` → Settings → Environment Variables löschen.

## 5. Admin nach der Migration

- **Vercel-Laufzeitfehler `guest-app-admin`:** Alle fünf Fehlergruppen (fehlende Spalten) liegen vor dem Einspielen von 0019–0022, die letzte um 07:54 UTC. Seitdem gibt es keine Fehler mehr.
- **Staging-Datenbank:** 23 Migrationen eingetragen, die vier zuvor fehlenden Spalten vorhanden, 10 Verbindungen, Verbindung fehlerfrei.
- **Offen:** Der Workflow `Database · Staging` braucht weiterhin `STAGING_DATABASE_URL` und `STAGING_SUPABASE_PROJECT_REF` in der GitHub-Umgebung `staging`.

## 6. Tests

**Automatisiert:** `turbo typecheck lint test` mit 21/21 Tasks grün. Gäste-App 246, Shadow 40, Integrations 91 Tests. Neu bzw. erweitert:

- **Mengenwahl:** Grenze aus Einstellung, Kapazität und Verfügbarkeit; keine Pauschalgrenze; Status „nicht verfügbar“ bei 0; Menge 12 serverseitig gültig.
- **Sammelbuchung:** jede Zeile einzeln mit eigenem Preis; eine Zeile mit geändertem Preis abgelehnt, die übrigen gebucht; feste Schlüssel je Zeile; ungültige Warenkörbe (leer, doppelter Service, ungültiger Schlüssel, Menge 0) ohne Aufruf der Quelle abgelehnt.
- **Parallele Versuche:**
  - Zwei Tabs wollen je 2 Zusatzpersonen bei 3 freien Plätzen: genau eine Buchung, danach ist der Rest (1) noch buchbar und mehr wird abgelehnt.
  - Bestehende Tests: Doppelklick mit gleichem Schlüssel, Hund aus zwei Tabs, parallele Freigaben.
- **Verlängerung:** vier Rabattkonfigurationen sowie Lücke = Mindestaufenthalt.

**Browser** (lokal, Apaleo-Simulator, Objekt TEST, Engine „test“, Schreiben simuliert):

| Bild      | Szenario                           | Ergebnis                                                                                       |
| --------- | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| c01       | Liste mit Mengenwahl               | Früher/Später Check-out und Parkplatz ohne Grenze, Zusatzperson bis 3 (Kapazität)              |
| c02       | zwei Tabs gleichzeitig, je 2 Pers. | Tab 1 gebucht, Tab 2 „wird gerade verarbeitet“, Belegung 2 → 4 (keine Überbuchung)             |
| –         | Dreifachklick auf „Buchen“         | genau ein Früher Check-in gebucht                                                              |
| c03       | Sammelauswahl                      | 6× Später Check-out (> 4), 2 Parkplätze mit Kennzeichen, Zusatzperson auf Rest 1 begrenzt      |
| c04       | Preisänderung 20 → 25 €            | nur Später Check-out abgelehnt, mit neuem Preis ausgewählt; Parkplatz und Zusatzperson gebucht |
| c05       | erneute Bestätigung                | Später Check-out zu 150 € (6 × 25 €) gebucht                                                   |
| c06       | mobil                              | Mengenwahl und Leiste über der Navigation                                                      |
| c07-e1…e4 | Verlängerung, vier Rabatte         | siehe Abschnitt 3                                                                              |

Die Kennzeichen stehen wie bei Extras im Reservierungskommentar („Parking vehicles: 1. … 2. …“).

**Behoben** durch den Browsertest:

- Der Typimport der Client-Liste zog den Datenbanktreiber in den Browser-Build.
- Für Liste und Warenkorb fehlten Übersetzungen auf der Client-Seite.
- In der Ergebnisliste erschien nach dem Aktualisieren die Service-ID statt des Titels.

## 7. Verbleibende Abweichungen zur Extras-App

| Thema                                   | Extras                                      | STAY                                                                | Bewertung                         |
| --------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------- | --------------------------------- |
| Reservierungskommentar                  | ein gemeinsamer Kommentar je „Jetzt buchen“ | ein Kommentar je gebuchter Zeile                                    | inhaltlich gleich, nur gestückelt |
| Ergebnis bei Teilfehlern                | Fehlermeldung je Position                   | Ergebnis je Zeile, abgelehnte bleiben ausgewählt                    | gleichwertig                      |
| Menge über die Extras-Brücke            | –                                           | Brücke nimmt höchstens 20 je Service an (`MAX_COUNT`)               | nur bis zum Go-live relevant      |
| Originalpreis der Nacht über die Brücke | –                                           | Brücke liefert ihn nicht; dann nur Rabatt und Endpreis              | akzeptabel bis zum Go-live        |
| Bilder                                  | Extras-Upload je Service                    | STAY-Bild am Angebot; Extras-Bilder mit der Bildmigration           | Bildmigration beim Go-live        |
| Verlängerung in der Liste               | volle Aufstellung in der Karte              | Kurzfassung oben, volle Aufstellung mit Kurtaxe auf der Detailseite | bewusst (Magazin-Design)          |
