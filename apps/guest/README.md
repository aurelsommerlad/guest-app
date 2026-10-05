# @up/guest

The UNIQUE PLACES Guest App (target domain: `stay.unique-places.com`).

```bash
cp .env.example .env.local
pnpm dev            # http://localhost:3000 → /de/stay
```

## Routes

| Route                                   | Content                                            |
| --------------------------------------- | -------------------------------------------------- |
| `/`                                     | Redirect to `/de/stay` (until guest access exists) |
| `/{de,en}/stay`                         | STAY home (Phase 2, mock data)                     |
| `/{de,en}/guide`, `/extras`, `/explore` | Placeholders, built in later phases                |
| `/dev/ui`                               | Design Lab (local/staging only, 404 in production) |
| `/api/health`                           | Health check                                       |

## Structure

- `src/app/[locale]`: root layout per locale (`<html lang>` from `next/root-params`), guest shell with bottom navigation
- `src/features/stay`: view model (`model.ts`, `build-stay-view-model.ts`), data access (`get-stay.ts`), screen components
- `src/features/guest-context.ts`: guest context for content sections (property/unit, time) – mock until guest access
- `src/features/explore`: EXPLORE view models, resolver, place actions, data access, filter UI
- `src/features/guide`: GUIDE view models, resolver (content → locale), data access, block renderer
- `src/components/GuestHeader.tsx`: `BrandHeader` (section start pages) and `BackHeader` (detail pages)
- `src/mocks/stay`, `src/mocks/guide`, `src/mocks/explore`, `src/mocks/content`: mock data and placeholder photos. Replace with real data and photos without touching components.
- `src/i18n` + `messages/*.json`: next-intl (UI strings). Content translations live in the data (`LocalizedText`).
- `src/env`: Zod-validated environment (`server.ts` server-only, `client.ts` public variables only)
- `src/instrumentation.ts`: startup hook (env check, later error monitoring)
- `vercel.json`: region `fra1` (Frankfurt)
