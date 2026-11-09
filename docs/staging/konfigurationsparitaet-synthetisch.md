# Konfigurationsparität Extras → STAY (maschinell erzeugt)

Grundlage: **synthetische Testdaten – KEIN Nachweis der produktiven Konfiguration**
Snapshot: d894f309d6e2af1f80d9322f3ad6b628f081b2e08eae051e5ca5064f540c9ef9 · erzeugt 2026-11-09T07:46:03.118Z

| Kategorie          | Anzahl |
| ------------------ | ------ |
| Identisch          | 101    |
| Bewusst abweichend | 9      |
| Fehlt              | 1      |
| Fehlerhaft         | 3      |
| Nicht verifiziert  | 1      |

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
| TEST-PKW             | imageUrl                               | https://cdn.example/parken.jpg                   | Bild                                         | nicht übernommen (externe Adresse)   | kein Bild                            | Fehlt              | external_image_url                    |
| (Verlängerungsnacht) | extensionNightEnabled                  | true                                             | kein Angebot (Mindestbelegung ungültig)      | false                                | aus                                  | Bewusst abweichend | invalid_min_in_extras_imported_off    |
| (Verlängerungsnacht) | extensionDiscountPreArrivalOneNightGap | 12.5                                             | 12.5 %                                       | 13                                   | 13 %                                 | Fehlerhaft         | discount_rounded_or_clamped           |
| (Verlängerungsnacht) | extensionDiscountInHouseStandard       | 100                                              | 100 %                                        | 90                                   | 90 %                                 | Fehlerhaft         | discount_rounded_or_clamped           |
| (Verlängerungsnacht) | minSellableStayNights                  | null                                             | ungültig – kein Angebot                      | 2                                    | Angebot bei Lücke 1 oder > 2         | Bewusst abweichend | –                                     |

Identische Felder an diesem Standort: 80 (vollständige Liste im JSON).

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

Benutzer je Rolle: {"admin":1,"manager":1,"viewer":1} · Bestellungen: 0 · Anfragen: {"pending":1,"approved":2,"rejected":1} · Verlängerungen: 0

Anfragen mit nicht vollständig rekonstruierbaren Angaben: 2

- r3 (rejected): service_removed_archived_offer, decision_time_missing
- r4 (approved): service_name_missing, departure_missing
- **Slack** (Fehlt): Extras sendet alle neuen Anfragen an EINEN Webhook (Umgebungsvariable, nicht im Export). In STAY braucht jeder Standort mit Anfrage-Services ein Slack-Ziel: TEST. Wird beim Go-live gesetzt (Import-Option --slack-route).
- **Benutzer und Rollen** (Bewusst abweichend): Extras: globale Rollen admin/manager/viewer ohne Standortrechte, Passwort-Hashes. STAY: Einladungen mit Rolle und Standortrechten; Passwörter werden nie übernommen.
- **Veröffentlichung** (Bewusst abweichend): Neue Angebote entstehen als Entwurf; erst die Veröffentlichung beim Go-live macht sie für Gäste sichtbar (Prüfliste).
- **Bestellhistorie** (Bewusst abweichend): Extras behält nur die letzten 500 Bestellungen (ältere sind dort bereits verloren). STAY übernimmt alle vorhandenen ohne Gastnamen.
