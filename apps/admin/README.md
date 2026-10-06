# @up/admin

Admin App von UNIQUE PLACES: zentrales Backend für die Pflege der Guest App. Enthalten sind die Bereiche **GUIDE** (Phase 9) und **EXPLORE** (Phase 10). Entscheidungen: [ADR 0014](../../docs/adr/0014-admin-app-and-auth.md) (App, Login) und [ADR 0013](../../docs/adr/0013-guide-content-management.md) (Inhalte, Medien).

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

| Pfad                            | Zweck                                                                       |
| ------------------------------- | --------------------------------------------------------------------------- |
| `src/navigation.ts`             | Modul-Registry: Gruppen, URLs, Property Context (neue Module hier ergänzen) |
| `src/features/property-context` | Property Selector, Context-Provider, Tenant-Properties                      |
| `src/components/AdminShell.tsx` | Layout mit Seitennavigation                                                 |
| `src/features/auth/`            | Login, Sessions, `/setup`, Rate Limits                                      |
| `src/features/guide/`           | GUIDE-Service, Server Actions, Editoren                                     |
| `src/server/media-storage.ts`   | signierter Direkt-Upload: Pfad, Token, Prüfung des gespeicherten Bildes     |
| `scripts/admin-user.ts`         | CLI zum Anlegen eines Admin-Kontos                                          |

## EXPLORE pflegen

- **Explore** (Sidebar) zeigt bei „Alle Objekte“ (`/explore`) alle Empfehlungen mit ihrer Objekt-Zuordnung, bei einem Objekt (`/explore/hov`) dessen Empfehlungen in Gast-Reihenfolge.
- Filter: Status-Tabs, Kategorie, Objekt (nur bei „Alle Objekte“, inkl. „Ohne Objekt-Zuordnung“), Suche über Titel, Beschreibung und Ort.
- **Empfehlung hinzufügen:** Titel, Kategorie, Kurzbeschreibung, Objekte – danach im Editor Beschreibung, Unser Tipp, Titelbild, Ort & Kontakt, Highlight.
- Gäste sehen nur veröffentlichte Empfehlungen, die ihrem Objekt zugeordnet sind.

## GUIDE pflegen

- **Guide** (Sidebar) mit gewähltem Objekt im Property Selector, z. B. `/guide/hov`, listet die Themen in Gast-Reihenfolge (↑/↓ zum Sortieren), mit Status und Varianten. Bei „Alle Objekte“ (`/guide`) wählst Du zuerst das Objekt.
- **Neues Thema:** für das gesamte Objekt oder ein einzelnes Apartment. Key und Slug werden aus dem Titel erzeugt.
- **Inhalt:** Intro, Titelbild und Blöcke (Überschrift, Absatz, Liste, Hinweis, Link, Bild), jeweils Deutsch und Englisch.
- **Variante für ein Apartment:** bei Objekt-Themen; startet als Kopie des allgemeinen Inhalts und ersetzt für Gäste dieses Apartments nur den Inhalt.
- **Status:** Entwurf (nicht öffentlich) → Veröffentlicht (sofort live, auch jede weitere Speicherung) → Archiviert (nicht öffentlich). Nie veröffentlichte Einträge können gelöscht werden.

Typ-spezifische Editoren (z. B. WLAN) können später als eigene Komponenten auf denselben Blöcken aufsetzen; der Block-Editor (`ContentEditor`) bleibt davon getrennt.
