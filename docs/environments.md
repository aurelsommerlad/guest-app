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
- Supabase dient als Postgres und (ab Phase 9) als Storage für GUIDE-Bilder. Supabase Auth und die Data API werden nicht genutzt; die deaktivierte Data API betrifft Storage nicht.
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

## Admin App und GUIDE-Medien (Phase 9)

Die Admin App (`apps/admin`, [ADR 0014](adr/0014-admin-app-and-auth.md)) ist ein eigenes Vercel-Projekt und nutzt pro Environment dieselbe Datenbank wie die Guest App.

|         | local                   | staging                                       | production                |
| ------- | ----------------------- | --------------------------------------------- | ------------------------- |
| URL     | `http://localhost:3001` | eigene Staging-Domain bzw. Preview-Deploys    | `admin.unique-places.com` |
| Secrets | `apps/admin/.env.local` | Vercel-Projekt `admin`, Env „Staging/Preview“ | Vercel Env „Production“   |

**Variablen `apps/admin`** (Schema: `apps/admin/src/env/schema.ts`, Vorlage: `apps/admin/.env.example`):

| Variable                    | Pflicht          | Hinweis                                                                                       |
| --------------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `APP_ENV`                   | ja               | `local`, `staging`, `production`                                                              |
| `NEXT_PUBLIC_APP_URL`       | ja               | URL der Admin App selbst, außerhalb von local `https`                                         |
| `DATABASE_URL`              | zur Laufzeit     | Supabase **Transaction Pooler** (Port 6543), als „Sensitive“ markieren                        |
| `SUPABASE_URL`              | für Bild-Uploads | `https://<projekt>.supabase.co`                                                               |
| `SUPABASE_SERVICE_ROLE_KEY` | für Bild-Uploads | nur serverseitig, nur im Admin-Projekt, „Sensitive“; nie `NEXT_PUBLIC_`, nie in der Guest App |
| `GUIDE_MEDIA_BUCKET`        | nein             | Standard `guide-media`                                                                        |
| `ADMIN_SETUP_TOKEN`         | nur für `/setup` | mindestens 32 zufällige Zeichen; nach dem Anlegen des ersten Kontos entfernen                 |
| `LOG_LEVEL`                 | nein             | Standard `info`                                                                               |

**Guest App:** zusätzlich `SUPABASE_URL` setzen, damit `next/image` Bilder aus dem öffentlichen Bucket laden darf. Die Guest App braucht keinen Storage-Key.

**Supabase-Storage-Bucket (einmalig pro Projekt, im Dashboard):** Storage → New bucket → Name `guide-media`, **Public bucket** an, File size limit 8 MB, Allowed MIME types `image/jpeg, image/png, image/webp`. Größen- und MIME-Grenze sind **sicherheitsrelevant**, weil der Browser direkt zu Storage hochlädt (signierter Upload, [ADR 0013](adr/0013-guide-content-management.md)). **Keine** Storage-Policies anlegen: Schreibrechte entstehen nur über die pfadgebundenen Upload-Tokens, die die Admin App serverseitig ausstellt. CORS muss nicht konfiguriert werden.

**EXPLORE (Phase 10):** keine neuen Variablen. Bilder liegen im selben Bucket unter `<tenantId>/explore/<uuid>.<ext>` (GUIDE: `<tenantId>/<propertyId>/guide/…`).

**Vercel-Projekt `admin`:** wie unten für `guest`, aber Root Directory `apps/admin` (Region `fra1` über `apps/admin/vercel.json`), Domain `admin.unique-places.com` für Production, Staging idealerweise mit Deployment Protection.

**Erstes Admin-Konto:** `ADMIN_SETUP_TOKEN` setzen, deployen, `/setup` öffnen, Token, Tenant-Slug, E-Mail und Passwort eingeben. Danach ist `/setup` gesperrt (404); das Token aus Vercel entfernen. Lokal oder mit direkter DB-Verbindung alternativ `pnpm admin-user:create` (siehe `apps/admin/README.md`).

## Guest Journey: Online-Check-in und Zugang (Phase 11)

| Variable                        | App   | Pflicht | Zweck                                                                                                                                                      |
| ------------------------------- | ----- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACCESS_CODE_KEY`               | guest | nein    | 32 Byte base64 (`openssl rand -base64 32`), verschlüsselt Schlüsselbox-Codes. Je Environment eigener Wert, nur Server. Ohne: manuelle Hinweise statt Code. |
| `APALEO_REGISTRATION_WRITEBACK` | guest | nein    | `disabled` (Standard) / `enabled`. Erfordert Apaleo-Client mit `reservations.manage`, `DATABASE_URL`.                                                      |
| `CRON_SECRET`                   | guest | nein    | ≥ 32 Zeichen. Aktiviert `GET /api/registration-sync` (Vercel Cron sendet `Authorization: Bearer …`). Ohne: Endpunkt 404.                                   |
| `EXTRAS_APP_URL`                | guest | nein    | Separate Extras-App (https). Ohne: Platzhalter auf `/extras`.                                                                                              |
| `PREVIEW_NOW`                   | guest | nein    | Nur `APP_ENV=local`: Referenzzeit der Mock-Vorschau, um Journey-Zustände anzusehen.                                                                        |

- Online-Check-in und Zugangsmodus werden **pro Objekt** in `property_journey_settings` gepflegt (keine Env-Variable). Ohne Datensatz: Check-in aus, Zugang manuell.
- Lokale Beispielkonfiguration: `ACCESS_CODE_KEY=… pnpm db:seed --target local --with-journey-fixtures` (nur lokal; Beispielfelder sind keine Rechtsaussage).
- Feratel hat keine Variablen: nicht implementiert, keine Aufrufe ([Doku](integrations/feratel-guest-registration.md)).

## Vercel-Setup (einmalig, manuell)

1. Projekt `guest` anlegen und das GitHub-Repo verbinden (für die Admin App analog Projekt `admin`, siehe oben).
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
