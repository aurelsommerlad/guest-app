# @up/admin

Admin App von UNIQUE PLACES: zentrales Backend für die Pflege der Guest App. Phase 9 enthält nur den Bereich **GUIDE**. Entscheidungen: [ADR 0014](../../docs/adr/0014-admin-app-and-auth.md) (App, Login) und [ADR 0013](../../docs/adr/0013-guide-content-management.md) (Inhalte, Medien).

## Lokal starten

```bash
cp apps/admin/.env.example apps/admin/.env.local     # DATABASE_URL auf die lokale DB setzen
DATABASE_URL=… pnpm db:migrate --target local
DATABASE_URL=… pnpm db:seed --target local --with-guide-fixtures   # optional: HØV-Fixtures
pnpm --filter @up/admin dev                          # http://localhost:3001
```

Erstes Konto lokal: entweder `ADMIN_SETUP_TOKEN` in `.env.local` setzen und `/setup` öffnen oder per CLI:

```bash
read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD     # mindestens 12 Zeichen
DATABASE_URL=… pnpm admin-user:create --target local --tenant unique-places --email name@example.com
unset ADMIN_PASSWORD
```

Für `staging`/`production` gelten dieselben Ziel-Sicherungen wie bei `pnpm db:migrate` (`--target`, TLS, `--confirm-production`).

## Aufbau

| Pfad                            | Zweck                                                                      |
| ------------------------------- | -------------------------------------------------------------------------- |
| `src/navigation.ts`             | Registry der Hauptbereiche und Property-Module (neue Module hier ergänzen) |
| `src/components/AdminShell.tsx` | Layout mit Seitennavigation                                                |
| `src/features/auth/`            | Login, Sessions, `/setup`, Rate Limits                                     |
| `src/features/guide/`           | GUIDE-Service, Server Actions, Editoren                                    |
| `src/server/media-storage.ts`   | serverseitiger Upload nach Supabase Storage                                |
| `scripts/admin-user.ts`         | CLI zum Anlegen eines Admin-Kontos                                         |

## GUIDE pflegen

- **Objekte → Property → Guide** listet die Themen in Gast-Reihenfolge (↑/↓ zum Sortieren), mit Status und Varianten.
- **Neues Thema:** für das gesamte Objekt oder ein einzelnes Apartment. Key und Slug werden aus dem Titel erzeugt.
- **Inhalt:** Intro, Titelbild und Blöcke (Überschrift, Absatz, Liste, Hinweis, Link, Bild), jeweils Deutsch und Englisch.
- **Variante für ein Apartment:** bei Objekt-Themen; startet als Kopie des allgemeinen Inhalts und ersetzt für Gäste dieses Apartments nur den Inhalt.
- **Status:** Entwurf (nicht öffentlich) → Veröffentlicht (sofort live, auch jede weitere Speicherung) → Archiviert (nicht öffentlich). Nie veröffentlichte Einträge können gelöscht werden.

Typ-spezifische Editoren (z. B. WLAN) können später als eigene Komponenten auf denselben Blöcken aufsetzen; der Block-Editor (`ContentEditor`) bleibt davon getrennt.
