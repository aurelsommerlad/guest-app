# @up/ui

Design tokens and central UI building blocks of the UNIQUE PLACES Guest App.
Specification and measurements: [docs/design-system.md](../../docs/design-system.md). Live view: `/dev/ui`.

```css
/* app stylesheet */
@import "tailwindcss";
@import "@up/ui/styles.css";
```

| Path                    | Content                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `src/styles/tokens.css` | **The only place with raw values** (colors, radii, widths, motion)                       |
| `src/styles/theme.css`  | Tailwind v4 theme: default theme removed, tokens as utilities, typography roles `type-*` |
| `src/styles/base.css`   | Body, focus ring, selection, reduced motion                                              |
| `src/primitives`        | `Text`, `Heading`, `Container`, `Stack`, `Surface`                                       |
| `src/icons`             | `Icon` + curated outline set (Lucide geometry, ISC)                                      |
| `src/components`        | `Button` / `buttonStyles`, `IconButton`                                                  |
| `src/tokens/catalog.ts` | Token names and roles for documentation (no values)                                      |

Rules:

- No HEX values or Tailwind arbitrary values outside `tokens.css` (enforced by `pnpm lint:tokens`).
- No domain types, no data access, no router dependency. Links use `buttonStyles()`.
- Tenant branding overrides `--up-*` custom properties at runtime.
