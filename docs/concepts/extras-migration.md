# Extras-App in STAY: Bestandsaufnahme, Zielarchitektur und Migrationsplan

Stand: 08.11.2026 (überarbeitet nach den Architekturentscheidungen vom 08.11.2026; M1 umgesetzt, siehe `docs/staging/extras-migration-m1-bericht.md`).

**Grundlage**

- Code von `aurelsommerlad/guest-services`, Branch `claude/stay-api-bridge` (enthält Production-Stand `9844259` plus Brücke und die Korrektur für Anfrage-Bestätigungen);
- STAY (`aurelsommerlad/guest-app`, Branch `claude/sharp-rubin-hwfdyt`);
- Vercel-Projektkonfiguration (nur Namen);
- Apaleo-Stammdaten (nur lesend).

**Nicht gelesen:** die produktiven Extras-Daten im KV-Store. Der lesende Export ist vorbereitet (M0, `docs/staging/extras-m0-export.md`) und wird erst nach gesonderter Freigabe ausgeführt.

**Entscheidung (08.11.2026):** Die Extras-App wird vollständig in STAY integriert und danach stillgelegt. Das betrifft Gästeoberfläche, Administration, Einstellungen, Geschäftsregeln, Integrationen und Daten. Die API-Brücke ist eine Übergangslösung.

**Verbindliche Entscheidungen (08.11.2026, zweite Runde)**

- **Gemeinsamer Go-live statt Umstellung je Objekt.** Extras bleibt für alle Objekte produktiv, bis STAY vollständig live geht. Kein Objekt wird vorher einzeln umgestellt. STAY schreibt bis dahin nur in isolierten Test-/Staging-Umgebungen. Es gibt nie zwei produktive Apaleo-Schreiber. Danach bleibt Extras als Rückfall erhalten und wird erst nach erfolgreicher Prüfung stillgelegt.
- **Katalog:** ein zentraler Katalog für eigene Services und später Partnerangebote. Ein Angebot kann mehreren Objekten zugeordnet sein; Preis, Regeln, Verfügbarkeit, Texte und Sichtbarkeit sind je Objekt konfigurierbar, inklusive Apartmenttyp- und Kapazitätsregeln. Keine doppelte Pflege.
- **Administration:** alle Extras-Einstellungen im STAY-Admin. Rollen Owner/Admin/Manager/Viewer, auf Objekte beschränkbar. Neue Konten nur per STAY-Einladung; alte Passwörter werden nicht übernommen. Rechteänderungen wirken sofort.
- **Buchung:** Extras-Logik vollständig übernehmen; Apaleo bleibt führend. STAY bekommt eine eigene zentrale Apaleo-Schreibschnittstelle mit verlässlicher Idempotenz, Sperren, Audit und Fehlerbehandlung. Die Extras-Tests sind Referenz.
- **Anfragen und Kommunikation:** Bestätigen/Ablehnen im STAY-Admin, Slack aus STAY; Gast-Benachrichtigungen vorbereitet, nicht aktiviert. Bestellungen, Anfragen und Verlängerungen bleiben nachvollziehbar.
- **Daten:** eine STAY-Datenbank mit Mandanten-/Objekttrennung. Eine STAY-Production-Datenbank wird geplant, aber nicht eingerichtet. Personendaten nur, soweit nötig; Aufbewahrung historischer Buchungsdaten und operativer Gastdaten getrennt betrachten.

---

## 1. Funktionsmatrix

**Legende**

| Zeichen | Bedeutung                                                                                                             |
| ------- | --------------------------------------------------------------------------------------------------------------------- |
| ✅      | in STAY vollständig vorhanden und von STAY selbst betrieben                                                           |
| 🟡      | teilweise: vorhanden, aber unvollständig oder nur über die Extras-Brücke (STAY zeigt an, Extras rechnet und schreibt) |
| ❌      | fehlt in STAY                                                                                                         |

### 1.1 Administration: Seiten und Zugang

| Extras-Funktion                        | Details in Extras                                                                        | STAY heute                                                                                                      | Status                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Admin-Login                            | Benutzername + Passwort (bcrypt), JWT-Cookie 30 Tage, `sameSite=lax`, kein Login-Limit   | E-Mail + Passwort (scrypt), Server-Sessions 12 h, `__Host-`-Cookie, `SameSite=Strict`, widerrufbar, Login-Limit | ✅ (STAY ist strenger) |
| Ersteinrichtung                        | `/admin/setup`, solange es keinen Benutzer gibt                                          | `/setup` mit `ADMIN_SETUP_TOKEN`, CLI `admin-user:create`                                                       | ✅                     |
| Eigenes Passwort ändern                | `PATCH users/me/password`                                                                | nicht in der Oberfläche                                                                                         | ❌                     |
| Benutzerverwaltung                     | anlegen, Rolle ändern, löschen; letzter Admin geschützt; Passwort-Reset nur über die API | nur per CLI, keine Oberfläche                                                                                   | ❌                     |
| Rollen                                 | `admin`, `manager`, `viewer` (siehe 1.10)                                                | **keine Rollen**, jede Person mit Admin-Zugang darf im Mandanten alles                                          | ❌                     |
| Navigation mit Zähler offener Anfragen | „Anfragen (n)“                                                                           | Modulgruppe „services“ angelegt, aber leer                                                                      | ❌                     |
| Objekt-Auswahl                         | Apaleo-Properties live (`GET /inventory/v1/properties`)                                  | Objekte aus der STAY-Datenbank, im Admin nur lesbar; Objektkontext über die URL                                 | 🟡                     |

### 1.2 Servicekatalog (pro Objekt)

Extras speichert pro Objekt und Apaleo-Service einen Eintrag (`catalog:{propertyId}:items`). Die Liste in der Oberfläche besteht aus **allen Apaleo-Services mit `onlySoldAsExtras=true`**, überlagert mit der Kuratierung.

| Einstellung (Feld)                                                 | Bedeutung                                                               | STAY heute                                                                                           | Status                                  |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Apaleo-Serviceliste je Objekt                                      | Quelle der Zeilen; nicht mehr existierende Services werden ausgeblendet | STAY liest keine Apaleo-Services                                                                     | ❌                                      |
| `active` „Im Gäste-Portal anzeigen“                                | Sichtbarkeit                                                            | `offers.status` (draft/published/archived), pro Angebot, nicht pro Objekt                            | 🟡                                      |
| `displayName`, `displayNameDe/En`                                  | Anzeigename + Übersetzungen                                             | `offers.title` (de/en), redaktionell, tenantweit                                                     | 🟡 (anderes Modell)                     |
| `description`, `descriptionDe/En`                                  | Beschreibung                                                            | `offers.teaser`/`body`/`details` (de/en)                                                             | 🟡                                      |
| Lokalisierungskette                                                | Override → Apaleo-Sprache → andere Sprache → generisch → Code           | nur STAY-Texte; Fallback auf Extras-Name über die Brücke                                             | 🟡                                      |
| `category`                                                         | Freitext, Gästen nicht angezeigt                                        | feste Kategorien (Anreise/Abreise, Mobilität …)                                                      | 🟡                                      |
| `imageUrl`                                                         | ein Bild (KV, base64, ≤ 700 KB)                                         | `hero_image` + Galerie (Supabase Storage, ≤ 8 MB, Prüfung der Bytes); Admin-Modul für Angebote fehlt | 🟡                                      |
| `sortOrder`                                                        | Reihenfolge (leer = zuletzt)                                            | `offer_properties.sort_order`                                                                        | 🟡 (keine Admin-Oberfläche)             |
| `actionType` `service` / `increase_occupancy`                      | Leistung buchen oder Reservierung um Personen erweitern                 | –                                                                                                    | ❌                                      |
| `extraPersonPricePerNight`                                         | Aufpreis pro Person und Nacht (nur Zusatzperson)                        | –                                                                                                    | ❌                                      |
| `bookingRule` `per_stay`/`per_night`/`arrival_day`/`departure_day` | welche Apaleo-Daten gebucht werden                                      | –                                                                                                    | ❌                                      |
| `fulfillmentMode` `instant`/`request`                              | sofort oder auf Anfrage (Zusatzperson immer sofort)                     | `offers.fulfillment` (instant/request/link)                                                          | 🟡 (Begriff vorhanden, Logik in Extras) |
| `priceUnitLabel`, `…De/En`                                         | Preiseinheit, Standard je Buchungsregel                                 | Preiseinheit aus der Buchungsregel abgeleitet (STAY-Text)                                            | 🟡                                      |
| `requiresRemainingCapacity`                                        | nur bei freier Personenkapazität zeigen                                 | –                                                                                                    | ❌                                      |
| `requiresVehicleRegistration`                                      | Kennzeichen pro Fahrzeug                                                | Eingabe in STAY über die Brücke; keine Einstellung in STAY                                           | 🟡                                      |
| `maxOnePerReservation`                                             | höchstens 1 (z. B. Hund), live in Apaleo geprüft                        | über die Brücke                                                                                      | 🟡                                      |
| `allowedUnitGroupIds`                                              | nur für bestimmte Apartmenttypen                                        | – (STAY kennt Einheiten, aber keine Apaleo-Unit-Groups)                                              | ❌                                      |
| Unit-Group-Liste je Objekt                                         | Apaleo `GET /inventory/v1/unit-groups`                                  | –                                                                                                    | ❌                                      |
| Speichern pro Zeile, nie löschen                                   | Ausblenden über `active`                                                | –                                                                                                    | ❌                                      |
| Altdaten-Migration `catalog:{pid}` → Hash                          | einmalig beim Lesen                                                     | –                                                                                                    | (entfällt)                              |

**Verknüpfung heute:** STAY-Angebote können über `offer_properties.extras_service_id` auf einen Extras-Eintrag verweisen. Preis und Verfügbarkeit kommen dann über die Brücke. Eine eigene Pflege der Extras-Einstellungen in STAY gibt es nicht.

### 1.3 Preis- und Verfügbarkeitsregeln

| Regel                                                                               | Extras                         | STAY heute                                        | Status        |
| ----------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------- | ------------- |
| Preis = Apaleo-Angebotspreis je Datum (`service-offers`) × Nächte                   | `getGuestCatalog`              | über die Brücke                                   | 🟡            |
| Nur Daten, die Apaleo anbietet; unvollständige Datumsmengen → Leistung ausgeblendet | `resolveRequiredDates`         | über die Brücke                                   | 🟡            |
| Vergangener Aufenthalt → kein Katalog                                               | `isPastDate` / Apaleo 422      | STAY hat Reisephasen; Extras-Teil über die Brücke | 🟡            |
| Restkapazität = `maxPersons` − (Erwachsene + Kinder)                                | `capacity.js`                  | –                                                 | ❌            |
| Apartmenttyp-Einschränkung (unbekannt = nicht erlaubt)                              | `unitGroupRestriction.js`      | –                                                 | ❌            |
| Hund: Anzahl aus `count`, nicht aus der Zahl der Daten; jede Quelle                 | `dogBooking.js`                | über die Brücke                                   | 🟡            |
| Bereits gebucht erkennen                                                            | nur bei `maxOnePerReservation` | Brücke: jede bereits gebuchte Leistung            | 🟡            |
| Preisprüfung direkt vor der Buchung                                                 | Neuberechnung des Katalogs     | Brücke: zusätzlich `expectedPrice`                | 🟡            |
| Saison, Wochentag, Reisephase, Vorlauf                                              | –                              | STAY-Verfügbarkeitsregeln (`isOfferAvailable`)    | ✅ (nur STAY) |

### 1.4 Buchungs- und Anfrageprozesse (Gast)

| Prozess                                                                                                          | Extras                                                                  | STAY heute                                                          | Status             |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------ |
| Gast-Zugang                                                                                                      | Buchungsnummer + Nachname, OTA-Referenz, Mehrdeutigkeit → 409, IP-Limit | eigener Zugang (Link/Login, Gastkontext); Extras-Lookup nicht nötig | ✅ (anders gelöst) |
| Sofortbuchung (Warenkorb, mehrere Leistungen)                                                                    | `POST /api/guest/order`, mehrere Zeilen                                 | eine Leistung je Vorgang über die Brücke                            | 🟡                 |
| Kennzeichen: erstes in `primaryGuest.vehicleRegistration`, weitere im Kommentar                                  | `vehicleRegistration.js`                                                | über die Brücke                                                     | 🟡                 |
| Reservierungskommentar „[Gäste-Portal …] Extras gebucht: …“                                                      | ja                                                                      | über die Brücke                                                     | 🟡                 |
| Anfrage („Auf Anfrage“) mit Name, optional E-Mail                                                                | `createGuestRequest`                                                    | über die Brücke, ohne Name/E-Mail-Eingabe (Name aus Apaleo)         | 🟡                 |
| Bestätigungsseiten, Fehlermeldungen (16 Fehlerschlüssel)                                                         | DE/EN                                                                   | STAY-Texte DE/EN                                                    | 🟡                 |
| Zusatzperson (Reservierung ändern, `requote:false`)                                                              | `increaseReservationOccupancy`                                          | über die Brücke                                                     | 🟡                 |
| Verlängerungsnacht (Angebot, Rabatt nach Phase und Lücke, Extras, Kurtaxe, Late-Check-out-Verschiebung, Prüfung) | `getStayExtensionOffer` / `confirmStayExtension`                        | über die Brücke                                                     | 🟡                 |
| Idempotenz, Replay-Schutz                                                                                        | Sperren ohne Ablauf (KV)                                                | Brücke: Idempotenzschlüssel; STAY selbst nur für eigene Aktionen    | 🟡                 |

### 1.5 Freigaben und Ablehnungen

| Funktion                                                                | Extras                               | STAY heute                                                   | Status |
| ----------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------ | ------ |
| Liste der Anfragen mit Status, Gast, Zeitraum, Menge, Preis             | `/admin/requests`                    | `offer_requests`-Tabelle vorbereitet, keine Admin-Oberfläche | ❌     |
| Bestätigen: Live-Prüfung, Buchung aller Pflichtdaten, Kommentar, Status | `approveRequest` (korrigiert 08.11.) | –                                                            | ❌     |
| Ablehnen: nur Status, keine Gast-Benachrichtigung                       | `rejectRequest`                      | –                                                            | ❌     |
| Gast-Benachrichtigung bei Entscheidung                                  | **gibt es nicht**                    | –                                                            | –      |
| Status in der Gästeansicht                                              | –                                    | „Gebucht & angefragt“ (über die Brücke)                      | 🟡     |

### 1.6 Bestellhistorie und Status

| Funktion                                                               | Extras                                                         | STAY heute                                   | Status |
| ---------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------- | ------ |
| Bestellungen (`orders`): Datum, Reservierung, Gast, Positionen, Preise | Liste, **auf 500 Einträge begrenzt**, nicht atomar geschrieben | – (nur Tagessummen in `offer_metrics_daily`) | ❌     |
| Filter nach Objekt                                                     | API ja, Oberfläche nein                                        | –                                            | ❌     |
| Prüfprotokoll der Brücke                                               | geschrieben, nirgends angezeigt                                | –                                            | ❌     |
| Gebuchte Leistungen je Reservierung (aus Apaleo, jede Quelle)          | über die Brücke                                                | „Gebucht & angefragt“                        | 🟡     |

### 1.7 Verlängerungsnächte und Zusatzpersonen

| Funktion                                                                                                                                                                | Extras                                                     | STAY heute | Status |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------- | ------ |
| Einstellungen je Objekt: aktiv, Rabatt vor Anreise (1-Nacht-Lücke / Standard), Rabatt im Aufenthalt (1-Nacht-Lücke / Standard), Mindestbelegung; Altfelder als Fallback | `extension-night:config:{pid}`                             | –          | ❌     |
| Admin-Liste „Verlängerungsnächte“ mit Filter (Objekt, Status), Detail (Preis, Extras, Late-Check-out, Kurtaxe, Prüfungen)                                               | `/admin/stay-extensions`, mit Live-Anreicherung aus Apaleo | –          | ❌     |
| Zusatzperson als eigene Einstellung (Preis pro Person/Nacht)                                                                                                            | im Katalog                                                 | –          | ❌     |

### 1.8 Slack-Benachrichtigungen

| Funktion                                                                                                              | Extras                                                         | STAY heute                                         | Status                            |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------- | --------------------------------- |
| Neue Anfrage → Slack-Webhook (Extra, Objekt, Gast, Reservierung, Zeitraum, Datum, Preis, Button „Anfrage bearbeiten“) | `notifyNewRequest`, Dedup, kein automatischer Wiederholversuch | – (`offer_requests.slack_notified_at` vorbereitet) | ❌                                |
| Meldung bei Sofortbuchung                                                                                             | nur Konsolen-Log (`notifyFrontOffice`)                         | –                                                  | ❌ (in Extras auch nicht wirksam) |
| Mehrere Kanäle, je Objekt                                                                                             | ein globaler Webhook                                           | –                                                  | ❌                                |

### 1.9 Apaleo-Integration

| Aufruf                                                               | Extras | STAY heute                                             | Status      |
| -------------------------------------------------------------------- | ------ | ------------------------------------------------------ | ----------- |
| Token (Client Credentials)                                           | ja     | ja, mit Single-Flight und Erneuerung                   | ✅          |
| Reservierung lesen (inkl. `timeSlices`, `actions`, `assignedUnits`)  | ja     | Grundlesen ja; Erweiterungen nein                      | 🟡          |
| Reservierungssuche (Buchungs-ID, Textsuche, OTA)                     | ja     | STAY-eigener Zugang                                    | ✅ (anders) |
| Service-Angebote `service-offers`                                    | ja     | –                                                      | ❌          |
| Services auf der Reservierung                                        | ja     | –                                                      | ❌          |
| Service-Definition (lokalisiert, `availability.mode`, `postNextDay`) | ja     | –                                                      | ❌          |
| Properties, Services (`onlySoldAsExtras`), Unit-Groups               | ja     | –                                                      | ❌          |
| Verfügbarkeit Unit-Group/Unit pro Nacht                              | ja     | –                                                      | ❌          |
| Folios mit Belastungen (Kurtaxe)                                     | ja     | ja (Zahlungsübersicht)                                 | ✅          |
| **`book-service`** (eine Anfrage mit allen Daten)                    | ja     | –                                                      | ❌          |
| **`amend`** (Zusatzperson, Verlängerung)                             | ja     | –                                                      | ❌          |
| **`PATCH`** Kommentar, Kennzeichen                                   | ja     | `PATCH` vorhanden (Check-in-Rückschrieb, abgeschaltet) | 🟡          |

### 1.10 Benutzerrollen und Berechtigungen

| Recht                                          | admin | manager | viewer                       | STAY heute |
| ---------------------------------------------- | ----- | ------- | ---------------------------- | ---------- |
| Bestellungen, Anfragen, Verlängerungen ansehen | ✔     | ✔       | ✔                            | –          |
| Anfragen bestätigen/ablehnen                   | ✔     | ✔       | – (Knöpfe sichtbar, API 403) | –          |
| Katalog, Verlängerungs-Einstellungen, Bilder   | ✔     | ✔       | –                            | –          |
| Benutzer verwalten                             | ✔     | –       | –                            | nur CLI    |
| Objektbezogene Rechte                          | –     | –       | –                            | –          |

**Schwächen in Extras:**

- Rollen- und Löschänderungen wirken erst nach bis zu 30 Tagen (kein Widerruf).
- Kein Login-Limit, kein CSRF-Schutz außer `sameSite=lax`.

STAY hat die sichere Sitzungsbasis, aber gar keine Rollen.

### 1.11 Datenmodelle und vorhandene Daten (Extras-KV)

| Datenbestand                             | Schlüssel                               | Inhalt                                                                                   | Personenbezug    | Ziel in STAY                                               | Status                   |
| ---------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------- | ------------------------ |
| Benutzer                                 | `users`                                 | Benutzername, bcrypt-Hash, Rolle, Erstellt                                               | ja (Namen)       | `admin_users` + Rollen (Hash nicht übertragbar, siehe 3.4) | ❌                       |
| Katalog                                  | `catalog:{pid}:items` (+ Alt-Schlüssel) | siehe 1.2                                                                                | nein             | Katalogtabellen (2.3)                                      | ❌                       |
| Verlängerungs-Einstellungen              | `extension-night:config:{pid}`          | siehe 1.7                                                                                | nein             | Objekteinstellungen                                        | ❌                       |
| Bestellungen                             | `orders` (≤ 500)                        | Reservierung, Buchungs-ID, Gastname, Positionen, Preise                                  | ja               | Buchungshistorie                                           | ❌                       |
| Anfragen                                 | `requests:items`                        | Reservierung, Gastname, E-Mail, Service, Menge, Daten, Preis, Status, Zeitstempel, Slack | ja               | `offer_requests` (erweitert)                               | 🟡 (Tabelle vorbereitet) |
| Verlängerungen                           | `stay-extensions:records`               | Daten, Preis, Rabatt, Extras, Late-Check-out, Kurtaxe, Prüfungen, Status                 | Reservierungs-ID | Buchungshistorie                                           | ❌                       |
| Bilder                                   | `image:{uuid}`                          | base64 + Typ                                                                             | nein             | Supabase Storage                                           | ❌                       |
| Prüfprotokoll Brücke                     | `stay-bridge:audit`                     | Aktion, Ergebnis, IDs                                                                    | nein             | Buchungs-Audit                                             | ❌                       |
| Sperren, Limits, Slack-Dedup, Idempotenz | diverse                                 | technisch                                                                                | nein             | ersetzt durch Datenbank-Mechanismen, nicht migriert        | –                        |

### 1.12 Bilder und Medien

| Extras                                                                                                                      | STAY                                                                                                                                                        | Status |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| ein Bild je Katalogeintrag, im KV als base64, ≤ 700 KB, nur MIME-Prüfung, öffentlich unter `/api/images/{id}`, nie gelöscht | Supabase Storage mit signiertem Upload, Bytes-Prüfung, ≤ 8 MB, jpeg/png/webp, `ContentImage` mit Alt-Text de/en; Module `guide`, `explore` (`offers` fehlt) | 🟡     |

### 1.13 Sonderfälle

Alle in Extras umgesetzt. In STAY nur über die Brücke 🟡 oder gar nicht ❌.

- OTA-Referenzsuche, Mehrdeutigkeit, Nachnamenvergleich ohne Akzente: ✅ in STAY entbehrlich (eigener Zugang).
- Pflicht-Leistungen (Endreinigung) nie anfassen; Late Check-out nur bei `Departure` + `postNextDay` verschieben: 🟡
- Kurtaxe nur aus der Folio-Belastung, nie aus der Konfiguration: 🟡
- `book-service` ersetzt die ganze Datumsmenge, daher immer **ein** Aufruf mit allen Daten und nie eine vorhandene Buchung überschreiben: 🟡
- Admin-Texte und Apaleo-Kommentare immer auf Deutsch: ❌
- Verlängerung: Lücke 0 → nichts, Lücke 1 → 1-Nacht-Rabatt, 1 < Lücke ≤ Mindestbelegung → nichts, sonst Standardrabatt; Phase nur für den Rabatt: 🟡
- Unbekannte Unit-Group → nicht erlaubt; unbekannte `maxPersons` → Kapazität 0 (fail closed): ❌

### 1.14 Bestehende Tests als Referenz

| Testdatei                                                                                | Inhalt                                                                 | Portierung nach STAY                         |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------- |
| `book-service`, `request-approval`                                                       | ein Aufruf mit allen Daten, Bestätigung aller Pflichtdaten, Idempotenz | Pflicht (Buchungsmotor)                      |
| `stay-extension` (≈ 1.800 Zeilen), `extension-config`, `stay-extension-admin`            | Verlängerung komplett                                                  | Pflicht                                      |
| `dog-booking`, `dog-booking-order`                                                       | Hunde-Limit                                                            | Pflicht                                      |
| `capacity`, `occupancy`, `occupancy-amendment`                                           | Kapazität, Zusatzperson                                                | Pflicht                                      |
| `unit-group-restriction`, `vehicle-registration`                                         | Apartmenttypen, Kennzeichen                                            | Pflicht                                      |
| `catalog-localization`, `catalog-sort`, `price-display`, `price-unit-label-persistence`  | Darstellung, Katalog                                                   | Pflicht (Admin + Katalog)                    |
| `catalog-concurrency`, `set-if-not-exists`                                               | parallele Speicherungen, Sperren                                       | durch Datenbanktests ersetzt                 |
| `request-flow`                                                                           | Anfrage-Lebenszyklus                                                   | Pflicht                                      |
| `reservation-matching`, `guest-lookup-rate-limit`, `reservation-summary`                 | Gast-Lookup                                                            | entfällt (STAY-Zugang), Regeln dokumentieren |
| `admin-login-cookie`                                                                     | Cookie-Flags                                                           | durch STAY-Auth-Tests abgedeckt              |
| `dog-booking-ui`, `catalog-item-price-alignment`, `admin-stay-extensions-layout`, `i18n` | Oberfläche (Quelltextprüfungen)                                        | als STAY-Komponententests neu                |
| `stay-bridge`, `stay-bridge-unit`                                                        | Brücke                                                                 | entfällt mit der Brücke                      |

### 1.15 Einstellungen aus Extras, die in STAY noch fehlen

| Bereich                          | Fehlende Einstellungen                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Servicekatalog je Objekt**     | Auswahl aus den Apaleo-Services (`onlySoldAsExtras`), `active` je Objekt, `actionType`, `extraPersonPricePerNight`, `bookingRule`, `fulfillmentMode` mit Buchungslogik, `priceUnitLabel` (+ de/en), `requiresRemainingCapacity`, `requiresVehicleRegistration`, `maxOnePerReservation`, `allowedUnitGroupIds` (mit Unit-Group-Liste aus Apaleo), `sortOrder` in einer Oberfläche, Bild je Service in einer Oberfläche, Anzeigename/Beschreibung je Objekt |
| **Verlängerungsnacht je Objekt** | `extensionNightEnabled`, vier Rabattsätze (vor Anreise / im Aufenthalt × 1-Nacht-Lücke / Standard), `minSellableStayNights`                                                                                                                                                                                                                                                                                                                               |
| **Benutzer und Rollen**          | Benutzerverwaltung in der Oberfläche, Rollen admin/manager/viewer, eigenes Passwort ändern                                                                                                                                                                                                                                                                                                                                                                |
| **Benachrichtigungen**           | Slack-Webhook für neue Anfragen                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Betrieb**                      | Anfragen-Warteschlange mit Bestätigen/Ablehnen, Bestellhistorie, Verlängerungsliste                                                                                                                                                                                                                                                                                                                                                                       |

---

## 2. Zielarchitektur

### 2.1 Grundsätze

1. **Eine Datenbank** (Supabase/Postgres) für Katalog, Einstellungen, Rollen, Buchungen, Anfragen, Verlängerungen, Medienverweise und Audit. Mandantenspalte und zusammengesetzte Fremdschlüssel wie bisher. RLS aktiv, Data API gesperrt.
2. **Apaleo bleibt führend für die Reservierung.** Was gebucht ist, steht in Apaleo; STAY speichert Vorgänge, Entscheidungen und Nachweise, aber keinen zweiten „Wahrheitsstand“ der Leistungen.
3. **Genau ein produktiver Schreiber je Mandant:** bis zum Go-live Extras, danach STAY. Der Wechsel gilt für alle Objekte gleichzeitig (siehe 3.2 und `docs/concepts/extras-go-live.md`).
4. **Ein zentraler Katalog**, keine doppelte Pflege. Ein Angebot (`offers`) hat Texte und Bilder einmal; je Objekt (`offer_properties`) liegen Apaleo-Service, Buchungsregeln, Sichtbarkeit, Apartmenttypen, Kapazität und optionale Text-/Preis-Overrides. Preise kommen live aus Apaleo bzw. aus den Einstellungen für Zusatzperson und Verlängerung.
5. **Eigene Services und Partnerangebote** in einem Katalog und einer Administration, unterschieden durch `kind`.

### 2.2 Bausteine

| Baustein                                | Inhalt (Stand M1)                                                                                                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/guest`                            | Gäste-Oberfläche (V2), Buchung, Anfrage, Verlängerung, „Gebucht & angefragt“ – heute über die Brücke, ab M3 über die eigene Buchungslogik                                                      |
| `apps/admin`                            | eine Administration: Inhalte, **Team** (Rollen, Objekte, Einladungen; M1 umgesetzt), ab M2 **Services & Erlebnisse**, **Betrieb**, **Einstellungen**                                           |
| `packages/core/admin`                   | Rollen- und Rechtemodell `can()` (M1 umgesetzt)                                                                                                                                                |
| `packages/core/booking`                 | Extras-Buchungsregeln 1:1 portiert, 160 Extras-Tests als Referenz (M1 umgesetzt)                                                                                                               |
| `packages/integrations/apaleo/services` | Lesezugriffe (Service-Angebote, gebuchte Services, Definitionen, Unit-Groups) und das **zentrale Schreib-Gateway** (Idempotenz, Sperre, Richtlinien, Audit) – in M1 nur `disabled`/`simulated` |
| `packages/integrations/extras`          | lesender Export (M0) mit Prüfsummen und anonymisierter Bestandsaufnahme                                                                                                                        |
| `packages/db`                           | Migration 0018, Repositories, Import und Abgleich (M1-D)                                                                                                                                       |
| Benachrichtigungen                      | `notification_outbox` (M1); Versand-Worker für Slack in M4                                                                                                                                     |

### 2.3 Datenmodell (umgesetzt in Migration 0018)

**Bestehend und erweitert**

- `offers`: zentraler Katalogeintrag, `legacy_key` = `extras:<Service-Code>` für importierte Einträge.
- `offer_properties` = **Objektkonfiguration eines Angebots**: `extras_service_id` (Apaleo-Service des Objekts), `active`, `sort_order`, `action_type`, `booking_rule`, `fulfillment`, `extra_person_price_cents`, `currency`, `price_unit_label`, `requires_remaining_capacity`, `requires_vehicle_registration`, `max_one_per_reservation`, `allowed_unit_group_ids`, Text-/Bild-Overrides, Preis-/Verfügbarkeits-Overrides für Partnerangebote, Import-Buchhaltung (`legacy_key`, `imported_hash`, `imported_at`), `updated_by`. CHECKs und ein Trigger erzwingen: Zusatzperson immer sofort und nur mit Restkapazität; Apaleo-Felder nur bei eigenen Services; Overrides nur bei Partnerangeboten.
- `offer_requests`: zusätzlich `apaleo_service_id`, `quantity`, `requested_dates`, `booked_service_dates`, `source` (`stay`/`extras`), `legacy_id`.
- `admin_users`: `role` (`owner|admin|manager|viewer`), `property_scope` (`all|selected`). Bestehende Konten wurden Owner.

**Neu**

- `admin_user_properties` (Objektrechte), `admin_invitations` (nur Token-Hash, Ablauf, einmalig).
- `property_service_settings`: Verlängerungsnacht (aktiv, vier Rabatte, Mindestnächte), Slack-Route.
- `tenant_service_settings`: **produktiver Schreiber** (`extras|stay`) und Go-live-Zustand; Änderung nur über die Go-live-Prozedur (Datenbank-Trigger).
- `service_bookings` + `service_booking_items` (unbegrenzt, Idempotenzschlüssel), `stay_extensions`.
- `apaleo_write_operations`: zentrales Schreibprotokoll mit eindeutigem Idempotenzschlüssel, Anfrage-Hash, Status, Sperrfrist.
- `admin_audit_events` (nur anfügbar, Trigger), `notification_outbox` (Dedup, Versuche; Gast-Kanäle unterdrückt), `migration_runs` + `migration_items`.

Sperren und Idempotenz laufen über Datenbank-Transaktionen (`FOR UPDATE`, eindeutige Schlüssel, Advisory Locks) statt über KV-Sperren ohne Ablauf.

### 2.4 Rollen und Berechtigungen

Umgesetzt in `packages/core/src/admin/permissions.ts`; Details in `docs/staging/extras-migration-m1-bericht.md`.

| Recht                                                         | owner | admin          | manager | viewer |
| ------------------------------------------------------------- | ----- | -------------- | ------- | ------ |
| Inhalte (Guide, Explore)                                      | ✔     | ✔              | ✔       | lesen  |
| Katalog, Partner, Bilder                                      | ✔     | ✔              | ✔       | lesen  |
| Anfragen bestätigen/ablehnen                                  | ✔     | ✔              | ✔       | –      |
| Buchungen/Verlängerungen ansehen                              | ✔     | ✔              | ✔       | ✔      |
| Objekt-Einstellungen, Verlängerungsregeln, Benachrichtigungen | ✔     | ✔              | –       | lesen  |
| Benutzer und Rollen                                           | ✔     | ✔ (ohne owner) | –       | –      |
| Datenimport aus Extras                                        | ✔     | ✔              | –       | –      |
| **Produktiver Schreiber-Wechsel (Go-live)**                   | ✔     | –              | –       | –      |

- Jede Rolle außer owner kann auf ausgewählte Objekte beschränkt werden. Mandantenweite Rechte (Benutzer, Import, Schreiber) verlangen Zugriff auf alle Objekte.
- Die Rolle wird bei jeder Anfrage aus der Datenbank gelesen: Änderungen wirken sofort; Deaktivieren beendet alle Sitzungen.

### 2.5 Buchungsablauf in STAY (Ziel)

1. Gast wählt eine Leistung. STAY lädt live aus Apaleo (Service-Angebote, Reservierung, gebuchte Services, Unit-Group) und berechnet Preis, Daten und Einschränkungen mit `packages/core/booking`.
2. Absenden → Server Action mit Idempotenzschlüssel → Schreib-Gateway:
   1. Schlüssel reservieren (`apaleo_write_operations`); Wiederholung liefert das gespeicherte Ergebnis, gleicher Schlüssel mit anderem Inhalt wird abgelehnt;
   2. Richtlinien: Modus, Schreiber = STAY, Objekt freigegeben, Reservierung gehört zum Objekt und ist buchbar;
   3. Neuberechnung und Prüfung „bereits gebucht“ (Extras-Regeln);
   4. genau ein `book-service` bzw. `amend`;
   5. Ergebnis, Audit, `service_bookings`, Outbox-Nachricht.
3. Anfragen: `offer_requests` + Outbox → Slack; Freigabe im STAY-Admin mit derselben Live-Prüfung wie in Extras.

### 2.6 Mandanten- und Objekttrennung

- Jeder Datensatz trägt `tenant_id`; Objektbezug über zusammengesetzte Fremdschlüssel.
- Admin-Kontext aus der Sitzung; Objekt aus der URL, gegen Rolle und Objektrechte geprüft (`can()`), in jeder Server Action.
- Das Schreib-Gateway prüft immer: Reservierung gehört zum Objekt, Objekt ist freigegeben, Schreiber = STAY.

---

## 3. Migrationsplan

### 3.1 Leitplanken

- **Extras bleibt produktiv bis unmittelbar vor dem gemeinsamen Go-live** – für alle Objekte. Keine vorzeitige Umstellung einzelner Objekte.
- **STAY schreibt vor dem Go-live nur in isolierten Test-/Staging-Umgebungen** (Apaleo TEST, Staging-Datenbank). Das Gateway kennt in M1 nur `disabled` und `simulated`.
- **Nie zwei produktive Schreiber:** Schreiberwert in STAY (Trigger-geschützt) plus Sperre in Extras, Reihenfolge siehe 3.2.
- **Nichts geht verloren:** Export mit Prüfsummen, idempotenter Import mit Protokoll, Delta-Lauf direkt vor dem Go-live, Extras-Daten bleiben unverändert als Rückfall und Archiv.
- **Extras-Tests sind Referenz:** 160 portierte Tests; Paritätsbericht im Schattenbetrieb (M3).

### 3.2 Gemeinsamer Go-live und Rückfall

Technisches Konzept: `docs/concepts/extras-go-live.md` (vorbereitet, nicht aktiviert).

1. Extras bleibt produktiv bis unmittelbar vor dem Go-live.
2. Offene Vorgänge und Einstellungen werden direkt vor dem Wechsel synchronisiert (Delta-Export und -Import, Abgleich ohne Abweichung).
3. Extras wird für neue Buchungen gesperrt, bevor STAY-Schreibzugriffe aktiviert werden (Zustand `extras_locked`).
4. STAY wird erst nach erfolgreichen Prüfungen aktiviert (`stay_active`, Prüfliste Pflicht).
5. Kontrollierter Rückfall: `stay_active → extras_locked → extras_active`; Extras-Daten sind unverändert vorhanden.
6. Keine Daten gehen verloren: letzter Delta-Lauf nach der Sperre, Abgleichsbericht, Archiv-Export mit Prüfsummen.

### 3.3 Phasen

| Phase                                   | Ziel                                         | Inhalt                                                                                                                                                                                 | Abnahme                                                                  |
| --------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **M0 Bestand erheben**                  | echte Mengen kennen                          | Lesender Export (vorbereitet). Ausführung gegen Produktion nur nach gesonderter Freigabe, mit Read-only-Token                                                                          | Bestandsbericht ohne Personendaten; Entscheidungen zur Datenübernahme    |
| **M1 Fundament** _(umgesetzt)_          | Datenmodell, Rollen, Regeln, Gateway, Import | Migration 0018, Rollen/Objektrechte/Einladungen im Admin, portierte Regeln, Apaleo-Lesezugriffe, Schreib-Gateway (aus), Import/Abgleich, Go-live-Mechanik vorbereitet                  | Alle Tests grün; keine Apaleo-Schreibzugriffe möglich                    |
| **M2 Administration** _(Priorität 1)_   | Extras-Admin vollständig in STAY             | Services & Erlebnisse (Katalog zentral + je Objekt), Verlängerungseinstellungen, Bilder (Storage), Lesezugriff auf importierte Vorgänge, Import-Oberfläche mit Abgleich, Audit-Ansicht | Import auf Staging wiederholbar, Abgleich ohne Abweichung, Admin-Abnahme |
| **M3 Buchungslogik im Schattenbetrieb** | STAY rechnet wie Extras                      | Gäste-UI nutzt eigene Regeln + Apaleo-Lesezugriffe; Ergebnis neben die Brücke gelegt (Paritätsbericht); keine Schreibzugriffe                                                          | festgelegter Zeitraum ohne Abweichung                                    |
| **M4 Anfragen, Freigaben, Slack**       | Betrieb in STAY                              | Anfragen-Warteschlange, Bestätigen/Ablehnen, Outbox-Worker + Slack (Testkanal), Gast-Benachrichtigung vorbereitet                                                                      | Ablauf auf TEST (simuliert)                                              |
| **M5 Generalprobe TEST**                | echter Schreibtest in isolierter Umgebung    | Gateway mit Live-Executor nur für Apaleo TEST (eigene Freigabe), Testplan JTKQSYFX-1, Go-live- und Rückfall-Probe auf Staging                                                          | Freigabe; Apaleo-Zustand wie erwartet; Rückfall geübt                    |
| **M6 Gemeinsamer Go-live**              | STAY ist produktiver Schreiber               | STAY-Production-Datenbank (eigene Freigabe), finaler Delta-Import, Sperre Extras, Prüfliste, Aktivierung STAY für alle Objekte                                                         | ausdrückliche Freigabe; Kennzahlen: Fehler, Doppelbuchungen = 0          |
| **M7 Partnerplattform** _(Priorität 2)_ | Partner in derselben Administration          | Partnerangebote, Anfragen, Provisionen                                                                                                                                                 | Abnahme Partner-Prozess                                                  |
| **M8 Stilllegung Extras**               | Abschaltung nach Prüfung                     | Extras als Rückfall lesend vorhalten, Abschluss-Export archivieren, Brücke entfernen, Domain umleiten                                                                                  | Freigabe zur Abschaltung                                                 |

### 3.4 Datenmigration: wiederholbar und prüfbar (umgesetzt)

1. **Export (M0, nur lesend):** Befehls-Allowlist, Read-only-Token, Minimierung an der Quelle (keine Passwörter, Gastnamen, E-Mails, Kennzeichen), Manifest mit SHA-256 je Schlüssel und Gesamtprüfsumme.
2. **Abbildung (deterministisch):**
   - Katalog: gleicher Service-Code über Objekte → ein Angebot (`extras:<Code>`), je Objekt eine Konfiguration; bestehende STAY-Angebote mit demselben Apaleo-Service werden verknüpft. Neue Angebote als Entwurf.
   - Einstellungen: `extension-night:config:*` → `property_service_settings` (Altfelder aufgelöst).
   - Vorgänge: `order.id`, `requestId`, `record.id` → `legacy_id` (eindeutig), ohne Namen/E-Mails, mit Löschfrist.
   - Benutzer: nur Einladungs-Kandidaten mit Rolle; Bilder: in M2 nach Storage.
3. **Import:** Probelauf und Übernahme mit identischer Logik; Konflikt statt Überschreiben, wenn in STAY nach dem letzten Import geändert; Protokoll in `migration_runs`/`migration_items`.
4. **Abgleich:** Konfiguration je Objekt und Service, Zähler je Vorgangsart.
5. **Wiederholung:** beliebig oft auf Staging; Delta-Läufe vor dem Go-live.

### 3.5 Rückfall

- Bis zur Stilllegung jederzeit: Zustand zurück auf `extras_locked`, dann `extras_active`. Extras-Katalog und -Einstellungen bleiben unverändert in Extras.
- Änderungen in STAY nach dem Go-live gehen nicht automatisch nach Extras zurück; sie sind in `admin_audit_events` protokolliert. Rückschreib-Werkzeug optional (Entscheidung offen).
- Offene STAY-Anfragen werden vor dem Rückfall entschieden oder als Liste übergeben. Buchungen stehen in Apaleo.

### 3.6 Risiken und Gegenmaßnahmen

| Risiko                                            | Gegenmaßnahme                                                                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Doppelte Buchung beim Wechsel                     | Sperre Extras vor Aktivierung STAY, Trigger-geschützter Schreiberwert, Idempotenz, Live-Prüfung „bereits gebucht“ |
| Abweichende Preise/Regeln nach der Portierung     | 160 portierte Extras-Tests, Paritätsbericht (M3)                                                                  |
| Staging schreibt in Produktionsdaten              | Gateway ohne Live-Executor, Objekt-Freigabeliste, eigene Staging-Datenbank                                        |
| Personendaten aus Extras                          | Minimierung beim Export, keine Namen/E-Mails im Import, Löschfristen                                              |
| Datenverlust (Extras-Obergrenze 500 Bestellungen) | M0 meldet die Grenze; alles darüber hinaus ist in Extras bereits verloren, Apaleo bleibt Quelle                   |
| Sperren ohne Ablauf (Extras)                      | entfallen in STAY (Sperrfrist + Übernahme)                                                                        |

---

## 4. Priorisierung

1. **M0–M2:** Bestand, Fundament (fertig), Extras-Administration in STAY.
2. **M3–M4:** eigene Buchungslogik im Schattenbetrieb, Anfragen/Freigaben, Slack.
3. **M5–M6:** Generalprobe auf TEST, gemeinsamer Go-live.
4. **M7:** Partnerplattform (gemeinsames Datenmodell über `offers.kind`).
5. **M8:** Stilllegung nach erfolgreicher Prüfung.

## 5. Offene Entscheidungen

Aktuelle Liste: `docs/staging/extras-migration-m1-bericht.md`, Abschnitt „Offene Entscheidungen und Freigaben“.
