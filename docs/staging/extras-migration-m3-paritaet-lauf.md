# Paritätslauf Extras ↔ STAY (automatisch erzeugt)

Erzeugt: 2026-11-09T06:39:09.077Z · Extras: aurelsommerlad/guest-services (lokaler Checkout, nur gelesen) · Apaleo: guest-services test/support/apaleo-simulator.mjs (Apaleo TEST, Stand 08.11.2026) – kein Apaleo-Zugriff · Gateway: simulated

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
| S18 Extras-Standard: keine eigenen Sprachtexte, nur allgemeiner Text (Apaleo-Namen vorrangig) | identisch |
| S19 Verlängerungsnacht: Mindestbelegung leer gespeichert (Extras: kein Angebot) | identisch |
| S20 Apartmenttyp-Beschränkung nur mit ungültigen Einträgen | identisch |
| S21 Unbekannte Buchungsart ("Request") und Reihenfolge als Text/Dezimalzahl | 1 Abweichung(en) |

## S14 Anfrage mit zu geringer Verfügbarkeit

| Schritt | Feld | Extras | STAY |
| --- | --- | --- | --- |
| 1:request | created | `true` | `false` |
| 1:request | requestedDates | `["2027-01-12"]` | `null` |
| 1:request | quoted | `15` | `null` |
| 1:request | approval | `"insufficient_availability"` | `null` |

## S15 Historischer Wahrheitswert: extensionNightEnabled = "false" (Text)

Importhinweise: `TEST:boolean_normalized:extensionNightEnabled`, `TEST:p1_boolean_differs:extensionNightEnabled`

| Schritt | Feld | Extras | STAY |
| --- | --- | --- | --- |
| 1:extension-offer | Angebot vorhanden | `true` | `false` |

## S16 Zusatzperson ohne gültigen Preis (Konfigurationsfehler)

Importhinweise: `TEST:TEST-EXTRPERSON:config_error:missing_extra_person_price`, `TEST:TEST-EXTRPERSON:p2_extra_person_price_differs`

| Schritt | Feld | Extras | STAY |
| --- | --- | --- | --- |
| 1:catalog | Reihenfolge/angezeigte Services | `["TEST-ECI","TEST-LCO","TEST-HUND","TEST-PKW","TEST-BABY","TEST-EXTRPERSON"]` | `["TEST-ECI","TEST-LCO","TEST-HUND","TEST-PKW","TEST-BABY"]` |

## S19 Verlängerungsnacht: Mindestbelegung leer gespeichert (Extras: kein Angebot)

Importhinweise: `TEST:invalid_min_nights_defaulted`, `TEST:extension_off_invalid_min_in_extras`

## S20 Apartmenttyp-Beschränkung nur mit ungültigen Einträgen

Importhinweise: `TEST:TEST-HUND:invalid_unit_group_ids_dropped`, `TEST:TEST-HUND:unit_groups_unmatchable_kept_restricted`

## S21 Unbekannte Buchungsart ("Request") und Reihenfolge als Text/Dezimalzahl

Importhinweise: `TEST:TEST-BABY:unknown_fulfillment_hidden_in_extras`, `TEST:TEST-HUND:sort_order_not_a_number`, `TEST:TEST-PKW:sort_order_rounded`

| Schritt | Feld | Extras | STAY |
| --- | --- | --- | --- |
| 1:catalog | Reihenfolge/angezeigte Services | `["TEST-ECI","TEST-PKW","TEST-LCO","TEST-BABY","TEST-EXTRPERSON","TEST-HUND"]` | `["TEST-ECI","TEST-LCO","TEST-PKW","TEST-EXTRPERSON","TEST-HUND"]` |

