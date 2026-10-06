# @up/db

Drizzle-Schema, versionierte Migrationen, Seeds und **tenant-scoped Repositories** für Supabase PostgreSQL. Entscheidung und Begründung: [ADR 0010](../../docs/adr/0010-database-foundation.md).

Regeln:

- Nur serverseitig. Nie in Client-Komponenten importieren (`@up/ui` darf `@up/db` per ESLint-Grenze nicht importieren).
- Jede tenant-bezogene Tabelle hat `tenant_id NOT NULL`. Kind-Tabellen referenzieren `(tenant_id, id)`.
- Repositories verlangen einen `TenantContext`. Apps führen keine rohen Queries aus.
- Migrationen werden generiert, reviewt und committet. Es gibt **nie** `drizzle-kit push`.

## Inhalt

| Datei                                                                   | Zweck                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/schema.ts`                                                         | Tabellen `tenants`, `properties`, `units`, `external_mappings`, `guest_access`, `guest_sessions`, `rate_limit_buckets`, `guide_sections`, `admin_users`, `admin_sessions`, `explore_places`, `explore_place_properties` |
| `drizzle/`                                                              | generierte SQL-Migrationen (+ `0001`/`0005`/`0007` custom: Supabase Data API sperren)                                                                                                                                   |
| `src/client.ts`                                                         | `createDatabase(url)`: postgres.js, `prepare: false`, TLS außerhalb localhost                                                                                                                                           |
| `src/repositories/tenancy-repository.ts`                                | `getTenantBySlug`, `getPropertyById/BySlug`, `getUnitsForProperty`, `resolveExternalMapping`                                                                                                                            |
| `src/repositories/guest-access-repository.ts`                           | Guest Access und Sessions (nur Hashes), Widerruf ([ADR 0011](../../docs/adr/0011-guest-access.md))                                                                                                                      |
| `src/repositories/rate-limit-repository.ts`                             | atomare Rate-Limit-Zähler (festes Fenster)                                                                                                                                                                              |
| `src/repositories/guide-repository.ts`                                  | GUIDE-Themen und -Varianten lesen/schreiben, Status, Sortierung ([ADR 0013](../../docs/adr/0013-guide-content-management.md))                                                                                           |
| `src/repositories/explore-repository.ts`                                | EXPLORE-Empfehlungen und Objekt-Zuordnung, Status, Sortierung ([ADR 0015](../../docs/adr/0015-explore-content-management.md))                                                                                           |
| `src/repositories/admin-repository.ts`                                  | Admin-Konten und -Sessions (nur Hashes) ([ADR 0014](../../docs/adr/0014-admin-app-and-auth.md))                                                                                                                         |
| `src/seed/preview-fixtures.ts`                                          | Apaleo-TEST-Property für local/staging (`--with-preview-fixtures`, nie Production)                                                                                                                                      |
| `src/seed/guide-fixtures.ts`                                            | HØV-Beispielinhalte für GUIDE, nur lokal und in Tests (`--with-guide-fixtures`)                                                                                                                                         |
| `src/seed/explore-fixtures.ts`                                          | fiktive EXPLORE-Beispielorte, nur lokal und in Tests (`--with-explore-fixtures`)                                                                                                                                        |
| `src/repositories/registration-repository.ts` / `journey-repository.ts` | Online-Check-in inkl. Vorbefüllung (`seedRegistrationGuests`), Belegungsabgleich (`syncRegistrationOccupancy`), Herkunft `prefilled_fields`, Sync-Zeilen, Journey-Einstellungen, Schlüsselbox-Codes (ADR 0016/0017)     |
| `src/seed/journey-fixtures.ts`                                          | Beispiel-Check-in-/Zugangskonfiguration für HØV (+ verschlüsselter Beispielcode mit `ACCESS_CODE_KEY`), nur lokal (`--with-journey-fixtures`)                                                                           |
| `src/seed/unique-places.ts`                                             | Stammdaten Tenant UNIQUE PLACES (4 Properties, 8 HØV-Units, 12 Apaleo-Mappings)                                                                                                                                         |
| `src/seed/seed-tenant.ts`                                               | idempotenter Upsert in einer Transaktion                                                                                                                                                                                |
| `src/cli/db.ts`                                                         | expliziter CLI für `migrate` und `seed` mit Ziel-Absicherung                                                                                                                                                            |
| `src/testing/test-database.ts`                                          | PGlite (In-Memory-Postgres) für Tests, auch als `@up/db/testing` für die App                                                                                                                                            |
| `src/postgres-driver.test.ts`                                           | dieselben Repositories über postgres.js (Wire-Protokoll, PGlite-Socket)                                                                                                                                                 |

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
                               [--with-preview-fixtures]   # Apaleo TEST, nie Production
                               [--with-guide-fixtures]     # GUIDE-Beispielinhalte, nur --target local
                               [--with-explore-fixtures]   # EXPLORE-Beispielorte, nur --target local
                               [--with-journey-fixtures]   # Beispiel-Check-in/Zugang, nur --target local
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
- EXPLORE-Inhalte gehören ebenso wenig zum Seed: `--with-explore-fixtures` spielt fiktive Beispielorte nur lokal ein.
- Check-in-Konfiguration und Schlüsselbox-Codes ebenso: `--with-journey-fixtures` nur lokal; in Staging/Production werden sie pro Objekt bewusst gepflegt (ADR 0016/0017).
- GUIDE-Inhalte gehören nicht zum Seed. `--with-guide-fixtures` spielt Beispielinhalte nur lokal ein (bei anderen Zielen bricht der CLI ab); in Staging und Production entstehen GUIDE-Inhalte ausschließlich über die Admin App.
