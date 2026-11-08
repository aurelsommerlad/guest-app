# Paritätslauf Extras ↔ STAY (automatisch erzeugt)

Erzeugt: 2026-11-08T21:23:26.031Z · Extras: aurelsommerlad/guest-services (lokaler Checkout, nur gelesen) · Apaleo: guest-services test/support/apaleo-simulator.mjs (Apaleo TEST, Stand 08.11.2026) – kein Apaleo-Zugriff · Gateway: simulated

Bewertung und Lösung jeder Abweichung: `extras-migration-m3-paritaet.md`.

| Szenario                                                                                          | Ergebnis         |
| ------------------------------------------------------------------------------------------------- | ---------------- |
| S01 Standardreservierung: Katalog und Verlängerungsangebot                                        | 6 Abweichung(en) |
| S02 Hund bereits gebucht (aus Apaleo direkt)                                                      | 6 Abweichung(en) |
| S03 Keine Restkapazität (5 Erwachsene + 1 Kind bei max. 6)                                        | 5 Abweichung(en) |
| S04 Apartmenttyp für Parken nicht erlaubt                                                         | 6 Abweichung(en) |
| S05 Vergangener Aufenthalt                                                                        | identisch        |
| S06 Geänderter Apaleo-Preis (Früher Check-in 25 €)                                                | 6 Abweichung(en) |
| S07 Mehrtägige Buchung: Hund, 2 Parkplätze, Früher Check-in, 2 Zusatzpersonen                     | identisch        |
| S08 Ungültige Positionen: Menge über Kapazität, Hund ×2, Parken ohne Kennzeichen, Anfrage-Service | identisch        |
| S09 Verlängerung mit Hund und bestehendem Late Check-out                                          | identisch        |
| S10 Verlängerung im Haus (Status InHouse, Rabatt im Haus)                                         | identisch        |
| S11 Keine Verlängerung: Folgenacht ausgebucht                                                     | identisch        |
| S12 Verlängerung mit Lücke von genau einer Nacht (Lückenrabatt)                                   | identisch        |
| S13 Anfrage Babybett: anlegen und bestätigen                                                      | identisch        |
| S14 Anfrage mit zu geringer Verfügbarkeit                                                         | identisch        |
| S15 Historischer Wahrheitswert: extensionNightEnabled = "false" (Text)                            | 1 Abweichung(en) |
| S16 Zusatzperson ohne gültigen Preis (Konfigurationsfehler)                                       | 6 Abweichung(en) |
| S17 Inaktiver Eintrag und Sortierung ohne Reihenfolge                                             | 5 Abweichung(en) |

## S01 Standardreservierung: Katalog und Verlängerungsangebot

| Schritt   | Feld                        | Extras                                            | STAY                                                |
| --------- | --------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| 1:catalog | TEST-ECI.description        | `{"de":"Früher Check-in","en":"Early Check-in"}`  | `{"de":"Früher Check-in","en":"Früher Check-in"}`   |
| 1:catalog | TEST-LCO.description        | `{"de":"Später Check-out","en":"Late Check-out"}` | `{"de":"Später Check-out","en":"Später Check-out"}` |
| 1:catalog | TEST-HUND.description       | `{"de":"Hund","en":"Dog fee"}`                    | `{"de":"Hund","en":"Hund"}`                         |
| 1:catalog | TEST-PKW.description        | `{"de":"Parkplatz","en":"Car park"}`              | `{"de":"Parkplatz","en":"Parkplatz"}`               |
| 1:catalog | TEST-BABY.description       | `{"de":"Babybett","en":"Baby cot"}`               | `{"de":"Babybett","en":"Babybett"}`                 |
| 1:catalog | TEST-EXTRPERSON.description | `{"de":"Zusatzperson","en":"Extra person"}`       | `{"de":"Zusatzperson","en":"Zusatzperson"}`         |

## S02 Hund bereits gebucht (aus Apaleo direkt)

| Schritt   | Feld                        | Extras                                            | STAY                                                |
| --------- | --------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| 1:catalog | TEST-ECI.description        | `{"de":"Früher Check-in","en":"Early Check-in"}`  | `{"de":"Früher Check-in","en":"Früher Check-in"}`   |
| 1:catalog | TEST-LCO.description        | `{"de":"Später Check-out","en":"Late Check-out"}` | `{"de":"Später Check-out","en":"Später Check-out"}` |
| 1:catalog | TEST-HUND.description       | `{"de":"Hund","en":"Dog fee"}`                    | `{"de":"Hund","en":"Hund"}`                         |
| 1:catalog | TEST-PKW.description        | `{"de":"Parkplatz","en":"Car park"}`              | `{"de":"Parkplatz","en":"Parkplatz"}`               |
| 1:catalog | TEST-BABY.description       | `{"de":"Babybett","en":"Baby cot"}`               | `{"de":"Babybett","en":"Babybett"}`                 |
| 1:catalog | TEST-EXTRPERSON.description | `{"de":"Zusatzperson","en":"Extra person"}`       | `{"de":"Zusatzperson","en":"Zusatzperson"}`         |

## S03 Keine Restkapazität (5 Erwachsene + 1 Kind bei max. 6)

| Schritt   | Feld                  | Extras                                            | STAY                                                |
| --------- | --------------------- | ------------------------------------------------- | --------------------------------------------------- |
| 1:catalog | TEST-ECI.description  | `{"de":"Früher Check-in","en":"Early Check-in"}`  | `{"de":"Früher Check-in","en":"Früher Check-in"}`   |
| 1:catalog | TEST-LCO.description  | `{"de":"Später Check-out","en":"Late Check-out"}` | `{"de":"Später Check-out","en":"Später Check-out"}` |
| 1:catalog | TEST-HUND.description | `{"de":"Hund","en":"Dog fee"}`                    | `{"de":"Hund","en":"Hund"}`                         |
| 1:catalog | TEST-PKW.description  | `{"de":"Parkplatz","en":"Car park"}`              | `{"de":"Parkplatz","en":"Parkplatz"}`               |
| 1:catalog | TEST-BABY.description | `{"de":"Babybett","en":"Baby cot"}`               | `{"de":"Babybett","en":"Babybett"}`                 |

## S04 Apartmenttyp für Parken nicht erlaubt

| Schritt   | Feld                        | Extras                                            | STAY                                                |
| --------- | --------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| 1:catalog | TEST-ECI.description        | `{"de":"Früher Check-in","en":"Early Check-in"}`  | `{"de":"Früher Check-in","en":"Früher Check-in"}`   |
| 1:catalog | TEST-LCO.description        | `{"de":"Später Check-out","en":"Late Check-out"}` | `{"de":"Später Check-out","en":"Später Check-out"}` |
| 1:catalog | TEST-HUND.description       | `{"de":"Hund","en":"Dog fee"}`                    | `{"de":"Hund","en":"Hund"}`                         |
| 1:catalog | TEST-PKW.description        | `{"de":"Parkplatz","en":"Car park"}`              | `{"de":"Parkplatz","en":"Parkplatz"}`               |
| 1:catalog | TEST-BABY.description       | `{"de":"Babybett","en":"Baby cot"}`               | `{"de":"Babybett","en":"Babybett"}`                 |
| 1:catalog | TEST-EXTRPERSON.description | `{"de":"Zusatzperson","en":"Extra person"}`       | `{"de":"Zusatzperson","en":"Zusatzperson"}`         |

## S06 Geänderter Apaleo-Preis (Früher Check-in 25 €)

| Schritt   | Feld                        | Extras                                            | STAY                                                |
| --------- | --------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| 1:catalog | TEST-ECI.description        | `{"de":"Früher Check-in","en":"Early Check-in"}`  | `{"de":"Früher Check-in","en":"Früher Check-in"}`   |
| 1:catalog | TEST-LCO.description        | `{"de":"Später Check-out","en":"Late Check-out"}` | `{"de":"Später Check-out","en":"Später Check-out"}` |
| 1:catalog | TEST-HUND.description       | `{"de":"Hund","en":"Dog fee"}`                    | `{"de":"Hund","en":"Hund"}`                         |
| 1:catalog | TEST-PKW.description        | `{"de":"Parkplatz","en":"Car park"}`              | `{"de":"Parkplatz","en":"Parkplatz"}`               |
| 1:catalog | TEST-BABY.description       | `{"de":"Babybett","en":"Baby cot"}`               | `{"de":"Babybett","en":"Babybett"}`                 |
| 1:catalog | TEST-EXTRPERSON.description | `{"de":"Zusatzperson","en":"Extra person"}`       | `{"de":"Zusatzperson","en":"Zusatzperson"}`         |

## S15 Historischer Wahrheitswert: extensionNightEnabled = "false" (Text)

Importhinweise: `TEST:boolean_normalized:extensionNightEnabled`

| Schritt           | Feld              | Extras | STAY    |
| ----------------- | ----------------- | ------ | ------- |
| 1:extension-offer | Angebot vorhanden | `true` | `false` |

## S16 Zusatzperson ohne gültigen Preis (Konfigurationsfehler)

Importhinweise: `TEST:TEST-EXTRPERSON:config_error:missing_extra_person_price`

| Schritt   | Feld                            | Extras                                                                         | STAY                                                         |
| --------- | ------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 1:catalog | Reihenfolge/angezeigte Services | `["TEST-ECI","TEST-LCO","TEST-HUND","TEST-PKW","TEST-BABY","TEST-EXTRPERSON"]` | `["TEST-ECI","TEST-LCO","TEST-HUND","TEST-PKW","TEST-BABY"]` |
| 1:catalog | TEST-ECI.description            | `{"de":"Früher Check-in","en":"Early Check-in"}`                               | `{"de":"Früher Check-in","en":"Früher Check-in"}`            |
| 1:catalog | TEST-LCO.description            | `{"de":"Später Check-out","en":"Late Check-out"}`                              | `{"de":"Später Check-out","en":"Später Check-out"}`          |
| 1:catalog | TEST-HUND.description           | `{"de":"Hund","en":"Dog fee"}`                                                 | `{"de":"Hund","en":"Hund"}`                                  |
| 1:catalog | TEST-PKW.description            | `{"de":"Parkplatz","en":"Car park"}`                                           | `{"de":"Parkplatz","en":"Parkplatz"}`                        |
| 1:catalog | TEST-BABY.description           | `{"de":"Babybett","en":"Baby cot"}`                                            | `{"de":"Babybett","en":"Babybett"}`                          |

## S17 Inaktiver Eintrag und Sortierung ohne Reihenfolge

| Schritt   | Feld                        | Extras                                           | STAY                                              |
| --------- | --------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| 1:catalog | TEST-HUND.description       | `{"de":"Hund","en":"Dog fee"}`                   | `{"de":"Hund","en":"Hund"}`                       |
| 1:catalog | TEST-PKW.description        | `{"de":"Parkplatz","en":"Car park"}`             | `{"de":"Parkplatz","en":"Parkplatz"}`             |
| 1:catalog | TEST-BABY.description       | `{"de":"Babybett","en":"Baby cot"}`              | `{"de":"Babybett","en":"Babybett"}`               |
| 1:catalog | TEST-EXTRPERSON.description | `{"de":"Zusatzperson","en":"Extra person"}`      | `{"de":"Zusatzperson","en":"Zusatzperson"}`       |
| 1:catalog | TEST-ECI.description        | `{"de":"Früher Check-in","en":"Early Check-in"}` | `{"de":"Früher Check-in","en":"Früher Check-in"}` |
