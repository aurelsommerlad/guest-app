# 0003 – Provider-basierte Integrationen

**Status:** Akzeptiert (2026-10-05). Umsetzung ab Phase 4 (Apaleo).

## Kontext

Apaleo ist Source of Truth für Reservierungen. Später kommen Nuki, Feratel und weitere PMS hinzu. Apaleo-Logik darf sich nicht durch die Anwendung ziehen, und die App muss bei API-Ausfällen weiter funktionieren.

## Entscheidung

- **Ports** (Interfaces) liegen in `@up/core`: `PMSProvider`, später `AccessProvider`, `GuestRegistrationProvider`, `ExtrasProvider`.
- **Adapter** liegen in `@up/integrations`: `MockPMSProvider`, `ApaleoProvider`.
- Provider-DTOs werden im Adapter auf Domain-Typen gemappt und verlassen ihn nie.
- Auswahl pro Tenant über `integration_connections`. Credentials liegen nur auf dem Server und sind verschlüsselt.
- Reservierungen werden in eine **lokale Kopie** gespiegelt: Webhooks (idempotent über `webhook_events`) plus periodischer Abgleich (`sync_runs`). Die Guest App liest nur lokal.
- Gemeinsamer HTTP-Client mit Timeout, Retry (nur bei idempotenten Calls), strukturiertem Logging und Fehler-Mapping.

## Konsequenzen

- Neue Provider brauchen nur einen neuen Adapter.
- Synchronisationsaufwand und mögliche kurzzeitige Inkonsistenz werden über `synced_at` und Status-Tracking sichtbar gemacht.
