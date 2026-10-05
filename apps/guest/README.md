# @up/guest

The UNIQUE PLACES Guest App (target domain: `stay.unique-places.com`).

```bash
cp .env.example .env.local
pnpm dev            # http://localhost:3000
```

- `src/env`: Zod-validated environment (`server.ts` server-only, `client.ts` public variables only)
- `src/instrumentation.ts`: startup hook (env check, later error monitoring)
- `src/app/api/health`: health check for deployments
- `vercel.json`: region `fra1` (Frankfurt)
