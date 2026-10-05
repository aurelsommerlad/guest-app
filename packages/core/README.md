# @up/core

Framework-free core: domain types, use cases, provider interfaces (ports), errors, plus shared server utilities.

Current contents (Phase 0):

- `parseEnv`, `appEnvironmentSchema`: Zod-based validation of environment variables (local / staging / production)
- `createLogger`: structured JSON logger with redaction of sensitive keys

Rules: no dependencies on Next.js, React, `@up/db`, `@up/integrations` or `@up/ui` (enforced by ESLint).
