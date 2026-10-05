# UNIQUE PLACES Guest App

Digitale Guest Experience Platform für Ferienapartments, Serviced Apartments und kleinere Hospitality-Betriebe.
Pilotkunde und erster Tenant: **UNIQUE PLACES**. Ziel-Domain: **`stay.unique-places.com`**.

> Dies ist **nicht** die bestehende Extras-App (`extras.unique-places.com`). Sie bleibt unverändert und wird zunächst nur verlinkt.

**Status:** Phase 2 – STAY-Startscreen mit Mock-Daten unter `/de/stay` (bzw. `/en/stay`). Noch keine Anbindung an Datenbank, Apaleo oder Gastzugang. Design Lab: `/dev/ui` (nur local und staging).

## Schnellstart

Voraussetzungen: Node.js ≥ 22.12 (siehe `.nvmrc`), pnpm 10 (`corepack enable`).

```bash
pnpm install
cp apps/guest/.env.example apps/guest/.env.local
pnpm dev                      # http://localhost:3000 → /de/stay · Design Lab: /dev/ui · Health: /api/health
```

## Befehle

| Befehl              | Zweck                                                  |
| ------------------- | ------------------------------------------------------ |
| `pnpm dev`          | Dev-Server aller Apps                                  |
| `pnpm typecheck`    | TypeScript (strict) in allen Packages                  |
| `pnpm lint`         | ESLint inkl. Architekturgrenzen                        |
| `pnpm test`         | Unit-Tests (Vitest)                                    |
| `pnpm build`        | Production Build (benötigt gültige Env-Variablen)      |
| `pnpm format`       | Prettier schreiben                                     |
| `pnpm format:check` | Prettier prüfen                                        |
| `pnpm check`        | Alles wie in CI: Format, Typecheck, Lint, Tests, Build |

## Struktur

```
apps/
  guest/            Next.js Guest App (App Router)
packages/
  config/           Geteilte TypeScript- und ESLint-Konfiguration
  core/             Domain, Use Cases, Provider-Interfaces, Env-Validierung, Logger (framework-frei)
  ui/               Design Tokens, Primitives, Icons, Buttons
  db/               Drizzle-Schema, Repositories, Seeds   (Phase 3)
  integrations/     Provider-Adapter (Apaleo …)           (Phase 4)
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
- [Architecture Decision Records](docs/adr/)
