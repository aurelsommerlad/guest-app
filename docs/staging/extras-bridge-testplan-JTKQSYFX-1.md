# Erster echter Integrationstest: Extras-Brücke gegen Apaleo TEST

**Status: geplant, nicht durchgeführt.** Die Durchführung braucht eine ausdrückliche Freigabe.

| Gegenstand      | Wert                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Reservierung    | `JTKQSYFX-1` (Buchung `JTKQSYFX`), Apaleo-Objekt `TEST` („Test run“), Einheit `TEST-ZHF`            |
| Leistung        | `TEST-ECI` Früher Check-in: 20,00 € brutto, 7 %, Modus `Arrival`, ein Datum (Anreisetag 12.01.2027) |
| Ablauf          | STAY (lokal) → Brücke (Extras lokal, **ohne Deployment**) → **echtes** Apaleo                       |
| Daten in Extras | lokale JSON-Datenbank; kein produktiver KV-Store, kein Slack                                        |

Der Early Check-in eignet sich, weil er nur ein Datum hat, keine Kennzeichen braucht, kein Limit hat und mit einer einzigen Aktion („RemoveService“) vollständig zurückgenommen werden kann.

## 0. Voraussetzungen

1. Freigabe für genau diesen Test.
2. Apaleo-Zugangsdaten von Extras als Umgebungsvariablen dieser Cloud-Umgebung, z. B. `EXTRAS_TEST_APALEO_CLIENT_ID` und `EXTRAS_TEST_APALEO_CLIENT_SECRET`. Sie werden in den Einstellungen der Umgebung hinterlegt, nie über den Chat, und nie ausgegeben oder gespeichert.
3. Extras lokal mit `STAY_BRIDGE_PROPERTY_IDS=TEST`, leerem `SLACK_REQUEST_WEBHOOK_URL`, ohne `KV_*`-Variablen und mit lokalem TEST-Katalog (`test/support/stay-bridge-seed.mjs`). **Ohne** Apaleo-Simulator.
4. STAY lokal mit `EXTRAS_BRIDGE_URL=http://localhost:3400`, Gastkontext `JTKQSYFX-1` über die Vorschau (`APALEO_PREVIEW_RESERVATION_ID`).
5. Schutzmaßnahme für Schreibzugriffe: Ein Fetch-Wächter im Extras-Prozess lässt `PUT`, `PATCH` und `POST` an `api.apaleo.com` nur für Pfade zu, die `JTKQSYFX-1` enthalten; alles andere bricht ab. Alle Apaleo-Aufrufe werden protokolliert (Methode und Pfad, keine Inhalte).

## 1. Ausgangszustand (lesend, festgehalten am 08.11.2026)

Vor dem Test erneut lesen und mit diesen Werten vergleichen:

| Prüfung                                               | Erwartet                                                                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Reservierung                                          | `Confirmed`, Anreise 12.01.2027 16:00, Abreise 14.01.2027 10:00, 1 Erwachsener, `totalGrossAmount` 337 €, kein Kommentar, keine Kfz-Angabe    |
| Leistungen (`GET …/reservations/JTKQSYFX-1/services`) | nur `TEST-FINALCLEAN` (Pflichtleistung, 13.01.2027, 139 €)                                                                                    |
| Folio `JTKQSYFX-1-1`                                  | offen, Saldo −337 €, Belastungen `TS-1` 99 €, `TS-2` 99 €, `ES-1` Endreinigung 139 €, alle nicht gebucht (`isPosted: false`), keine Zahlungen |
| Angebot (`service-offers`)                            | `TEST-ECI` für 12.01.2027 zu 20 €, verfügbar                                                                                                  |
| Reservierungsprotokoll                                | letzter Eintrag notiert (Zeitpunkt)                                                                                                           |

Ein Abweichen vom Ausgangszustand führt zum Abbruch vor jedem Schreibzugriff.

## 2. Buchung eines einfachen Service

1. STAY: `/de/v2/services/frueher-einchecken` öffnen. Preis 20 € und Datum Di., 12. Januar müssen angezeigt werden.
2. „Verbindlich buchen“ einmal anklicken.
3. Erwartet in STAY: „Gebucht.“; die Übersicht zeigt „Früher Check-in · 12. Jan. · 20 €“.
4. Erwartet im Extras-Protokoll: genau **ein** `PUT /booking/v1/reservation-actions/JTKQSYFX-1/book-service` und ein `PATCH /booking/v1/reservations/JTKQSYFX-1` (Kommentar „[Gäste-Portal …] Extras gebucht: 1x Früher Check-in“). Sonst keine Schreibzugriffe.
5. Prüfprotokoll der Brücke: Eintrag `order ok TEST-ECI` mit Idempotenzschlüssel.

## 3. Prüfung des Apaleo-Folios

- Leistungen: zusätzlich `TEST-ECI`, ein Datum 12.01.2027, Anzahl 1, 20 €.
- Folio `JTKQSYFX-1-1`: neue, nicht gebuchte Belastung „Early Check-in“, 12.01.2027, 20,00 € (7 %); Saldo −357 €.
- Reservierung: `totalGrossAmount` 357 €, Kommentarzeile wie oben.
- Reservierungsprotokoll: Eintrag der Änderung durch den Extras-Client.

## 4. Prüfung auf Doppelbuchungen

1. Denselben Klick wiederholen (gleicher Idempotenzschlüssel, z. B. Seite nicht neu laden, erneut senden): erwartet ist dasselbe Ergebnis ohne neuen `book-service`.
2. Seite neu laden: STAY zeigt „Bereits gebucht“ statt des Formulars.
3. Direkter Brückenaufruf mit neuem Schlüssel: Antwort `409 already_booked`, kein `book-service`.
4. Zwei gleichzeitige Aufrufe mit neuen Schlüsseln: beide `409` (`already_booked` oder `in_progress`), kein `book-service`.
5. Apaleo erneut lesen: `TEST-ECI` weiterhin genau einmal (ein Datum, Anzahl 1), Folio unverändert bei −357 €.

## 5. Rücknahme der Testbuchung

Erst nach einer zweiten kurzen Bestätigung im Chat, Schreibzugriffe nur auf `JTKQSYFX-1`:

1. Leistung entfernen: `RemoveService` für `TEST-ECI` auf `JTKQSYFX-1`. Die Aktion ist laut Reservierung erlaubt (`RemoveService: isAllowed true`).
2. Kommentar zurücksetzen: `PATCH /booking/v1/reservations/JTKQSYFX-1` auf den Ausgangswert (leer).
3. Lokale Daten von Extras (Bestellung, Prüfprotokoll) bleiben als Testnachweis erhalten. Sie liegen nur lokal und sind in keinem produktiven Speicher.

## 6. Prüfung des ursprünglichen Zustands

Alle Werte aus Abschnitt 1 erneut lesen. Erwartet ist die Übereinstimmung in allen Punkten:

- nur `TEST-FINALCLEAN`;
- Folio-Saldo −337 € mit den drei ursprünglichen Belastungen;
- `totalGrossAmount` 337 €;
- Kommentar leer.

Im Reservierungsprotokoll bleiben die Einträge „Leistung hinzugefügt/entfernt“ als Nachweis stehen.

## Abbruchkriterien

- Jeder Schreibzugriff auf eine andere Reservierung oder ein anderes Objekt (der Fetch-Wächter verhindert ihn).
- Ein anderer Preis als 20 € oder ein anderes Datum als der 12.01.2027.
- Mehr als ein `book-service`.
- Jede Slack-Anfrage (`hooks.slack.com`) oder ein Zugriff auf einen KV-Store.

In jedem dieser Fälle: anhalten, Zustand lesen, berichten, keine weiteren Schreibzugriffe.

## Optionaler zweiter Schritt (gesonderte Freigabe)

**Late Check-out bei Verlängerung:** `TEST-LCO` buchen, dann die Verlängerungsnacht, und prüfen, dass der Late Check-out auf die neue Abreise wandert. Abschließend klären lässt sich nur am echten System, ob Apaleo beim Verlängern selbst schon etwas mit nicht-pflichtigen Abreise-Leistungen macht. Die Rücknahme ist hier aufwendiger:

- Abreise per `amend` zurücksetzen;
- `TEST-LCO` entfernen;
- Folio prüfen.

Erst nach erfolgreichem Grundtest.
