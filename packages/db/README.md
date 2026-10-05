# @up/db

Drizzle ORM schema, migrations (Drizzle Kit), seeds and **tenant-scoped repositories**.

Rules:

- Every tenant-related table has `tenant_id NOT NULL` and composite foreign keys `(tenant_id, id)`.
- Repositories require a `TenantContext`. Apps never run raw queries.
- Server-only. Never import into client components.

Status: empty, built in **Phase 3**. Drizzle is installed only then.
