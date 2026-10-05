# 0006 – Environments und Env-Validierung

**Status:** Akzeptiert (2026-10-05)

## Kontext

Es gibt drei Umgebungen (local, staging, production) mit getrennten Secrets und später getrennten Datenbanken. Konfigurationsfehler sollen früh auffallen, und Secrets dürfen nie in den Client gelangen.

## Entscheidung

- `APP_ENV` (`local | staging | production`) ist **getrennt von `NODE_ENV`**.
- Zod-Schemas in `apps/guest/src/env/schema.ts`, Validierung über `parseEnv` aus `@up/core`. Fehlermeldungen nennen nur Variablennamen, nie Werte.
- Server-Variablen werden nur über `src/env/server.ts` gelesen (`server-only`). Public-Variablen nur über `src/env/client.ts`, wo jede Variable explizit aufgeführt ist, damit Next.js sie inlinen kann.
- **Prüfzeitpunkte:**
  - `next build` und `next dev`, über `next.config.ts`
  - Serverstart, über `src/instrumentation.ts`
  - Reine Tooling-Läufe (`next typegen`) überspringen die Prüfung mit `SKIP_ENV_VALIDATION=1`.
- Außerhalb von `local` ist `https` für `NEXT_PUBLIC_APP_URL` Pflicht.
- Vercel: Region `fra1`, Env-Variablen pro Environment getrennt. Details in [environments.md](../environments.md).

## Konsequenzen

- Ein Build ohne gültige Konfiguration schlägt sofort fehl. Die CI setzt dafür unkritische Platzhalterwerte.
- Neue Variablen müssen in Schema **und** `.env.example` ergänzt werden.
