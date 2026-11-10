# Prüfung der STAY-Preview (Commit `41dd3ed`)

Stand: 10.11.2026 · nur lesend geprüft, keine Apaleo-Schreibzugriffe, keine Änderung an Extras.

## Ergebnis

| Punkt                        | Ergebnis                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Deployment `41dd3ed`         | READY (`dpl_Grdy1KFvAx6Zk7n8Mn9eo5oRF9b1`), erreichbar, Region fra1                                                         |
| TEST-Schalter                | aktiv: Die App ruft für TEST die STAY-Engine auf (Logs `services.getServiceOffers`)                                         |
| Testreservierung             | `JTKQSYFX-1` gehört zum Apaleo-Objekt TEST (einzige aktive TEST-Reservierung)                                               |
| Services/Verlängerung        | **nicht sichtbar**: Apaleo antwortet 403 auf die Serviceangebote; die Seite zeigt „Services können nicht geladen werden“    |
| Sammelbuchung/Menge/Anfragen | Preview: blockiert durch dieselbe 403. Lokal mit Apaleo-Simulator: funktionieren (Anfrage, Sammelbuchung, Kapazitätsgrenze) |
| Admin                        | `guest-app-admin.vercel.app` erreichbar, keine Laufzeitfehler seit 09.11. 08:00 UTC                                         |

## Ursache und Abhilfe

STAY fordert keine eigenen Berechtigungen an; das Token erhält die Berechtigungen des Apaleo-Zugangs
der Preview. Diesem fehlen Leseberechtigungen. Benötigt werden (nur lesend):

- `reservations.read` (vorhanden: Login funktioniert)
- `offers.read` – Serviceangebote je Reservierung, Verfügbarkeit (Katalog, Mengen, Verlängerung)
- `setup.read` – Servicestammdaten und Texte DE/EN, Apartmenttypen
- `folios.read` – Zahlungsstatus und Kurtaxe

Extras verwendet dieselben plus `reservations.manage`; die Preview braucht **keine** Schreibberechtigung,
Schreiben bleibt im Code simuliert.

## Was `folios.read` konkret einschränkt

- **Zahlungsübersicht** (`/v2/payment`) und Zahlungshinweis auf der STAY-Startseite: Status „unbekannt“,
  kein Hinweis auf offene Zahlung.
- **Verlängerung, nur bei Reservierungen mit Kurtaxe:** Kurtaxe fehlt in der Vorschau; nach einer
  Verlängerung kann sie nicht nachgeprüft werden („bestätigt mit Hinweis“). `JTKQSYFX-1` hat keine
  Kurtaxe und ist davon nicht betroffen.
- Services, Mengen, Anfragen und Sammelbuchung brauchen `folios.read` nicht.

## Anmeldung

Die Login-Suche erwartet die **Reservierungsnummer** mit Suffix (`JTKQSYFX-1`), nicht die
Buchungsnummer `JTKQSYFX` (sonst „nicht gefunden“). Das Feld heißt „Buchungsnummer“; das ist
für die Preview zu beachten, eine Änderung ist nicht Teil dieses Schritts.
