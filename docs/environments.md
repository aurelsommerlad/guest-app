# Environments & Deployment

## Übersicht

|            | local                        | staging                                      | production                   |
| ---------- | ---------------------------- | -------------------------------------------- | ---------------------------- |
| App        | `pnpm dev`                   | Vercel, Branch `staging` (+ Preview-Deploys) | Vercel, Branch `main`        |
| URL        | `http://localhost:3000`      | z. B. `staging.stay.unique-places.com`       | `stay.unique-places.com`     |
| `APP_ENV`  | `local`                      | `staging`                                    | `production`                 |
| `NODE_ENV` | `development`                | `production`                                 | `production`                 |
| Datenbank  | Supabase CLI lokal (Phase 3) | eigenes Supabase-Projekt, EU (Phase 3)       | eigenes Supabase-Projekt, EU |
| Secrets    | `apps/guest/.env.local`      | Vercel Env „Staging“ bzw. „Preview“          | Vercel Env „Production“      |
| Daten      | Seeds                        | Seeds / Testdaten, Apaleo-Testsystem         | echte Daten                  |

`APP_ENV` ist bewusst von `NODE_ENV` getrennt: Staging läuft als Production-Build, nutzt aber eigene Secrets, eine eigene Datenbank und eigene Integrationszugänge.

## Environment-Variablen

- Definition und Validierung: `apps/guest/src/env/schema.ts` (Zod).
- `src/env/server.ts`: nur serverseitig (`server-only`). Wird es aus einer Client-Komponente importiert, schlägt der Build fehl.
- `src/env/client.ts`: nur `NEXT_PUBLIC_*`, niemals Secrets.
- Wann geprüft wird:
  - `next build` und `next dev`, über `next.config.ts`
  - Serverstart, über `src/instrumentation.ts`
  - Ungültige oder fehlende Werte brechen sofort ab. Die Fehlermeldung nennt nur Variablennamen, nie Werte.
- Außerhalb von `local` muss `NEXT_PUBLIC_APP_URL` `https` verwenden.
- Vorlage: `apps/guest/.env.example`. Neue Variablen werden immer dort **und** im Schema ergänzt.

## STAY-Datenquelle (Phase 4)

| Variable                        | local                           | staging / Preview               | production                                         |
| ------------------------------- | ------------------------------- | ------------------------------- | -------------------------------------------------- |
| `STAY_DATA_SOURCE`              | `mock` (Standard) oder `apaleo` | `apaleo` für den Testaufenthalt | `mock` bzw. nicht setzen (`apaleo` wird abgelehnt) |
| `APALEO_CLIENT_ID`              | nur bei `apaleo`                | ✅ (sensitiv)                   | –                                                  |
| `APALEO_CLIENT_SECRET`          | nur bei `apaleo`                | ✅ (sensitiv)                   | –                                                  |
| `APALEO_PREVIEW_RESERVATION_ID` | nur bei `apaleo`                | ✅                              | **nie** (wird abgelehnt)                           |

Die Apaleo-Zugangsdaten gehören ausschließlich in Vercel (Environment „Preview“ bzw. das Custom Environment „staging“) oder lokal in `.env.local`, nie ins Repository.

## Vercel-Setup (einmalig, manuell)

1. Projekt `guest` anlegen und das GitHub-Repo verbinden.
2. **Root Directory:** `apps/guest`. Framework: Next.js. Install- und Build-Befehle erkennt Vercel im pnpm-Monorepo automatisch.
3. **Region:** `fra1`, gesetzt über `apps/guest/vercel.json`.
4. **Production Branch:** `main`.
5. **Staging:**
   - Variante A: Vercel Custom Environment „staging“, an den Branch `staging` gebunden.
   - Variante B: Preview-Environment mit Branch-spezifischen Variablen für `staging`.
6. Env-Variablen **pro Environment getrennt** setzen (mindestens `APP_ENV`, `NEXT_PUBLIC_APP_URL`, optional `LOG_LEVEL`).
7. Domains:
   - `stay.unique-places.com` → Production
   - `staging.stay.unique-places.com` → Staging, idealerweise mit Vercel Deployment Protection
8. Auftragsverarbeitungsverträge mit Vercel und Supabase vor dem Go-live abschließen.

## Branching & Release-Fluss

```
feature/* ──PR──▶ staging ──(Abnahme)──PR──▶ main
   │                 │                          │
   CI + Preview      Staging-Deploy             Production-Deploy
```

- CI (`.github/workflows/ci.yml`) läuft auf jedem PR sowie auf `main` und `staging`: Format, Typecheck, Lint, Tests, Build.
- Empfehlung: Branch Protection auf `main` und `staging`, mit grüner CI als Pflicht.
- Ab Phase 3: Datenbankmigrationen (Drizzle Kit) laufen versioniert vor dem jeweiligen Deployment gegen die Ziel-Datenbank. Es gibt keine manuellen Schemaänderungen in Staging oder Production.
- Preview-Deployments nutzen niemals die Production-Datenbank.

## Health Check

`GET /api/health` liefert `{ status, environment, commit }` (ohne Secrets, ohne Cache) und eignet sich für Deployment-Checks und Uptime-Monitoring.
