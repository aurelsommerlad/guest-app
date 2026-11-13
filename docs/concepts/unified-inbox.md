# Unified Inbox und Gäste-Chat – Architektur und Umsetzungsplan

Stand: 13.11.2026 · Status: **Vorschlag, noch nicht umgesetzt** · Entscheidung: [ADR 0023](../adr/0023-unified-inbox.md)

Ziel: eine zentrale Kommunikationsplattform für UNIQUE PLACES im STAY-Admin.

**Kanäle:**

- STAY-interner Gäste-Chat
- Booking.com und Airbnb über die Channex Messaging API
- später WhatsApp Business und weitere Kanäle

Dazu kommt eine providerunabhängige KI-Schicht. Sie liefert zunächst nur Vorschläge und Übersetzungen.

**Unverändert bleiben:**

- die Extras-App
- die Extras-Migration
- der Online-Check-in
- produktive Apaleo- und Channex-Prozesse

Es werden keine produktiven Nachrichten gesendet.

---

## 1. Bestandsaufnahme (Code-Stand `4c12c61`)

| Bereich             | Heute vorhanden                                                                                                                                                                                                    | Bedeutung für die Inbox                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architektur         | Monorepo; Ports in `@up/core`, Adapter in `@up/integrations` (ADR 0003); Repositories mit `TenantContext` (ADR 0002/0010); Admin-Feature-Schnitt `actions.ts` → `*-service.ts` → `server.ts`                       | Kanäle werden **Adapter hinter einem `ChannelAdapter`-Port**; die Inbox-Logik ist ein framework-freier Service                                            |
| Mandanten/Standorte | `tenant_id NOT NULL`, zusammengesetzte FKs, Standort-IDs als Text (`hov`); externe IDs nur in `external_mappings` (heute nur `apaleo`)                                                                             | Channex-Property-IDs kommen als `provider = 'channex'` in `external_mappings`                                                                             |
| Reservierungen      | **Keine Reservierungstabelle.** Eine Reservierung ist überall `(tenant_id, property_id, reservation_provider, external_reservation_id)`; Daten werden live aus Apaleo gelesen                                      | Unterhaltungen verweisen über dieses Quadrupel auf Reservierungen (n:m), ohne eine Reservierungskopie anzulegen                                           |
| Gastidentität       | Gastsitzung (`guest_sessions`) → `GuestContext` mit Reservierung; Nachname wird nie gespeichert; Kontaktdaten erst nach Check-in (`guest_registration_contacts`)                                                   | Der STAY-Chat hängt am `GuestContext` (`requireGuestContext`, wie in ADR 0012 für „Chat“ vorgesehen)                                                      |
| Admin-Rollen        | `owner/admin/manager/viewer`, Standort-Scope `all/selected`, eine Regel `can(principal, permission, {propertyId})`; `requirePermission`                                                                            | Neue Rechte `inbox.*` und `ai.use` im selben Modell; die Navigation hat schon die leere Gruppe „Kommunikation“ und den Scope `allProperties: "aggregate"` |
| Benachrichtigungen  | `notification_outbox` (Dedup-Schlüssel, Backoff 1/5/15/60/240 min, `FOR UPDATE SKIP LOCKED`), Slack nur simuliert; Worker **nur per Knopf**                                                                        | Das Muster wird für den Nachrichtenversand übernommen, aber in einer eigenen Tabelle (anderes Fehlerverhalten); es braucht **erstmals einen Cron**        |
| Hintergrundjobs     | Nur `api/registration-sync` mit `CRON_SECRET`; in `vercel.json` sind keine `crons` definiert                                                                                                                       | Der Versand-Worker und der Abgleich laufen per Vercel Cron, dasselbe Schutzmuster; Sofortversand zusätzlich über Next `after()`                           |
| Eingehende Webhooks | **Keine** (keine Route, keine Signaturprüfung)                                                                                                                                                                     | Neu: Webhook-Route mit HMAC-Prüfung, Rohereignis-Tabelle und asynchroner Verarbeitung                                                                     |
| Supabase            | RLS aktiv **ohne Policies**, `anon`/`authenticated` haben keine Rechte, die App verbindet sich als Owner; **kein Realtime, keine supabase-js**; Storage nur vom Admin (öffentlicher GUIDE-Bucket)                  | Realtime nicht über Tabellen-Abos (würde Policies erfordern); Anhänge in einem **neuen privaten Bucket** mit signierten URLs                              |
| Audit               | `admin_audit_events` nur anhängend (Trigger, Migration 0018), Details nur als IDs                                                                                                                                  | Nachrichteninhalte gehören **nicht** ins Audit; eigener Ereignisverlauf je Unterhaltung, ebenfalls nur anhängend                                          |
| GUIDE-/STAY-Inhalte | `guide_sections` mit `status draft/published/archived`, `visibility`, `translation_state`; Lesen über `listPublishedGuideEntries`                                                                                  | Wissensquelle der KI: nur `published` und für Gäste sichtbar, mit Abschnitts-ID als Quelle                                                                |
| Apaleo              | Client mit globalen Zugangsdaten; die Preview hat derzeit nur `reservations.read` (siehe [Preview-Prüfung](../staging/preview-pruefung.md))                                                                        | Reservierungskontext in der Inbox braucht dieselben Leseberechtigungen; Apaleo wird von der Inbox nicht beschrieben                                       |
| Channex             | **Im Code nicht vorhanden.** Channex ist als Channel-Manager im Apaleo Store gelistet; ob und wie UNIQUE PLACES Channex heute betreibt (Konto, Standorte, vorhandene Webhooks), ist aus dem Code nicht ersichtlich | Vor jeder produktiven Aktivierung nur lesend klären (Abschnitt 3.7)                                                                                       |
| KI                  | Kein LLM-Provider im Code                                                                                                                                                                                          | Neuer Port `AiProvider` und Adapter                                                                                                                       |
| Admin-UI            | `packages/ui` (Text, Heading, Stack, Surface, Button, TextField, FilterBar, StatusList, DetailList, Callout …), `AdminShell`/`AdminNav`; Muster Liste → Detail (Anfragen); **keine Echtzeit, kein Polling**        | Die Inbox nutzt diese Bausteine; Echtzeit kommt neu hinzu                                                                                                 |

## 2. Datenmodell

Grundsätze:

- Jede Tabelle hat `tenant_id`, zusammengesetzte FKs und Unique-Indizes je Mandant (ADR 0002).
- Technische IDs sind UUIDs. Externe IDs stehen nur in kanalbezogenen Spalten mit Unique-Index je Kanal-Konto.
- Inhalte (Nachrichtentexte, Anhänge) sind personenbezogen. Sie bekommen `purge_after` und werden nie geloggt.
- Wo nicht anders genannt, sind alle neuen Tabellen nur Teil des Admin-Schemas. RLS ist wie bisher an, ohne Policies.

### 2.1 Tabellen

**`channel_accounts`**: eine Anbindung je Mandant und Kanal-Konto.

- Spalten: `id`, `tenant_id`, `provider` (`stay` | `channex` | `whatsapp` | `email` …, erweiterbar), `label`, `environment` (`simulated` | `staging` | `production`), `status` (`active` | `paused` | `error`), `config jsonb` (nur nicht-geheime Werte: Gruppen-ID, Basis-URL), `secret_ref` (Name der Env-Variable bzw. später des verschlüsselten Eintrags; nie der Schlüssel selbst), Zeitstempel.
- Standortzuordnung: über `external_mappings` (`provider = 'channex'`, `entity_type = 'property'`) plus `channel_account_id` in einer kleinen Zuordnungstabelle `channel_account_properties (channel_account_id, property_id, external_property_id, messaging_enabled)`.

**`conversations`**

- Identität: `id`, `tenant_id`, `property_id` (**nullable**: nur für eingehende Unterhaltungen eines nicht zugeordneten Channex-Standorts; diese sieht nur, wer alle Standorte sehen darf), `channel_account_id`.
- Kanal und Art:
  - `channel` (`stay_chat` | `booking_com` | `airbnb` | `expedia` | `whatsapp` | …): der konkrete Endkanal, unabhängig vom Provider
  - `external_thread_id` (Channex `message_thread.id`, WhatsApp-Kontakt-ID …)
  - `kind` (`reservation` | `inquiry` | `reservation_request` | `general`)
- Darstellung: `title` (z. B. Vorname plus Zeitraum, minimal)
- Status:
  - `status`: `open` | `pending` | `done`; „ungelesen“ wird je Mitarbeiter berechnet, siehe `conversation_reads`
  - `snoozed_until`
  - `priority`: `normal` | `high`
  - `external_closed`: Spiegel von Channex `is_closed`
- Zuweisung: `assigned_admin_user_id` (nullable)
- Zeitstempel und Sprache:
  - `last_message_at`, `last_inbound_at`, `last_outbound_at`
  - `guest_language`: erkannt, z. B. `en`
- Technik: `version` (optimistische Sperre), `purge_after`, Zeitstempel
- Unique-Indizes:
  - `(tenant_id, channel_account_id, external_thread_id)`
  - STAY-Chat: `(tenant_id, property_id, reservation_provider, external_reservation_id)` über `conversation_reservation_links` mit `link_method = 'guest_session'`, also eine Chat-Unterhaltung je Reservierung

**`conversation_reservation_links`**: n:m. Eine Reservierung kann mehrere Unterhaltungen haben (STAY-Chat, Booking.com, später WhatsApp); eine Inquiry hat keine.

- Spalten:
  - `conversation_id`, `tenant_id`, `property_id`
  - `reservation_provider`, `external_reservation_id`
  - `external_booking_ref` (Channex `booking_id`, OTA-Buchungsnummer)
  - `link_method` (`guest_session` | `channex_booking` | `ota_code_match` | `manual`)
  - `confidence` (`exact` | `suggested`), `linked_by_admin_user_id`, `created_at`
- Vorschläge (`suggested`) erscheinen in der Oberfläche, gelten aber erst nach Bestätigung.

**`conversation_participants`**

- Spalten:
  - `id`, `conversation_id`, `kind` (`guest` | `staff` | `ai` | `system` | `ota`)
  - `display_name`: minimal; vom Kanal geliefert bzw. Vorname aus dem PMS
  - je nach Art genau eine Referenz: `admin_user_id` (staff), `guest_access_id` (STAY-Gast) oder `external_participant_id` (Kanal)
  - `contact_handle_hash`: WhatsApp-Nummer als Hash für die Zuordnung, Klartext nur verschlüsselt, falls nötig

**`messages`**

- Inhalt und Herkunft:
  - `id`, `tenant_id`, `conversation_id`
  - `direction` (`inbound` | `outbound` | `internal`; `internal` ist eine Team-Notiz und wird nie versendet)
  - `sender_participant_id`
  - `origin` (`guest` | `staff` | `staff_ai_assisted` | `ai_auto` | `system` | `ota_system`)
  - `body_text` (Text, Länge kanalabhängig begrenzt), `language`
- Idempotenz und Status:
  - `client_message_id`: von STAY vergeben, Idempotenz für eigene Sends, unique
  - `external_message_id`: vom Kanal, unique je `channel_account_id`
  - `delivery_status` (`received` | `queued` | `sending` | `sent` | `delivered` | `read` | `failed` | `uncertain`)
  - `delivery_error_code`, `provider_created_at`, `sent_at`, `created_at`
- KI-Bezug: `ai_suggestion_id` (nullable)
- Aufbewahrung: `purge_after`
- Unique-Indizes:
  - `(tenant_id, channel_account_id, external_message_id)` für die Deduplizierung eingehender Nachrichten
  - `(tenant_id, client_message_id)`

**`message_translations`**

- Spalten: `message_id`, `target_language`, `text`, `provider`, `model`, `created_at`.
- Wird zwischengespeichert, damit nicht jede Ansicht erneut übersetzt.

**`message_attachments`**

- Spalten:
  - `id`, `message_id`, `tenant_id`
  - `storage_path`: **privater** Bucket, `<tenant>/<property>/inbox/<uuid>`
  - `file_name`, `mime_type`, `size_bytes`, `sha256`
  - `external_attachment_id`
  - `status` (`pending_download` | `stored` | `rejected` | `failed`)
- Auslieferung nur über kurzlebige signierte URLs nach Rechteprüfung.
- Erlaubt sind Bilder und PDF mit Größengrenze. Andere Typen werden abgewiesen und als Ereignis vermerkt.

**`conversation_reads`**

- Spalten: `conversation_id`, `admin_user_id`, `last_read_message_id`, `last_read_at`.
- „Ungelesen“ heißt: es gibt eine eingehende Nachricht nach `last_read_at`.

**`conversation_events`**: Verlauf und Audit je Unterhaltung, **nur anhängend** (Trigger wie Migration 0018).

- Spalten: `id`, `tenant_id`, `conversation_id`, `type`, `actor_kind`, `actor_id`, `details jsonb` (nur IDs und Codes, keine Inhalte), `created_at`.
- Typen:
  - `status_changed`, `assigned`, `unassigned`
  - `reservation_linked`, `reservation_unlinked`
  - `message_failed`, `message_uncertain`, `delivery_retried`
  - `ai_suggested`, `ai_used`, `ai_discarded`, `ai_auto_sent` (später)
  - `handover_to_staff`, `attachment_rejected`, `external_closed`, `no_reply_needed`
- Mandantenweite Verwaltungsaktionen (Kanal anlegen, KI-Richtlinie ändern) gehen wie bisher in `admin_audit_events`.

**`message_delivery_jobs`**: eigene Outbox für ausgehende Nachrichten.

- Spalten: `id`, `tenant_id`, `message_id` (unique), `channel_account_id`, `status` (`pending` | `sending` | `sent` | `failed` | `uncertain`), `attempts`, `next_attempt_at`, `last_error_code`, `locked_until`.
- Gleiches Claim-Muster wie `notification_outbox`.
- Eine eigene Tabelle, weil ein Versand „ungewiss“ enden kann (Abschnitt 3.4). Das darf nicht automatisch wiederholt werden.

**`inbound_events`**: entspricht der in `docs/architecture.md` geplanten `webhook_events`.

- Spalten:
  - `id`, `provider`, `channel_account_id`, `tenant_id` (nach Zuordnung)
  - `event_type`, `external_event_key` (z. B. Channex-Nachrichten-ID bzw. Hash aus Ereignis-Typ und Payload-ID)
  - `signature_valid`, `received_at`, `payload jsonb`
  - `status` (`received` | `processed` | `ignored` | `failed`), `attempts`, `error_code`
  - `purge_after`: 30 Tage, weil die Payload Inhalte enthält
- Unique: `(provider, channel_account_id, external_event_key)`.

**`ai_suggestions`**

- Bezug: `id`, `tenant_id`, `conversation_id`, `for_message_id`, `kind` (`reply` | `translation` | `summary` | `classification`)
- Modell: `provider`, `model`, `prompt_version`, `input_hash`
- Ergebnis: `output_text`, `output_language`
- Nachvollziehbarkeit:
  - `sources jsonb`: Liste von `{type: guide_section | stay_fact | reservation_field | message, id, version}`
  - `data_scopes jsonb`: welche Datenkategorien verwendet wurden
  - `intent`, `confidence`, `needs_human` mit `reason_code`
- Lebenszyklus: `status` (`proposed` | `used` | `edited` | `discarded` | `expired`), `used_message_id`, `requested_by_admin_user_id`
- Kosten: `latency_ms`, `input_tokens`, `output_tokens`, `created_at`, `purge_after`

**`ai_policies`**: je Standort, erst ab Phase I10 wirksam.

- Spalten:
  - `mode` (`off` | `suggest` | `shadow` | `auto_limited`)
  - `allowed_intents[]`, `min_confidence`, `channels[]`
  - `business_hours`, `max_auto_per_conversation`
  - `reservation_data_allowed`, `kill_switch`
  - `updated_by`
- Jede Änderung wird auditiert.

Optional später: `reply_templates` (gespeicherte Antworten je Standort und Sprache).

### 2.2 Wichtige Regeln

- **Unterhaltung ohne Reservierung:** Airbnb-Inquiry oder Reservierungsanfrage bekommt `kind = inquiry` bzw. `reservation_request` und keinen Reservierungslink. Kommt später eine Buchung, kann sie per Vorschlag oder manuell verknüpft werden. Laut Channex gibt es keinen automatischen Rückbezug von der Buchung zum Angebot.
- **Mehrere Unterhaltungen je Reservierung:** In der Reservierungsansicht und im Kontextbereich werden alle verknüpften Unterhaltungen angezeigt. Auf Wunsch gibt es eine kombinierte Zeitleiste, nur in der Darstellung, ohne die Daten zusammenzuführen.
- **Mandanten- und Standorttrennung:**
  - Jede Abfrage läuft über Repository und `TenantContext`.
  - Standortrechte prüft `can(…, {propertyId})`.
  - Unterhaltungen ohne `property_id` sieht nur, wer Zugriff auf alle Standorte hat.
- **Status:** `open` (Antwort nötig) → `pending` (wartet auf Gast/Dritte) → `done`. Eine neue eingehende Nachricht öffnet `pending` bzw. `done` automatisch wieder (Ereignis `status_changed`, actor `system`).
- **Aufbewahrung:** Standardvorschlag: Inhalte 12 Monate nach Abreise bzw. nach letzter Nachricht. Rohereignisse 30 Tage, KI-Vorschläge 90 Tage. Ereignisse ohne Inhalt bleiben. Die genauen Fristen sind eine Entscheidung (Abschnitt 8).

## 3. Channex-Integration

### 3.1 Was die offizielle API bietet (geprüft 13.11.2026)

- **Kanäle:** Booking.com, Airbnb, Expedia. Ausgenommen sind Buchungen über Expedia Partner Solutions.
- **Endpunkte:**
  - Nachrichten je Buchung: `GET`/`POST /api/v1/bookings/:id/messages`
  - Threads: `GET /api/v1/message_threads`, `GET /api/v1/message_threads/:id`
  - Nachrichten je Thread: `GET`/`POST /api/v1/message_threads/:id/messages`
  - Thread schließen: `POST /api/v1/message_threads/:id/close`
  - Ohne Antwort erledigen: `POST /api/v1/message_threads/:id/no_reply_needed` (nur Booking.com; schützt die Antwortzeit-Wertung)
  - Anhänge: `POST /api/v1/attachments` (Base64-Upload, danach `attachment_id` senden; Text und Anhang nur getrennt möglich)
- **Thread-Felder:** `title`, `is_closed`, `provider`, `message_count`, `last_message`, `last_message_received_at`; Beziehungen zu `booking` (bei Airbnb-Inquiries leer), `channel`, `property`.
- **Nachrichten-Felder:** `message`, `attachments`, `sender` (`guest` | `property` | `system`), `inserted_at`. Anhang-URLs sind relativ zur API-Basis.
- **Fehlercodes:**
  - `401`: Schlüssel ungültig
  - `403`: Messages-App am Standort **nicht installiert**
  - `404`: Buchung/Thread nicht gefunden
  - `422 not_supported`: OTA unterstützt Messaging nicht
  - `429`: Rate-Limit, mit `Retry-After`
- **Webhooks:**
  - Ereignisse: `message` (neue Gastnachricht, Payload: `id`, `message`, `sender`, `property_id`, `booking_id`, `message_thread_id`, `attachments`, `ota_message_id`, `live_feed_event_id`), `inquiry`, `reservation_request`, `alteration_request`, `accepted_reservation`, `declined_reservation`, `review`, `message_thread_booking_assigned`, `booking*`.
  - Scope: global oder je Standort. **Wichtig:** Passen ein globaler und ein standortbezogener Webhook auf dasselbe Ereignis, wird **nur** der standortbezogene zugestellt.
  - Wiederholung: nur bei 5xx, bis zu 11 Versuche über etwa 24 Stunden, FIFO.
- **Authentifizierung:**
  - Header `user-api-key`.
  - Schlüssel kann nur der Billing-Owner anlegen. Er hat **dieselben Rechte wie sein Nutzer** (also auch Preise und Verfügbarkeiten), auf Wunsch auf bestimmte Standorte beschränkt.
  - Es gibt keinen reinen Lese- oder Nachrichtenschlüssel. IP-Allowlist ist optional möglich.
- **Webhook-Signatur:**
  - HMAC-SHA256 über `"{timestamp}.{raw_body}"`, hex.
  - Header: `x-hmac-timestamp`, `x-hmac-signature-256` (bei Schlüsselrotation zwei Werte), `x-hmac-keys-256`.
  - Aktivierung mit `is_signed: true` und `signing_key_id`. Empfehlung: 300 s Toleranz, Vergleich in konstanter Zeit.
- **Rate-Limits (geplant):** pro Buchungs-/Messaging-Endpunkt 100/min je Schlüssel und 300/min je Konto; Header `RateLimit`/`RateLimit-Policy` generisch auswerten.
- **Staging:** `https://staging.channex.io`, kostenlos, eigenes Konto. Die gesamte Entwicklung läuft dort.

### 3.2 Aktivierung und Kosten

- Die **Messages-App** muss je Standort in Channex installiert werden, sonst kommt `403`.
- Laut Channex-Preisseite (WhiteLabel-Plan) kostet das Add-on „Messaging & Reviews“ **7 $ je Hotel-Standort bzw. 0,50 $ je Ferienwohnungs-Einheit und Monat**, zuzüglich USt. Der Plan selbst kostet 130 $ Plattformgebühr pro Monat.
- Im Apaleo Store ist Channex mit einem Standard-Plan (80 $/Monat) gelistet. Welche Konditionen für UNIQUE PLACES gelten, hängt vom bestehenden Vertrag ab und **ist bei Channex zu bestätigen**.
- Zur Einordnung: Bei Abrechnung als Ferienwohnungs-Einheiten wären es für z. B. 60 Einheiten etwa 30 $/Monat.

### 3.3 Eingehend: Webhook → Rohereignis → Normalisierung

1. Route `apps/admin/src/app/api/webhooks/channex/route.ts`, nur `POST`. Ablauf:
   - **Rohdaten** lesen, vor dem JSON-Parsen.
   - Signatur gegen alle Werte in `x-hmac-signature-256` prüfen.
   - Zeitstempel ±300 s prüfen.
   - Bei Fehler `401` ohne Details zurückgeben und einen Zähler erhöhen.
2. Gültige Ereignisse werden sofort in `inbound_events` geschrieben. Ein bereits vorhandener `external_event_key` gilt als Duplikat und wird mit `200` quittiert. Danach folgt die Antwort `200`, Ziel unter 1 s.
3. Die Verarbeitung läuft asynchron (`after()` und Cron als Sicherheitsnetz):
   - Standort über `channel_account_properties` zuordnen.
   - Unterhaltung per `(channel_account_id, message_thread_id)` anlegen oder finden.
   - Nachricht per `external_message_id` deduplizieren.
   - Anhänge herunterladen und privat speichern.
   - Status `open` setzen, Ereignis schreiben, Echtzeitsignal senden (Abschnitt 4.3).
4. Fehler bei der Verarbeitung führen zu `inbound_events.status = failed` mit Backoff. Das Rohereignis bleibt erhalten, nichts geht verloren. Gegenüber Channex wird trotzdem `200` gemeldet, damit keine Wiederholungsflut entsteht.
5. **Abgleich (Reconciliation)** per Cron alle 5 min, nur lesend: `GET /message_threads`, sortiert nach letzter Nachricht. Bei Abweichungen werden die Nachrichten des Threads nachgeladen und dedupliziert. Damit werden ausgefallene oder verlorene Webhooks aufgefangen.
   - Beim Erststart importiert er die Threads der letzten N Tage, auf Wunsch rein lesend.

### 3.4 Ausgehend: zuverlässige Zustellung

1. Antwort in der Inbox → `messages` (`outbound`, `delivery_status = queued`, `client_message_id`) und `message_delivery_jobs` werden in **einer** Transaktion angelegt.
2. Danach sofort ein Versuch per `after()`. Der Cron-Worker (jede Minute) holt Fälliges mit `FOR UPDATE SKIP LOCKED`.
3. Ergebnis des Versands:
   - **200** → `external_message_id` aus der Antwort speichern, Status `sent`.
   - **Eindeutige Fehler** (`401`, `403`, `404`, `422`) → `failed` mit lesbarem Grund, z. B. „Messages-App nicht aktiv“ oder „OTA unterstützt keine Nachrichten“. Es gibt keinen automatischen Retry.
   - **`429`** → `Retry-After` beachten und erneut versuchen.
   - **Netzwerkfehler vor dem Senden** → erneut versuchen, Backoff 1/5/15/60 min.
   - **Zeitüberschreitung oder 5xx nach dem Senden** → `uncertain`.
4. Bei `uncertain` gibt es **keinen** blinden Retry. Channex kennt keinen Idempotenz-Schlüssel, ein zweiter POST könnte die Nachricht doppelt zustellen.
   - Der Worker liest stattdessen die letzten Nachrichten des Threads und sucht eine `property`-Nachricht mit gleichem Text im Zeitfenster.
   - Treffer → `sent`. Kein Treffer nach dem Abgleich → `failed`, und in der Oberfläche erscheint „Erneut senden“, manuell.
5. Booking.com „Keine Antwort nötig“ und „Thread schließen“ sind eigene Aktionen mit Ereignis. Sie gehen nur an Kanäle, deren `capabilities` sie unterstützen.

### 3.5 Reservierungszuordnung

- Channex-Thread mit `booking` → Channex-Buchung lesen (`GET /bookings/:id`, OTA-Buchungsnummer) → passende Apaleo-Reservierung suchen.
- Die Annahme ist, dass Apaleo die OTA-Nummer als `externalCode` bzw. in `externalReferences` führt. Das muss **mit realen Daten lesend geprüft werden**.
- Eindeutiger Treffer → Link `exact`. Mehrdeutig oder kein Treffer → `suggested` oder kein Link; die Oberfläche bietet „Reservierung verknüpfen“ an.
- Ereignis `message_thread_booking_assigned` (Inquiry wird zur Buchung) → neue Zuordnung versuchen.

### 3.6 Schutzmaßnahmen

- **Egress-Allowlist im Adapter:**
  - Der Channex-Client erlaubt ausschließlich `GET`/`POST` auf `message_threads*`, `bookings/:id/messages`, `attachments` und lesend `bookings/:id`.
  - Alles andere (ARI, Restrictions, Availability, Booking-ACK) ist im Code unmöglich und wird getestet.
  - Das gleicht aus, dass Channex-Schlüssel nicht eingeschränkt werden können.
- **Getrennter Schlüssel nur für STAY:** auf die freigegebenen Standorte beschränkt, mit IP-Allowlist, falls Vercel Static IPs genutzt werden. Rotation dokumentiert.
- **Feature-Schalter:** `CHANNEX_MESSAGING=off|simulated|staging|production`. `production` erzwingt zusätzlich `channel_accounts.environment = production` und eine Standortliste. Senden ist getrennt schaltbar (`CHANNEX_SEND=off|on`).
- **Simulator:** wie beim Apaleo-Simulator, für Tests und Browserprüfungen ohne Netz.
- **Bestehende Integrationen:**
  - Vor dem Anlegen eines Webhooks werden die vorhandenen Webhooks des Kontos **lesend** geprüft.
  - Die STAY-Webhooks abonnieren nur Nachrichten-Ereignisse, keine `booking*`. Booking-ACK und ARI bleiben unberührt.
  - Kollidiert ein standortbezogener STAY-Webhook mit einem bestehenden globalen Nachrichten-Webhook, würde er diesen verdrängen. Das ist Teil der Freigabeprüfung.

### 3.7 Vorab zu klären (nur lesend, ohne Änderungen)

1. Gibt es ein Channex-Konto von UNIQUE PLACES (direkt oder über Apaleo)? Wer ist Billing-Owner?
2. Welche Standorte und Kanäle sind dort verbunden? Abrechnung als Hotel oder als Einheiten?
3. Welche Webhooks existieren (global oder je Standort, Ereignismaske)?
4. Wird die Messages-App bereits genutzt, z. B. im Channex-Dashboard oder in einem anderen Tool? Dann laufen Antworten künftig parallel über zwei Oberflächen. Das ist organisatorisch zu regeln.

## 4. Unified Inbox im STAY-Admin

### 4.1 Struktur

- **Navigation:** „Kommunikation → Posteingang“ (die Gruppe existiert bereits leer). Scope `allProperties: "aggregate"`. Das Badge zeigt die Zahl der ungelesenen bzw. offenen Unterhaltungen, die einem selbst oder niemandem zugewiesen sind.
- **Routen:**
  - `/inbox`: Liste über alle erlaubten Standorte; Filter als Query-Parameter `property`, `channel`, `status`, `assignee`, `unread`, `q`
  - `/inbox/c/[conversationId]`: Unterhaltung
  - `/settings/channels`: Kanalverwaltung, nur `inbox.manage`
- **Desktop:** drei Spalten.
  1. Liste mit Name, Kanal-Glyphe, Standort, letzter Zeile, Zeit, Status und Ungelesen-Punkt
  2. Verlauf
  3. Kontext:
     - Reservierung (Zeitraum, Apartment, Personen, Status, Check-in-Stand, gebuchte Services)
     - verknüpfte weitere Unterhaltungen
     - Zuweisung und Status
     - KI-Bereich
- **Mobil:** Liste → Unterhaltung im Vollbild. Kontext als ausklappbares Blatt, Antwortfeld fest am unteren Rand, „Erledigt“ und „Zuweisen“ im Kopf.
- **Gestaltung:** das bestehende Admin-Design und die Bausteine aus `packages/ui` (Surface, FilterBar, StatusBadge, TextField, Button, Callout). Ruhige Typografie, Kanalunterscheidung über kleine Glyphen statt Farbe. Gast und Team sind im Verlauf klar getrennt; interne Notizen sind optisch abgesetzt.

### 4.2 Funktionen

- **Filter:** Standort, Kanal, Status (offen/wartend/erledigt), ungelesen, „mir zugewiesen“ / „nicht zugewiesen“, Suche nach Name und Reservierungsnummer.
- **Zuweisung** an Teammitglieder mit Recht auf den Standort, mit Ereignis. Optional erhält die zugewiesene Person eine Slack-Benachrichtigung (Outbox, Vorlage `inbox.assigned`, simuliert bis zur Freigabe).
- **Verlauf:**
  - Nachrichten chronologisch, mit Datumsgrenzen.
  - Übersetzung inline („Original anzeigen“).
  - Anhänge als Vorschau über signierte URLs.
  - Zustellstatus je eigener Nachricht: gesendet, fehlgeschlagen mit Grund, ungewiss mit „Prüfen/Erneut senden“.
- **Antworten:**
  - Textfeld mit Kanalhinweis, z. B. „wird über Booking.com zugestellt“.
  - Zeichengrenze je Kanal, Anhang, interne Notiz.
  - Antwort in Gastsprache: Der Mitarbeiter schreibt deutsch, die Übersetzung wird in einer Vorschau angezeigt und erst nach Bestätigung gesendet; beide Texte werden gespeichert.
- **Sicherheit:**
  - Jede Aktion läuft über `requirePermission` und Standortprüfung.
  - Gleichzeitige Bearbeitung wird über `version` abgefangen.
  - Doppelklick erzeugt keine doppelte Nachricht (`client_message_id`).

### 4.3 Echtzeit

- **Stufe 1:** Leichtes Polling. Eine Route `GET /api/inbox/changes?since=…` liefert nur IDs und Zähler der geänderten Unterhaltungen seit einem Zeitstempel.
  - Intervall: 5 s bei offener Unterhaltung, 15 s in der Liste, pausiert bei verborgenem Tab.
  - Kein neues Infrastrukturteil, und die Daten bleiben hinter dem bestehenden Rechtemodell.
- **Stufe 2 (optional):** Supabase Realtime **Broadcast** auf privaten Kanälen je Mandant und Standort.
  - Der Server sendet nach jeder Änderung ein Signal ohne Inhalt.
  - Clients authentifizieren sich mit einem kurzlebigen, serverseitig ausgestellten Token.
  - Die Daten werden danach wie in Stufe 1 geladen.
  - Tabellen-Abos (`postgres_changes`) bleiben ausgeschlossen: Sie würden RLS-Policies für Inhalte voraussetzen, die es bewusst nicht gibt.
- Beide Stufen stehen hinter einem Port `InboxEvents`, damit die Oberfläche unabhängig bleibt.

### 4.4 Rechte (Ergänzung `packages/core/src/admin/permissions.ts`)

| Recht          | owner | admin | manager | viewer |
| -------------- | :---: | :---: | :-----: | :----: |
| `inbox.read`   |   ✔   |   ✔   |    ✔    |   ✔    |
| `inbox.reply`  |   ✔   |   ✔   |    ✔    |   –    |
| `inbox.assign` |   ✔   |   ✔   |    ✔    |   –    |
| `inbox.manage` |   ✔   |   ✔   |    –    |   –    |
| `ai.use`       |   ✔   |   ✔   |    ✔    |   –    |
| `ai.configure` |   ✔   |   ✔   |    –    |   –    |

Alle Rechte sind standortbezogen. `inbox.manage` und `ai.configure` gelten mandantenweit wie `settings.*`.

### 4.5 STAY-Gäste-Chat (Gästeseite)

- **Seite:** `/v2/chat` im Magazin-Design, Zugang nur mit `requireGuestContext`.
  - Eine Unterhaltung je Reservierung. Gastname aus dem PMS (Vorname).
  - Senden per Server-Action, mit `rate_limit_buckets` (z. B. 10 Nachrichten/10 min) und Längenbegrenzung.
- **Sichtbarkeit:** Der Gast sieht nur Nachrichten seiner Unterhaltung, nie interne Notizen und nie KI-Metadaten. Abfragen laufen ausschließlich über `GuestContext`, also Mandant, Standort und Reservierung.
- **Aktualisierung:** Polling alle 10 s bei geöffneter Seite. Ein Hinweis „Neue Nachricht“ auf der STAY-Startseite erscheint beim nächsten Seitenaufruf.
- **Gastanhänge:** erst in einer späteren Phase, nur Bilder mit Größengrenze.
- **Benachrichtigung bei Antwort:** Später per E-Mail, nur an eine bestätigte Adresse (`guest_registration_contacts`) und nur bei `EMAIL_DELIVERY=resend`. Bis dahin sieht der Gast die Antwort beim nächsten Besuch.
- **Schalter:** `GUEST_CHAT=off|test`, zunächst nur Objekt TEST.

## 5. KI-Schicht

### 5.1 Aufbau

```
Inbox-Service ──► AiAssistService (core, framework-frei)
                   ├─ ContextBuilder   – stellt Wissen zusammen (nur freigegebene Quellen)
                   ├─ PolicyGate       – prüft Rechte, Datenkategorien, Modus je Standort
                   ├─ PromptRegistry   – versionierte Vorlagen im Repo (prompt_version)
                   ├─ AiProvider (Port) ◄─ Adapter: anthropic | openai | simulated
                   └─ Recorder         – ai_suggestions + conversation_events
```

- **Port `AiProvider`:** `generate({ system, messages, schema }) → { output, usage }` mit strukturierter Ausgabe (JSON-Schema) und `translate(text, target)`.
- **Provider austauschbar:** per Env `AI_PROVIDER` und `AI_MODEL`. Voraussetzung ist ein Auftragsverarbeitungsvertrag; Verarbeitung möglichst in der EU, kein Training auf Kundendaten.
- **Wissen (`ContextBuilder`):**
  - `guide_sections` mit `status = published` und gastsichtbarer `visibility` für Standort und Sprache.
  - STAY-Fakten des Standorts (Check-in-Zeiten, Adresse, Kontakt).
  - Freigegebene Service-Texte.
  - Jede Quelle trägt ID und Version.
- **Reservierungsdaten:**
  - Nur wenn der anfragende Mitarbeiter `inbox.read` für den Standort hat **und** die Standortrichtlinie es erlaubt.
  - Nur die nötigen Felder: Zeitraum, Apartmenttyp, Personenzahl, gebuchte Services, Check-in-Stand.
  - Keine Zahlungsdaten, keine Ausweisdaten, keine Kontaktdaten.
- **Ausgabe:**
  - `{ reply, language, sources[], intent, confidence, needs_human, reason_code }`.
  - Quellen erscheinen in der Oberfläche unter dem Vorschlag, z. B. „aus: GUIDE › Parken“.
  - Ohne passende Quelle lautet der Vorschlag ausdrücklich „an Mitarbeiter übergeben“, statt zu raten.

### 5.2 Grenzen in den ersten Phasen

- Die KI **sendet nichts und ändert nichts**. Sie hat keine Werkzeuge mit Schreibzugriff. Der Mitarbeiter übernimmt, bearbeitet oder verwirft den Vorschlag. Ein gesendeter Vorschlag wird als `staff_ai_assisted` markiert.
- Buchungswünsche (Verlängerung, Late Check-out, Services) werden als **Intent erkannt** und auf die bestehenden Wege verwiesen (Extras bzw. STAY-Services). Es gibt keine Zusage im Text.
- Übergabe an Mitarbeiter bei:
  - `needs_human`
  - Beschwerde, Zahlung, Stornierung, Recht/Schaden, Sicherheit
  - niedriger Konfidenz
  - fehlender Quelle

### 5.3 Später: automatische Beantwortung (eigene Freigabe)

1. **Shadow-Modus:** Die KI entscheidet, ob sie antworten _würde_. Das Team sieht Vorschlag und Entscheidung, gesendet wird nichts. Über einen festgelegten Zeitraum werden Trefferquote und Fehlerquote gemessen.
2. **`auto_limited` je Standort**, nur wenn alle Bedingungen erfüllt sind:
   - erlaubter Intent aus einer Positivliste (z. B. WLAN, Parken, Check-in-Zeit, Anfahrt)
   - Konfidenz ≥ Schwelle, Quelle vorhanden
   - Kanal erlaubt, Uhrzeit im Fenster
   - höchstens N automatische Antworten je Unterhaltung
   - keine offene Eskalation
3. Kennzeichnung gegenüber dem Gast nach Vorgabe, z. B. „Automatische Antwort“.
4. Jede Auto-Antwort erzeugt `ai_auto_sent` mit Quellen und Entscheidungsgründen. Ein Not-Aus je Standort und global ist vorhanden.

### 5.4 Qualität

- Fester **Evaluationssatz** (anonymisierte Beispielfragen je Standort mit erwarteter Quelle und erwartetem Verhalten), als automatischer Test gegen den simulierten und den echten Provider.
- Messgrößen:
  - Anteil übernommener Vorschläge
  - Bearbeitungsgrad
  - Übergabequote
  - Latenz und Kosten je Vorschlag

## 6. Zukunftssicherheit: WhatsApp und weitere Kanäle

Jeder Kanal ist ein Adapter hinter einem Port in `@up/core`:

```ts
interface ChannelAdapter {
  provider: ChannelProvider; // 'stay' | 'channex' | 'whatsapp' | …
  capabilities: {
    attachments: boolean;
    readReceipts: boolean;
    closeThread: boolean;
    noReplyNeeded: boolean;
    maxLength: number;
    replyWindowHours: number | null; // WhatsApp: 24
    templatesOutsideWindow: boolean; // WhatsApp: true
  };
  verifyInbound(req: RawRequest): VerifiedInbound | Rejected;
  parseInbound(event: VerifiedInbound): NormalizedInboundEvent[]; // Nachricht, Status, Thread-Info
  send(target: ConversationRef, message: OutboundMessage): Promise<SendResult>; // sent | failed | uncertain
  listChangedSince?(since: Date): Promise<ThreadDigest[]>; // Abgleich
}
```

Für WhatsApp Business (Cloud API) braucht es **keine Änderung** an Inbox oder Datenmodell:

| Anforderung                            | Abbildung                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Kontakt = Telefonnummer                | `conversation_participants.external_participant_id` und `contact_handle_hash`                                              |
| Unterhaltung ohne Thread-ID des Kanals | `external_thread_id` = Kontakt-ID je `channel_account`                                                                     |
| 24-Stunden-Fenster, Vorlagen           | `capabilities.replyWindowHours`; die Oberfläche bietet außerhalb des Fensters nur freigegebene Vorlagen an                 |
| Zustellstatus (sent/delivered/read)    | `messages.delivery_status`, Statusereignisse über `parseInbound`                                                           |
| Opt-in                                 | zusätzliches Feld in `conversation_participants.metadata` bzw. eigene Einwilligungstabelle                                 |
| Reservierung finden                    | Vorschlag über eine bestätigte Telefonnummer aus `guest_registration_contacts` → Link `suggested`, nie automatisch `exact` |

E-Mail oder weitere OTAs folgen demselben Muster.

## 7. Umsetzungsphasen

Jede Phase ist klein, einzeln abnehmbar und läuft zunächst lokal und auf Staging. Produktive Schritte sind eigene Freigaben.

| Phase   | Inhalt                                                                                                                                                                               | Tests                                                                                                                                                                      | Abnahmekriterien                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I0**  | Entscheidungen und Zugänge (kein Code): Fragen aus 3.7 und Abschnitt 8, Channex-Staging-Konto, KI-Provider und AV-Vertrag, Aufbewahrungsfristen; ADR 0023 annehmen                   | –                                                                                                                                                                          | Schriftlich festgehaltene Antworten; Staging-Konto vorhanden                                                                                        |
| **I1**  | Datenmodell (Migration 0023, nur lokal und Staging), Repositories, Rechte `inbox.*`/`ai.*`, Ports `ChannelAdapter`, `AiProvider`, `InboxEvents`                                      | PGlite: Mandanten- und Standorttrennung, Unique-Indizes (Dedup), `conversation_events` nur anhängend, Rechte-Matrix, `purge_after`                                         | Alle Tests grün; Schema auf Staging identisch; kein bestehender Test verändert                                                                      |
| **I2**  | Admin-Inbox mit simuliertem Kanal und Testdaten: Liste, Filter, Status, Zuweisung, Gelesen, interne Notizen, Polling (Stufe 1), mobile Ansicht                                       | Service-Tests (Statuswechsel, Wiedereröffnung, optimistische Sperre), Playwright Desktop und Mobil, Rechte (viewer kann nicht antworten, fremder Standort unsichtbar)      | Inbox auf Staging mit Simulator bedienbar; Screenshots; keine externen Aufrufe                                                                      |
| **I3**  | STAY-Gäste-Chat (`GUEST_CHAT=test`, nur TEST): Gastseite, Antwort im Admin, Rate-Limit                                                                                               | Gast sieht nur eigene Unterhaltung, keine Notizen; Rate-Limit; Doppelklick erzeugt eine Nachricht; Browser Gast ↔ Admin                                                    | Gespräch Gast ↔ Team auf der Staging-Preview mit `JTKQSYFX-1` durchspielbar                                                                         |
| **I4**  | Zustell-Engine: `message_delivery_jobs`, Worker, Vercel Cron (geschützt wie `registration-sync`), `after()`, Zustände `failed`/`uncertain`, Anzeige in der Oberfläche                | Simulierter Adapter mit erzwungenen Fehlern (401/403/422/429/Timeout/5xx); kein Doppelversand bei `uncertain`; parallele Worker                                            | Alle Fehlerpfade sichtbar und korrekt; kein Retry bei eindeutigen Fehlern                                                                           |
| **I5**  | Channex eingehend gegen **Channex-Staging** und Simulator: Webhook-Route mit HMAC, `inbound_events`, Normalisierung, Dedup, Abgleich, Standortzuordnung, Inquiries ohne Reservierung | Signatur (gültig, falsch, abgelaufen, Rotation mit zwei Werten), Duplikate, Reihenfolge, verlorene Webhooks per Abgleich, Egress-Allowlist (verbotene Pfade schlagen fehl) | Eine Nachricht aus Channex-Staging erscheint genau einmal in der Inbox; ein manipulierter Webhook wird abgewiesen                                   |
| **I6**  | Channex ausgehend (nur Staging): Antworten, Anhänge, „Keine Antwort nötig“, Thread schließen; Reservierungszuordnung (exakt/Vorschlag/manuell)                                       | Zustellung inkl. `uncertain`-Abgleich; Zuordnungslogik mit Testfällen (eindeutig, mehrdeutig, keine); Rechte                                                               | Antwort erreicht Channex-Staging genau einmal; Zuordnung nachvollziehbar                                                                            |
| **I7**  | Team-Benachrichtigung (Slack-Vorlage „neue Gastnachricht“/„zugewiesen“, simuliert), Ungelesen-Badge, optional Echtzeit Stufe 2                                                       | Outbox-Dedup, kein Inhalt in Slack-Text (nur Link und Kanal)                                                                                                               | Benachrichtigungen simuliert korrekt                                                                                                                |
| **I8**  | KI-Vorschläge und Übersetzung (`AI_ASSIST=off                                                                                                                                        | suggest`): ContextBuilder, PolicyGate, Quellen, Aufzeichnung; nur Vorschläge                                                                                               | Simulierter Provider: Quellenpflicht, keine Reservierungsdaten ohne Recht, Übergabe-Intents; Evaluationssatz; keine Sendefunktion im KI-Pfad (Test) | Vorschlag mit Quelle in der Inbox; Übersetzung hin und zurück; Kosten und Latenz gemessen |
| **I9**  | **Produktiver Pilot, eigene Freigabe:** ein Standort; zuerst nur lesend spiegeln (Webhook und Abgleich, `CHANNEX_SEND=off`), danach Senden für den Pilotstandort                     | Vorab lesende Prüfung der bestehenden Webhooks; Monitoring; Rückfallplan (Schalter aus, Webhook deaktivieren)                                                              | Zwei Wochen Spiegelung ohne Verlust oder Duplikat; danach Senden freigegeben                                                                        |
| **I10** | KI Shadow-Modus, danach `auto_limited` je Standort (eigene Freigabe)                                                                                                                 | Richtlinientests (jede Bedingung einzeln), Not-Aus, Audit je Entscheidung                                                                                                  | Messwerte aus dem Shadow-Modus erfüllen vereinbarte Schwellen                                                                                       |
| **I11** | WhatsApp-Adapter (Cloud API), Vorlagen, 24-h-Fenster                                                                                                                                 | Adapter-Vertragstests wie Channex; Fensterlogik                                                                                                                            | Keine Änderung an Inbox oder Schema außer neuen Enum-Werten                                                                                         |

Jede Phase erfüllt die üblichen Prüfungen (`turbo typecheck lint test`, Prettier) und bekommt einen kurzen Bericht in `docs/staging/`.

## 8. Offene Entscheidungen

1. **Channex:** Konto und Billing-Owner, Konditionen der Messages-App, vorhandene Webhooks (3.7). Wird parallel im Channex-Dashboard geantwortet?
2. **KI-Provider:** Auswahl, AV-Vertrag, Region, Budget je Monat.
3. **Aufbewahrung:** Fristen für Inhalte, Rohereignisse, KI-Vorschläge. Löschung auf Gastwunsch.
4. **Gästebenachrichtigung** bei STAY-Chat-Antworten: E-Mail ab wann, Texte?
5. **Rollen:** Darf `viewer` Inhalte lesen? Sollen Zuweisungen auf Teams statt Personen möglich sein?
6. **Kennzeichnung automatischer Antworten** gegenüber Gästen (rechtliche Vorgabe und Tonalität).
7. **Echtzeit Stufe 2** (Supabase Realtime Broadcast) gleich oder erst bei Bedarf?

## Quellen

- [Channex Messages Collection](https://docs.channex.io/api-v.1-documentation/messages-collection)
- [Channex Webhook Collection](https://docs.channex.io/api-v.1-documentation/webhook-collection)
- [Channex HMAC Signing](https://docs.channex.io/api-v.1-documentation/webhook-collection/hmac-signing.md)
- [Channex Rate Limits](https://docs.channex.io/api-v.1-documentation/rate-limits.md)
- [Channex API Key Access](https://docs.channex.io/application-documentation/api-key-access.md)
- [Channex Airbnb Booking Requests](https://docs.channex.io/api-v.1-documentation/airbnb-api/manage-a-booking-requests.md)
- [Channex Pricing](https://channex.io/pricing)
- [Channex im Apaleo Store](https://store.apaleo.com/apps/channex)
