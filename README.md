# UNIQUE PLACES Guest App

Digitale Guest Experience Platform für Ferienapartments, Serviced Apartments und kleinere Hospitality-Betriebe.
Pilotkunde und erster Tenant: **UNIQUE PLACES**. Ziel-Domain: **`stay.unique-places.com`**.

> Dies ist **nicht** die bestehende Extras-App (`extras.unique-places.com`). Sie bleibt unverändert und wird zunächst nur verlinkt.

**Status:** Phase 8 – Zentraler Guest/Stay Context: STAY, GUIDE und EXPLORE beziehen Property, Unit und Reservierung aus derselben Guest Session ([ADR 0012](docs/adr/0012-guest-context.md)). Phase 7 – Sicherer Gastzugang: persönlicher Link (`/de/s/{token}`) und Login per Buchungsnummer + Nachname (`/de/login`) führen in dieselbe serverseitige Guest Session. STAY lädt damit die Reservierung des Gastes (Apaleo oder Mock). Ohne Session zeigt `/de/stay` im Modus `preview` weiter die Preview. Datenbank: Supabase PostgreSQL + Drizzle (Tenant → Property → Unit, External Mappings, Guest Access). GUIDE (`/de/guide`) und EXPLORE (`/de/explore`) laufen mit Mock-Inhalten. Design Lab: `/dev/ui` (nur local und staging).

## Schnellstart

Voraussetzungen: Node.js ≥ 22.12 (siehe `.nvmrc`), pnpm 10 (`corepack enable`).

```bash
pnpm install
cp apps/guest/.env.example apps/guest/.env.local
pnpm dev                      # http://localhost:3000 → /de/stay · Design Lab: /dev/ui · Health: /api/health
```

## Befehle

| Befehl                     | Zweck                                                  |
| -------------------------- | ------------------------------------------------------ |
| `pnpm dev`                 | Dev-Server aller Apps                                  |
| `pnpm typecheck`           | TypeScript (strict) in allen Packages                  |
| `pnpm lint`                | ESLint inkl. Architekturgrenzen                        |
| `pnpm test`                | Unit-Tests (Vitest)                                    |
| `pnpm build`               | Production Build (benötigt gültige Env-Variablen)      |
| `pnpm format`              | Prettier schreiben                                     |
| `pnpm format:check`        | Prettier prüfen                                        |
| `pnpm check`               | Alles wie in CI: Format, Typecheck, Lint, Tests, Build |
| `pnpm db:generate`         | Migration aus dem Drizzle-Schema erzeugen              |
| `pnpm db:migrate`          | Migrationen anwenden (explizit, siehe `packages/db`)   |
| `pnpm db:seed`             | Stammdaten UNIQUE PLACES idempotent einspielen         |
| `pnpm guest-access:create` | Test-Gastzugang anlegen, Link einmalig ausgeben        |
| `pnpm guest-access:revoke` | Gastzugänge einer Reservierung widerrufen              |

## Struktur

```
apps/
  guest/            Next.js Guest App (App Router)
packages/
  config/           Geteilte TypeScript- und ESLint-Konfiguration
  core/             Domain, Use Cases, Provider-Interfaces, Env-Validierung, Logger (framework-frei)
  ui/               Design Tokens, Primitives, Icons, Buttons
  db/               Drizzle-Schema, Migrationen, Repositories, Seeds
  integrations/     Provider-Adapter (Apaleo …)
docs/
  architecture.md   Freigegebener Architekturplan
  environments.md   local / staging / production, Deployment
  adr/              Architecture Decision Records
```

Abhängigkeitsregeln (per ESLint erzwungen):
`apps → ui, core, db, integrations` · `db → core` · `integrations → core` · `core → –` · `ui → –`

## Dokumentation

- [Architektur](docs/architecture.md)
- [Design System](docs/design-system.md)
- [Environments & Deployment](docs/environments.md)
- [Architecture Decision Records](docs/adr/) – u. a. [PMS-Provider & Apaleo](docs/adr/0008-pms-provider-apaleo.md), [Datenbank-Fundament](docs/adr/0010-database-foundation.md), [Gastzugang](docs/adr/0011-guest-access.md)
- [Datenbank: Migrationen & Seed](packages/db/README.md)
