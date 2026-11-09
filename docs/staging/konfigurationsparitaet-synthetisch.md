# Konfigurationsparität Extras → STAY (maschinell erzeugt)

Grundlage: **synthetische Testdaten – KEIN Nachweis der produktiven Konfiguration**
Snapshot: 1f73727e19b562afab10820f30e32dff9f98e999560f01e2304b559f852318b1 · erzeugt 2026-11-09T06:47:37.388Z

| Kategorie          | Anzahl |
| ------------------ | ------ |
| Identisch          | 100    |
| Bewusst abweichend | 9      |
| Fehlt              | 1      |
| Fehlerhaft         | 3      |
| Nicht verifiziert  | 2      |

## Standort LEGACY

Reihenfolge: Identisch – Extras: LEGACY-LCO · STAY: LEGACY-LCO

| Service              | Feld                  | Gespeichert | Wirkung Extras  | Wert STAY | Wirkung STAY | Kategorie          | Grund      |
| -------------------- | --------------------- | ----------- | --------------- | --------- | ------------ | ------------------ | ---------- |
| (Verlängerungsnacht) | extensionNightEnabled | false       | Angebot möglich | false     | aus          | Bewusst abweichend | p1_boolean |

Identische Felder an diesem Standort: 19 (vollständige Liste im JSON).

## Standort TEST

Reihenfolge: Identisch – Extras: TEST-ECI, TEST-PKW, TEST-BABY, TEST-EXTRPERSON, TEST-HUND · STAY: TEST-ECI, TEST-PKW, TEST-BABY, TEST-EXTRPERSON, TEST-HUND

| Service              | Feld                                   | Gespeichert                                      | Wirkung Extras                               | Wert STAY                            | Wirkung STAY                         | Kategorie          | Grund                                 |
| -------------------- | -------------------------------------- | ------------------------------------------------ | -------------------------------------------- | ------------------------------------ | ------------------------------------ | ------------------ | ------------------------------------- |
| TEST-ALT             | active                                 | false                                            | true                                         | false                                | false                                | Bewusst abweichend | hidden_in_extras_by_unknown_mode      |
| TEST-ALT             | bookingRule                            | weekly                                           | per_stay                                     | per_stay                             | per_stay                             | Bewusst abweichend | unknown_rule_label_default            |
| TEST-ALT             | fulfillmentMode                        | Request                                          | hidden                                       | instant                              | hidden                               | Bewusst abweichend | unknown_mode_imported_inactive        |
| TEST-BABY            | imageUrl                               | /api/images/33333333-3333-4333-8333-333333333333 | Bild                                         | Bildmigration                        | Bild problematisch: unreadable       | Fehlerhaft         | –                                     |
| TEST-ECI             | category                               |                                                  | ohne Wirkung für Gäste (nur im Extras-Admin) | STAY-Kategorie aus Regeln abgeleitet | Gruppierung in der STAY-Oberfläche   | Bewusst abweichend | free_text_category_not_used_by_guests |
| TEST-EXTRPERSON      | extraPersonPricePerNight               | null                                             | 0.00 € pro Person/Nacht                      | null                                 | nicht buchbar (Konfigurationsfehler) | Bewusst abweichend | p2_price                              |
| TEST-HUND            | allowedUnitGroupIds                    | ["TEST-DOG","kein gültiger Typ"]                 | nur TEST-DOG, kein gültiger Typ              | ["TEST-DOG"]                         | nur TEST-DOG                         | Bewusst abweichend | –                                     |
| TEST-PKW             | sortOrder                              | 1.5                                              | 1.5                                          | 2                                    | 2                                    | Nicht verifiziert  | sort_order_rounded                    |
| TEST-PKW             | imageUrl                               | https://cdn.example/parken.jpg                   | Bild                                         | nicht übernommen (externe Adresse)   | kein Bild                            | Fehlt              | external_image_url                    |
| (Verlängerungsnacht) | extensionNightEnabled                  | true                                             | kein Angebot (Mindestbelegung ungültig)      | false                                | aus                                  | Bewusst abweichend | invalid_min_in_extras_imported_off    |
| (Verlängerungsnacht) | extensionDiscountPreArrivalOneNightGap | 12.5                                             | 12.5 %                                       | 13                                   | 13 %                                 | Fehlerhaft         | discount_rounded_or_clamped           |
| (Verlängerungsnacht) | extensionDiscountInHouseStandard       | 100                                              | 100 %                                        | 90                                   | 90 %                                 | Fehlerhaft         | discount_rounded_or_clamped           |
| (Verlängerungsnacht) | minSellableStayNights                  | null                                             | ungültig – kein Angebot                      | 2                                    | Angebot bei Lücke 1 oder > 2         | Bewusst abweichend | –                                     |

Identische Felder an diesem Standort: 79 (vollständige Liste im JSON).

## Betroffene Konfigurationen

- P-1 (Wahrheitswerte): LEGACY:extension extensionNightEnabled="false"; TEST:TEST-ALT active="false"
- P-2 (Zusatzpersonenpreis): TEST:TEST-EXTRPERSON gespeichert null → Extras 0 / STAY gesperrt
- P-4 (Anfrage-Services, Prüfung schon beim Anlegen): TEST:TEST-BABY
- Verlängerungsnacht mit geänderter Wirkung: TEST (invalid_min_in_extras), TEST (discount_changed:extensionDiscountPreArrivalOneNightGap), TEST (discount_changed:extensionDiscountInHouseStandard)
- Unbekannte Felder: TEST:TEST-ALT.price

## Bilder

Geplant: 1 · mit Hinweisen: 1 · externe Adressen: 1

- 33333333: unreadable (TEST:TEST-BABY)
- extern: TEST:TEST-PKW

## Betrieb

Benutzer je Rolle: {"admin":1,"manager":1,"viewer":1} · Bestellungen: 0 · Anfragen: {"pending":1,"approved":1} · Verlängerungen: 0

- **Slack** (Fehlt): Extras sendet alle neuen Anfragen an EINEN Webhook (Umgebungsvariable, nicht im Export). In STAY braucht jeder Standort mit Anfrage-Services ein Slack-Ziel: TEST. Wird beim Go-live gesetzt (Import-Option --slack-route).
- **Benutzer und Rollen** (Bewusst abweichend): Extras: globale Rollen admin/manager/viewer ohne Standortrechte, Passwort-Hashes. STAY: Einladungen mit Rolle und Standortrechten; Passwörter werden nie übernommen.
- **Veröffentlichung** (Bewusst abweichend): Neue Angebote entstehen als Entwurf; erst die Veröffentlichung beim Go-live macht sie für Gäste sichtbar (Prüfliste).
- **Bestellhistorie** (Bewusst abweichend): Extras behält nur die letzten 500 Bestellungen (ältere sind dort bereits verloren). STAY übernimmt alle vorhandenen ohne Gastnamen.
