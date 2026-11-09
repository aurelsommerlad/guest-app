# Konfigurationsparität Extras → STAY (vor M5)

Stand: 09.11.2026 · Branch `claude/sharp-rubin-hwfdyt`.

**Ergebnis in einem Satz:**

- **Nachgewiesen:** Die Logik von STAY bildet jede Einstellung, die Extras speichern oder lesen kann, ab. Sie übernimmt sie beim Import oder meldet jede Bedeutungsänderung sichtbar. Belegt ist das durch Codeprüfung, Orakeltests gegen den echten Extras-Code und Paritätsszenarien.
- **Offen:** Der Abgleich mit dem tatsächlichen produktiven Datenbestand. Der lesende M0-Export war nicht möglich, weil die Zugangsdaten in dieser Umgebung fehlen.

Bis zum M0-Lauf gilt die Konfigurationsparität deshalb **nicht** als vollständig nachgewiesen.

Vorgaben eingehalten:

- Die Extras-App ist unverändert (guest-services auf 6c5e5af, nur gelesen).
- Keine produktiven Apaleo-Schreibzugriffe.
- Keine produktiven Einstellungen geändert.
- Keine Standortumstellung.
- Online-Check-in unberührt.

## Vorgehen

1. **Extras-Code vollständig gelesen**, nicht nur die bestehende Funktionsmatrix. Geprüft wurden:
   - Datenhaltung: `lib/store.js`, `lib/db.js`
   - Admin-Routen und Formulare: `app/api/admin/*`, `components/admin/CatalogManager.jsx`
   - Buchungslogik: `lib/guest.js`, `lib/requests.js`, `lib/stayExtension.js`
   - Hilfsmodule: `catalogLocalization`, `priceDisplay`, `catalogSort`, `unitGroupRestriction`, `capacity`, `occupancy`, `occupancyAmendment`, `vehicleRegistration`, `dogBooking`, `images`
   - Slack und Rollen: `notify`, `auth`
   - Gästeoberfläche: `GuestApp.jsx`
   - Apaleo-Anbindung: `apaleo.js`
   - Umgebungsvariablen und alle KV-Schlüssel
2. **Jede Interpretation nachgebaut:** `@up/core` `extras-semantics.ts` bildet ab, wie Extras gespeicherte Werte tatsächlich liest, einschließlich seiner Eigenheiten.
3. **Orakeltests:** Diese Nachbildung läuft gegen den **echten Extras-Code** (`packages/shadow/src/extras-oracle.test.ts`) mit allen Wertefällen.
4. **Vergleichswerkzeug** `extras:config-parity`: Es stellt je Standort, Service und Feld gegenüber:
   - den gespeicherten Wert,
   - die Wirkung in Extras,
   - den STAY-Wert,
   - die Wirkung in STAY,
   - die Kategorie.

   Die Ausgabe gibt es maschinenlesbar (JSON) und als Markdown.

5. **Lücken geschlossen** (Abschnitt 3), Tests ergänzt, Paritätsszenarien S18 bis S21 hinzugefügt.

---

## 1. Feld-für-Feld-Konfigurationsmatrix

Spalten:

- **Name** und technischer Schlüssel in Extras
- **Typ/Werte**
- **Standard** beim Anlegen in Extras
- **Bedeutung**
- **Ablage Extras**
- **Ablage STAY**
- **Bearbeitung im STAY-Admin**
- **Import**: übernimmt die Importlogik den Wert korrekt?
- **Buchung**: verhält sich die spätere Buchung identisch?
- **Abweichung**

Kürzel:

- **SK:** Servicekatalog → Angebot → Konfiguration am Objekt
- **op:** Spalte in `offer_properties`
- **pss:** Spalte in `property_service_settings`

### 1.1 Serviceeinstellungen

Ablage in Extras: KV-Hash `catalog:{apaleoPropertyId}:items`, ein Feld je Apaleo-Service. Ältere Daten liegen als Array unter `catalog:{id}`; Extras migriert sie beim Lesen.

| Name (Extras)                                             | Typ / Werte                                                | Standard                           | Bedeutung                                                                 | STAY                                                                    | STAY-Admin                                       | Import                                             | Buchung                                     | Abweichung                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Service-ID `serviceId`                                    | Text (Apaleo-Service-ID)                                   | –                                  | Zuordnung zum Apaleo-Service, Schlüssel des Hash-Felds                    | op `extras_service_id` (eindeutig je Objekt)                            | SK „Apaleo-Service“                              | ja                                                 | identisch                                   | –                                                                                  |
| Code `code`                                               | Text                                                       | Apaleo-Code beim ersten Speichern  | letzter Rückfall für den Titel                                            | Angebotsgruppe `offers.legacy_key = extras:{code}`, `extras_texts.code` | – (aus Apaleo)                                   | ja                                                 | identisch                                   | gleicher Code an mehreren Standorten = **ein** zentrales Angebot (gewollt)         |
| Name `name`                                               | Text                                                       | Apaleo-Name beim Speichern         | keine Gastwirkung                                                         | nur Rückfall für den STAY-Titel                                         | –                                                | ja                                                 | identisch (ohne Wirkung)                    | –                                                                                  |
| Anzeigename `displayName`                                 | Text                                                       | Apaleo-Name beim Speichern         | allgemeiner Titel, **4. Stufe** nach eigenem Sprachtext und Apaleo-Texten | `extras_texts.displayName` (neu), zusätzlich STAY-Titel                 | SK Titel, Schalter „Texte wie in Extras“         | **korrigiert** (K-1)                               | identisch (S18)                             | vorher: STAY zeigte den allgemeinen Text vor dem Apaleo-Namen                      |
| Beschreibung `description`                                | Text                                                       | Apaleo-Beschreibung beim Speichern | allgemeine Beschreibung, 4. Stufe                                         | `extras_texts.description`, STAY-Kurzbeschreibung                       | SK Kurzbeschreibung                              | **korrigiert** (K-1)                               | identisch (S18)                             | wie oben                                                                           |
| Anzeigename DE/EN `displayNameDe`, `displayNameEn`        | Text                                                       | leer                               | eigener Titel je Sprache, 1. Stufe                                        | `extras_texts`, `title_override`                                        | SK „Abweichender Titel“                          | ja                                                 | identisch                                   | –                                                                                  |
| Beschreibung DE/EN `descriptionDe`, `descriptionEn`       | Text                                                       | leer                               | eigene Beschreibung je Sprache                                            | `extras_texts`, `teaser_override`                                       | SK „Abweichende Kurzbeschreibung“                | ja                                                 | identisch                                   | –                                                                                  |
| Preiseinheit `priceUnitLabel`                             | Text                                                       | leer                               | allgemeine Preiseinheit, gilt in Extras für **beide** Sprachen            | `extras_texts.priceUnitLabel`, `price_unit_label.de`                    | SK Preiseinheit DE/EN                            | **korrigiert** (K-1)                               | identisch (S18)                             | vorher: EN zeigte den Standardtext                                                 |
| Preiseinheit DE/EN `priceUnitLabelDe`, `priceUnitLabelEn` | Text                                                       | leer                               | eigene Preiseinheit je Sprache                                            | `extras_texts`, `price_unit_label`                                      | SK                                               | ja                                                 | identisch                                   | –                                                                                  |
| Kategorie `category`                                      | Freitext                                                   | leer                               | keine Gastwirkung (nur Extras-Admin)                                      | STAY-Kategorie wird aus Regeln abgeleitet                               | SK Angebot „Kategorie“                           | nicht übernommen                                   | ohne Wirkung                                | bewusst                                                                            |
| Bild `imageUrl`                                           | URL, Upload `/api/images/{uuid}`                           | leer                               | Bild der Kachel                                                           | Bildmigration → `offers.hero_image` bzw. `hero_image_override`          | SK Angebot „Bild“                                | ja für Uploads; **externe URLs fehlen** (gemeldet) | identisch nach Migration                    | K-7                                                                                |
| Aktiv `active`                                            | Boolean                                                    | false                              | für Gäste sichtbar                                                        | op `active`                                                             | SK „Gästen an diesem Objekt anzeigen“            | ja                                                 | identisch; Ausnahme P-1 bei `"false"`/`"0"` | P-1                                                                                |
| Berechnung `bookingRule`                                  | `per_stay` / `per_night` / `arrival_day` / `departure_day` | `per_stay`                         | welche Apaleo-Daten gebucht werden                                        | op `booking_rule`                                                       | SK „Buchungsregel“                               | ja; unbekannte Werte → `per_stay` (wie Extras)     | identisch                                   | bei unbekannter Regel zeigt STAY die Preiseinheit von `per_stay`, Extras gar keine |
| Buchungsart `fulfillmentMode`                             | `instant` / `request`                                      | `instant`                          | sofort buchen oder anfragen                                               | op `fulfillment`                                                        | SK „Buchungsart“                                 | ja; **unbekannte Werte jetzt inaktiv** (K-4)       | identisch                                   | vorher: unbekannter Wert in STAY sofort buchbar, in Extras unsichtbar              |
| Aktionstyp `actionType`                                   | `service` / `increase_occupancy`                           | `service`                          | Service buchen oder Erwachsene erhöhen                                    | op `action_type`                                                        | SK „Aktionstyp“                                  | ja                                                 | identisch                                   | –                                                                                  |
| Zusatzpersonenpreis `extraPersonPricePerNight`            | Zahl oder null (€ pro Person und Nacht)                    | null                               | Aufpreis je Person und Nacht                                              | op `extra_person_price_cents`                                           | SK „Preis pro Person/Nacht“                      | ja                                                 | identisch; Ausnahme P-2                     | P-2                                                                                |
| Apartmenttypen `allowedUnitGroupIds`                      | Liste von Unit-Group-IDs                                   | `[]` = alle                        | Einschränkung auf Apartmenttypen                                          | op `allowed_unit_group_ids`                                             | SK Apartmenttypen (Auswahl oder Liste)           | **korrigiert** (K-3)                               | identisch (S20)                             | vorher: eine Liste nur aus ungültigen IDs wurde zu „alle“                          |
| Reihenfolge `sortOrder`                                   | Zahl oder null (Dezimalzahlen möglich)                     | null = am Ende                     | Anzeigereihenfolge                                                        | op `sort_order` (Kommazahl; 1e9 = ohne Reihenfolge)                     | SK „Reihenfolge“ (Dezimalzahlen, leer = am Ende) | **korrigiert** (K-5, Nachtrag)                     | identisch, auch bei Dezimalzahlen           | vorher: Rundung; Dezimalzahlen ließen den Import scheitern                         |
| Kapazitätsabhängig `requiresRemainingCapacity`            | Boolean                                                    | false; bei Zusatzperson immer true | nur bei freier Personenkapazität                                          | op `requires_remaining_capacity`                                        | SK                                               | ja                                                 | identisch                                   | P-1 bei Textwerten                                                                 |
| Kennzeichenpflicht `requiresVehicleRegistration`          | Boolean                                                    | false                              | Kennzeichen je Stück (erstes in Apaleo, weitere im Kommentar)             | op `requires_vehicle_registration`                                      | SK                                               | ja                                                 | identisch (M3/M4)                           | P-1 bei Textwerten                                                                 |
| Maximal 1 je Reservierung `maxOnePerReservation`          | Boolean                                                    | false                              | z. B. Hund; Prüfung live gegen Apaleo                                     | op `max_one_per_reservation`                                            | SK                                               | ja                                                 | identisch                                   | P-1 bei Textwerten                                                                 |
| `updatedAt`                                               | ISO-Zeit                                                   | beim Speichern                     | nur Verwaltung                                                            | nicht übernommen (aus dem Prüfwert ausgenommen)                         | –                                                | ja                                                 | –                                           | –                                                                                  |

Preise: Extras speichert **keine Servicepreise**. Der Preis kommt immer live aus den Apaleo-Service-Angeboten. STAY verhält sich genauso; die Preisprüfung vor dem Buchen kommt hinzu (M4). Einzige Ausnahme ist der Zusatzpersonenpreis.

### 1.2 Verlängerungsnächte je Standort

Ablage in Extras: `extension-night:config:{apaleoPropertyId}`. Ablage in STAY: `property_service_settings`. Bearbeitung im STAY-Admin unter Services → Verlängerungsnächte.

| Name (Extras)                                                              | Typ      | Standard | Bedeutung                                                  | STAY (pss)                                             | Import                   | Buchung                                | Abweichung                              |
| -------------------------------------------------------------------------- | -------- | -------- | ---------------------------------------------------------- | ------------------------------------------------------ | ------------------------ | -------------------------------------- | --------------------------------------- |
| Aktiv `extensionNightEnabled`                                              | Boolean  | false    | Angebot „Eine Nacht länger“                                | `extension_night_enabled`                              | ja; **korrigiert** (K-2) | identisch (S19)                        | P-1 bei `"false"`                       |
| Rabatt vor Anreise, Lücke 1 Nacht `extensionDiscountPreArrivalOneNightGap` | Prozent  | 15       | Rückfall: Pauschalfeld, dann Standard                      | `discount_pre_arrival_one_night_gap` (ganze Zahl 0–90) | ja                       | identisch; Rundung/Begrenzung gemeldet | K-6                                     |
| Rabatt vor Anreise, Standard `extensionDiscountPreArrivalStandard`         | Prozent  | 10       | Lücke > Mindestbelegung                                    | `discount_pre_arrival_standard`                        | ja                       | identisch                              | K-6                                     |
| Rabatt im Haus, Lücke 1 Nacht `extensionDiscountInHouseOneNightGap`        | Prozent  | 20       |                                                            | `discount_in_house_one_night_gap`                      | ja                       | identisch                              | K-6                                     |
| Rabatt im Haus, Standard `extensionDiscountInHouseStandard`                | Prozent  | 15       |                                                            | `discount_in_house_standard`                           | ja                       | identisch                              | K-6                                     |
| Alt: `extensionDiscountOneNightGap`, `extensionDiscountStandard`           | Prozent  | 20 / 15  | Rückfall für beide Phasen, solange die Phasenfelder fehlen | auf die vier Phasenfelder verteilt                     | ja                       | identisch                              | –                                       |
| Mindestbelegung `minSellableStayNights`                                    | Zahl ≥ 1 | 2        | Angebot bei Lücke = 1 oder Lücke > Mindestbelegung         | `min_sellable_stay_nights` (1–30)                      | **korrigiert** (K-2)     | identisch                              | Werte > 30 werden begrenzt und gemeldet |

Unterschied vor Anreise und während des Aufenthalts:

- „Im Haus“ gilt bei Status `InHouse` oder wenn heute zwischen Anreise und Abreise liegt, sonst „vor Anreise“.
- STAY verwendet dieselbe Funktion (Szenarien S10 und S12).

Weitere Punkte sind fest im Code von Extras und STAY gleich, nicht konfigurierbar und per Parität geprüft (M3):

- Ein Rabatt gilt nie für Zusatzleistungen.
- Vorhandene Leistungen werden verlängert.
- Late Check-out wird verschoben.
- Die Kurtaxe wird geprüft.

### 1.3 Administration und Betrieb

| Bereich                      | Extras                                                                                                      | STAY                                                                | Import                                                                     | Abweichung                                                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Benutzer                     | KV `users` (Name, Passwort-Hash, Rolle)                                                                     | `admin_users` + Einladungen                                         | Einladungsliste ohne Namen und ohne Passwörter                             | bewusst: Neuanmeldung je Person                                                                                                                  |
| Rollen                       | `admin` (alles), `manager` (Katalog, Verlängerung, Anfragen), `viewer` (nur lesen); **ohne Standortrechte** | owner/manager/editor/viewer mit Standortrechten (M1)                | Rolle als Vorschlag                                                        | bewusst: Standortrechte bei der Einladung festlegen                                                                                              |
| Sitzung                      | JWT-Cookie, 30 Tage                                                                                         | STAY-Sitzungen mit Entzug                                           | –                                                                          | bewusst                                                                                                                                          |
| Serviceverwaltung            | `/admin/catalog`                                                                                            | Servicekatalog                                                      | ja                                                                         | –                                                                                                                                                |
| Standortkonfiguration        | Auswahl „Property“ im Katalog                                                                               | Objekte und Konfiguration je Objekt                                 | über `external_mappings`                                                   | –                                                                                                                                                |
| Anfragen und Entscheidungen  | `requests:items`, approve/reject ohne Begründung                                                            | `offer_requests`, Entscheidung mit Preisprüfung und Begründung (M4) | ja; **Status wird jetzt nachgeführt** (K-8)                                | Extras-Anfragen sind in STAY nur lesbar                                                                                                          |
| Bestellhistorie              | KV `orders`, **höchstens 500**                                                                              | `service_bookings`                                                  | ja, ohne Gastnamen                                                         | ältere als die letzten 500 gibt es auch in Extras nicht mehr                                                                                     |
| Verlängerungshistorie        | `stay-extensions:records`                                                                                   | `stay_extensions`                                                   | ja                                                                         | –                                                                                                                                                |
| Slack                        | **ein** Webhook `SLACK_REQUEST_WEBHOOK_URL` (Umgebung), nur „neue Anfrage“                                  | Ziel je Standort, Statusmeldungen zuschaltbar, Warteschlange        | **neu:** `--slack-route` setzt das Ziel für alle Standorte ohne Ziel (K-9) | bewusst erweitert                                                                                                                                |
| Bilderverwaltung             | Upload als Base64 in KV `image:{uuid}`, höchstens 700 KB, jeder `image/*`-Typ                               | Speicherbereich `offers`, JPEG/PNG/WebP bis 5 MB                    | Plan + Upload; **Altkataloge jetzt erfasst** (K-7)                         | GIF/SVG/HEIC → „unreadable“, muss ersetzt werden                                                                                                 |
| Veröffentlichung             | „aktiv“ wirkt sofort                                                                                        | Angebote entstehen als Entwurf                                      | –                                                                          | bewusst: Veröffentlichen ist Go-live-Schritt                                                                                                     |
| Apaleo-Serviceliste im Admin | nur `onlySoldAsExtras`                                                                                      | Apaleo-Liste im Konfigurationseditor                                | –                                                                          | im Katalog können Einträge zu Services stehen, die in Apaleo nicht mehr als Extra verkauft werden; das Vergleichswerkzeug listet sie je Standort |

### 1.4 Nur im Code festgelegt (nicht in der Oberfläche)

| Einstellung                                 | Extras                                                                 | STAY                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Hund höchstens 1, Prüfung live gegen Apaleo | `MAX_DOGS_PER_RESERVATION = 1`                                         | gleich (`maxOnePerReservation`)                                                              |
| Kennzeichen-Land                            | `DE`                                                                   | `DE`                                                                                         |
| Weitere Kennzeichen                         | Kommentar „Parking vehicles: 1. … 2. …“                                | gleich (M3-Parität)                                                                          |
| Reservierungskommentar                      | „[Gäste-Portal …] Extras gebucht: …“ und „Anfrage bestätigt: …“        | gleich                                                                                       |
| Bestätigung einer Anfrage                   | bucht **ohne** Betrag (Apaleo-Tagespreis)                              | bucht nur zum bestätigten Preis; eine Preisänderung muss ausdrücklich übernommen werden (M4) |
| Zusatzperson                                | Apaleo-Amend, `requote: false`, Aufpreis je Nacht auf jede Zeitscheibe | gleich                                                                                       |
| Vergangener Aufenthalt                      | keine Angebote (422 oder Abreise in der Vergangenheit)                 | gleich                                                                                       |
| Datumsregeln                                | nur Daten, die Apaleo anbietet; unvollständig → ausgeblendet           | gleich                                                                                       |
| Rabatt nie auf Extras                       | fest                                                                   | fest                                                                                         |
| Bestellliste                                | 500                                                                    | unbegrenzt mit Aufbewahrungsfrist                                                            |
| Bildgröße                                   | 700 KB                                                                 | 5 MB                                                                                         |

### 1.5 Umgebungsvariablen in Extras (nicht im Export)

| Variable                                    | Wirkung                        | STAY                                               |
| ------------------------------------------- | ------------------------------ | -------------------------------------------------- |
| `SLACK_REQUEST_WEBHOOK_URL`                 | Kanal für neue Anfragen        | Route je Standort, Webhooks aus der Umgebung (K-9) |
| `APP_BASE_URL` / `VERCEL_*`                 | Link in der Slack-Meldung      | Admin-URL von STAY                                 |
| `JWT_SECRET`                                | Admin-Sitzungen                | eigene Sitzungen                                   |
| `APALEO_CLIENT_ID` / `APALEO_CLIENT_SECRET` | Apaleo-Zugang                  | eigener Zugang                                     |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN`     | Datenhaltung                   | nur der lesende M0-Zugang wird verwendet           |
| `STAY_BRIDGE_*`                             | Brücke für den Schattenbetrieb | entfällt nach dem Go-live                          |

Flüchtige KV-Schlüssel werden nicht übernommen, sie haben nach dem Wechsel keine Bedeutung:

- `*:claim:*`
- `requests:slack-notified:*`
- `ratelimit:*`
- `stay-bridge:*`
- `order:*`, `request:*`, `extension:*`

---

## 2. Funktionsvergleich Extras → STAY

| Funktion                                                   | Extras               | STAY                                               | Stand                                                     |
| ---------------------------------------------------------- | -------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| Katalog je Standort aus Konfiguration und Apaleo-Angeboten | ja                   | ja                                                 | identisch (S01–S08, S17–S21)                              |
| Texte DE/EN mit Apaleo-Vorrang                             | ja                   | ja, über `extras_texts`                            | identisch seit K-1                                        |
| Sofortbuchung mit Datumsregeln                             | ja                   | ja                                                 | identisch                                                 |
| Kapazität, Zusatzpersonen                                  | ja                   | ja                                                 | identisch; 0 € nur bei ausdrücklicher Konfiguration (P-2) |
| Hund, Kennzeichen, Apartmenttypen                          | ja                   | ja                                                 | identisch                                                 |
| Anfrage anlegen                                            | ohne Prüfung         | mit Prüfung von Menge, Kapazität und Verfügbarkeit | P-4 (bewusst)                                             |
| Anfrage bestätigen                                         | bucht zum Tagespreis | bucht nur zum bestätigten Preis                    | bewusst strenger (M4)                                     |
| Anfrage ablehnen                                           | ohne Begründung      | optional interne Begründung                        | erweitert                                                 |
| Verlängerungsnacht                                         | ja                   | ja                                                 | identisch (S09–S12, S19)                                  |
| Slack                                                      | ein Kanal            | je Standort, Warteschlange, Wiederholung           | erweitert, nur simuliert                                  |
| Rollen                                                     | global               | je Standort                                        | bewusst                                                   |
| Audit                                                      | –                    | jede Änderung und Entscheidung                     | erweitert                                                 |

---

## 3. Fehlende oder abweichende Einstellungen – gefunden und behoben

| Nr.     | Befund                                                                                                                                                                                                                                                                 | Wirkung vor der Korrektur                                                                                      | Korrektur                                                                                                                                                                                                                                                                                                           | Nachweis                                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **K-1** | Texte: Extras nimmt bei leerem DE/EN-Feld den **aktuellen Apaleo-Namen** und erst danach den allgemeinen Text. STAY übernahm den allgemeinen Text als Titel. Das ist der Normalfall im Extras-Admin, denn neue Zeilen speichern den Apaleo-Namen nur in `displayName`. | Gäste hätten z. B. „Car park“ statt „Parkplatz“ gesehen; dasselbe bei Beschreibung und englischer Preiseinheit | Neue Spalte `offer_properties.extras_texts` (Migration 0021). Die Engine wendet dort die Extras-Textlogik mit Live-Apaleo-Texten an. Die erste Textänderung in STAY oder das Entfernen des Hakens „Texte wie in Extras“ schaltet auf die STAY-Texte um.                                                             | S18: vorher 3 Abweichungen, nachher identisch; Orakeltest der Textauflösung; Repository-Test für das Umschalten |
| **K-2** | Verlängerungsnacht: Eine Mindestbelegung von null, „“, 0 oder negativ bedeutet in Extras „ungültig – kein Angebot“, obwohl der Schalter an ist. STAY setzte den Standardwert 2 ein und hätte Angebote gezeigt.                                                         | neue Angebote an solchen Standorten                                                                            | Import setzt den Schalter dann auf aus und meldet `extension_off_invalid_min_in_extras`. Dezimalzahlen werden abgerundet; die Entscheidungen bleiben gleich.                                                                                                                                                        | S19 identisch; 13 Wertefälle getestet                                                                           |
| **K-3** | Apartmenttypen: Eine Liste nur aus ungültigen Einträgen beschränkt in Extras auf „keinen Typ“. STAY verwarf die Einträge und bekam „alle Typen“.                                                                                                                       | z. B. Hund in allen Apartments buchbar                                                                         | Platzhalter `__extras_no_match__` hält die Einschränkung, Meldung im Bericht                                                                                                                                                                                                                                        | S20 identisch; Test                                                                                             |
| **K-4** | Unbekannte Buchungsart (z. B. „Request“): in Extras in keiner Liste sichtbar, in STAY sofort buchbar                                                                                                                                                                   | plötzlich buchbarer Service                                                                                    | Import als inaktiv, Meldung                                                                                                                                                                                                                                                                                         | S21; Test                                                                                                       |
| **K-5** | Reihenfolge: Der Extras-Admin nimmt Dezimalzahlen an (Eingabefeld ohne Schrittweite, gespeichert per `Number()`). STAY speicherte nur ganze Zahlen, und „ohne Reihenfolge“ lag bei 1000.                                                                               | falsche Reihenfolge, abgebrochener Import                                                                      | Nachtrag: `sort_order` als Kommazahl (Migration 0022), exakte Übernahme ohne Rundung. „Ohne Reihenfolge“ = 1e9. Der STAY-Admin nimmt Dezimalzahlen an („1,5“) und zeigt sie an. Text-Werte kommen wie in Extras ans Ende.                                                                                           | Tests (Werte, Reihenfolge 1/1,5/2/10000/leer, DB-Rundlauf, Admin); S21 Reihenfolge identisch                    |
| **K-6** | Rabatte: STAY speichert ganze Prozent 0–90. 12,5 %, 100 % oder Negativwerte wurden still gerundet bzw. begrenzt.                                                                                                                                                       | anderer Preis                                                                                                  | Rundung und Begrenzung werden je Feld gemeldet (`discount_rounded`/`discount_clamped`) und im Werkzeug als „fehlerhaft“ markiert. Entscheidung nötig, falls M0 solche Werte zeigt (Abschnitt 8).                                                                                                                    | Tests                                                                                                           |
| **K-7** | Bilder: Altkataloge (Array-Format) wurden im Bildplan übersehen; externe Bild-URLs wurden still ignoriert                                                                                                                                                              | fehlende Bilder                                                                                                | Bildplan nutzt dieselbe Eintragsliste wie der Import; externe URLs werden gelistet („Fehlt“)                                                                                                                                                                                                                        | Test                                                                                                            |
| **K-8** | Anfragen: Wurde eine schon importierte Anfrage später in Extras entschieden, blieb sie in STAY „offen“.                                                                                                                                                                | doppelte Entscheidung nach dem Go-live möglich                                                                 | Ein erneuter Import führt Status, gebuchte Daten, Slack-Zeitpunkt und Entscheidungszeitpunkt nach (`synced_from_extras`). Nachtrag: Bestätigungs- und Ablehnungszeitpunkt aus Extras stehen in `handled_at`, mit dem externen Bearbeiter `handled_by_external = "Extras (migriert)"` – ohne künstlichen STAY-Admin. | Tests                                                                                                           |
| **K-9** | Slack: Der Extras-Kanal steht in der Umgebung, nicht im Export; in STAY hätte jeder Standort ohne Ziel `no_slack_route` erhalten                                                                                                                                       | keine Benachrichtigung                                                                                         | Import-Option `--slack-route <name>` für alle Standorte ohne Ziel; ein bestehendes STAY-Ziel wird nie ersetzt                                                                                                                                                                                                       | Test                                                                                                            |
| K-10    | P-1/P-2-Fälle wurden bisher nur pauschal als „normalisiert“ gemeldet                                                                                                                                                                                                   | betroffene Konfigurationen nicht erkennbar                                                                     | eigene Meldungen `p1_boolean_differs:*` und `p2_extra_person_price_differs` nur dort, wo sich die Wirkung wirklich ändert                                                                                                                                                                                           | Tests für alle Wertefälle                                                                                       |

Geprüft und **ohne Befund** (identisch übernommen):

- `serviceId`, `code`, `actionType`, `bookingRule`
- `requiresVehicleRegistration`, `maxOnePerReservation`, `requiresRemainingCapacity` (bis auf P-1)
- die vier Rabatte und ihre Pauschalfeld-Rückfälle
- Zusatzpersonen-Erzwingung (sofort + Kapazität)
- Bestell- und Verlängerungshistorie

---

## 4. Nachweis der korrekten Übernahme einschließlich Standardwerten

### 4.1 Standardwerte

Für jedes Feld wurden die geforderten Fälle geprüft: fehlendes Feld, `""`, `null`, `undefined`, `0`, `"0"`, `false`, `"false"`, `true`, `"true"`, dazu Dezimal-, Negativ- und Textwerte. Je Fall gibt es vier Spalten:

1. gespeicherter Wert
2. Wirkung in Extras, belegt durch den echten Extras-Code
3. Wirkung in STAY
4. Zielverhalten

**Wahrheitswerte** (`active` und die drei Regeln):

| Gespeichert                                    | Extras | STAY    | Zielverhalten                                   |
| ---------------------------------------------- | ------ | ------- | ----------------------------------------------- |
| fehlt, `""`, `null`, `undefined`, `0`, `false` | aus    | aus     | identisch                                       |
| `true`, `"true"`                               | an     | an      | identisch                                       |
| `"0"`, `"false"`                               | **an** | **aus** | P-1: STAY korrigiert; gemeldet je Konfiguration |
| `"ja"`, `"1"`, `"on"`, `1`                     | an     | an      | identisch                                       |
| `"nein"`, `"no"`, beliebiger anderer Text      | **an** | **aus** | P-1-Familie; gemeldet                           |

**Zusatzpersonenpreis:**

| Gespeichert                          | Extras                   | STAY                            | Zielverhalten                           |
| ------------------------------------ | ------------------------ | ------------------------------- | --------------------------------------- |
| fehlt, `undefined`, `"abc"`, negativ | ausgeblendet             | gesperrt (Konfigurationsfehler) | identisch für Gäste (nicht buchbar)     |
| `null`, `""`, `false`                | **0 € – gratis buchbar** | **gesperrt**                    | P-2: nie versehentlich gratis; gemeldet |
| `0`, `"0"`                           | 0 €                      | 0 €                             | identisch (ausdrücklich gratis)         |
| `true`                               | 1 €                      | gesperrt                        | P-2-Familie; gemeldet                   |
| `"35"`, `35.5`                       | 35 € / 35,50 €           | gleich                          | identisch                               |
| `"35,50"`                            | **ausgeblendet**         | 35,50 €                         | bewusst (Komma ist gemeint); gemeldet   |

**Verlängerungsnacht, Schalter:**

| Gespeichert                | Extras | STAY    | Zielverhalten |
| -------------------------- | ------ | ------- | ------------- |
| fehlt, `null`, `undefined` | aus    | aus     | identisch     |
| `"false"`, `"0"`           | **an** | **aus** | P-1; gemeldet |

**Verlängerungsnacht, Mindestbelegung:**

| Gespeichert                                | Extras           | STAY                | Zielverhalten             |
| ------------------------------------------ | ---------------- | ------------------- | ------------------------- |
| fehlt                                      | 2                | 2                   | identisch                 |
| `null`, `""`, `0`, `"0"`, `false`, negativ | **kein Angebot** | jetzt: Schalter aus | identisch (K-2)           |
| `true`                                     | 1                | 1                   | identisch                 |
| `2.5`                                      | Lücke > 2,5      | Lücke > 2           | identische Entscheidungen |
| `50`                                       | Lücke > 50       | Lücke > 30          | gemeldet                  |

**Verlängerungsnacht, Rabatte:**

| Gespeichert                | Extras                      | STAY       | Zielverhalten  |
| -------------------------- | --------------------------- | ---------- | -------------- |
| fehlt                      | Pauschalfeld, dann Standard | gleich     | identisch      |
| `null`, `""`, `0`, `false` | 0 %                         | 0 %        | identisch      |
| `"abc"`                    | Rückfall                    | Rückfall   | identisch      |
| `12.5`                     | 12,5 %                      | 13 %       | gemeldet (K-6) |
| `100` / `-5`               | 100 % / −5 %                | 90 % / 0 % | gemeldet (K-6) |

**Weitere Felder:**

| Feld           | Gespeichert                      | Extras                        | STAY                 | Zielverhalten   |
| -------------- | -------------------------------- | ----------------------------- | -------------------- | --------------- |
| Buchungsart    | fehlt, `""`, `null`, `"instant"` | sofort                        | sofort               | identisch       |
| Buchungsart    | `"request"`                      | Anfrage                       | Anfrage              | identisch       |
| Buchungsart    | anderer Text                     | unsichtbar                    | inaktiv              | identisch (K-4) |
| Reihenfolge    | fehlt, `null`, `""`, Text        | am Ende                       | 9999 = am Ende       | identisch (K-5) |
| Apartmenttypen | fehlt, kein Array, `[]`          | alle                          | alle                 | identisch       |
| Apartmenttypen | nur ungültige Einträge           | keiner                        | keiner (Platzhalter) | identisch (K-3) |
| Texte          | leer                             | Apaleo, dann allgemeiner Text | gleich               | identisch (K-1) |

### 4.2 Übernahme in die Datenbank (Round-Trip)

`config-parity.test.ts` importiert einen Datenbestand mit allen Sonderfällen in eine echte Postgres-Instanz (PGlite) und weist nach:

- **Werte:** Jede gespeicherte STAY-Zeile entspricht Feld für Feld dem geplanten Wert, bei Konfiguration, Texten und Verlängerungseinstellungen.
- **Meldungen:** Jede Interpretation steht im Importbericht.
- **Wiederholbarkeit:** Ein zweiter Import desselben Stands ändert nichts.
- **Änderungen in Extras** werden übernommen.
- **Änderungen in STAY** bleiben erhalten und werden als Konflikt gemeldet.
- **Entscheidungen in Extras** werden nachgeführt, ohne doppelte Datensätze.
- **Slack:** Ein bestehendes Slack-Ziel in STAY wird nicht ersetzt.

### 4.3 Paritätsszenarien (echter Extras-Code gegen dieselbe simulierte Apaleo-Instanz)

21 Szenarien:

- **17 identisch**, darunter neu S18, S19, S20.
- **4 bewusste Abweichungen:**
  - S14: P-4
  - S15: P-1
  - S16: P-2
  - S21: Die unbekannte Buchungsart ist in STAY ausgeblendet. Die Extras-Schnittstelle liefert sie zwar aus, die Extras-Oberfläche zeigt sie aber nicht. Die Reihenfolge mit 1,5 ist seit dem Nachtrag identisch.

Bericht: `docs/staging/extras-migration-m3-paritaet.json` und `-lauf.md`.

---

## 5. Tatsächlicher Datenabgleich (M0)

**Nicht durchgeführt – offen.**

- `KV_REST_API_URL` und `KV_REST_API_READ_ONLY_TOKEN` sind in dieser Umgebung nicht gesetzt (geprüft am 09.11.2026, 0 von 2).
- Es wurden keine anderen Tokens verwendet und keine Zugriffsrechte umgangen.

Vorbereitet ist der Ablauf in drei Schritten, sobald beide Werte in den Umgebungseinstellungen hinterlegt sind (nicht im Chat):

1. Export, nur lesend:

   ```
   pnpm --filter @up/admin extras:export --source kv --confirm-production-read --out <Verzeichnis außerhalb des Repos>
   ```

2. Vergleich je Standort, Service und Feld:

   ```
   pnpm --filter @up/admin extras:config-parity --snapshot <dir>/snapshot.json --manifest <dir>/manifest.json --json <dir>/paritaet.json --md <dir>/paritaet.md
   ```

3. Trockenlauf des Imports auf Staging mit Bericht.

Das Werkzeug markiert das Ergebnis nur bei einem verifizierten Produktions-Snapshot als „m0-export“. Diese Dateien werden nicht eingecheckt.

Beispielausgabe auf synthetischen Daten mit allen Sonderfällen, ausdrücklich **kein** Nachweis:

- `docs/staging/konfigurationsparitaet-synthetisch.md` und `.json`
- Eingabe: `konfigurationsparitaet-synthetisch-eingabe.json`

## 6. Produktive Konfigurationen, die von P-1, P-2 oder P-4 betroffen wären

**Nicht ermittelbar ohne M0.** Das Werkzeug erstellt die Liste automatisch, Abschnitt „Betroffene Konfigurationen“:

- **P-1:** jede Konfiguration, bei der ein gespeicherter Wahrheitswert in Extras anders wirkt als in STAY (`"false"`, `"0"`, `"nein"` …), einschließlich Verlängerungsschalter.
- **P-2:** jede Zusatzperson mit gespeichertem `null`, `""`, `false`, `true` oder Komma-Preis.
- **P-4:** jeder aktive Anfrage-Service. Hier ändert sich nur das Verhalten bei zu wenig Verfügbarkeit: STAY lehnt dann schon beim Anlegen ab.
- **Verlängerung:** jeder Standort mit geänderter Wirkung (ungültige Mindestbelegung, gerundeter oder begrenzter Rabatt).

Einschätzung aus dem Code: Der Extras-Admin speichert Wahrheitswerte immer als echte Booleans und Preise als Zahl oder `null`. P-1-Fälle entstehen also nur durch alte oder manuell bearbeitete Daten.

**P-2 ist dagegen bei jeder Zusatzperson ohne eingetragenen Preis zu erwarten.** Der Extras-Admin speichert ein leeres Preisfeld als `null`, und Extras bietet die Zusatzperson dann gratis an.

## 7. Ergebnisse der automatisierten Tests

Vollständiger Lauf mit Typecheck, Lint und Tests in allen Paketen: siehe unten.

| Paket        | Tests            | Neu in diesem Schritt                                                                                                                                                                             |
| ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| core         | 502              | Extras-Semantik (über Orakel und Import abgedeckt)                                                                                                                                                |
| db           | 312 (vorher 206) | 105 Konfigurationsparität (Standardwerte, Regeln, Rabatte, Apartmenttypen, Reihenfolge, Bilder, unbekannte Felder, Round-Trip, Wiederholung, Konflikte, Statusabgleich, Slack-Ziel) + 1 Textmodus |
| integrations | 91               | –                                                                                                                                                                                                 |
| shadow       | 34 (vorher 28)   | 6 Orakeltests gegen den echten Extras-Code                                                                                                                                                        |
| admin        | 132              | –                                                                                                                                                                                                 |
| guest        | 241              | –                                                                                                                                                                                                 |
| ui           | 45               | –                                                                                                                                                                                                 |

Die Paritätsszenarien S18 bis S21 kamen hinzu, Ergebnis siehe 4.3.

## 8. Offene Risiken und Entscheidungen

| Thema                                                    | Art                                                                                                 | Vorschlag                                                                                                                       |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| M0-Datenabgleich fehlt                                   | **Blocker für den Nachweis**                                                                        | Zugangsdaten hinterlegen, Export und Vergleich ausführen, Ergebnis abnehmen                                                     |
| Rabatte mit Dezimalstellen, über 90 % oder negativ (K-6) | Entscheidung, falls M0 solche Werte zeigt                                                           | entweder STAY-Spalten erweitern (Dezimal, 0–100) oder Wert mit dem Standort abstimmen                                           |
| Mindestbelegung über 30                                  | Entscheidung, falls vorhanden                                                                       | Grenze anheben                                                                                                                  |
| Externe Bild-URLs, nicht lesbare Bildtypen               | manuelle Nacharbeit                                                                                 | vor dem Go-live in STAY hochladen                                                                                               |
| Anfragen zu nicht mehr katalogisierten Services          | Nachtrag: als Historie an einem archivierten Angebot mit dem ursprünglichen Servicenamen übernommen | Nicht rekonstruierbare Angaben stehen je Anfrage im Importbericht (`history:*`)                                                 |
| Entscheidungszeitpunkt aus Extras                        | Nachtrag: übernommen, Bearbeiter „Extras (migriert)“                                                | Extras speichert nicht, wer entschieden hat; fehlt der Zeitpunkt, wird keiner erfunden (Meldung)                                |
| Konflikte durch STAY-Testkonfigurationen                 | sichtbar im Importbericht, nie überschrieben                                                        | vor dem Go-live je Konflikt entscheiden: Extras übernehmen oder STAY behalten. Testkonfigurationen bleiben auf TEST beschränkt. |
| Gleichstand der Reihenfolge                              | Extras-Reihenfolge hängt von der Redis-Einfügereihenfolge ab                                        | gemeldet als „nicht verifiziert“; bei Bedarf eindeutige Reihenfolge setzen                                                      |
| Slack-Ziel je Standort                                   | Entscheidung                                                                                        | ein gemeinsamer Kanal wie heute (`--slack-route`) oder getrennte Kanäle                                                         |
| Benutzernamen im Export                                  | Der M0-Export behält Benutzernamen (für Einladungen)                                                | Export nie einchecken, nach dem Import löschen                                                                                  |

## 9. Methode für Datenmigration und Synchronisierung

1. **Bis zum Go-live ist Extras führend.** STAY schreibt nie nach Extras. Testkonfigurationen in STAY gibt es nur am Objekt TEST.
2. **Wiederholbarer Import ohne Duplikate:**
   - Schlüssel: `legacy_key`, `legacy_id` und Prüfwert je Eintrag.
   - Unveränderte Einträge bleiben unberührt, geänderte werden aktualisiert.
   - In STAY geänderte Einträge werden als **Konflikt** gemeldet und nicht überschrieben. STAY-eigene Texte und Bilder bleiben.
3. **Änderungen in Extras während der Entwicklung:** Jeder neue M0-Export kann als Trockenlauf eingespielt werden; der Bericht zeigt create, update, unchanged, conflict und skip je Eintrag. Anfrage-Entscheidungen werden nachgeführt (K-8).
4. **Delta unmittelbar vor dem Go-live:**
   1. Extras-Admin sperren (Zustand `extras_locked`).
   2. Export.
   3. `extras:config-parity`: Ziel sind 0 „Fehlerhaft“ und 0 „Fehlt“ ohne Entscheidung, alle „Nicht verifiziert“ geklärt.
   4. Trockenlauf und Abnahme der Konflikte.
   5. Import mit `--apply --images --upload-images --slack-route …`.
   6. Abgleich (`reconcile`).
   7. Angebote veröffentlichen.
   8. Umschalten.
5. **Bilder:**
   - Prüfsummen-adressierter Upload.
   - Altkataloge sind enthalten.
   - Externe und nicht lesbare Bilder werden gelistet.
6. **Offene Anfragen:** Sie kommen als Extras-Anfragen (nur lesbar) mit aktuellem Status. Nach dem Umschalten entscheidet das Team in STAY nur neue Anfragen. Für offene Extras-Anfragen ist eine Liste in der Go-live-Prüfliste vorgesehen.
7. **Historie:** Bestellungen und Verlängerungen werden je Extras-ID genau einmal übernommen, ohne Gastnamen, mit Aufbewahrungsfrist.
8. **Vollständigkeitsnachweis:**
   - `migration_items` hält je KV-Eintrag die Aktion und den Grund fest.
   - Paritäts-JSON und Snapshot-Prüfsumme werden mit dem Importlauf archiviert.
   - `reconcile` zählt Quelle gegen Ziel.
9. **Rückfall:** Solange Extras unverändert läuft, ist der Rückweg das Entsperren von Extras. Konzept aus M2, wird in M5 geübt.

## 10. Kann STAY die bestehende Extras-Konfiguration vollständig ersetzen?

- **Logisch ja.** Für jede Einstellung, die Extras speichern oder lesen kann, gibt es ein Gegenstück in STAY:
  - Datenmodell, Admin-Bearbeitung, Import und gleiche Wirkung.
  - Ausnahmen sind die dokumentierten, bewussten Korrekturen P-1, P-2 und P-4.
  - K-6-Werte, die STAY nicht darstellen kann, werden gemeldet statt still verändert.
- **Nachgewiesen** ist das für den Code, alle Wertefälle (Orakeltests gegen den echten Extras-Code) und die Paritätsszenarien.
- **Nicht verifiziert** ist es für den produktiven Datenbestand: welche Standorte, Services, Werte, Texte und Bilder es tatsächlich gibt und ob dort P-1-, P-2- oder K-6-Fälle vorkommen. Das kann nur der lesende M0-Export zeigen.

## 11. Empfehlung zu M5

M5 sollte erst beginnen, wenn der M0-Datenabgleich vorliegt. Alternativ wird der M0-Abgleich als **verbindlicher erster Schritt** in M5 aufgenommen, bevor die Generalprobe startet.

- Für die Generalprobe ist kein weiterer Code nötig.
- Ohne M0 kann das Abnahmekriterium aber nicht bestätigt werden: Keine Einstellung darf verloren gehen oder unbemerkt ihre Bedeutung ändern.
- Werkzeug, Import und Tests dafür sind fertig. Es fehlen nur die beiden lesenden Zugangsdaten und eine Entscheidung zu eventuellen K-6-Werten.
