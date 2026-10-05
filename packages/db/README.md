# @up/db

Drizzle-Schema, versionierte Migrationen, Seeds und **tenant-scoped Repositories** für Supabase PostgreSQL. Entscheidung und Begründung: [ADR 0010](../../docs/adr/0010-database-foundation.md).

Regeln:

- Nur serverseitig. Nie in Client-Komponenten importieren (`@up/ui` darf `@up/db` per ESLint-Grenze nicht importieren).
- Jede tenant-bezogene Tabelle hat `tenant_id NOT NULL`. Kind-Tabellen referenzieren `(tenant_id, id)`.
- Repositories verlangen einen `TenantContext`. Apps führen keine rohen Queries aus.
- Migrationen werden generiert, reviewt und committet. Es gibt **nie** `drizzle-kit push`.

## Inhalt

| Datei                                    | Zweck                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/schema.ts`                          | Tabellen `tenants`, `properties`, `units`, `external_mappings`                               |
| `drizzle/`                               | generierte SQL-Migrationen (+ `0001` custom: Supabase Data API sperren)                      |
| `src/client.ts`                          | `createDatabase(url)`: postgres.js, `prepare: false`, TLS außerhalb localhost                |
| `src/repositories/tenancy-repository.ts` | `getTenantBySlug`, `getPropertyById/BySlug`, `getUnitsForProperty`, `resolveExternalMapping` |
| `src/seed/unique-places.ts`              | Stammdaten Tenant UNIQUE PLACES (4 Properties, 8 HØV-Units, 12 Apaleo-Mappings)              |
| `src/seed/seed-tenant.ts`                | idempotenter Upsert in einer Transaktion                                                     |
| `src/cli/db.ts`                          | expliziter CLI für `migrate` und `seed` mit Ziel-Absicherung                                 |
| `src/testing/test-database.ts`           | PGlite (In-Memory-Postgres) für Tests                                                        |

## Wann eine Datenbank nötig ist

| Situation                                              | Datenbank                                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Guest App (`pnpm dev`, Preview, Production) in Phase 6 | **keine**: STAY, GUIDE und EXPLORE lesen weiter Registry und Mocks. `DATABASE_URL` ist optional.               |
| Unit- und Schema-Tests (`pnpm test`)                   | **keine externe**: PGlite startet pro Testdatei ein Postgres im Prozess und spielt die echten Migrationen ein. |
| `pnpm db:migrate` / `pnpm db:seed`                     | ja, explizit über `DATABASE_URL` und `--target`                                                                |
| Spätere Integrationstests (RLS, Pooler)                | eigenes Supabase-Projekt bzw. lokales Supabase, nie Staging oder Production                                    |

## Befehle

```bash
pnpm db:generate --name <beschreibung>   # Migration aus schema.ts erzeugen (ohne DB)
DATABASE_URL=… pnpm db:migrate --target local|staging|production [--confirm-production]
DATABASE_URL=… pnpm db:seed    --target local|staging|production [--confirm-production]
```

Der CLI liest `DATABASE_URL` **nur aus der Shell**. Er lädt keine `.env`-Dateien, damit nie unbemerkt eine falsche Datenbank verwendet wird. Sicherungen:

- `--target` ist Pflicht.
- `local` akzeptiert nur localhost. `staging` und `production` lehnen localhost ab und erzwingen TLS.
- `production` verlangt zusätzlich `--confirm-production`.
- Vor jeder Aktion zeigt der CLI Ziel, Host und Datenbank an, ohne Zugangsdaten. Auch Fehlermeldungen enthalten nie die URL.

Damit die URL nicht in der Shell-History landet:

```bash
read -rs DATABASE_URL && export DATABASE_URL   # URL aus dem Passwortmanager einfügen
pnpm db:migrate --target staging
unset DATABASE_URL
```

## Ablauf je Umgebung

**Schemaänderung (immer):**

1. `src/schema.ts` ändern.
2. `pnpm db:generate --name …` ausführen.
3. Die erzeugte SQL-Datei reviewen und committen.
4. Die CI prüft, dass Schema und Migrationen übereinstimmen (Schritt „Migrations match schema“).

Destruktive Änderungen (Spalte entfernen, umbenennen) laufen in zwei Schritten (expand → contract), damit die laufende App nie bricht.

**local:**

- Supabase CLI (`supabase start`, Postgres auf Port 54322) oder ein beliebiges lokales Postgres ab Version 15.
- `DATABASE_URL=postgres://postgres:postgres@localhost:54322/postgres pnpm db:migrate --target local`, danach `pnpm db:seed --target local`.

**staging:**

- Nach dem Merge nach `staging` und **vor** dem ersten Deployment, das das neue Schema braucht: `pnpm db:migrate --target staging`, falls nötig auch `pnpm db:seed --target staging`.
- Verwende dafür die Session-Pooler-URL des Staging-Projekts.

**production:**

- Erst wenn die Migration auf Staging gelaufen und abgenommen ist.
- Vorher prüfen, dass ein aktuelles Supabase-Backup existiert.
- Dann `pnpm db:migrate --target production --confirm-production` ausführen, danach `main` deployen.

Migrationen laufen nie automatisch beim App-Start oder Build.

## Seed

- `pnpm db:seed` schreibt die UNIQUE-PLACES-Stammdaten als Upsert in einer Transaktion.
- Der Seed ist idempotent: Beim zweiten Lauf ist `rows written` überall 0, auch `updated_at` bleibt unverändert.
- Er löscht nie etwas und verschiebt nie eine ID von einem anderen Tenant (Abbruch mit `SeedConflictError`).
- Die Apaleo-TEST-Property gehört nicht zum Seed.
