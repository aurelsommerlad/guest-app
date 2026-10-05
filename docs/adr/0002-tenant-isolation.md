# 0002 – Tenant-Isolation

**Status:** Akzeptiert (2026-10-05). Umsetzung ab Phase 3.

## Kontext

UNIQUE PLACES ist der einzige Tenant, die Software soll aber ohne Umbau mandantenfähig werden. Ein Datenleck zwischen Betreibern wäre geschäftskritisch und ein DSGVO-Vorfall.

## Entscheidung

Isolation in drei Schichten:

1. **Anwendung:** Alle Zugriffe laufen über Repositories in `@up/db`, die einen `TenantContext` als Pflichtparameter verlangen.
2. **Schema:** `tenant_id NOT NULL` in jeder tenant-bezogenen Tabelle, zusammengesetzte Fremdschlüssel `(tenant_id, id)`, eindeutige Indizes pro Tenant.
3. **Postgres RLS:**
   - Sofort: „deny all“ für die Supabase-Rollen `anon` und `authenticated`. Die öffentliche Supabase-API ist damit dicht.
   - Tenant-Policies über `app.tenant_id` werden vorbereitet und spätestens mit Content-Editor bzw. Admin oder dem 2. Tenant aktiviert.

Tenant-Auflösung über das Gast-Token oder den Host (`tenant_domains`). Bei Widerspruch wird der Zugriff verweigert.

## Konsequenzen

- Etwas mehr Schema-Disziplin, dafür kann die Datenbank Fremdreferenzen strukturell verhindern.
- Pflicht-Integrationstests mit zwei Tenants in der CI.
