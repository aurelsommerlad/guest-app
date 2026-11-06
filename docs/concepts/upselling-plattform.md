# Upselling in STAY: Services & Erlebnisse

Stand 06.11.2026 · Status: **Vorschlag, nicht umgesetzt.** Es wurde keine bestehende Anwendung umgebaut und keine produktive Schnittstelle verändert. Der Online-Check-in ist zurückgestellt.

Grundlage:

- der Quellcode der Extras-App (Repository `aurelsommerlad/guest-services`, Commit `9844259`, Vercel-Projekt `guest-services` → `extras.unique-places.com`), nur lesend analysiert;
- der aktuelle Stand des STAY-Monorepos (`aurelsommerlad/guest-app`).

---

## 1. Bestandsaufnahme Extras-App

### 1.1 Architektur

| Bereich      | Umsetzung                                                                                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework    | Next.js 16 (App Router), **JavaScript** (kein TypeScript), React 18, Tailwind 3                                                                                                  |
| Hosting      | Vercel-Projekt `guest-services`, Domain `extras.unique-places.com`                                                                                                               |
| Datenhaltung | **Vercel KV (Upstash Redis)**, lokal Fallback `.data/db.json`; Bilder als Base64 in KV                                                                                           |
| Umfang       | ca. 3.300 Zeilen Fachlogik in `lib/`; Gäste-Oberfläche in einer Datei (`GuestApp.jsx`, 1.229 Zeilen); 6 Admin-Komponenten; **26 Testdateien, ca. 288 Testfälle** (`node --test`) |
| Sprachen     | DE/EN (`lib/i18n.js`, Katalogtexte zweisprachig)                                                                                                                                 |
| Mandanten    | Ein Mandant; Objekte über Apaleo-Property-IDs (`ALTUS`, `HUESLE`, `ALPILA`, `LAEKE`, `TEST` …)                                                                                   |

**Datenschlüssel in KV:**

- `catalog:{propertyId}:items`: Hash, ein Feld pro Apaleo-Service;
- `orders`: Liste, gekappt auf die letzten 500;
- `requests:items`: Anfragen;
- `extension-night:config:{propertyId}` und `stay-extensions:records`: Verlängerung;
- `users`;
- Sperrschlüssel (`…:claim:…`) gegen Doppelbuchungen;
- `ratelimit:*`.

**API-Endpunkte:**

| Gast (öffentlich)                | Zweck                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `POST /api/guest/lookup`         | Reservierungssuche: Reservierungs-, Buchungs- oder OTA-Nummer plus Nachname; IP-Limit 10 pro 5 Min. |
| `POST /api/guest/catalog`        | Katalog für die Reservierung plus Angebot „Eine Nacht länger“                                       |
| `POST /api/guest/order`          | Sofortbuchung auf das Apaleo-Folio                                                                  |
| `POST /api/guest/request`        | Anfrage („Auf Anfrage“), Slack-Benachrichtigung                                                     |
| `POST /api/guest/stay-extension` | Aufenthalt um eine Nacht verlängern                                                                 |
| `GET /api/images/[id]`           | Bilder aus KV                                                                                       |

| Admin (JWT-Cookie, Rollen `admin`, `manager`, `viewer`)      | Zweck                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| `catalog`, `services`, `properties`, `unit-groups`, `upload` | Apaleo-Services je Objekt freischalten und gestalten     |
| `requests`, `requests/[id]/approve`, `requests/[id]/reject`  | Anfragen freigeben (bucht dann auf Apaleo) oder ablehnen |
| `orders`                                                     | Bestellprotokoll                                         |
| `stay-extensions`, `extension-config`                        | Verlängerungsregeln und -protokoll                       |
| `users`, `users/me/password`, `setup`, `login`, `logout`     | Benutzerverwaltung                                       |

### 1.2 Authentifizierung über Apaleo-Reservierungen

- **Gast:** Reservierungs- oder Buchungsnummer plus Nachname. Ersatzweise wird über die OTA-Referenz gesucht, etwa eine Booking.com-Nummer; bei Mehrdeutigkeit gibt es eine eigene Meldung. Die Fehlermeldung ist generisch, sie verrät nicht, ob Nummer oder Name falsch war.
- **Keine Gast-Session:** Jeder Aufruf von Katalog, Buchung, Anfrage und Verlängerung schickt erneut `reservationId` und `lastName`. Der Server lädt die Reservierung frisch aus Apaleo.
- **Admin:** Benutzername und Passwort (bcrypt), JWT HS256 im httpOnly-Cookie, 30 Tage gültig, Rollenprüfung in jedem Handler.

### 1.3 Verfügbarkeit und standortspezifische Regeln

- **Katalog je Objekt:** Das Admin schaltet einzelne Apaleo-Services frei („kuratiert“).
- **Verfügbarkeit kommt live von Apaleo** (`service-offers` je Reservierung). Angezeigt wird nur, was kuratiert _und_ jetzt buchbar ist. Abgereiste Aufenthalte werden erkannt (HTTP 422 wird abgefangen).
- **Buchungsregeln:**
  - `per_stay`: ein Termin;
  - `per_night`: alle Nächte, sonst gar nicht;
  - `arrival_day`: z. B. Early Check-in;
  - `departure_day`: z. B. Late Check-out.
- **Einschränkungen:**
  - Apartmenttyp (`allowedUnitGroupIds`, fail-closed);
  - Restkapazität der Unit-Group (`requiresRemainingCapacity`);
  - **höchstens ein Hund** pro Reservierung, aus jeder Quelle gezählt (App, Apaleo, OTA, Make), mit Sperre gegen Doppelklicks;
  - Kennzeichenpflicht bei Parkplatz (`requiresVehicleRegistration`; schreibt `primaryGuest.vehicleRegistration`, weitere Kennzeichen in den Reservierungskommentar).
- **„Zusatzperson“** (`increase_occupancy`): Kein Service, sondern AmendReservation. Die Erwachsenenzahl wird erhöht und der Preis pro Nacht auf jede Übernachtung aufgeschlagen. Die Kapazität wird unmittelbar davor neu geprüft.
- **„Eine Nacht länger“:**
  - pro Objekt konfigurierbar, mit Rabatt je Phase (vor Anreise / im Haus) und Lückenlogik (`minSellableStayNights`, keine unverkäuflichen Einzelnächte);
  - nur, wenn genau dasselbe Apartment frei ist;
  - ein vorhandener Late Check-out wird auf den neuen Abreisetag verschoben;
  - Ortstaxe in der Vorschau;
  - Neuprüfung direkt vor der Änderung.

### 1.4 Preise und Buchungslogik

- Der Preis kommt aus dem Apaleo-Service-Offer: Brutto des gewählten Tages bzw. Gesamtbetrag × Nächte.
- Die Zusatzperson hat einen eigenen Preis pro Nacht aus dem Katalog.
- Die Verlängerung wird selbst berechnet: Durchschnittsrate abzüglich Rabatt.
- Gebucht wird über `book-service` mit explizitem Datum oder Datumsliste, nie Apaleos Standardmuster („pro Nacht“-Falle).
- Nach jeder Buchung wird der Reservierungskommentar _ergänzt_, nicht überschrieben.
- `fulfillmentMode`: `instant` bucht sofort, `request` wird erst nach Freigabe durch das Team gebucht.

### 1.5 Zahlungsabwicklung

**Keine.** Alles landet auf dem Apaleo-Folio und wird mit der Rechnung beglichen. Es gibt keinen Zahlungsanbieter und keine Vorabzahlung.

### 1.6 Slack und Freigabeprozess

- `SLACK_REQUEST_WEBHOOK_URL` (Incoming Webhook). Bei jeder **Anfrage** geht eine Nachricht mit Extra, Objekt, Gast, Reservierung, Datum, Preis und Button „Anfrage bearbeiten“ an das Team.
- Gegen doppelte Nachrichten schützt eine atomare Sperre je Anfrage; schlägt der Versand fehl, wird die Sperre wieder freigegeben. Ein Slack-Fehler bricht die Anfrage des Gastes nie ab.
- Freigabe im Admin: Sperre gegen Doppelbearbeitung, frische Neuprüfung (Reservierung, Offer, Apartmenttyp, Kapazität, Hund), Buchung auf Apaleo, Kommentar. Ablehnung ohne Apaleo-Aufruf.
- `notifyFrontOffice` (Sofortbuchungen) protokolliert bisher nur.

### 1.7 Administration

- **Katalog:** Apaleo-Services je Objekt freischalten. Pflegbar sind:
  - Name, Beschreibung und Preiseinheit, jeweils DE/EN;
  - Bild, Kategorie, Reihenfolge;
  - Buchungsregel, Modus Sofort oder Anfrage, Aktionstyp;
  - Apartmenttypen, Kapazitätsprüfung, „max. 1“ und Kennzeichenpflicht.
- **Anfragen:** freigeben oder ablehnen.
- **Bestellungen:** Protokoll, lesend.
- **Verlängerungen:** Konfiguration und Protokoll.
- **Benutzer:** Rollen.

### 1.8 Befunde, die bei der Integration relevant werden

| #   | Befund                                                                                                                                                      | Bewertung                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | Katalog-, Buchungs- und Anfrage-Endpunkte prüfen bei jedem Aufruf nur `reservationId` plus Nachnamen und haben **kein Rate-Limit** (nur die Suche hat eins) | Geringes, aber vorhandenes Rate-Risiko; entfällt in STAY durch die Session                    |
| 2   | Das Rate-Limit liegt in KV als Lesen-dann-Schreiben (nicht atomar) und ist IP-basiert                                                                       | ausreichend für die Suche, nicht als Muster übernehmen                                        |
| 3   | `notifyFrontOffice` schreibt die komplette Bestellung inklusive Gastname ins Log; der Slack-Antworttext wird geloggt                                        | Personenbezug in Logs, bei Übernahme bereinigen                                               |
| 4   | `users` und `orders` sind JSON-Listen mit Lesen-Ändern-Schreiben (Race möglich); Bestellungen sind auf 500 gekappt                                          | für Historie und Übersicht nicht ausreichend                                                  |
| 5   | Admin-JWT 30 Tage ohne Widerruf                                                                                                                             | STAY-Admin hat Sessions mit Widerruf (DB)                                                     |
| 6   | Bilder als Base64 in Redis                                                                                                                                  | STAY nutzt Supabase Storage                                                                   |
| 7   | Apaleo-Scopes inklusive `reservations.manage` (Buchen, Ändern, Kommentar, Kennzeichen)                                                                      | **Extras ist heute der einzige schreibende Client.** Das soll in der Übergangszeit so bleiben |
| 8   | Ein Mandant, Apaleo-Property-IDs als Schlüssel                                                                                                              | STAY hat bereits die Zuordnung `pms.propertyId` je Objekt                                     |

---

## 2. Was STAY bereits mitbringt

| Baustein                                                                                                  | Fundstelle                                                  | Nutzen fürs Upselling                                                 |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------- |
| Gast-Session und Gastkontext (Link oder Buchungsnummer-Login, Reservierung aus Apaleo, Objekt, Apartment) | ADR 0011/0012, `features/guest-context`                     | **keine zweite Anmeldung**; die Reservierung ist serverseitig bekannt |
| Apaleo-Provider (lesend) und Zuordnung der Property-IDs                                                   | `@up/integrations/apaleo`, `config/properties.ts`           | Grundlage für Katalog und „Gebucht“-Übersicht                         |
| Journey-Phasen (vor Anreise, Anreisetag, im Haus, Abreisetag, danach), Zeitzone je Objekt                 | `@up/core/journey`, ADR 0016                                | zeitlich passende Empfehlungen                                        |
| STAY-Startseite mit Kacheln (`tiles.start` und `tiles.accent`), Design V2 (Editorial Minimal)             | `build-stay-view-model.ts`, `v2/`                           | Ort und Formensprache für die Empfehlungen                            |
| Explore (Orte, Kategorien, Zuordnung zu Objekten, Übersetzungsstatus, Hero-Bild, Reservierungslink)       | `explore_places`, `explore_place_properties`, Admin-Explore | Vorbild bzw. Basis für **Partner** und **lokale Angebote**            |
| Admin-App (Benutzer, Rollen, Sessions mit Widerruf, Objektkontext, Medien-Upload in Supabase Storage)     | `apps/admin`                                                | eine Administration statt zwei                                        |
| Postgres (Drizzle, Migrationen, RLS, Data API gesperrt), Rate-Limits in Postgres, Logger mit Redaction    | `@up/db`, `@up/core/logging`                                | sichere, mandantenfähige Datenhaltung                                 |
| Zahlungsübersicht (Folio lesend, Phase 12 A)                                                              | `@up/core/payment`, Apaleo payment provider                 | gebuchte Extras erscheinen auf der Rechnung des Gastes                |
| Feature-Schalter je Objekt (`testOnly`, `design`)                                                         | `config/properties.ts`                                      | Einführung zuerst nur für TEST                                        |

---

## 3. Integrationsvarianten

### Variante A – API-basierte Integration

Die Extras-App bleibt bestehen und bekommt eine **interne Server-zu-Server-API**. STAY rendert alles selbst im eigenen Design und ruft die Extras-Logik nur serverseitig auf.

- **Authentifizierung:** kurzlebige, signierte Service-Tokens (JWT, `iss=stay`, `aud=extras-internal`, ≤ 60 s, `jti` gegen Wiederholung). Tenant und `reservationId` stehen nur im Token und werden in STAY aus der Gast-Session aufgelöst. Kein Nachname, keine Gastdaten im Browser.
- **Extras lädt die Reservierung wie heute frisch aus Apaleo.** Die Nachnamensprüfung entfällt nur für signierte STAY-Aufrufe.
- **Endpunkte, additiv und versioniert:** `GET /api/internal/v1/catalog`, `POST …/orders`, `POST …/requests`, `GET …/requests?reservationId=`, `GET/POST …/stay-extension`.
- **Vorteil:** schnell, risikoarm. Die erprobte Geschäftslogik (ca. 288 Tests) bleibt unverändert, und Extras bleibt der **einzige schreibende Apaleo-Client**.
- **Nachteil:** zwei Datenhaltungen (KV und Postgres), zwei Admins, zwei Apaleo-Clients, zwei Deployments. Partnerangebote liegen woanders als Hausleistungen, und eine gemeinsame Übersicht braucht Aggregation über zwei Systeme.

### Variante B – Zusammenführung in den STAY-Monorepo

Die Extras-Fachlogik wird in TypeScript in die bestehenden Pakete übernommen:

- reine Regeln nach `@up/core/upsell`;
- Apaleo-Schreibaufrufe nach `@up/integrations/apaleo`;
- die Daten nach Postgres;
- die Admin-Ansichten in die STAY-Admin-App.

- **Vorteil:** eine Session, ein Apaleo-Client, eine Datenbank, ein Admin. Gemeinsame Übersicht, gemeinsame Empfehlungslogik für Haus- und Partnerangebote, Mandantenfähigkeit, RLS, Typensicherheit.
- **Nachteil:** größter Aufwand. Die heikle Logik (Verlängerung, Zusatzperson, Hund, Kennzeichen) muss verhaltensgleich übertragen werden. Gelingt das nicht, drohen Fehlbuchungen auf echten Folios.

### Variante C – iFrame (nicht empfohlen)

Wird nur der Vollständigkeit halber genannt. Dagegen sprechen: zweites Design, zweite Anmeldung oder unsicherer Token-Durchgriff, schlechte Mobilbedienung, keine gemeinsame Übersicht. Den Zielen widerspricht die Variante deshalb grundsätzlich.

### Vergleich

| Kriterium                           | A: API                                      | B: Zusammenführung                          |
| ----------------------------------- | ------------------------------------------- | ------------------------------------------- |
| Keine zweite Anmeldung              | ✓ (Session in STAY, Token serverseitig)     | ✓                                           |
| Einheitliches Design                | ✓ (STAY rendert)                            | ✓                                           |
| Geschäftslogik wiederverwenden      | ✓ unverändert                               | ✓ übertragen, mit Tests abgesichert         |
| Keine doppelte Pflege               | ◐ Hausleistungen in Extras, Partner in STAY | ✓ eine Pflege                               |
| Sichere Kommunikation               | ✓ signierte Tokens, nur Server              | ✓ entfällt (gleicher Prozess)               |
| Gemeinsame Übersicht                | ◐ Aggregation über zwei Systeme             | ✓                                           |
| Standort- und reservierungsabhängig | ✓                                           | ✓                                           |
| Zeit bis zum Nutzen                 | **kurz**                                    | lang                                        |
| Risiko für Fehlbuchungen            | **gering**                                  | mittel (nur mit Schattenbetrieb vertretbar) |
| Betrieb langfristig                 | zwei Apps                                   | **eine App**                                |

### Empfehlung: erst Brücke, dann Zusammenführung („Strangler“)

1. **Brücke (Variante A):** STAY bekommt „Services & Erlebnisse“ sofort im eigenen Design, ohne Logik doppelt zu schreiben. Extras bleibt in dieser Zeit der einzige Apaleo-Schreiber.
2. **Neue Partnerplattform direkt in STAY**, weil sie ohnehin neu ist und auf Explore aufbaut.
3. **Zusammenführung (Variante B) schrittweise:** Die Extras-Module werden einzeln übertragen, die Extras-Tests dienen als Abnahmetests. Ein **Schattenbetrieb** (beide berechnen den Katalog, Abweichungen werden protokolliert) läuft, bevor STAY selbst schreibt. Danach leitet `extras.unique-places.com` auf STAY um.

Ein Weg ohne jede Änderung an Extras wäre, dass der STAY-Server die bestehenden öffentlichen Endpunkte mit `reservationId` und Nachnamen aufruft. Das taugt höchstens für einen Staging-Prototyp: keine Service-Authentifizierung, abhängig vom Namensabgleich, kein Rate-Limit. Für die Produktion empfehle ich das nicht.

---

## 4. Zielarchitektur

```
                  Gast (STAY, V2)                    Admin (STAY-Admin)
                        │ Session (ADR 0011)                │ Session + Rollen
              ┌─────────▼──────────┐              ┌─────────▼───────────────┐
              │ apps/guest          │              │ apps/admin               │
              │  Services & Erleb.  │              │  Hausleistungen (Katalog)│
              │  Startseiten-Modul  │              │  Partner · Angebote      │
              │  Gebucht & angefragt│              │  Anfragen · Platzierung  │
              └─────────┬──────────┘              └─────────┬───────────────┘
                        │ serverseitig                      │
              ┌─────────▼──────────────────────────────────▼──────────┐
              │ @up/core/upsell (rein, getestet)                        │
              │  OfferSource-Port · Empfehlungsregeln · Statusmodell    │
              │  (Phase B: Buchungsregeln, Kapazität, Hund, Verlängerung)│
              └───┬──────────────────┬──────────────────────┬──────────┘
                  │                  │                      │
     ┌────────────▼─────┐  ┌─────────▼────────┐   ┌─────────▼──────────┐
     │ Hausleistungen    │  │ Partnerangebote  │   │ Gebucht (Apaleo)    │
     │ Brücke: Extras-API│  │ Postgres (neu)   │   │ reservation services│
     │ später: Apaleo    │  │ Link · Anfrage · │   │ (alle Quellen)      │
     │ direkt (B)        │  │ später Partner-API│  └────────────────────┘
     └────────┬─────────┘  └─────────┬────────┘
              │                      │ Benachrichtigung
     extras.unique-places.com   Slack (Webhook, entdoppelt) · später E-Mail (Resend, Freigabe)
     (einziger Apaleo-Schreiber in der Übergangszeit)
```

**Eine Schnittstelle für alle Angebotsquellen (`OfferSource`):** Hausleistungen (Brücke oder Apaleo), Partnerangebote und künftige Quellen liefern einheitlich:

```
Offer { id, source, kind, title/teaser/description (DE/EN), images[], price { model, amount?, currency },
        fulfillment: "instant" | "request" | "link" | "partner-api",
        availability { dates?, maxQuantity?, restricted?, alreadyBooked? },
        requires { vehiclePlates?, date?, people?, note? } }
```

Gebucht wird über `Fulfillment`-Adapter nach demselben Muster wie die PMS-Provider. Neue Partner oder Angebotsarten brauchen nur einen Adapter und Daten, keine neue Oberfläche.

**Wer schreibt nach Apaleo:** in Phase 2 nur Extras, ab Phase 5 nur STAY (eigener Client mit `reservations.manage`, Freigabe nötig). Nie beide gleichzeitig.

---

## 5. Funktionsübersicht

### 5.1 Hausleistungen (aus Extras)

Hund, Parkplatz (mit Kennzeichen), Early Check-in, Late Check-out, Zusatzperson, „Eine Nacht länger“, weitere Apaleo-Services. Je nach Einstellung:

- **sofort buchbar** (auf die Rechnung);
- **auf Anfrage** (das Team gibt frei, Slack).

### 5.2 Lokale Angebote und Erlebnisse (neu)

**Partnerverwaltung**

- Name, Art (Gastronomie, Aktivität, Wellness, Mobilität, Handel …), interne Kontakte, Status;
- optionaler Bezug zu einem Explore-Ort (Adresse und Karte nicht doppelt pflegen).

**Angebote**

- Titel, Teaser, Beschreibung, „Gut zu wissen“ (DE/EN mit Übersetzungsstatus wie Explore);
- Hero- und Galeriebilder mit Alt-Text-Pflicht;
- Preismodell: fest, „ab“, pro Person oder auf Anfrage;
- Dauer, Treffpunkt, Vorlaufzeit.

**Zuordnung**

- zu Objekten (wie `explore_place_properties`);
- je Objekt optional mit eigener Reihenfolge oder eigenem Link.

**Abwicklung**

- **Buchungslink** zum Partner, mit Referenzparameter, ohne Cookies;
- **Anfrage** an das Team, später direkt an den Partner;
- **Direktbuchung** über eine Partner-Schnittstelle (spätere Adapter; Anbieter erst nach Prüfung).

**Provision (optional je Partner oder Angebot)**

- keine;
- Prozent vom Umsatz;
- fester Betrag je Buchung;
- fester Betrag je Vermittlung (Lead).

Zuordnung über eigene Ereignisse (Klick auf den Buchungslink, bestätigte Anfrage, vom Partner gemeldete Buchung), pseudonym, ohne Gastdaten. Dazu ein Monatsexport je Partner.

**Zeitlich passende Empfehlungen**

- Gültigkeit: Saison, Wochentage, Uhrzeiten.
- Journey-Phase: z. B. „ab 7 Tage vor Anreise“, „Anreisetag“, „im Haus“, „Abreisetag“.
- Bedingungen: Personenzahl, Kinder, Hund gebucht, Apartmenttyp, Aufenthaltsdauer.

**Platzierung auf der Startseite**

- Plätze `home-feature` (ein großes Bild) und `home-list` (2–3 Zeilen);
- dazu der Bereich „Services & Erlebnisse“ und der Abreisetag;
- je Platz Priorität, Zeitraum und objektweise Steuerung.

### 5.3 Empfehlungslogik (neu, nachvollziehbar statt Black Box)

Reine, getestete Funktion in `@up/core/upsell`:

1. **Eignung:** Objekt, Zeitfenster, Phase, Vorlauf, Bedingungen, noch nicht gebucht, noch buchbar.
2. **Gewichtung:** Platzierungspriorität, „hervorgehoben“, Phasenrelevanz.
3. **Auswahl:** die besten N je Platz.

Keine Profilbildung und kein Tracking von Ansichten. Es werden nur Fakten der Reservierung genutzt; jede Empfehlung ist erklärbar. A/B-Tests sind später möglich.

### 5.4 Gemeinsame Übersicht „Gebucht & angefragt“ (neu)

| Quelle                       | Inhalt                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| Apaleo-Reservierungsservices | **alles Gebuchte**, aus jeder Quelle (App, Rezeption, OTA, Make) – maßgeblich                   |
| Anfragen                     | offen, bestätigt, abgelehnt (Extras-Anfragen über die Brücke, Partneranfragen aus Postgres)     |
| Partnerereignisse            | „Beim Partner gebucht“ nur, wenn der Partner es meldet; sonst steht nichts da (keine Vermutung) |

Gezeigt werden Status in Worten, Termin, Preis und „auf Deiner Rechnung“ bzw. „zahlbar beim Partner“.

### 5.5 Zahlung

- **Hausleistungen:** weiterhin auf das Folio; sichtbar in der Zahlungsübersicht (Phase 12 A).
- **Vorabzahlung** (z. B. für Partner-Direktbuchungen): erst nach Freigabe der Zahlungsphase B2 (Apaleo-Zahlungslinks), sonst beim Partner.

### 5.6 Benachrichtigungen

- **Slack:** übernimmt das Extras-Muster (entdoppelt, Fehler blockieren den Gast nie), als gemeinsamer Adapter `@up/integrations/slack`. Ohne Personenbezug in Logs; Gastname nur in der Slack-Nachricht selbst.
- **E-Mail-Bestätigungen an Gäste oder Partner:** nur nach Resend-Freigabe.

---

## 6. Gästeerlebnis und Gestaltung

**Leitlinien aus Design V2 (Editorial Minimal):**

- keine Karten, keine Rundungen, keine Schatten;
- Haarlinien, viel Weißraum, große leichte Typo, Eyebrow-Kapitälchen;
- nummerierte Abschnitte, Preise rechtsbündig in Tabellenziffern;
- Status in Worten statt Pillen;
- ein Akzent pro Bildschirm;
- Bilder randabfallend.

### 6.1 Personalisierte Angebote auf der Startseite

- **Modul „Für Deinen Aufenthalt“** unter dem bestehenden Kachelpaar, nie davor:
  - ein großes Bild (4:5 mobil, 16:9 Desktop), darunter Eyebrow (z. B. „Am Anreisetag · ab 14:00“), Titel, eine Zeile Text und Preis;
  - darunter zwei bis drei Zeilen mit Haarlinie: Nummer, Titel, Preis, Pfeil.
- **Auswahl nach Phase:**

| Phase       | Angebote                                                                          |
| ----------- | --------------------------------------------------------------------------------- |
| vor Anreise | Early Check-in, Parkplatz, Hund, Zusatzperson, „Eine Nacht länger“ (Vorab-Rabatt) |
| Anreisetag  | Parkplatz, Early Check-in, Abendessen-Empfehlung                                  |
| im Haus     | Erlebnisse für morgen, Late Check-out, Verlängerung (Rabatt im Haus)              |
| Abreisetag  | Late Check-out                                                                    |

- **Höchstens ein Angebot im Fokus.** Gebuchte Leistungen verschwinden aus den Empfehlungen und erscheinen in „Gebucht & angefragt“.

### 6.2 Bereich „Services & Erlebnisse“

Ersetzt `/extras`, erreichbar über die bestehende Navigation bzw. die Extras-Kachel.

- **Zwei Kapitel:**
  - „Für Dein Apartment“: Hausleistungen;
  - „In der Umgebung“: Partnerangebote.
- **Zeitfilter in Textform:** „Heute“, „Morgen“, „Während Deines Aufenthalts“.
- **Magazinraster:** abwechselnd großformatige und schmale Einträge, Kapitelnummern, Haarlinien. Keine Kacheln.

### 6.3 Detailseiten

- randabfallendes Hero-Bild, optional Galerie;
- Titel groß und leicht;
- Faktenzeile als Haarlinien-Liste: Preis, Dauer, Ort, Verfügbarkeit;
- Text, „Gut zu wissen“, Partner mit Adresse (aus Explore);
- feste Aktionsleiste unten mit Preis und einer Hauptaktion.

**Bildsprache**

- eigene oder vom Partner geprüfte Fotos, Mindestauflösung, festes Seitenverhältnis je Platz, Alt-Text verpflichtend;
- keine Stockbilder für Hausleistungen.

### 6.4 Kurzer Buchungsprozess (ohne Anmeldung, Session vorhanden)

| Art                   | Schritte                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sofort (Hausleistung) | Detail → _Menge_ bzw. _Kennzeichen_ (nur wenn nötig, vorbefüllt) → Bestätigung mit Preis, Termin und „Wird Deiner Rechnung hinzugefügt“ → **gebucht**. 2 Tipps im Normalfall. |
| Anfrage               | Detail → Datum und Uhrzeit, Personen, optional Nachricht → „Anfrage senden“ → **angefragt**, Antwort erscheint in der Übersicht                                               |
| Buchungslink          | Detail → „Beim Partner buchen ↗“ mit Hinweis, dass die Buchung beim Partner erfolgt                                                                                           |
| Eine Nacht länger     | Detail mit Preisvorschau (Nacht, Extras, Ortstaxe) → Bestätigen → neue Abreise sichtbar                                                                                       |

Fehlerfälle zeigen klare Texte, z. B. „nicht mehr verfügbar“, „bereits gebucht“, „für Dein Apartment nicht möglich“. Eingaben bleiben erhalten; das Muster stammt aus dem Online-Check-in.

### 6.5 Übersicht gebuchter Leistungen

Neuer Abschnitt auf der Aufenthaltsseite und im Bereich „Services & Erlebnisse“: „Gebucht & angefragt“.

- Liste mit Haarlinien: Titel, Termin, Status in Worten, Preis.
- Rechnungsbezug über die Zahlungsübersicht.
- Kein Stornieren durch den Gast in Phase 1; die Regeln dafür klärt Ihr.

---

## 7. Wiederverwenden oder neu bauen

### 7.1 Aus der Extras-App wiederverwenden

Phase 2: unverändert über die Brücke. Phase 5: übertragen.

| Funktion                                                                              | Datei(en)                                                                                        |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Kuratierter Katalog je Objekt inkl. Admin-Pflege                                      | `lib/store.js`, `components/admin/CatalogManager.jsx`, `api/admin/catalog`                       |
| Live-Verfügbarkeit und Preis aus `service-offers`, Buchungsregeln, „pro Nacht“-Schutz | `lib/guest.js` (`getGuestCatalog`, `resolveRequiredDates`, `extractOfferPrice`), `lib/apaleo.js` |
| Apartmenttyp, Kapazität, Zusatzperson (AmendReservation)                              | `lib/unitGroupRestriction.js`, `lib/capacity.js`, `lib/occupancyAmendment.js`                    |
| Hund max. 1, Kennzeichen für Parkplatz                                                | `lib/dogBooking.js`, `lib/vehicleRegistration.js`                                                |
| „Eine Nacht länger“, Late-Check-out-Verschiebung, Rabatte je Phase                    | `lib/stayExtension.js`, `lib/stayExtensionAdmin.js`                                              |
| Anfrage, Freigabe (bucht dann), Ablehnung                                             | `lib/requests.js`, `RequestsManager.jsx`                                                         |
| Slack-Benachrichtigung mit Entdopplung                                                | `lib/notify.js`                                                                                  |
| Zweisprachige Texte, Preiseinheiten, Sortierung                                       | `lib/catalogLocalization.js`, `lib/priceDisplay.js`, `lib/catalogSort.js`                        |
| Reservierungskommentar ergänzen                                                       | `lib/apaleo.js` (`appendReservationComment`)                                                     |
| Testsuite (ca. 288 Fälle)                                                             | `test/*.test.mjs` → Abnahmetests der Übertragung                                                 |

**Nicht übernommen:**

- Gast-Suche mit Nachname (STAY-Session ersetzt sie);
- Admin-Benutzer, JWT und KV (STAY-Admin und Postgres ersetzen sie);
- Bilder in KV (Supabase Storage ersetzt sie).

### 7.2 Aus STAY wiederverwenden

- Gast-Session und Gastkontext;
- Apaleo-Provider und Property-Zuordnung;
- Journey-Phasen;
- Startseiten-Viewmodel und Kacheln;
- Design V2 und UI-Bausteine;
- Explore (Orte, Zuordnung, Übersetzung, Bilder) als Vorbild bzw. Basis für Partner;
- Admin (Benutzer, Rollen, Sessions, Medien-Upload);
- Postgres mit RLS-Muster;
- Rate-Limits und Logger-Redaction;
- Zahlungsübersicht;
- Feature-Schalter je Objekt;
- Env-Schema-Muster (externe Dienste standardmäßig aus).

### 7.3 Neu zu entwickeln

| Baustein                                                                                                              | Phase |
| --------------------------------------------------------------------------------------------------------------------- | ----- |
| Domänenmodell `@up/core/upsell` (Offer, OfferSource, Fulfillment, Statusmodell, Empfehlungsregeln)                    | 1     |
| Apaleo lesend in STAY: Reservierungsservices für „Gebucht“                                                            | 1     |
| Editorial-Oberflächen: Startseiten-Modul, „Services & Erlebnisse“, Detailseite, Bestätigung, „Gebucht & angefragt“    | 1–2   |
| Interne Extras-API plus signierte Service-Tokens (additiv in Extras) und STAY-Client                                  | 2     |
| Postgres-Tabellen für Partner, Angebote, Zuordnung, Zeitfenster, Platzierung, Anfragen, Ereignisse, Provisionsmodelle | 3     |
| Admin: Partner, Angebote, Platzierung, Anfragen (Partner), Provisionsexport                                           | 3     |
| Slack-Adapter in STAY (gemeinsam)                                                                                     | 3     |
| Übertragung der Extras-Logik nach TypeScript, KV→Postgres-Migration, Schattenbetrieb, Umleitung                       | 5     |
| Partner-API-Adapter für Direktbuchungen, Vorabzahlung                                                                 | 6     |

---

## 8. Umsetzungsplan in Phasen

Jede Phase gilt zuerst nur für das TEST-Objekt und Staging. Es gibt keine produktiven Schreibzugriffe ohne Freigabe; die Abnahme erfolgt je Phase mit Bericht.

**Phase 0 – Entscheidungen (ohne Code)**

Zu treffen sind:

- Architekturweg (Empfehlung: Brücke → Zusammenführung);
- einziger Apaleo-Schreiber in der Übergangszeit (Empfehlung: Extras);
- Stornoregeln;
- Provisionsmodelle;
- wer Partneranfragen beantwortet (Team per Slack oder Partner direkt);
- Bildrechte und Fotobudget;
- Datenschutz (Ereignisse ohne Personenbezug, AVV mit Partnern bei Direktbuchung).

**Phase 1 – Fundament, nur lesend, nur STAY**

- Domänenmodell und Empfehlungsregeln mit Tests;
- Apaleo-Lesezugriff auf Reservierungsservices;
- „Gebucht & angefragt“ mit echten Apaleo-Daten (nur Anzeige);
- Gestaltungsprototyp der vier Oberflächen mit Beispieldaten.

_Keine Änderung an Extras._

**Phase 2 – Brücke zu den Hausleistungen**

_Erste Änderung an Extras, additiv. Braucht Deine Freigabe._

- **In Extras:** interne API (`/api/internal/v1/*`), signierte Service-Tokens, Rate-Limit, Log-Bereinigung; hinter einem Schalter, zuerst Staging bzw. Preview.
- **In STAY:**
  - Katalog, Sofortbuchung, Anfrage und Verlängerung im eigenen Design;
  - Startseiten-Modul;
  - Übersicht inklusive Extras-Anfragen.
- **Abnahme:** Playwright mit TEST-Reservierung. Buchungen nur auf TEST-Folio, nach Freigabe.

**Phase 3 – Partnerplattform**

- Datenmodell (Migration nur Staging);
- Admin für Partner, Angebote, Zuordnung, Zeitfenster und Platzierung;
- Abwicklung über Link und Anfrage;
- Slack für Partneranfragen;
- Ereignisse und Provisionsexport;
- Empfehlungen auf der Startseite aus beiden Quellen.

**Phase 4 – Feinschliff und Messung**

- Platzierungen je Objekt, Saisonpflege;
- Kennzahlen aus eigenen Ereignissen (Klicks, Anfragen, Buchungen; ohne Personenbezug);
- Barrierefreiheit, Performance (Bildgrößen), EN-Texte.

**Phase 5 – Zusammenführung der Extras-Logik**

- Übertragung nach TypeScript mit den portierten Extras-Tests als Abnahme;
- KV→Postgres-Migration (Katalog, Anfragen, Verlängerungskonfiguration und -protokoll, Bestellhistorie);
- Admin-Module in die STAY-Admin-App;
- **Schattenbetrieb:** STAY berechnet parallel, Abweichungen werden protokolliert;
- danach Umschalten des Apaleo-Schreibers (Freigabe), Umleitung von `extras.unique-places.com` und Abschalten der Extras-App.

**Phase 6 – Erweiterungen (je mit Freigabe)**

- Partner-Schnittstellen für Direktbuchungen;
- Vorabzahlung (nach Zahlungsphase B2);
- E-Mail-Bestätigungen (Resend);
- Slack-App mit Freigabe-Buttons;
- Partnerportal.

---

## 9. Risiken und Gegenmaßnahmen

| Risiko                             | Gegenmaßnahme                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Fehlbuchungen auf echten Folios    | Ein Schreiber, TEST zuerst, Neuprüfung direkt vor jeder Buchung (wie Extras), Schattenbetrieb vor dem Umschalten |
| Verhaltensänderung beim Übertragen | Extras-Testsuite portieren; Abweichungen im Schattenbetrieb sichtbar machen                                      |
| Zwei Systeme in der Übergangszeit  | klar begrenzte Brücke (versioniert), keine Logik doppelt, Zeitplan für Phase 5                                   |
| Aufdringliches Upselling           | höchstens ein Angebot im Fokus, phasengerecht, Gebuchtes verschwindet aus den Empfehlungen                       |
| Datenschutz bei Provisionsnachweis | nur pseudonyme Ereignisse, keine Cookies, Referenzparameter ohne Gastdaten                                       |
| Bildqualität bei Partnern          | Bildvorgaben im Admin (Mindestgröße, Seitenverhältnis, Alt-Text), redaktionelle Freigabe vor Veröffentlichung    |
