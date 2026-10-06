# Apaleo-Vorbefüllung des Online-Check-ins

Stand: Phase 11.2. Architektur: [ADR 0016, Abschnitt 4a](../adr/0016-guest-journey-and-online-check-in.md).

## Verifizierte Grundlage

Quelle wie beim [Write-back](apaleo-registration-writeback.md): offizieller Client `@apaleo/angular-api-proxy-booking` 19.0.29 (generiert aus der Booking-API-Spezifikation). Es wird **kein** neuer Endpunkt genutzt: `GET /booking/v1/reservations/{id}`, Scope `reservations.read` (derselbe Aufruf wie bisher).

| Apaleo (`ReservationModel` / `GuestModel`)                  | Check-in-Feld                             | Hinweis                                                                                                 |
| ----------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `adults` (Pflicht)                                          | Belegung: Erwachsene                      | Quelle der Personenzahl                                                                                 |
| `childrenAges[]`                                            | Belegung: Kinder (Anzahl), Alter          | Alter nur informativ                                                                                    |
| `primaryGuest`                                              | Person 1 (Hauptgast)                      |                                                                                                         |
| `additionalGuests[]`                                        | Person 2 … n in Apaleo-Reihenfolge        | fehlen sie, bleiben die Personen leer                                                                   |
| `firstName`, `lastName`                                     | `firstName`, `lastName`                   |                                                                                                         |
| `email`                                                     | `email`                                   | Relay-Adressen (`…@guest.booking.com`) werden verworfen                                                 |
| `phone`                                                     | `phone`                                   | Freitext in Apaleo → nur übernommen, wenn als Mobilnummer gültig; gespeichert E.164                     |
| `birthDate`                                                 | `birthDate`                               | Zeitanteil abgeschnitten, Plausibilität (nicht in der Zukunft, ab 1900)                                 |
| `nationalityCountryCode`                                    | `nationality`                             | ISO 3166-1 alpha-2                                                                                      |
| `address.addressLine1`, `postalCode`, `city`, `countryCode` | `street`, `postalCode`, `city`, `country` | `addressLine2`, `regionCode` werden nicht erhoben                                                       |
| `identificationNumber` + `identificationType`               | `documentNumber`, `documentType`          | nur `PassportNumber` → Reisepass, `IdNumber` → Personalausweis; nur wenn das Objekt Ausweisdaten erhebt |

Bewusst **nicht** genutzt: `booker` (kann eine Agentur oder eine andere Person sein), Firma, Präferenzen, Zahlungsdaten. Das Parse-Schema (`apaleoReservationPrefillSchema`) verwirft alle nicht deklarierten Felder; die Daten bleiben im Speicher und werden nicht geloggt (Logs: Registrierungs-ID, Anzahl Personen).

## Ablauf

1. Erster Aufruf des Check-ins (`confirmTrip`) bzw. Belegungsabgleich: `getReservationGuests`.
2. `prefillGuests` (`@up/core`) normalisiert mit denselben Regeln wie Gasteingaben und erhebt nur Felder der Objektkonfiguration bzw. die festen Kontaktfelder.
3. `seedRegistrationGuests` schreibt nur leere Positionen eines Entwurfs (`ON CONFLICT DO NOTHING`), markiert `prefilled_fields`.
4. Fehler/Timeout von Apaleo → keine Vorbefüllung, der Check-in funktioniert normal.

## Offene Punkte

- Mit echten Testreservierungen (Objekt „TEST“) prüfen, wie Kanäle `additionalGuests` und `phone` tatsächlich befüllen.
- Weitere Relay-Domains (z. B. anderer Kanäle) erst nach Nachweis in `RELAY_EMAIL_DOMAINS` aufnehmen.
