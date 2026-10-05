# @up/integrations

Adapters for external systems. They implement the provider interfaces (ports) from `@up/core`. **Server-only.**

| Provider          | Port                                          | Status                                                              |
| ----------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| `ApaleoProvider`  | `PmsProvider`                                 | Phase 4: load one reservation (`GET /booking/v1/reservations/{id}`) |
| `MockPmsProvider` | `PmsProvider`                                 | In-memory reservations for development and tests                    |
| Nuki, Feratel     | `AccessProvider`, `GuestRegistrationProvider` | later                                                               |

Apaleo client (`src/apaleo`):

- OAuth 2.0 client credentials against `identity.apaleo.com/connect/token`, token cached per process
- Timeout 8 s, one retry for network/429/5xx, fresh token after 401
- Zod validation keeping only the fields we use (data minimisation)
- Structured logs and `PmsError` messages without credentials, tokens, response bodies or guest data

Rules: provider-specific types never leave the adapter. Tests use mocked HTTP only (`fetch` is injectable). See [ADR 0008](../../docs/adr/0008-pms-provider-apaleo.md).
