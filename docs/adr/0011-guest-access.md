# 0011 – Sicherer Gastzugang: Link, Buchungsnummer-Login, Guest Session

**Status:** Akzeptiert (2026-10-05, Phase 7). Präzisiert und ersetzt in Teilen [ADR 0004](0004-guest-access.md): Statt eines signierten Cookies gibt es eine serverseitige Session.

## Kontext

Gäste sollen ohne Konto ihren Aufenthalt öffnen können. Dafür gibt es zwei Wege:

1. über einen persönlichen Link
2. ersatzweise über Buchungsnummer + Nachname

Beide Wege müssen widerrufbar sein und dieselben Zeitregeln einhalten. Sie dürfen keine personenbezogenen Daten in der Datenbank anhäufen und keine Information über Reservierungen preisgeben. Echte Apaleo-Zugangsdaten und Supabase-Projekte folgen später. Deshalb muss alles lokal und in Tests mit dem Mock-PMS laufen.

## Entscheidung

### Ablauf (beide Wege enden gleich)

```
Link /{locale}/s/{token}                 Login /{locale}/login (Buchungsnummer + Nachname)
  │ Hash → guest_access                    │ Rate Limit → PMS-Suche → Nachname prüfen
  │ Zeitfenster/Widerruf prüfen            │ Status, Property-Mapping (Tenant), Widerruf, Zeitfenster
  └──────────────┬─────────────────────────┘ bestehenden guest_access nutzen oder anlegen
                 ▼
        startSession(): neues Session-Secret, alte Session widerrufen
                 ▼
        Cookie setzen → 303 auf /{locale}/stay (ohne Token, ohne Formulardaten)
                 ▼
/stay: Cookie → guest_sessions ⋈ guest_access (bei jedem Request geprüft)
       → externalReservationId → PmsProvider (Apaleo | Mock) → StaySource → ViewModel
```

### Datenmodell (Migration `0002`)

- **`guest_access`** mit folgenden Spalten:
  - `id` (uuid), `tenant_id`, `property_id`, `unit_id?`
  - `reservation_provider` (`apaleo` | `mock`), `external_reservation_id`
  - `token_hash`
  - `valid_from`, `valid_until`, `revoked_at?`, `last_used_at?`, `created_at`, `updated_at`
- Die Property gehört zum Tenant, über einen Fremdschlüssel `(tenant_id, property_id)`. Die Unit gehört zu Property **und** Tenant, über `(tenant_id, property_id, unit_id)` → `units`.
- Die Reservation-ID ist eine externe Identität und nie Primärschlüssel. Reservierungsdaten (Daten, Namen, Status) werden nicht dupliziert, sondern live aus dem PMS geladen.
- **`guest_sessions`:**
  - Spalten: `id`, `tenant_id`, `guest_access_id`, `token_hash`, `expires_at`, `revoked_at?`
  - Fremdschlüssel `(tenant_id, guest_access_id)` mit Cascade
- **`rate_limit_buckets`:** `key` (`<scope>:<sha256>`), `window_started_at`, `hits`
- Auf allen Tabellen ist RLS ohne Policies aktiv. Migration `0003` entzieht `anon` und `authenticated` die Rechte auf alle Tabellen.

### Token

- Erzeugt mit `crypto.randomBytes(32)`: 256 Bit, base64url, 43 Zeichen, URL-sicher. Das Token enthält keine Reservation-ID, Gast-ID oder Personendaten.
- In der Datenbank liegt nur `SHA-256(token)` als Hex-String. Ein schneller Hash genügt, weil die Eingabe volle 256 Bit Entropie hat. Es gibt nichts durchzuprobieren und keine Rainbow-Tabellen.
- Der Vergleich läuft über eine Hash-Gleichheitsabfrage auf einem Unique-Index. Das Formular des Tokens wird vor jeder Abfrage geprüft (`^[A-Za-z0-9_-]{43}$`).
- Den Klartext gibt es nur bei der Erzeugung (CLI-Ausgabe, später der Versand) und im Link selbst.
- Rotation: Ein neuer Link ist einfach ein neuer `guest_access`-Datensatz. Der alte wird widerrufen.

### Gültigkeit

- `computeAccessWindow()` in `@up/core`, mit Defaults `opensDaysBeforeArrival: 30` und `closesDaysAfterDeparture: 3`. Die Policy-Struktur erlaubt später Werte pro Tenant oder Property.
- `evaluateAccess()` liefert `valid | not-yet-valid | expired | revoked`. Ein Widerruf hat Vorrang. `valid_from` zählt inklusiv, `valid_until` exklusiv.
- Unbekannte Tokens und Inkonsistenzen sind ebenfalls ungültig:
  - Die Reservierung passt nicht mehr zu Property oder Tenant.
  - Die Reservierung ist storniert oder No-Show.

  Beides prüft STAY beim Laden aus dem PMS und leitet dann auf die neutrale Seite um.

### Session

- Opakes, zufälliges Secret (256 Bit) im Cookie. In `guest_sessions` liegt nur dessen Hash.
- **Warum nicht stateless (signiert oder JWT):**
  - Widerruf muss serverseitig sofort greifen. Jeder Request prüft deshalb Session **und** Guest Access gemeinsam (ein Join), widerrufene oder abgelaufene Datensätze greifen sofort.
  - Ein signiertes Cookie bräuchte dieselbe Datenbankabfrage und zusätzlich ein Secret-Management (`GUEST_SESSION_SECRET` entfällt).
- **Lebensdauer:** höchstens 30 Tage, nie länger als `valid_until` des Zugangs. Die Session verlängert sich nicht von selbst. Ein erneuter Einstieg erzeugt eine neue Session.
- **Session Fixation:** Bei jedem Einstieg (Link oder Login) entsteht ein neues Secret, die vorherige Session wird widerrufen. Ein Secret aus der URL wird nie akzeptiert.
- **Cookie:**
  - immer `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` = Restlaufzeit
  - außerhalb von local zusätzlich `Secure` und das Präfix `__Host-` (dann ohne `Domain`)
  - `Lax` ist nötig: Der Link wird aus E-Mail oder Messenger geöffnet (Top-Level-Navigation von fremder Seite), und auch der 303-Redirect muss das Cookie tragen. `Strict` würde das brechen.
- Kein Fingerprinting, keine IP- oder Gerätebindung. Ein weitergeleiteter Link gewährt Zugriff; das ist bewusst so (ADR 0004).

### Einstieg `/{locale}/s/{token}`

- Ein Route Handler, nur serverseitig. Er antwortet immer mit **303** auf eine URL ohne Token:
  - gültig: `/{locale}/stay` plus Cookie
  - alles andere: `/{locale}/link-invalid`
- Header: `Cache-Control: no-store, private`, `Referrer-Policy: no-referrer` (Route-spezifisch in `next.config.ts`), `X-Robots-Tag: noindex`.
- Die neutrale Seite sagt „Dieser Zugangslink ist nicht mehr gültig.“ und bietet den Login an. Sie unterscheidet nicht nach Grund, die Reservierung bleibt unbekannt.

### Buchungsnummer + Nachname

- **Normalisierung der Buchungsnummer:** trimmen, innere Leerzeichen entfernen, Großbuchstaben, Muster `^[A-Z0-9][A-Z0-9-]{2,39}$`. Andere Eingaben erreichen das PMS nie.
- **Nachname:**
  - Normalisierung: NFC, trimmen, innere Leerzeichen zusammenfassen, Kleinbuchstaben.
  - Vergleich in konstanter Zeit, ohne Fuzzy- oder Ähnlichkeitssuche. „Müller“ ≠ „Mueller“ ≠ „Muller“.
- **Ergebnis:**
  - Nur genau **ein** passender Kandidat führt zum Erfolg. Mehrdeutigkeit (relevant für spätere OTA-Nummern) schlägt fehl.
  - Danach gelten dieselben Regeln wie beim Link: Status nicht storniert oder No-Show, Property über `external_mappings` **dieses** Tenants, kein Widerruf, Zeitfenster offen.
  - Bestehender gültiger Zugang → wiederverwenden, sonst neu anlegen (mit zufälligem, verworfenem Token).
  - Ein **widerrufener** Zugang sperrt die Reservierung auch für den Login.
- **Ein Fehlertext für alle Fehlschläge:** „Wir konnten Deinen Aufenthalt mit diesen Angaben nicht finden. Bitte prüfe Buchungsnummer und Nachname.“ Er gilt für unbekannte Nummer, falschen Nachnamen, Stornierung, abgelaufenen Aufenthalt, Widerruf, PMS-Fehler und fehlende Konfiguration. Die Gründe stehen nur im Server-Log, ohne Eingabewerte.
- Eingaben laufen nur im POST-Body einer Server Action (Next prüft Origin gegen Host). Sie werden nicht gespeichert, nicht geloggt und nicht in URLs übertragen. Nach Erfolg bleibt nur die Session.
- Tenant: `GUEST_TENANT_SLUG` (eine Deployment-Instanz = ein Tenant). Das ist die Vorstufe zur Host-basierten Auflösung (`tenant_domains`).
- **PMS für den Login:**
  - Apaleo, wenn konfiguriert
  - sonst außerhalb von Production das Mock-PMS
  - sonst keines (der Login schlägt geschlossen fehl)

### Rate Limiting

- Implementiert über **Postgres** (`rate_limit_buckets`, atomarer Upsert mit festem Fenster). Es gilt für alle Serverless-Instanzen gemeinsam, ohne neue Infrastruktur und ohne In-Memory-Zustand.
- **Limits:**
  - **pro Client-Adresse** (`x-real-ip` bzw. `x-forwarded-for` von Vercel): 10 Versuche in 15 Minuten
  - **pro Buchungsnummer**, über alle Adressen: 5 Versuche in 15 Minuten
- Jeder Versuch zählt, und zwar vor der PMS-Abfrage.
- Die Sperre endet mit dem Fenster, es gibt keine dauerhafte Bindung. Die Meldung „Zu viele Versuche …“ verrät nichts über Reservierungen.
- Schlüssel sind SHA-256-Hashes. Buckets älter als 24 Stunden werden bei jedem Zugriff gelöscht.
- Kein CAPTCHA. Bei Bedarf kommen zusätzlich die Vercel Firewall bzw. Bot-Schutz davor.
- Den Link-Einstieg begrenzen wir nicht. 256 Bit Entropie machen Raten praktisch unmöglich (2²⁵⁶ Möglichkeiten).

### Apaleo-Kennungen (geprüft gegen die offizielle API-Beschreibung, nur Schemas, keine Live-Daten)

- **Reservation-ID** (z. B. `ABCDEFGH-1`): `GET /booking/v1/reservations/{id}`, Scope `reservations.read` (bereits verifiziert). **Implementiert.** Die Antwort enthält `primaryGuest.lastName`. Das Schema liest es nur im Login-Pfad und gibt es als `primaryGuestLastName` zum einmaligen Vergleich zurück. In `PmsReservation` landet es nie.
- **Booking-ID** (z. B. `ABCDEFGH`): eigene Entität. Eine Buchung kann mehrere Reservierungen enthalten (`GET /booking/v1/bookings/{id}`, Filter `bookingId` in der Liste). **Nicht implementiert.**
- **OTA-Nummer:**
  - `GET /booking/v1/reservations?externalCode=…` ist laut API ein **Präfix**-Filter („starting with the provided value“), also nicht exakt.
  - `externalReferences` filtert exakt auf Felder des `ExternalReferencesModel`. Welche Felder Booking.com oder Airbnb (über Channel Manager) tatsächlich befüllen, ist unbekannt.
  - `channelCode` kennt u. a. `BookingCom` und `ChannelManager`, aber kein Airbnb.
  - `textSearch` ist unscharf (sucht auch in Namen und E-Mails) und damit ungeeignet.
  - **Nicht implementiert.** Der Port (`findReservationsByBookingReference` liefert eine Kandidatenliste, Mehrdeutigkeit schlägt fehl) ist vorbereitet.

### Modi

- **`GUEST_ACCESS_MODE=preview`** (Standard): `/stay` ohne Session zeigt die Preview (Mock oder Apaleo-Preview-Reservierung). Mit gültiger Session zeigt es die Session-Reservierung. Der Entwicklungs-Workflow bleibt damit unverändert.
- **`GUEST_ACCESS_MODE=secured`:** `/stay` ohne gültige Session leitet auf `/login`. Der Modus verlangt `DATABASE_URL` und `GUEST_TENANT_SLUG`, in Production zusätzlich Apaleo-Zugangsdaten.
- Production muss vor echten Gästen auf `secured` stehen.

### Development-Zugang

- Es gibt kein Web-Formular zur Link-Erzeugung, nur den CLI:
  - `pnpm guest-access:create --target … --tenant … --provider mock|apaleo --reservation …` gibt den Link **einmal** aus, gespeichert wird nur der Hash.
  - `pnpm guest-access:revoke …` widerruft alle Zugänge einer Reservierung.
- Production verlangt `--confirm-production`, nie `mock` und nie `--valid-days`.
- Die Mock-Reservierung `MOCK-HOV-ROS-LIVE` (Nachname „Muster“) ist um das aktuelle Datum herum datiert, damit Link und Login lokal funktionieren.
- `pnpm db:seed --with-preview-fixtures` legt die Apaleo-TEST-Property für local/staging an. In Production wird das abgelehnt.

### Datenschutz

- `guest_access` enthält keinen Namen, keine E-Mail, keine Telefonnummer und keine Adresse; ein Test prüft die Spaltenliste. Die Verbindung zur Person besteht nur über die Reservation-ID im PMS.
- `guest_sessions` enthält nur Hashes und Zeitpunkte. `rate_limit_buckets` enthält nur Hashes und höchstens 24 Stunden lang.
- **Logs:** nie Token, Session-Secret, Buchungsnummer, Nachname oder IP.
  - Der Logger schwärzt zusätzlich Schlüssel wie `token`, `lastName` und `bookingReference`.
  - Datenbankfehler werden nur mit Name und Code geloggt, weil postgres.js-Fehler Query-Parameter enthalten.

## Bekannte Restrisiken

- **Plattform-Request-Logs:** Vercel protokolliert Request-Pfade, also auch `/de/s/{token}`. Unser Code loggt das Token nicht. Gegenmaßnahmen: begrenzte Gültigkeit, sofortiger Widerruf, kurze Log-Aufbewahrung und beschränkter Zugriff auf das Vercel-Team. Eine spätere Variante mit Token im URL-Fragment wäre möglich, braucht aber JavaScript.
- **Browser-Verlauf:** Der Einstiegs-Link kann in der Browser-Historie des Gastes stehen. Das betrifft das Gerät des Gastes selbst, und der Link ist ohnehin sein Zugang.
- **E-Mail-Scanner** (z. B. Safe Links) öffnen Links vorab und erzeugen dabei ungenutzte Sessions. Das ist harmlos: Das Token bleibt gültig, die Session-Secrets erhält nur der Scanner und sie laufen ab.
- **Error Tracking** (z. B. Sentry) ist noch nicht eingebunden. Bei Einführung müssen Pfade unter `/s/` und Formulardaten im `beforeSend` gefiltert werden.

## Konsequenzen

- Ein Weg, eine Session-Art: Link und Login unterscheiden sich nur bis `startSession()`.
- Jede Seitenansicht mit Session kostet eine indizierte Datenbankabfrage. Dafür greift ein Widerruf sofort.
- `/stay` wird pro Request gerendert (Cookie). Die Darstellung ist unverändert.
