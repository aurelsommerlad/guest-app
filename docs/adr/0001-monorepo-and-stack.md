# 0001 – Monorepo und Tech Stack

**Status:** Akzeptiert (2026-10-05)

## Kontext

Die Guest App ist der Start. Später folgen ein Content-Editor bzw. eine Admin-App und weitere Integrationen. Die Guest App darf nicht zum untrennbaren Monolithen werden, gleichzeitig wollen wir keine unnötige Infrastruktur.

## Entscheidung

- **pnpm Workspaces + Turborepo** mit `apps/guest` und den Packages `config`, `core`, `ui`, `db`, `integrations`.
- Packages liefern **TypeScript-Quellen ohne eigenen Build** aus, die Next.js über `transpilePackages` kompiliert.
- Architekturgrenzen werden per ESLint (`no-restricted-imports`) erzwungen. Es braucht kein zusätzliches Plugin.
- **Stack:** Next.js (App Router), React, TypeScript strict, Vercel (`fra1`), Supabase PostgreSQL (EU), Drizzle ORM/Kit, Tailwind CSS v4, next-intl, Zod, Vitest.
- **TypeScript 6.0** statt 7.x, weil `typescript-eslint` (Typed Linting) aktuell nur `< 6.1` unterstützt.
- **ESLint 9** statt 10, weil die Plugins in `eslint-config-next` ESLint 10 noch nicht vollständig unterstützen.
- Ein Upgrade folgt, sobald das Ökosystem es unterstützt.

## Konsequenzen

- Eine Admin-App ist später nur ein weiterer Ordner unter `apps/` und nutzt dieselben Packages.
- Kein Publish- oder Build-Schritt für Packages. Das ist einfach, aber die Packages sind nur innerhalb des Monorepos nutzbar, was gewollt ist.
- Supabase wird als Standard-Postgres genutzt. Ein Anbieterwechsel bleibt möglich.
