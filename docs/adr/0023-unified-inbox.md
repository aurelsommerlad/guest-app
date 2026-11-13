# ADR 0023: Unified Inbox als zentrale, mobile Kommunikationsoberfläche

Status: Akzeptiert für I0–I3 (Produktentscheidung 13.11.2026); produktive Aktivierung je Phase gesondert · Details: [Konzept Unified Inbox](../concepts/unified-inbox.md)

## Kontext

UNIQUE PLACES bündelt die gesamte Gästekommunikation im STAY-Admin.

**Kanäle:**

- STAY-Gäste-Chat
- Booking.com, Airbnb und weitere Nachrichtenkanäle über die Channex Messaging API
- später WhatsApp Business

Das Team arbeitet überwiegend mobil auf dem iPhone. Eine Chat-Kommunikation über Slack ist ausdrücklich nicht gewünscht.

**Ausgangslage:**

- Es gibt keine Reservierungstabelle; Reservierungen werden live aus Apaleo gelesen, Apaleo bleibt führend.
- Es gibt keine eingehenden Webhooks, kein Realtime und keinen Cron.
- RLS ist an allen Tabellen aktiv, aber ohne Policies; die App verbindet sich als Eigentümer.
- Channex-API-Schlüssel lassen sich nicht auf Messaging beschränken.

## Entscheidung

1. **Die Inbox im STAY-Admin ist die einzige Arbeitsoberfläche für Gästekommunikation.**
   - Sie ist als installierbare PWA für das iPhone gebaut.
   - Benachrichtigungen kommen als Web Push mit Deep Link zur Unterhaltung, beantwortet wird in STAY.
   - Slack ist kein Kanal; höchstens später ein optionaler Benachrichtigungsweg.
2. **Push ist ein Zusatz, keine Zustellgarantie.**
   - Inbox, Ungelesen-Status und Polling funktionieren ohne Push.
   - Mitteilungen enthalten standardmäßig keinen Nachrichteninhalt.
   - Die Empfänger richten sich nach Standortrechten und Zuweisung.
   - Je Nachricht und Gerät gibt es höchstens eine Mitteilung.
   - Jede Zustellung wird ohne Inhalt protokolliert.
3. **Einheitliches, kanalunabhängiges Datenmodell.**
   - Unterhaltungen, Nachrichten, Teilnehmer, Kanal-Konten, Reservierungsverknüpfungen (n:m), Anhänge, Gelesen-Stände, Ereignisverlauf (nur anhängend), Zustell-Jobs, Push-Geräte und Push-Protokoll.
   - Unterhaltungen ohne Reservierung sind erlaubt.
4. **Mandanten- und Standorttrennung serverseitig und per RLS.**
   - Inbox-Zugriffe laufen in Transaktionen mit `SET LOCAL ROLE stay_inbox`. Die Rolle ist ohne `BYPASSRLS` und nicht Eigentümerin der Tabellen.
   - Die Policies lesen `app.tenant_id`, `app.property_ids`, `app.all_properties`, `app.can_read_notes` und `app.admin_user_id`. Gesetzt werden sie nur vom Server aus dem geprüften Admin-Kontext.
5. **Rechte im bestehenden Rollenmodell:**
   - neue Rechte `inbox.read`, `inbox.reply`, `inbox.notes`, `inbox.assign`, `inbox.manage`
   - Viewer lesen Nachrichten nur mit ausdrücklicher Freigabe (`admin_user_grants`) und sehen nie interne Notizen
6. **Kanäle sind Adapter hinter dem Port `ChannelAdapter`.**
   - Eingehend: signaturgeprüfter Webhook, Rohereignis, idempotente Verarbeitung und Abgleich.
   - Ausgehend: Outbox; ein ungewisser Versand wird nie blind wiederholt.
   - Channex wird zuerst nur gegen Staging und einen Simulator entwickelt, mit Egress-Allowlist und getrennten Schaltern für Lesen und Senden.
7. **KI hinter dem Port `AiProvider`.**
   - Wissen nur aus freigegebenen Quellen, mit Quellennachweis.
   - Zunächst kein Senden und keine Buchungsänderungen.

## Konsequenzen

- **Neue Infrastruktur:**
  - Datenbankrolle `stay_inbox`
  - Migration 0023
  - Service Worker und Web-App-Manifest im Admin
  - VAPID-Schlüssel
  - später die erste Webhook-Route und der erste Vercel-Cron
- **Produktive Aktivierung je Schritt gesondert:** Migration auf Production, `PUSH_DELIVERY=live`, Channex lesen und senden.
- **Datenschutz:** Inhalte, Anhänge und Push-Geräte bekommen Aufbewahrungs- und Löschregeln. Inhalte stehen nicht im Audit, nicht in Logs und standardmäßig nicht in Mitteilungen.
- **Offen:** Für die tägliche Nutzung auf dem iPhone ist die Sitzungsdauer im Admin neu zu entscheiden; heute sind es 12 Stunden.
- **Unverändert:** Extras-App, Extras-Migration, Online-Check-in sowie produktive Apaleo- und Channex-Prozesse bleiben unberührt.
