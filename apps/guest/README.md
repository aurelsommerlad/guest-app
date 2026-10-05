# @up/guest

The UNIQUE PLACES Guest App (target domain: `stay.unique-places.com`).

```bash
cp .env.example .env.local
pnpm dev            # http://localhost:3000 → /de/stay
```

## Routes

| Route                        | Content                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `/`                          | Redirect to `/de/stay` (until guest access exists)                                                   |
| `/{de,en}/stay`              | STAY home: guest session's stay, else preview (mode `preview`) or redirect to login (mode `secured`) |
| `/{de,en}/s/{token}`         | Personal guest link → session cookie → 303 to `/stay` (ADR 0011)                                     |
| `/{de,en}/login`             | Booking number + last name → same guest session                                                      |
| `/{de,en}/link-invalid`      | Neutral page for every unusable link                                                                 |
| `/{de,en}/guide`, `/explore` | GUIDE and EXPLORE (mock content)                                                                     |
| `/{de,en}/extras`            | Placeholder                                                                                          |
| `/dev/ui`                    | Design Lab (local/staging only, 404 in production)                                                   |
| `/api/health`                | Health check                                                                                         |

## Structure

- `src/app/[locale]`: root layout per locale (`<html lang>` from `next/root-params`), guest shell with bottom navigation
- `src/features/stay`: view model (`model.ts`, `build-stay-view-model.ts`), data access (`get-stay.ts`), screen components
- `src/features/guest-access`: guest access use cases (`guest-access-service.ts`: link, login, session), rate limit, session cookie, entry response, login action/form
- `src/server`: server-only singletons (`database.ts`, `pms.ts`, `logger.ts`)
- `scripts/guest-access.ts`: CLI `pnpm guest-access:create|revoke` (development/test links)
- `src/features/guest-context`: the central guest context (ADR 0012) – session → property/unit/reservation for every section; development preview only outside production
- `src/features/explore`: EXPLORE view models, resolver, place actions, data access, filter UI
- `src/features/guide`: GUIDE view models, resolver (content → locale), data access, block renderer
- `src/components/GuestHeader.tsx`: `BrandHeader` (section start pages) and `BackHeader` (detail pages)
- `src/mocks/stay`, `src/mocks/guide`, `src/mocks/explore`, `src/mocks/content`: mock data and placeholder photos. Replace with real data and photos without touching components.
- `src/i18n` + `messages/*.json`: next-intl (UI strings). Content translations live in the data (`LocalizedText`).
- `src/env`: Zod-validated environment (`server.ts` server-only, `client.ts` public variables only)
- `src/instrumentation.ts`: startup hook (env check, later error monitoring)
- `vercel.json`: region `fra1` (Frankfurt)
