# 0018 – Zahlungsübersicht und zahlungsabhängige Zugangsfreigabe

**Status:** Vorschlag (2026-11-04). **Phase A umgesetzt (2026-11-05, nur TEST, nur lesend)**, Phase B/C offen. Ergänzt [ADR 0008](0008-pms-provider-apaleo.md), [ADR 0016](0016-guest-journey-and-online-check-in.md) und [ADR 0017](0017-provider-neutral-access.md). Die verifizierte Apaleo-Grundlage steht in [docs/integrations/apaleo-payments.md](../integrations/apaleo-payments.md).

## Kontext

Gäste sollen nach Ende der kostenfreien Stornierung in „Dein Zugang“ sehen, welcher Betrag offen und fällig ist. Sie sollen über Apaleo Pay (Adyen) bezahlen können. Zugangsdaten gibt die App erst aus, wenn die Zahlungsbedingungen erfüllt sind. Apaleo ist maßgeblich. Die App speichert keine Karten- oder Zahlungsdaten und gibt nie auf Grund eines Frontend-Zustands oder einer bloßen Rückkehr von der Zahlungsseite frei.

Heute gibt es genau eine Stelle, die über Zugang entscheidet: `getAccessForStay` (`packages/core/src/access/access-model.ts`). Sie wird von `loadStayJourney` (STAY) und von der Server Action `revealAccessCode` (Code anzeigen) genutzt. Andere Ausgabekanäle gibt es nicht: keine E-Mails, keine API-Route mit Codes.

## Entscheidung

### 1. Zwei getrennte Zeitpunkte

| Begriff                               | Quelle                                                                                                                                                                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ende der kostenfreien Stornierung** | `reservation.cancellationFee.dueDateTime` (Booking v1, dokumentiert). Fehlt der Wert, gibt es keine Stornofrist: Es gilt sofort die Fälligkeit nach Regel.                                                                                            |
| **Zahlung fällig am**                 | Apaleo hat dafür **kein** Feld. Eine eigene Regel pro Objekt: `dueAt = at-free-cancellation-end` (Standard) · `days-before-arrival: n` · `at-booking`. Der früheste sinnvolle Zeitpunkt gewinnt nie automatisch. Die Regel ist explizit konfiguriert. |

Vor `dueAt` zeigt die App höchstens eine Information („Zahlung fällig ab …“), aber keine Aufforderung und keine Sperre.

### 2. Welcher Betrag ist vom Gast zu zahlen?

Quelle: `GET /finance/v1/folios?reservationIds=<id>&expand=charges` (Scope `folios.read`). Die App berechnet den Betrag aus Folios, nicht aus dem undokumentierten `reservation.payableAmount.guest`. Der Wert dient nur zur Plausibilitätsprüfung: Weicht er ab, gilt der Status `review`.

Ein Folio zählt als **Gast-Folio**, wenn alle Bedingungen gelten:

- `type = Guest`,
- `debitor.type ∈ {PrimaryGuest, Booker, AdditionalGuest}`,
- kein `company` am Folio.

Diese Folios zählen nicht:

- `Company` als Debitor (Firmen- oder Drittzahler),
- `House` und `External`,
- Charges mit `routedTo` oder `movedTo` (die Forderung liegt auf einem anderen Folio).

`type = Booking` oder ein unklarer Debitor führt zu `review`, nie zu einer stillen Freigabe.

**Offener Betrag** = Summe der negativen `balance` der Gast-Folios. Ein negativer Saldo bedeutet beobachtet eine Forderung (siehe Integrationsdoku). Die Vorzeichenregel wird in Phase A an echten Testfällen abgesichert.

**Die Währung muss einheitlich sein.** Gemischte Währungen führen zu `review`.

### 3. OTA, virtuelle Karte, Drittzahler

Diese Fälle lösen **keine Zahlungsaufforderung** an den Gast aus. Sie sperren auch nicht wegen der Zahlung, sofern die Objektkonfiguration das so festlegt:

- `paymentAccount.isVirtual = true` (virtuelle Karte des Portals)
- `guaranteeType = Ota`
- `guaranteeType = Company`
- alle Gast-Folios ausgeglichen, weil die Forderung auf einem Firmen-Folio liegt

Ein `channelCode` ≠ `Direct`/`Ibe` ohne eindeutiges Signal von oben führt zu `review`. Hintergrund: Booking.com- und Expedia-Modelle (Hotel Collect oder Portal Collect) lassen sich ohne echte Beispiele nicht sicher unterscheiden.

`review` bedeutet:

- Der Zugang bleibt gesperrt.
- Der Gast sieht einen Hilfetext mit Kontakt.
- Das Team bekommt einen Hinweis (zuerst Log/Admin-Liste, später Benachrichtigung).

Ausnahmen setzt das Team manuell pro Reservierung: `payment_override` mit Begründung, Person und Zeit.

### 4. Zahlungsstatus (pro Reservierung, serverseitig berechnet)

`not-applicable` · `not-due` · `due` · `pending` · `paid` · `failed` · `review` · `unknown`

- `paid`: Der offene Gast-Betrag ist ≤ 0, frisch von Apaleo gelesen.
- `pending`: Es gibt eine eigene Zahlungsanforderung mit Apaleo-Status `Pending`.
- `failed`: Die letzte Anforderung hat den Status `Failure` oder `Canceled`, und es ist weiter ein Betrag offen. Der Gast kann es erneut versuchen.
- `unknown`: Apaleo ist nicht erreichbar oder liefert eine unerwartete Antwort. Dann gilt **gesperrt** plus Hilfetext. Ausnahme: `cleared_at` ist bereits gesetzt (siehe 6).

### 5. Zahlungsprozess (Apaleo Pay / Adyen)

1. Der Gast tippt „Jetzt bezahlen“. Eine Server Action prüft Session und Reservierung und liest die Folios neu. Der Betrag kommt **nur** vom Server.
2. Gibt es eine offene, nicht abgelaufene Anforderung für dasselbe Folio und denselben Betrag, nutzt die App sie wieder. Hat sich der Betrag geändert, ruft die App `PUT …/payments/{id}/cancel` auf und legt eine neue an.
3. Neu: `POST /finance/v1/folios/{folioId}/payments/by-link` mit
   - `amount` (offener Betrag des Folios, höchstens `allowedPayment`),
   - `expiresAt` (zum Beispiel 60 min),
   - `description`, `countryCode`, optional `payerEmail`,
   - `returnUrl = https://<app>/<locale>/stay/payment/return?ref=<opaque>`,
   - `paidCharges` (die offenen Charges des Folios).

   Der Header `Idempotency-Key` ist deterministisch: `sha256(reservationId, folioId, amount, attempt)`. Ein Doppelklick erzeugt so keine zweite Zahlung (Apaleo: Schlüssel 24 h gültig). Dazu kommt eine DB-Sperre pro Reservierung, die eine parallele Anlage verhindert.

4. Die App liest die Zahlung über den `Location`-Header (`GET …/payments/{paymentId}`). Sie leitet nur weiter, wenn der Host von `url` auf der Allowlist steht.
5. **Rückkehr:** Die Seite `/stay/payment/return` zeigt „Wird geprüft …“. Der Server liest Zahlungsstatus **und** Folio-Saldo. Freigegeben wird nur nach dem Saldo. `ref` ist ein zufälliger Verweis auf unsere Anforderung. Die Rückkehr selbst ändert nichts.
6. **Bestätigung:** Folio-Webhooks (`payment-posted`, `payment-failed`, `payment-canceled`, `balance-changed`, `charges-changed`) sind nur Auslöser für einen Neuabruf. Ein Cron fragt offene Anforderungen ab (zum Beispiel alle 5 min, höchstens bis `expiresAt` + 30 min). Weitere Auslöser: Aufruf von STAY, der Zahlungsseite und „Code anzeigen“.
7. Der Webhook-Endpunkt hat ein Token in der URL und eine IP-Allowlist. Er ist idempotent, reagiert schnell mit 2xx und verarbeitet asynchron. Doppelte und ungeordnete Events sind unschädlich, weil die Wahrheit immer der API-Abruf ist.

### 6. Serverseitige Sperre im Zugangsmodell

`getAccessForStay` erhält ein neues Pflicht-Input `payment: { state, dueAt?, clearedAt? }`. Die Reihenfolge wird so:

> Aufenthalt vorbei → **Zahlung** → Registrierungspflicht → Freigabezeit → manueller Modus → Credential.

Daraus folgt:

- Bei fälliger, nicht bestätigter Zahlung gibt die App weder Code **noch** manuelle Hinweise aus. Hinweise sind ebenfalls Zugangsinformation.
- Neues Ergebnis `pending: { reason: "payment-required" | "payment-review" }`.
- `revealAccessCode` liest die Zahlung **live** neu, bevor es entschlüsselt.
- Künftige Smart-Lock-Adapter stellen Credentials erst nach `cleared` aus.
- `clearedAt`: Die App speichert, wann der Gast-Betrag erstmals bestätigt bezahlt war. **Später gebuchte Extras** (Minibar, Verlängerung vor Ort) sperren den Zugang danach nicht mehr. Sie erscheinen nur als neue offene Position mit Zahlungsmöglichkeit.
- Rollout-Modus pro Objekt: `off` (nichts) · `inform` (Übersicht und Bezahlen, keine Sperre) · `enforce` (Sperre). Der Standard ist `off`. `enforce` nur nach Freigabe.

### 7. Ausgabekanäle (Prüfung)

| Kanal                                                | Befund                                      | Maßnahme                                                                        |
| ---------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| STAY „Dein Zugang“                                   | über `loadStayJourney` → `getAccessForStay` | Gate greift                                                                     |
| Server Action „Code anzeigen“                        | prüft live neu                              | Zahlung zusätzlich live prüfen                                                  |
| E-Mails / Push                                       | in der App nicht vorhanden                  | wer sie später einführt, muss `getAccessForStay` nutzen (Test, der das sichert) |
| API-Routen                                           | keine mit Zugangsdaten                      | –                                                                               |
| Schlüsselbox-Code pro Unit                           | statisch, bekannt bei früheren Gästen       | Restrisiko dokumentieren; Rotation zwischen Aufenthalten bleibt organisatorisch |
| Externe Kanäle (Apaleo-Mails, OTA-Nachrichten, Team) | außerhalb der App                           | dokumentieren; das Team darf dort keine Codes vor Zahlung senden                |

### 8. Architektur

- **Port** `PaymentProvider` in `@up/core`:
  - `getPaymentSummary(reservation)` liefert das normalisierte Modell: Folios, Positionen, Zahlungen, offener Betrag, Signale für OTA und Drittzahler.
  - `createPaymentRequest(...)` und `getPaymentRequest(...)`
  - `cancelPaymentRequest(...)`
- **Adapter** `ApaleoPaymentProvider` im Apaleo-Paket. Er nutzt den bestehenden Token-Client pro Tenant. Phase A nutzt nur Lesezugriffe.
- Die **Bewertungslogik** (`evaluatePayment(summary, config, now)` → Status) ist rein und provider-neutral und vollständig unit-testbar.
- **Daten** (Tenant- und Objekt-getrennt, RLS wie die übrigen Tabellen): `payment_requests` mit
  - `tenant_id`, `property_id`, `reservation_id`, `folio_id`
  - `provider_payment_id`, `amount`, `currency`, `status`
  - `idempotency_key`, `return_ref`, `expires_at`, Zeitstempel

  Dazu `reservation_payment_state` (`cleared_at`, `last_checked_at`, `override`). **Nicht** gespeichert: Link-URL, Kartendaten, PSP-Rohdaten.

- **Konfiguration:** drittes Dokument `payment` in `property_journey_settings` mit
  - `mode` (`off` / `inform` / `enforce`)
  - `due` (Regel aus Abschnitt 1)
  - `otaPolicy`
  - `helpContact`
  - Texte DE/EN

  Später im Admin pro Objekt pflegbar.

### 9. Oberfläche

- **STAY, „Dein Zugang“:**
  - Bei `due` oder `failed`: Hinweis „Offener Betrag 337,00 €“ mit Fälligkeit, Button „Jetzt bezahlen“ (Primärfarbe), Zugang „gesperrt bis Zahlung bestätigt“.
  - Bei `pending`: „Zahlung wird bestätigt …“.
  - Bei `review` oder `unknown`: Hilfetext mit Kontakt.
  - Bei `paid`: kein Hinweis, Freigabe nach der bisherigen Logik.
- **Zahlungsübersicht** `/stay/payment`:
  - Objekt, Apartment, Daten
  - Positionen (`translatedNames`, Datum, Betrag)
  - bereits gezahlt, offen und fällig
  - Button zu Apaleo Pay
  - Rückkehrseite mit den Zuständen ausstehend, erfolgreich, fehlgeschlagen, in Prüfung
- Alle Texte gibt es auf Deutsch und Englisch. Beträge formatiert `Intl.NumberFormat` mit der Währung aus Apaleo.

## Phasen

| Phase              | Inhalt                                                                                                             | Voraussetzungen                                                                                                                  | Wirkung auf Gäste                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **A – nur lesend** | `PaymentProvider` (lesen), `evaluatePayment`, Zahlungsübersicht, Hinweis in STAY. Modus `inform`, nur Objekt TEST. | Scope `folios.read`                                                                                                              | keine Sperre, kein Bezahl-Button    |
| **B – Apaleo Pay** | Payment Links, `payment_requests`, Rückkehrseite, Webhook-Endpunkt, Cron                                           | Apaleo-Pay-**Testkonto** für TEST bestätigt; Scope `folios.manage`; Webhook-Subscription (nur TEST); Link-Host für die Allowlist | Testzahlungen nur im Adyen-Test     |
| **C – Sperre**     | Gate in `getAccessForStay` und `revealAccessCode`, `cleared_at`, Overrides, Modus `enforce`                        | A und B im Test abgenommen; ausdrückliche Freigabe pro Objekt                                                                    | Sperre nur für freigegebene Objekte |

## Tests

Die reinen Tests laufen für `evaluatePayment` und das Gate. Integrationstests nutzen einen Apaleo-Stub:

- **vollständig bezahlt:** `paid`, Zugang nach Freigabezeit
- **teilweise bezahlt:** `due` mit Restbetrag
- **Drittzahler oder Firma:** Gast-Folio ausgeglichen, `not-applicable`; Firmen-Folio wird nicht angezeigt
- **mehrere Folios:** nur Gast-Folios zählen; ein unklarer Debitor führt zu `review`
- **Zahlungsfehler:** `failed`, erneuter Versuch möglich, Zugang gesperrt
- **doppelter Klick oder parallele Anfragen:** genau eine Anforderung, gleicher Idempotency-Key
- **Betrag ändert sich bei offenem Link:** alter Link wird storniert, neuer angelegt
- **spätere Extras nach `cleared_at`:** Zugang bleibt frei, neue Position wird angezeigt
- **Rückkehr ohne bestätigte Zahlung:** bleibt gesperrt
- **Apaleo nicht erreichbar:** `unknown`, gesperrt plus Hilfe; bei gesetztem `cleared_at` bleibt der Zugang frei
- **OTA mit virtueller Karte:** keine Aufforderung
- **Stornofrist noch offen:** `not-due`, keine Aufforderung
- **Webhook doppelt oder ungeordnet:** gleiches Ergebnis

## Konsequenzen

- Die Zahlungsentscheidung liegt vollständig auf dem Server und folgt immer Apaleo. Ein Frontend-Zustand gibt nie frei.
- Mit `enforce` hängt der Zugang von der Erreichbarkeit von Apaleo ab. `cleared_at` und manuelle Overrides begrenzen das Risiko.
- Statische Schlüsselbox-Codes bleiben ein organisatorisches Restrisiko, das die App nicht lösen kann.

## Offene Fragen

Siehe [Integrationsdoku, Abschnitt „Offen“](../integrations/apaleo-payments.md#offen-im-apaleo-testsystem-zu-klären-vor-phase-b): Testkonto, Link-Host, echte OTA-Beispiele, Bedeutung von `payableAmount.guest`, Zusammenspiel mit der Apaleo-Zahlungsautomatik.

## Umsetzungsstand Phase A (2026-11-05)

**Geschäftsregeln** (festgelegt am 2026-11-05):

1. Nach Ablauf der kostenfreien Stornierung ist der **gesamte offene Betrag** fällig, nicht nur die Stornogebühr. Die Fälligkeitsregel ist pro Objekt und optional pro Rate konfigurierbar (`ratePlans`).
2. Eine bestätigte Zahlung (`cleared_at`, Phase B/C) wird durch spätere Extras nicht wieder zur Sperre.
3. Ein Apaleo-Ausfall sperrt einen freigegebenen Zugang nicht wieder. Unverifizierte Zahlungen geben nie frei.
4. Firmen- und Drittzahler, Guthaben und noch nicht fällige Leistungen werden gesondert behandelt.

**Code:**

| Teil             | Ort                                                                                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bewertung (rein) | `packages/core/src/payment/` mit `evaluatePayment`, `paymentAccessCondition` (Regeln 2 und 3, noch nicht verdrahtet) und `confirmsPayment`                                                                                 |
| Apaleo lesend    | `ApaleoPaymentProvider`: Reservierung, Folios der Reservierung und Buchungsfolios, Zahlungen, Erstattungen. Nur `GET`, Scope `folios.read`. Personendaten werden nicht übernommen. Unvollständige Seiten werden verworfen. |
| Konfiguration    | übergangsweise in der Registry (`payment`), wirksam **nur für Testobjekte**, `enforce` wird auf `inform` begrenzt (`config/payment.ts`)                                                                                    |
| Gastansicht      | `/v2/payment` (Leistungen, Zahlungen, Erstattungen, Übersicht, Status, DE/EN), Hinweis im Zugangsbereich der Apartmentseite, Kachel „Zahlung“ bei `due`                                                                    |

**Nicht enthalten:** Zahlungslinks, Speicherung, Webhooks und Sperre. Das folgt in B/C nach gesonderter Freigabe.

**Ergänzende Fakten (2026-11-05, nur lesend geprüft):**

- Jede Buchung hat ein eigenes Buchungsfolio (`type = Booking`) für Anzahlungen. Ist es leer, wird es ignoriert. Ist es gefüllt, geht es in die Prüfung.
- Das TEST-Folio erlaubt vor Anreise `AddPayment` mit `allowedPayment` 337, obwohl alle Charges ungebucht sind.

## Umsetzungsstand Phase B1 (2026-11-05)

**Migrationen `0011_payments` und `0012_lock_and_audit_payments`** (auf Staging eingespielt mit `docs/staging/O-migration-0011-0012.sql`, Production unberührt):

| Tabelle                      | Zweck                                                                                                                                             | Schutz                                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payment_requests`           | eine Zahlungsanforderung je Folio einer Reservierung (Tenant, Property, Reservierung, Buchung, Folio)                                             | partieller Unique-Index **eine offene Anforderung je Folio**; Idempotency-Key (SHA-256) und Return-Ref (zufällig) eindeutig; Statusübergänge nur vorwärts; `pending`/`succeeded` nur mit Provider-Zahlungs-ID; Endzustände mit `settled_at` |
| `reservation_payment_states` | letzter Zustand und Prüfzeitpunkt je Reservierung, `cleared_at` mit Betrag                                                                        | `cleared_at` per Trigger **nur einmal setzbar**; Zeilen nicht löschbar                                                                                                                                                                      |
| `payment_audit_events`       | Prüfprotokoll: beobachtete Zustandswechsel, erste Bestätigung (mit bestätigenden Zahlungs-IDs und Prüfzeitpunkt), Anforderungen und Statuswechsel | **nur anfügbar** (UPDATE, DELETE und TRUNCATE per Trigger abgewiesen)                                                                                                                                                                       |

- Alle drei Tabellen:
  - zusammengesetzte Fremdschlüssel auf (Tenant, Property)
  - RLS ohne Policies, Data-API-Rechte entzogen
  - keine Spalten für Karten-, Link- oder Rohdaten
- **Repository** (`packages/db/src/repositories/payment-repository.ts`):
  - Jede Abfrage ist tenant-scoped, Eingaben werden validiert.
  - `recordPaymentObservation` serialisiert pro Reservierung (Zeilensperre).
  - `openPaymentRequest` gibt bei Doppelklick oder parallelen Anfragen die bestehende Anforderung zurück.
  - Return-Refs werden nur innerhalb von Tenant und Reservierung der Session aufgelöst.
- **Guest App:**
  - Jede Bewertung (nur Objekte mit `inform`, also TEST) wird mit Prüfzeitpunkt erfasst.
  - Fehler beim Speichern brechen die Seite nicht ab und ändern den Zustand nie.
- **Nicht enthalten:** Provider-Aufrufe zum Anlegen von Links, Webhooks und Sperren.

**Revisionssicherheit:** Die Trigger schützen gegen Änderungen über die Anwendung und reguläre Datenbankrollen. Ein Superuser kann Trigger abschalten. Für externe Revisionsprüfungen wäre später eine Hash-Kette oder ein Export in einen WORM-Speicher möglich.

## Voraussetzungen B2–B4 (geprüft 2026-11-05)

- **Apaleo Pay testen:**
  - Laut apaleo.dev ist Apaleo Pay auf jedem **Developer-Account** vorkonfiguriert (Sandbox, Testkarten z. B. 4111 1111 1111 1111 / 737 / 03/2030).
  - Registrierung kostenlos unter identity.apaleo.com/account/register-dev-account (mit Testobjekt und optional Beispieldaten).
  - Für Live-Accounts beschreibt die Dokumentation keinen Testmodus. Live-Zugangsdaten gibt es pro Objekt über den Apaleo-Support.
  - **Folge:** B2–B4 nur gegen einen Developer-Account, mit eigenen Client-Zugangsdaten und einem eigenen Testobjekt in der Registry. Nie gegen TEST im Live-Account, solange Apaleo nicht schriftlich bestätigt, dass dort nur Testzahlungen möglich sind.
- **Links für ungebuchte Leistungen:**
  - Die OpenAPI-Beschreibung von `by-link` nennt **keine** Voraussetzung gebuchter Charges (nur `amount` ≤ `allowedPayment`, `paidCharges` für Rechnungskauf).
  - Der Leitfaden „Payment links“ verlangt dagegen gebuchte Charges.
  - Am TEST-Folio sind vor Anreise `AddPayment` und `allowedPayment` 337 möglich.
  - **Ungeklärt:** Erster Test im Developer-Account mit ungebuchten Charges und ohne `paidCharges`; parallel Rückfrage beim Apaleo-Support.
- **Rechte:**
  - `folios.manage`, bei Fine-grained Clients `core.folio_payments.create`
  - Webhooks: `notifications:admin`
- **Webhook-Sicherheitskonzept (bestätigt):**
  - Apaleo signiert nicht. Empfohlen sind HTTPS, ein Token in der URL und die IP-Allowlist (34.240.36.71, 52.212.76.75, 63.33.249.221).
  - Zustellung mindestens einmal, ungeordnet, bis zu 24 h Wiederholungen. Beim Anlegen der Subscription sendet Apaleo einen Ping, ohne 2xx wird sie nicht aktiv.
  - **Umsetzung:** Der Webhook darf nur einen **Neuabruf** bei Apaleo auslösen. Payload-Werte (Beträge, Status) werden nie übernommen.
  - Das Payload wird eng validiert: `accountId` = unser Account, `propertyId` aus der Registry (zunächst nur Sandbox/TEST), ID-Muster, Größenlimit.
  - Rate-Limit, Dedup über Event-ID, Antwort sofort 2xx, Logs ohne Payload.
  - Ein geleakter Token erlaubt höchstens zusätzliche, rate-limitierte Abfragen, keine Zustandsänderung.
  - **Hinweis:** Vercel-Preview-Deployments sind geschützt. Für B4 braucht es eine öffentlich erreichbare Staging-Domain für genau diesen Pfad oder den Vercel „Protection Bypass for Automation“.
