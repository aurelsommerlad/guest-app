# Paritätslauf Extras ↔ STAY (automatisch erzeugt)

Erzeugt: 2026-11-09T00:00:21.062Z · Extras: aurelsommerlad/guest-services (lokaler Checkout, nur gelesen) · Apaleo: guest-services test/support/apaleo-simulator.mjs (Apaleo TEST, Stand 08.11.2026) – kein Apaleo-Zugriff · Gateway: simulated

Bewertung und Lösung jeder Abweichung: `extras-migration-m3-paritaet.md`.

| Szenario | Ergebnis |
| --- | --- |
| S01 Standardreservierung: Katalog und Verlängerungsangebot | identisch |
| S02 Hund bereits gebucht (aus Apaleo direkt) | identisch |
| S03 Keine Restkapazität (5 Erwachsene + 1 Kind bei max. 6) | identisch |
| S04 Apartmenttyp für Parken nicht erlaubt | identisch |
| S05 Vergangener Aufenthalt | identisch |
| S06 Geänderter Apaleo-Preis (Früher Check-in 25 €) | identisch |
| S07 Mehrtägige Buchung: Hund, 2 Parkplätze, Früher Check-in, 2 Zusatzpersonen | identisch |
| S08 Ungültige Positionen: Menge über Kapazität, Hund ×2, Parken ohne Kennzeichen, Anfrage-Service | identisch |
| S09 Verlängerung mit Hund und bestehendem Late Check-out | identisch |
| S10 Verlängerung im Haus (Status InHouse, Rabatt im Haus) | identisch |
| S11 Keine Verlängerung: Folgenacht ausgebucht | identisch |
| S12 Verlängerung mit Lücke von genau einer Nacht (Lückenrabatt) | identisch |
| S13 Anfrage Babybett: anlegen und bestätigen | identisch |
| S14 Anfrage mit zu geringer Verfügbarkeit | 4 Abweichung(en) |
| S15 Historischer Wahrheitswert: extensionNightEnabled = "false" (Text) | 1 Abweichung(en) |
| S16 Zusatzperson ohne gültigen Preis (Konfigurationsfehler) | 1 Abweichung(en) |
| S17 Inaktiver Eintrag und Sortierung ohne Reihenfolge | identisch |

## S14 Anfrage mit zu geringer Verfügbarkeit

| Schritt | Feld | Extras | STAY |
| --- | --- | --- | --- |
| 1:request | created | `true` | `false` |
| 1:request | requestedDates | `["2027-01-12"]` | `null` |
| 1:request | quoted | `15` | `null` |
| 1:request | approval | `"insufficient_availability"` | `null` |

## S15 Historischer Wahrheitswert: extensionNightEnabled = "false" (Text)

Importhinweise: `TEST:boolean_normalized:extensionNightEnabled`

| Schritt | Feld | Extras | STAY |
| --- | --- | --- | --- |
| 1:extension-offer | Angebot vorhanden | `true` | `false` |

## S16 Zusatzperson ohne gültigen Preis (Konfigurationsfehler)

Importhinweise: `TEST:TEST-EXTRPERSON:config_error:missing_extra_person_price`

| Schritt | Feld | Extras | STAY |
| --- | --- | --- | --- |
| 1:catalog | Reihenfolge/angezeigte Services | `["TEST-ECI","TEST-LCO","TEST-HUND","TEST-PKW","TEST-BABY","TEST-EXTRPERSON"]` | `["TEST-ECI","TEST-LCO","TEST-HUND","TEST-PKW","TEST-BABY"]` |

