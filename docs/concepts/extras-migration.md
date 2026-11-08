# Extras-App in STAY: Bestandsaufnahme, Zielarchitektur und Migrationsplan

Stand: 08.11.2026. Konzept, noch keine Implementierung.

**Grundlage**

- Code von `aurelsommerlad/guest-services`, Branch `claude/stay-api-bridge` (enthält Production-Stand `9844259` plus Brücke und die Korrektur für Anfrage-Bestätigungen);
- STAY (`aurelsommerlad/guest-app`, Branch `claude/sharp-rubin-hwfdyt`);
- Vercel-Projektkonfiguration (nur Namen);
- Apaleo-Stammdaten (nur lesend).

**Nicht gelesen:** die produktiven Extras-Daten im KV-Store. Mengen und Inhalte (Anzahl Katalogeinträge, Bestellungen, Anfragen, Bilder) werden erst im Schritt M0 erhoben.

**Entscheidung (08.11.2026):** Die Extras-App wird vollständig in STAY integriert und danach stillgelegt. Das betrifft Gästeoberfläche, Administration, Einstellungen, Geschäftsregeln, Integrationen und Daten. Die API-Brücke ist eine Übergangslösung.

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
3. **Ein Schreiber je Objekt.** Für jedes Objekt ist genau ein System für Apaleo-Schreibzugriffe zuständig: Extras oder STAY (siehe 3.2).
4. **Ein Katalog je Leistung**, keine doppelte Pflege. Redaktioneller Inhalt (Texte, Bilder) und Buchungsregeln liegen am selben Angebot. Preise kommen immer live aus Apaleo, bzw. aus den Einstellungen für Zusatzperson und Verlängerung.
5. **Eigene Services und Partnerangebote** in einem Katalog und einer Administration, unterschieden durch `kind`.

### 2.2 Bausteine

| Baustein                                    | Inhalt                                                                                                                                                                                                                                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/guest`                                | Gäste-Oberfläche (V2), Buchung, Anfrage, Verlängerung, „Gebucht & angefragt“                                                                                                                                                                                                           |
| `apps/admin`                                | eine Administration: Inhalte (Guide, Explore), **Services & Erlebnisse** (Katalog, Partner), **Betrieb** (Anfragen, Buchungen, Verlängerungen), **Einstellungen** (Objekt, Verlängerung, Benachrichtigungen), **Benutzer & Rollen**                                                    |
| `packages/core/booking` (neu)               | reine Buchungsregeln aus Extras portiert: Datumsauflösung, Preis, Kapazität, Apartmenttyp, Hund, Kennzeichen, Verlängerungsentscheidung, Late-Check-out, Kurtaxe; vollständig mit den Extras-Tests abgedeckt                                                                           |
| `packages/integrations/apaleo` (erweitert)  | lesend: `service-offers`, Services der Reservierung, Service-Definitionen, Unit-Groups, Verfügbarkeit, Properties. Schreibend: `book-service`, `amend`, `PATCH` Kommentar/Kennzeichen. Nur über einen zentralen **Apaleo-Schreib-Gateway** mit Schreiber-Prüfung, Idempotenz und Audit |
| `packages/integrations/notifications` (neu) | Slack (Webhook pro Objekt/Mandant), über eine Outbox mit Wiederholung und Dedup                                                                                                                                                                                                        |
| `packages/db`                               | Tabellen siehe 2.3, Repositories, Migrationen, Import-Werkzeuge                                                                                                                                                                                                                        |

### 2.3 Datenmodell (Entwurf)

**Bestehend und erweitert**

- `offers` (Katalog, tenantweit, `kind` = `house-service` | `partner`): bleibt redaktionelles Angebot.
- `offer_properties` wird zur **Objektkonfiguration eines Angebots**:
  - `apaleo_service_id` (heute `extras_service_id`), `active`, `sort_order`;
  - bei house-service: `action_type`, `booking_rule`, `fulfillment`, `extra_person_price_cents`, `requires_remaining_capacity`, `requires_vehicle_registration`, `max_one_per_reservation`, `allowed_unit_group_ids`, `price_unit_label` (de/en);
  - optional objektbezogene Text-Overrides (`title_override`, `teaser_override`).

  Die CHECK-Regeln stellen sicher, dass Zusatzperson immer `instant` mit Preis ist und Partnerangebote keine Apaleo-Felder haben.

- `offer_requests` (erweitert): Bezug auf Angebot + Objekt, `apaleo_service_id`, Menge, angefragte Daten, angezeigter Preis, Status `pending|approved|rejected|cancelled`, `decided_by`, `decided_at`, `booked_service_dates`, `slack_notified_at`; Gastname/E-Mail nur, wenn nötig und mit Löschfrist.
- `admin_users` + **`admin_memberships`** (neu): Benutzer × Mandant × Rolle (`owner|admin|manager|viewer`), optional Objekt-Einschränkung.

**Neu**

- `property_service_settings`: je Objekt Verlängerungsnacht (aktiv, vier Rabatte, Mindestbelegung), Standard-Kanal für Benachrichtigungen, **Schreiber** (`extras|stay`) mit Zeitstempel und Person.
- `service_bookings` + `service_booking_items`: Sofortbuchungen und Zusatzpersonen. Unbegrenzt, mit Idempotenzschlüssel (eindeutig), Positionen, Preisen, Apaleo-Ergebnis. Ersetzt `orders`.
- `stay_extensions`: Verlängerungen mit allen Feldern der Extras-Datensätze.
- `apaleo_write_audit` (nur anfügbar): jeder Schreibversuch mit Objekt, Reservierung, Aktion, Idempotenzschlüssel, Ergebnis, Quelle (gast/admin/system/migration). Ersetzt `stay-bridge:audit`.
- `notification_outbox`: Nachrichten mit Status, Versuchen, Dedup-Schlüssel.
- `admin_audit_events` (nur anfügbar): Änderungen an Katalog, Einstellungen, Rollen, Freigaben.
- `migration_runs` + `migration_items`: Import-Läufe mit Quell-Checksumme, Zählern, Abweichungen (siehe 3.4).

Sperren und Idempotenz laufen künftig über Datenbank-Transaktionen (`SELECT … FOR UPDATE`, eindeutige Schlüssel, Advisory Locks) statt über KV-Sperren ohne Ablauf.

### 2.4 Rollen und Berechtigungen (Ziel)

| Recht                                                         | owner | admin          | manager | viewer |
| ------------------------------------------------------------- | ----- | -------------- | ------- | ------ |
| Inhalte (Guide, Explore)                                      | ✔     | ✔              | ✔       | lesen  |
| Katalog, Partner, Bilder                                      | ✔     | ✔              | ✔       | lesen  |
| Anfragen bestätigen/ablehnen                                  | ✔     | ✔              | ✔       | –      |
| Buchungen/Verlängerungen ansehen                              | ✔     | ✔              | ✔       | ✔      |
| Objekt-Einstellungen, Verlängerungsregeln, Benachrichtigungen | ✔     | ✔              | –       | –      |
| **Schreiber-Umschaltung je Objekt**                           | ✔     | –              | –       | –      |
| Benutzer und Rollen                                           | ✔     | ✔ (ohne owner) | –       | –      |

- Optional sind Rollen auf einzelne Objekte beschränkbar.
- Aktionen, die nicht erlaubt sind, werden gar nicht angezeigt; das behebt den Viewer-Fehler aus Extras.
- Sitzungen sind widerrufbar (STAY-Basis). Eine Rollenänderung wirkt sofort.

### 2.5 Buchungsablauf in STAY (Ziel)

1. Gast wählt eine Leistung. STAY lädt live aus Apaleo: Angebote, Reservierung, Services, Unit-Group. Daraus berechnet es Preis, Daten und Einschränkungen nach den portierten Regeln.
2. Absenden → Server Action mit Idempotenzschlüssel → Apaleo-Schreib-Gateway:
   1. Prüfen, dass STAY Schreiber für das Objekt ist (sonst Abbruch, kein Apaleo-Aufruf);
   2. Datenbanksperre auf Reservierung und Service;
   3. Neuberechnung, Preis gegen `expectedPrice` prüfen;
   4. bereits gebucht? → Konflikt;
   5. ein `book-service` bzw. `amend`;
   6. Audit;
   7. `service_bookings` schreiben;
   8. Kommentar.
3. Anfragen: Datensatz in `offer_requests`, Outbox-Nachricht an Slack, Freigabe in der STAY-Administration mit derselben Live-Prüfung wie heute in Extras.

### 2.6 Mandanten- und Objekttrennung

- Jeder Datensatz trägt `tenant_id`; Objektbezug über zusammengesetzte Fremdschlüssel.
- Admin-Kontext aus der Sitzung; Objekt aus der URL, gegen Mitgliedschaft und Objekt-Einschränkung geprüft.
- Apaleo-Zugangsdaten je Mandant (heute ein Konto).
- Das Schreib-Gateway prüft immer: Reservierung gehört zum Objekt, Objekt zum Mandanten, Objekt-Schreiber = STAY.

---

## 3. Migrationsplan

### 3.1 Leitplanken

- **Extras bleibt produktiv**, bis das letzte Objekt umgestellt ist; danach eine Rückfallfrist.
- **Ein Schreiber je Objekt:**
  - Vor dem Umstieg schreibt nur Extras, danach nur STAY.
  - Die Brücke bleibt in der Übergangszeit nur für Objekte mit Schreiber = Extras im Einsatz; für Objekte mit Schreiber = STAY ist sie aus.
- **Keine doppelte Buchung:**
  - Beide Systeme prüfen vor jedem Schreiben live die Services der Reservierung.
  - STAY nutzt Idempotenzschlüssel und Datenbanksperren.
  - Dazu kommt die Schreiber-Sperre.
- **Daten bleiben erhalten:** Import ist wiederholbar, idempotent und prüfbar. Die Quelle bleibt unverändert, bis zur Abschaltung und als Archiv darüber hinaus.
- **Rückfall:** Schreiber-Schalter zurück auf Extras. Extras-Katalog und -Einstellungen des Objekts sind bis zur Abschaltung unverändert verfügbar (siehe 3.5).
- **Extras-Tests sind Referenz:** Jede portierte Regel bekommt die entsprechenden Testfälle. Ein Paritätsbericht vergleicht für dieselben Eingaben die Ergebnisse von Extras und STAY (siehe 3.3).

### 3.2 Schreiber-Schalter

| Stelle                 | Umsetzung                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STAY                   | `property_service_settings.writer` (`extras`/`stay`), nur durch owner änderbar, mit Audit. Das Schreib-Gateway lehnt ab, wenn `writer ≠ stay`.                                                                                                                                                                                               |
| Extras                 | **kleine Änderung nötig, braucht eine Freigabe für guest-services:** Extras liest vor jedem Schreibzugriff (Gast-Bestellung, Anfrage, Bestätigung, Verlängerung) einen Sperrwert je Objekt. Ist das Objekt an STAY übergeben, lehnt Extras ab und leitet Gäste zu STAY. Der Wert wird bei der Umstellung gesetzt und beim Rückfall entfernt. |
| Reihenfolge Umstellung | 1. Extras sperren → 2. offene Extras-Anfragen übernehmen (Delta-Import) → 3. STAY freischalten. Zu keinem Zeitpunkt sind beide freigeschaltet.                                                                                                                                                                                               |
| Reihenfolge Rückfall   | 1. STAY sperren → 2. offene STAY-Anfragen an Extras zurückgeben oder in STAY abschließen → 3. Extras freischalten.                                                                                                                                                                                                                           |

### 3.3 Phasen

| Phase                                                          | Ziel                                                | Inhalt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Ergebnis / Abnahme                                                                                                                              |
| -------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0 Bestand erheben**                                         | echte Mengen kennen                                 | Lesender Export des produktiven KV-Stores über den vorhandenen **Read-only-Token**, nur lokal, ohne Schreibzugriff. Zählung je Datenbestand und Objekt, Prüfung der Feldvarianten (Altdaten), Bildergrößen. Datenschutz-Einstufung (Namen, E-Mails).                                                                                                                                                                                                                                                 | Bestandsbericht; Entscheidung, welche historischen Personendaten übernommen werden. **Braucht Freigabe** (Zugriff auf Produktionsdaten, lesend) |
| **M1 Fundament**                                               | Datenmodell, Rollen, Apaleo-Lese- und Schreibclient | Migrationen für 2.3; `admin_memberships` + Rollenprüfung in allen Admin-Aktionen; Apaleo-Client erweitert (nur Code, Schreiben bleibt aus); `packages/core/booking` portiert mit allen Extras-Testfällen                                                                                                                                                                                                                                                                                             | Alle portierten Tests grün; keine Apaleo-Schreibzugriffe möglich (Gateway hart aus)                                                             |
| **M2 Administration und Servicekonfiguration** _(Priorität 1)_ | Extras-Administration vollständig in STAY           | Admin-Modul „Services & Erlebnisse“: Katalog je Objekt mit Apaleo-Serviceliste und allen Feldern aus 1.15, Unit-Groups, Bilder (Storage-Modul `offers`); Verlängerungs-Einstellungen; Benutzer & Rollen inkl. Passwort ändern; Lesezugriff auf Bestellungen, Anfragen und Verlängerungen (importiert). **Import-Werkzeug** für Katalog, Einstellungen, Bilder, Historie (3.4). Während M2 bleibt Extras Schreiber; STAY zeigt importierte Daten und einen **Abgleich** (Unterschiede Extras ↔ STAY). | Import auf Staging wiederholbar, Prüfbericht ohne Abweichungen; Admin-Abnahme durch euch                                                        |
| **M3 Buchungsmotor im Schattenbetrieb**                        | STAY rechnet wie Extras                             | STAY berechnet Katalog, Preise und Verfügbarkeit selbst. Für jede Gästeansicht auf TEST wird das Ergebnis neben die Brücke gelegt und protokolliert: **Paritätsbericht**. Keine Schreibzugriffe.                                                                                                                                                                                                                                                                                                     | Über einen festgelegten Zeitraum keine Abweichung                                                                                               |
| **M4 Anfragen, Freigaben, Slack**                              | Betrieb in STAY                                     | Anfragen-Warteschlange mit Bestätigen/Ablehnen (Live-Prüfung wie Extras), Outbox + Slack (Testkanal), optional Gast-Benachrichtigung                                                                                                                                                                                                                                                                                                                                                                 | Ablauf auf TEST (simuliert)                                                                                                                     |
| **M5 Umstellung TEST**                                         | erster echter Schreiber-Wechsel                     | Schreiber TEST = STAY; Testplan JTKQSYFX-1 (erweitert um Anfrage + Freigabe, Zusatzperson, Verlängerung mit Rücknahme); Rückfall-Übung                                                                                                                                                                                                                                                                                                                                                               | Freigabe; Apaleo-Zustand wie erwartet; Rückfall in Minuten möglich                                                                              |
| **M6 Umstellung je echtem Objekt**                             | Produktivbetrieb                                    | Reihenfolge nach Risiko, z. B. LAEKE → ALTUS (HØV) → HUESLE → ALPILA. Je Objekt: Delta-Import, Sperre in Extras, Freigabe in STAY, Links von `extras.unique-places.com` → STAY-Login, Beobachtung                                                                                                                                                                                                                                                                                                    | Je Objekt eigene Freigabe; Kennzahlen: Buchungen, Fehler, Doppelbuchungen = 0                                                                   |
| **M7 Partnerplattform** _(Priorität 2)_                        | Partner in derselben Administration                 | Partner und Partnerangebote, Anfragen, Provisionen, Kennzahlen im Modul „Services & Erlebnisse“                                                                                                                                                                                                                                                                                                                                                                                                      | Abnahme Partner-Prozess                                                                                                                         |
| **M8 Stilllegung Extras**                                      | Abschaltung                                         | Extras nur lesend (Rückfallfrist, z. B. 4–8 Wochen), Abschluss-Export mit Checksummen archivieren, Brücke entfernen, Domain umleiten, Projekt abschalten                                                                                                                                                                                                                                                                                                                                             | Freigabe zur Abschaltung                                                                                                                        |

### 3.4 Datenmigration: wiederholbar und prüfbar

1. **Export (nur lesend):**
   - `users`, `catalog:*`, `extension-night:config:*`, `orders`, `requests:items`, `stay-extensions:records`, `image:*`, `stay-bridge:audit`.
   - Ablage als Snapshot mit Zeitstempel und SHA-256 je Datenbestand.
   - Nie über `KV_REST_API_TOKEN` (Schreibrecht), nur über den Read-only-Token.
2. **Abbildung (deterministisch):**
   - Katalog: `(objekt, apaleoServiceId)` → `offer_properties`. Pro Extras-Eintrag ein Angebot; Zusammenführen gleicher Services über Objekte hinweg ist ein späterer redaktioneller Schritt.
   - Anfragen: `requestId` → `offer_requests.legacy_id` (eindeutig).
   - Bestellungen: `order.id` → `service_bookings.legacy_id`.
   - Verlängerungen: `record.id` → `stay_extensions.legacy_id`.
   - Bilder: `image:{uuid}` → Storage-Pfad `<tenant>/offers/legacy-<uuid>.<ext>` (Bytes geprüft, ggf. neu komprimiert).
3. **Import:** idempotent (Upsert auf `legacy_id`), in einer Transaktion je Datenbestand, mit `migration_runs`.
4. **Prüfung:**
   - Zähler Quelle = Ziel je Datenbestand und Objekt;
   - Feldvergleich je Datensatz (normalisiert);
   - Bilder per Checksumme;
   - Abweichungsbericht.

   Erst ein Lauf ohne Abweichung gilt.

5. **Wiederholung:**
   - Beliebig oft auf Staging.
   - Vor jeder Objekt-Umstellung ein Delta-Lauf; dann Sperre in Extras und ein letzter Delta-Lauf (nur offene Anfragen).
6. **Benutzer:** Die bcrypt-Hashes sind mit dem STAY-Verfahren (scrypt) nicht verwendbar. Zwei Möglichkeiten:
   - Konten anlegen und Personen setzen ein neues Passwort per Einladung (empfohlen);
   - beim ersten Login einmalig gegen bcrypt prüfen und neu hashen.
7. **Altdaten:** Altfelder der Verlängerung über die vorhandene Fallback-Logik auflösen und als neue Felder speichern; den Alt-Katalog-Schlüssel mitlesen.

### 3.5 Rückfall

- **Bis M8 jederzeit pro Objekt:** Schreiber auf Extras zurück. Extras-Katalog und -Einstellungen bleiben bis dahin unverändert in Extras (keine Löschung).
- **Änderungen, die in STAY nach der Umstellung gemacht wurden** (Katalog, Einstellungen), gehen beim Rückfall nicht automatisch nach Extras zurück. Deshalb gilt in der Rückfallfrist: Katalogänderungen sparsam und protokolliert (`admin_audit_events`). Ein Rückschreib-Werkzeug nach Extras ist optional.
- **Offene Anfragen:** werden vor dem Rückfall in STAY entschieden oder als Liste an das Team gegeben.
- **Buchungen** stehen ohnehin in Apaleo und gehen nicht verloren.

### 3.6 Risiken und Gegenmaßnahmen

| Risiko                                        | Gegenmaßnahme                                                                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Doppelte Buchung in der Übergangszeit         | Schreiber-Schalter in beiden Systemen, Live-Prüfung „bereits gebucht“, Idempotenz, eine Umstellung zur Zeit             |
| Abweichende Preise/Regeln nach der Portierung | Portierte Extras-Tests, Paritätsbericht im Schattenbetrieb (M3)                                                         |
| Staging schreibt in Produktionsdaten          | Eigene Staging-Datenbank für STAY; Extras-Staging nur mit eigenem KV (siehe `docs/staging/extras-bridge-sicherheit.md`) |
| Personendaten aus Extras (Namen, E-Mails)     | Datenschutz-Einstufung in M0, Löschfristen, Übernahme nur soweit nötig                                                  |
| Lange Rückfallfrist bindet Doppelbetrieb      | feste Frist je Objekt, danach M8                                                                                        |
| Sperren ohne Ablauf (Extras)                  | entfallen in STAY (Datenbank-Transaktionen)                                                                             |

---

## 4. Priorisierung

1. **M0–M2: Extras-Administration und Servicekonfigurationen in STAY**
   - Katalog je Objekt mit allen Einstellungen;
   - Verlängerungsregeln;
   - Bilder;
   - Benutzer und Rollen;
   - Import und Abgleich;
   - Lesezugriff auf die Historie.
2. **M3–M4:** eigener Buchungsmotor im Schattenbetrieb, Anfragen/Freigaben, Slack.
3. **M5–M6:** Umstellung TEST, dann je Objekt.
4. **M7:** Partnerplattform in derselben Administration. Das Datenmodell ist schon gemeinsam (`offers.kind`), deshalb ohne zweite Struktur.
5. **M8:** Stilllegung.

## 5. Offene Entscheidungen

1. Zugriff auf die produktiven Extras-Daten für M0 (lesend, Read-only-Token).
2. Umfang der historischen Personendaten (Gastnamen, E-Mails in Bestellungen/Anfragen) und Löschfristen in STAY.
3. Benutzerübernahme: Einladung mit neuem Passwort oder einmalige bcrypt-Prüfung.
4. Rollenmodell: owner/admin/manager/viewer, mit oder ohne Objekt-Einschränkung.
5. Katalog-Zusammenführung: ein Angebot je Objekt (1:1-Import) oder gemeinsame Angebote über Objekte.
6. Kleine Änderung in Extras für den Schreiber-Schalter (braucht eure Freigabe für guest-services).
7. Gast-Benachrichtigung bei Bestätigung/Ablehnung (Extras hat keine).
8. Reihenfolge der Objekte in M6 und Dauer der Rückfallfrist.
9. Eigene Supabase-Datenbank für STAY-Production (heute nur Staging).
