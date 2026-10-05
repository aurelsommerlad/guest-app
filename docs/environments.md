# Environments & Deployment

## Übersicht

|            | local                           | staging                                      | production                          |
| ---------- | ------------------------------- | -------------------------------------------- | ----------------------------------- |
| App        | `pnpm dev`                      | Vercel, Branch `staging` (+ Preview-Deploys) | Vercel, Branch `main`               |
| URL        | `http://localhost:3000`         | z. B. `staging.stay.unique-places.com`       | `stay.unique-places.com`            |
| `APP_ENV`  | `local`                         | `staging`                                    | `production`                        |
| `NODE_ENV` | `development`                   | `production`                                 | `production`                        |
| Datenbank  | Supabase CLI / lokales Postgres | eigenes Supabase-Projekt, Frankfurt          | eigenes Supabase-Projekt, Frankfurt |
| Secrets    | `apps/guest/.env.local`         | Vercel Env „Staging“ bzw. „Preview“          | Vercel Env „Production“             |
| Daten      | Seeds                           | Seeds / Testdaten, Apaleo-Testsystem         | echte Daten                         |

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

## Datenbank (Phase 6)

Details zu Schema, Isolation und RLS: [ADR 0010](adr/0010-database-foundation.md). Befehle und Ablauf: [`packages/db/README.md`](../packages/db/README.md).

**Grundsätze:**

- **Zwei getrennte Supabase-Projekte:** `unique-places-guest-staging` und `unique-places-guest-production`, beide in der Region **Central EU (Frankfurt)**, passend zu Vercel `fra1`.
- Preview- und Staging-Deployments nutzen nie die Production-Datenbank.
- Supabase dient nur als Postgres. Supabase Auth, Storage und die Data API werden nicht genutzt.
- Die App verbindet sich serverseitig über den **Transaction Pooler** (Port 6543). Migrationen und Seed laufen über den **Session Pooler** (Port 5432). Beide sind IPv4-fähig.
- `DATABASE_URL` ist nie `NEXT_PUBLIC_` und wird nie an den Browser ausgeliefert.

| Variable       | local                                    | Vercel Preview / staging                                            | Vercel Production                                                      |
| -------------- | ---------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `DATABASE_URL` | optional, z. B. lokales Supabase (54322) | optional in Phase 6: Staging-Projekt, Transaction Pooler (sensitiv) | optional in Phase 6: Production-Projekt, Transaction Pooler (sensitiv) |

- In Phase 6 liest die App die Datenbank noch nicht. Ist `DATABASE_URL` gesetzt, wird sie nur validiert: `postgres://`-Schema, außerhalb von `local` kein localhost.
- Migrations- und Seed-URLs stehen **nicht** in Vercel. Sie werden nur für den jeweiligen CLI-Aufruf in der Shell gesetzt.

**Einmalig in Supabase, je Projekt:**

1. Projekt anlegen: Region Central EU (Frankfurt), starkes Datenbank-Passwort im Passwortmanager speichern.
2. Unter Project Settings → Data API die Data API deaktivieren. Ist das nicht möglich: „Automatically expose new tables“ ausschalten. Migration `0001` sperrt `anon` und `authenticated` zusätzlich.
3. Unter Database → Settings → SSL Configuration „Enforce SSL“ aktivieren.
4. Über **Connect** zwei Connection Strings kopieren:
   - Transaction Pooler (Port 6543) → Vercel `DATABASE_URL`
   - Session Pooler (Port 5432) → nur für `pnpm db:migrate` und `pnpm db:seed`

## Gastzugang (Phase 7)

Details in [ADR 0011](adr/0011-guest-access.md).

| Variable                  | local                                 | Vercel Preview / staging                        | Vercel Production                                                |
| ------------------------- | ------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| `GUEST_ACCESS_MODE`       | `preview` (Standard)                  | `preview` für die Abnahme, zum Testen `secured` | wirkt wie `secured`: Production fällt nie auf die Preview zurück |
| `GUEST_TENANT_SLUG`       | `unique-places` (für Login)           | `unique-places`                                 | `unique-places`                                                  |
| `DATABASE_URL`            | lokales Postgres (z. B. Supabase CLI) | Staging-Projekt (Transaction Pooler)            | Production-Projekt (Transaction Pooler)                          |
| `APALEO_CLIENT_ID/SECRET` | optional (sonst Mock-PMS)             | für echte Testreservierungen                    | Pflicht im Modus `secured`                                       |

- Ohne `DATABASE_URL` schlagen Link und Login geschlossen fehl (neutrale Seite bzw. Meldung). `/stay` zeigt im Modus `preview` weiter die Preview.
- Ohne Apaleo-Zugangsdaten nutzt der Login außerhalb von Production das Mock-PMS. Testdaten: `MOCK-HOV-ROS-LIVE` mit Nachname „Muster“.
- Ein Session-Secret als Env-Variable gibt es nicht: Sessions sind zufällige IDs, in der Datenbank liegt nur ihr Hash.

**Test-Gastzugang erzeugen** (local bzw. staging, `DATABASE_URL` in der Shell):

```bash
pnpm db:migrate --target local && pnpm db:seed --target local --with-preview-fixtures
pnpm guest-access:create --target local --tenant unique-places --provider mock --reservation MOCK-HOV-ROS-LIVE
# → Link wird einmal ausgegeben: http://localhost:3000/de/s/<token>
pnpm guest-access:revoke --target local --tenant unique-places --provider mock --reservation MOCK-HOV-ROS-LIVE
```

Auf Staging mit einer Apaleo-Testreservierung: `--provider apaleo --reservation <id> --base-url https://staging.stay.unique-places.com`, dazu `APALEO_CLIENT_ID` und `APALEO_CLIENT_SECRET` in der Shell.

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
- Datenbankmigrationen (Drizzle Kit, versioniert in `packages/db/drizzle`) werden explizit vor dem jeweiligen Deployment gegen die Ziel-Datenbank ausgeführt (`pnpm db:migrate --target …`). Es gibt weder manuelle Schemaänderungen noch `drizzle-kit push` in Staging oder Production. Die CI prüft, dass Schema und Migrationen übereinstimmen.
- Preview-Deployments nutzen niemals die Production-Datenbank.

## Health Check

`GET /api/health` liefert `{ status, environment, commit }` (ohne Secrets, ohne Cache) und eignet sich für Deployment-Checks und Uptime-Monitoring.
