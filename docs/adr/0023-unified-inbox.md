# ADR 0023: Unified Inbox mit Kanal-Adaptern und providerunabhängiger KI

Status: Vorschlag (13.11.2026) · Details: [Konzept Unified Inbox](../concepts/unified-inbox.md)

## Kontext

UNIQUE PLACES möchte die Gästekommunikation in einer zentralen Inbox im STAY-Admin bündeln.

**Kanäle:**

- STAY-Gäste-Chat
- Booking.com und Airbnb über die Channex Messaging API
- später WhatsApp Business

Zusätzlich ist eine KI vorgesehen. Sie liefert zunächst nur Vorschläge und Übersetzungen.

**Ausgangslage:**

- Es gibt keine Reservierungstabelle; Reservierungen werden live aus Apaleo gelesen.
- Es gibt keine eingehenden Webhooks, kein Realtime und keinen Cron.
- Channex-API-Schlüssel lassen sich nicht auf Messaging beschränken.

## Entscheidung

1. **Einheitliches Datenmodell** (`conversations`, `messages`, `conversation_participants`, `conversation_reservation_links`, `message_attachments`, `conversation_events`, `message_delivery_jobs`, `inbound_events`, `ai_suggestions`, `ai_policies`, `channel_accounts`).
   - Mandant und Standort an jeder Zeile.
   - Reservierungen werden n:m über `(reservation_provider, external_reservation_id)` verknüpft.
   - Unterhaltungen ohne Reservierung (Inquiries) sind erlaubt.
2. **Kanäle sind Adapter hinter dem Port `ChannelAdapter`** (ADR 0003) mit deklarierten Fähigkeiten. Inbox und Datenmodell kennen keine providerspezifischen Felder.
3. **Eingehend:** signaturgeprüfter Webhook → Rohereignis → asynchrone, idempotente Verarbeitung, plus regelmäßiger lesender Abgleich.
4. **Ausgehend:** Outbox mit Claim-Muster.
   - Ein ungewisser Versand wird **nie** blind wiederholt, sondern gegen den Kanal abgeglichen.
5. **Channex-Schutz:**
   - eigener, auf Standorte beschränkter Schlüssel
   - Egress-Allowlist im Adapter (nur Messaging-Pfade)
   - getrennte Schalter für Lesen und Senden
   - Entwicklung ausschließlich gegen Channex-Staging und einen Simulator
6. **Echtzeit:**
   - zuerst Polling über eine rechtegeprüfte Änderungs-Route
   - später optional Supabase Realtime Broadcast (Signal ohne Inhalt)
   - keine Tabellen-Abos
7. **KI hinter dem Port `AiProvider`.**
   - Wissen nur aus freigegebenen Quellen, mit Quellennachweis.
   - Reservierungsdaten nur mit Recht und nach Standortrichtlinie.
   - Zunächst kein Senden und keine Schreibwerkzeuge.
   - Automatische Antworten erst nach Shadow-Modus und eigener Freigabe.

## Konsequenzen

- Neue Infrastruktur:
  - erste eingehende Webhook-Route
  - erster Vercel-Cron
  - privater Storage-Bucket für Anhänge
- Neue Rechte `inbox.*` und `ai.*` im bestehenden Rollenmodell.
- Inhalte sind personenbezogen. Deshalb gelten Aufbewahrungsfristen (`purge_after`), Inhalte stehen nicht im Audit und werden nicht geloggt.
- WhatsApp und weitere Kanäle kommen ohne Schemaänderung hinzu (nur Enum-Werte).
- Extras-App, Extras-Migration, Online-Check-in sowie produktive Apaleo- und Channex-Prozesse bleiben unberührt.
