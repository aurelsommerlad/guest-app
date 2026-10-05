# @up/integrations

Adapters for external systems. They implement the provider interfaces (ports) from `@up/core`:

- `PMSProvider`: `MockPMSProvider`, `ApaleoProvider` (Phase 4)
- `AccessProvider`: Nuki (later)
- `GuestRegistrationProvider`: Feratel (later)

Rules:

- Provider-specific types (e.g. Apaleo DTOs) never leave the adapter.
- Every call goes through a shared HTTP client with timeout, retry (idempotent calls only) and structured logging.
- Server-only. Credentials come per tenant from the server and never reach the client.

Status: empty, built in **Phase 4**.
