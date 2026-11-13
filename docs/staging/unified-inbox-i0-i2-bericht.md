# Unified Inbox – Bericht I0–I2, I3 vorbereitet

Stand: 13.11.2026 · Branch `claude/sharp-rubin-hwfdyt` · Konzept: [unified-inbox.md](../concepts/unified-inbox.md) · Entscheidung: [ADR 0023](../adr/0023-unified-inbox.md) · Screenshots: [`unified-inbox-screenshots/`](unified-inbox-screenshots/)

Eingehaltene Grenzen:

- Keine Channex-Nachrichten gelesen oder gesendet, keine Webhooks verändert.
- Keine Apaleo-Schreibzugriffe; der Reservierungskontext wird nur gelesen (lokal über den Apaleo-Simulator).
- Keine Änderung an Extras; Extras-Migration und Online-Check-in bleiben pausiert.
- Migration 0023 nur lokal angewendet – **nicht** auf Staging oder Production.
- Keine Push-Mitteilungen an reale Mitarbeiter; automatische Mitteilungen gibt es im Code noch nicht.

## I0 – Bestandsaufnahme und Planung

- **Produktentscheidung eingearbeitet:**
  - Die Inbox im STAY-Admin ist die zentrale Oberfläche.
  - iPhone-PWA mit Web Push.
  - Keine Slack-Chats und keine Slack-Antworten; Slack höchstens später als zusätzlicher Benachrichtigungsweg.
  - Konzept und ADR 0023 sind aktualisiert, die Phasen I0–I11 neu geschnitten.
- **Architektur:** Monorepo, Ports und Adapter, Repositories mit `TenantContext`. Es gibt keine Reservierungstabelle; Apaleo bleibt führend. Bisher gab es keine Webhooks, kein Realtime und keinen Cron.
- **Datenbank:** RLS war an allen Tabellen aktiv, aber ohne Policies, weil die App als Eigentümer verbindet. Für die Inbox gibt es jetzt eine eigene Rolle mit echten Policies (siehe I1).
- **Channex:** In dieser Umgebung gibt es **keinen Channex-Zugang** (keine Zugangsdaten). Die lesende Prüfung der Anbindung und der vorhandenen Webhooks steht deshalb aus (offener Punkt 1).
- **PWA/Push-Voraussetzungen:**
  - Admin auf Next 16 mit dem Manifest-Mechanismus `app/manifest.ts`.
  - Admin-Domain mit HTTPS (`guest-app-admin.vercel.app`).
  - Sitzungs-Cookie `__Host-…`, SameSite=Strict, 12 Stunden.
  - iOS ab 16.4 unterstützt Web Push nur in der zum Home-Bildschirm hinzugefügten Web-App.
  - Bisher gab es weder Service Worker noch Manifest.

## I1 – Datenmodell, RLS, Berechtigungen

**Migration `0023_unified_inbox`:** 13 neue Tabellen, alle mit `tenant_id`, zusammengesetzten Fremdschlüsseln und Prüfregeln.

| Tabelle                          | Zweck                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `channel_accounts`               | Kanal-Konto je Mandant (Provider, Umgebung; Geheimnisse nur als Verweis auf Env-Namen) |
| `channel_account_properties`     | Kanalzuordnung zu STAY-Objekten (z. B. Channex-Property-ID)                            |
| `conversations`                  | Unterhaltung: Kanal, Art (Reservierung/Anfrage), Status, Zuweisung, Vorschau, Version  |
| `conversation_reservation_links` | n:m zu Apaleo-Reservierungen; Anfragen ohne Reservierung möglich                       |
| `conversation_participants`      | Gast, Team, KI, System, OTA                                                            |
| `conversation_messages`          | Eingehend, ausgehend, interne Notiz; Zustellstatus; Dedup per Kanal-ID und Client-ID   |
| `conversation_reads`             | Gelesen-Stand je Mitarbeiter (Ungelesen)                                               |
| `conversation_events`            | Verlauf und Audit je Unterhaltung, **nur anhängend** (Trigger), ohne Inhalte           |
| `message_attachments`            | Anhänge (privater Bucket, signierte URLs) – Struktur vorbereitet                       |
| `message_delivery_jobs`          | Ausgehende Zustellung (Claim-Muster, `failed`/`uncertain`)                             |
| `push_subscriptions`             | Push-Geräte, mehrere je Mitarbeiter, Widerruf und Fehlerzähler                         |
| `push_deliveries`                | Zustellprotokoll ohne Inhalt, eine Mitteilung je Gerät und Dedup-Schlüssel             |
| `admin_user_grants`              | Ausdrückliche Zusatzrechte (nur `inbox.read` für Viewer)                               |

**RLS (in der Datenbank durchgesetzt):**

- Neue Rolle `stay_inbox` (NOLOGIN, kein `BYPASSRLS`, nicht Eigentümerin der Tabellen).
- Das Inbox-Repository führt jede Abfrage in einer Transaktion mit `SET LOCAL ROLE stay_inbox` und den Einstellungen des geprüften Admin-Kontexts aus: Mandant, Objekte, „alle Objekte“, Notizen, Mitarbeiter.
- 15 Policies:
  - Mandant und Objekt müssen passen.
  - Kindtabellen folgen der Sichtbarkeit ihrer Unterhaltung.
  - Interne Notizen nur mit `inbox.notes`.
  - Push-Geräte nur für den eigenen Mitarbeiter.
  - Systemprozesse laufen mit ausdrücklichem System-Kontext je Mandant.
- Die Rolle hat keinen Zugriff auf andere Tabellen; die Supabase-Data-API ist für alle neuen Tabellen gesperrt.

**Rechte:**

| Recht          | Owner | Admin |    Manager     |              Viewer              |
| -------------- | :---: | :---: | :------------: | :------------------------------: |
| `inbox.read`   |   ✔   |   ✔   | eigene Objekte | nur mit Freigabe im Team-Bereich |
| `inbox.reply`  |   ✔   |   ✔   | eigene Objekte |                –                 |
| `inbox.notes`  |   ✔   |   ✔   | eigene Objekte |                –                 |
| `inbox.assign` |   ✔   |   ✔   | eigene Objekte |                –                 |
| `inbox.manage` |   ✔   |   ✔   |       –        |                –                 |

- Die Viewer-Freigabe vergeben Owner und Admin unter **Team → Mitglied → „Nachrichten lesen freigeben“**, auditiert.
- Ein Viewer sieht danach Gästenachrichten, aber nie interne Notizen und kann weder antworten noch den Status ändern.

**Kanalunabhängigkeit:**

- Ports `ChannelAdapter` (Fähigkeiten, Signaturprüfung, Normalisierung, Versand mit `sent`/`failed`/`uncertain`, Abgleich) und `PushSender` in `@up/core`.
- WhatsApp oder weitere Channex-Kanäle kommen ohne Schemaänderung hinzu.

## I2 – Erste Unified Inbox (simuliert)

- **Navigation:**
  - „Kommunikation → Posteingang“ (`/inbox`, je Objekt `/inbox/<objekt>`, Unterhaltung `/inbox/c/<id>`).
  - Die Startseite öffnet das erste erlaubte Modul; das ist jetzt der Posteingang.
- **Desktop:** Liste, Verlauf und Kontext nebeneinander. Der Kontext zeigt die Reservierung live aus Apaleo, weitere Unterhaltungen derselben Reservierung, Status und Zuweisung sowie den Verlauf.
- **Mobil:** Liste, dann die Unterhaltung im Vollbild mit Zurück-Link. Der Kontext ist einklappbar, das kompakte Antwortfeld steht fest am unteren Rand (iPhone-Safe-Area).
- **Liste:** Kanal-Kürzel statt Farben, Objekt, Vorschau, Zeit, Ungelesen-Marke, Status. Unterhaltungen mit Anfrage ohne Buchung sind gekennzeichnet.
- **Filter:** Alle, Ungelesen, Offen, Wartet, Erledigt; Kanal; „mir zugewiesen“/„nicht zugewiesen“; Objekt über die bestehende Objektauswahl.
- **Antworten:**
  - Das Feld wächst mit dem Text, bis 8000 Zeichen; ⌘/Strg+Enter sendet.
  - Doppelklicks erzeugen keine zweite Nachricht (Client-Message-ID).
  - Während des Sendens Getipptes geht nicht verloren.
- **Interne Notizen:** optisch abgesetzt, nur für Berechtigte.
- **Zustellstatus je Nachricht:**
  - „Wird gesendet“, „Gesendet“, „Nicht gesendet – Grund“, „Zustellung ungewiss“.
  - Für die Prüfung lässt sich ein Fehlversand simulieren (`[simuliert:fehler]`).
- **Status und Zuweisung:**
  - Eine Antwort setzt die Unterhaltung auf „Wartet auf Gast“, eine neue Gästenachricht öffnet sie wieder.
  - Zuweisen ist nur an Personen möglich, die im Objekt antworten dürfen.
  - Kein unbemerktes Überschreiben durch Kollegen.
- **Aktualisierung:** rechtegeprüftes Polling ohne Inhalte, alle 5 s in der Unterhaltung und alle 15 s in der Liste; pausiert im Hintergrund.
- **Simulation:**
  - Owner und Admin können lokal und auf Staging realistische, fiktive Gästenachrichten erzeugen (`INBOX_SIMULATION=on`, in Production gesperrt).
  - Es gibt sechs Unterhaltungen über vier Kanäle, mit Deutsch, Englisch und Französisch, einer Airbnb-Anfrage ohne Buchung und einer Reservierung mit zwei Unterhaltungen.

## I3 – PWA und Push (vorbereitet)

- **PWA-Bausteine:**
  - Web-App-Manifest `/manifest.webmanifest`: „STAY Admin“, `standalone`, Start im Posteingang.
  - Icons 192/512, maskable, Apple-Touch-Icon.
  - Apple-Web-App-Metadaten.
- **Service Worker `/sw.js`:**
  - Nur für Push und Benachrichtigungsklicks, kein Offline-Cache.
  - Deep Links sind auf `/inbox…` beschränkt.
  - Ein Tippen fokussiert ein offenes Fenster oder öffnet die App.
  - Eigene Header: kein Cache, CSP `script-src 'self'`.
- **„Posteingang → Mitteilungen“ (`/inbox/devices`):**
  - Mitteilungen auf diesem Gerät aktivieren; die Berechtigung wird erst nach einem Tippen angefragt, auf dem iPhone mit Hinweis zum Home-Bildschirm.
  - Gerätename vergeben; Geräteliste mit Entfernen.
  - **Test-Mitteilung an das eigene Gerät**, mit Deep Link zur neuesten sichtbaren Unterhaltung.
  - Zustellprotokoll.
- **Zustellung:**
  - Adapter `WebPushSender` (VAPID, `web-push` 3.6.7), TTL 24 h, Urgency high.
  - Antworten 404/410 widerrufen das Gerät, 429/5xx sind wiederholbar.
  - Mitteilungen ohne Nachrichteninhalt.
- **Schalter:**
  - `PUSH_DELIVERY=off` (Standard) oder `test` (nur Test-Mitteilungen an das eigene Gerät).
  - `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` müssen zusammen gesetzt sein.
  - Einen Modus für automatische Mitteilungen gibt es im Code noch nicht.

## Screenshots

| Bild | Inhalt                                                                       |
| ---- | ---------------------------------------------------------------------------- |
| d01  | Desktop: Posteingang nach der Simulation                                     |
| d02  | Desktop: Unterhaltung mit Reservierungskontext (live aus Apaleo-Simulator)   |
| d03  | Desktop: Antwort „Gesendet“, interne Notiz, simulierter Fehlversand, Verlauf |
| d04  | Desktop: Airbnb-Anfrage ohne Buchung                                         |
| d05  | Team: Viewer-Freigabe „Nachrichten lesen“                                    |
| d06  | Viewer mit Freigabe: liest, keine Notizen, keine Antwort                     |
| m01  | iPhone: Liste mit Filtern                                                    |
| m02  | iPhone: Unterhaltung im Vollbild                                             |
| m03  | iPhone: längere Antwort im Eingabefeld                                       |
| m04  | iPhone: gesendete Antwort                                                    |
| m05  | iPhone: Geräte & Mitteilungen mit Zustellprotokoll                           |

## Tests

**Automatisiert:** `turbo typecheck lint test` mit 21/21 Tasks grün.

| Paket        | Tests | davon neu                                                                                                                                          |
| ------------ | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| core         |   512 | Rechte (Viewer-Freigabe, nicht vergebbare Rechte, Objektgrenze), Statusregeln, Ungelesen, Push-Regeln                                              |
| db           |   340 | 23 Inbox-Tests (RLS je Mandant/Objekt/Notizen/Rolle, Dedup, idempotente Antworten, Zustand statt Version, Push-Geräte, Freigaben) + Policy-Prüfung |
| integrations |    94 | Web-Push-Adapter (VAPID-Schlüssel, Netzfehler, Simulation)                                                                                         |
| admin        |   141 | Inbox-Scope aus dem Admin-Kontext, URL-Filter, Push-Sperre, Navigation, Startmodul                                                                 |

**Browser** (lokal, echte Postgres-Datenbank mit Migration 0023, Apaleo-Simulator):

- **Owner:**
  - Simulation, Liste (6), Ungelesen (5) und Filter.
  - Antwort „Gesendet“, Notiz, Fehlversand.
  - Zuweisung; Lena (Manager HØV) steht im Objekt TEST korrekt nicht zur Auswahl.
- **Manager HØV:** sieht nur die zwei HØV-Unterhaltungen.
- **Viewer ohne Freigabe:** Posteingang nicht in der Navigation, `/inbox` → „Keine Berechtigung“.
- **Viewer mit Freigabe:** liest drei Nachrichten, sieht keine Notiz, kann nicht antworten und keinen Status ändern.
- **Manifest und `/sw.js`:** mit den richtigen Headern ausgeliefert.
- **Test-Mitteilung an ein absichtlich unerreichbares Testgerät:** „Zustellung fehlgeschlagen (network_error)“, im Protokoll vermerkt.

**Durch Browsertests gefunden und behoben:**

- postgres.js serialisiert keine `Date`-Werte in rohen SQL-Fragmenten; PGlite hatte das verdeckt.
- Statuswechsel und Zuweisung prüfen jetzt den gesehenen Zustand statt der Version. Eine Antwort blockierte vorher eine direkt folgende Zuweisung.
- Während des Sendens Getipptes wurde vorher gelöscht.

## Offene Punkte

1. **Channex:** Es gibt keinen Zugang in dieser Umgebung. Die lesende Prüfung von Konto, Standorten, Messages-App und bestehenden Webhooks steht aus. Dafür braucht es einen ausdrücklich freigegebenen Zugang, idealerweise zuerst Channex-Staging.
2. **Staging-Migration 0023:** noch nicht angewendet, sie braucht die Freigabe. Das Vorgehen ist wie bei 0019–0022: Prüfung auf einer Kopie, dann `pnpm db:migrate --target staging`. Neu ist das Anlegen der Rolle `stay_inbox`.
3. **Sitzungsdauer im Admin:** heute 12 Stunden. Für die tägliche iPhone-Nutzung ist eine längere, gerätegebundene Sitzung zu entscheiden.
4. **Deep Link mit `SameSite=Strict`:** Ein Tippen auf die Mitteilung öffnet die App aus dem Service Worker. Ob die Sitzung dabei erhalten bleibt, ist im gemeinsamen iPhone-Test zu bestätigen.
5. **Noch nicht gebaut** (laut Plan):
   - STAY-Gäste-Chat (I4)
   - Zustell-Engine mit Cron und automatischen Mitteilungen (I5)
   - Channex-Adapter (I6/I7)
   - Anhänge-Speicher
   - Löschlauf für `purge_after`; die Spalten sind vorhanden
   - KI (I9)
6. **Echtzeit:** Polling reicht für den Anfang; Supabase Realtime Broadcast ist optional (I10).

## Nächster Schritt: iPhone-Push aktivieren (gemeinsamer Test)

1. **Freigabe** für Migration 0023 auf Staging erteilen, dann wird sie eingespielt (nicht Production).
2. **VAPID-Schlüssel erzeugen:**
   - Einmalig mit `node -e "console.log(require('web-push').generateVAPIDKeys())"` im Paket `packages/integrations`.
   - Im Vercel-Projekt `guest-app-admin` hinterlegen: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (verschlüsselt), `VAPID_SUBJECT=mailto:<Betriebsadresse>`, dazu `PUSH_DELIVERY=test` und für Testdaten `INBOX_SIMULATION=on`.
   - Den privaten Schlüssel nie im Chat teilen.
3. **Neu bereitstellen:** Ein Push auf den Branch genügt.
4. **Auf dem iPhone (iOS ≥ 16.4):**
   - In Safari `https://guest-app-admin.vercel.app` öffnen, „Teilen → Zum Home-Bildschirm“.
   - Die App vom Home-Bildschirm starten und anmelden.
5. **In der App:**
   - Posteingang → „Simulierte Gästenachrichten erzeugen“.
   - „Mitteilungen“ → Gerätename eingeben → „Mitteilungen auf diesem Gerät aktivieren“ → Erlauben.
   - „Test-Mitteilung senden“.
6. **Prüfen:**
   - Die Mitteilung erscheint ohne Nachrichteninhalt.
   - Ein Tippen öffnet die Unterhaltung.
   - Das Protokoll zeigt „übergeben (201)“.
7. **Danach:** Freigabe für I5 (automatische Mitteilungen bei neuen Gästenachrichten an ausgewählte Testgeräte).
