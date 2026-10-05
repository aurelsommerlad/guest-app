# 0010 – Datenbank-Fundament: Tenant → Property → Unit

**Status:** Akzeptiert (2026-10-05, Phase 6). Präzisiert [ADR 0002](0002-tenant-isolation.md). Ersetzt die Regel „UUIDs als IDs“ aus `architecture.md` §5 für Stammdaten.

## Kontext

Bisher liegen Properties und Units als typisierte Registry im Code (`apps/guest/src/config/properties.ts`). GUIDE- und EXPLORE-Inhalte referenzieren deren IDs (`hov`, `ros`). Die Apaleo-IDs (`ALTUS`, `ALTUS-SWA`) sind dort pro Eintrag hinterlegt. Für Gastzugang, Content-Editor und Sync brauchen wir eine persistente, mandantenfähige Grundlage. Die App soll in dieser Phase aber noch nicht umgestellt werden.

## Entscheidung

**Technik:**

- Supabase wird ausschließlich als PostgreSQL genutzt, ohne Supabase Auth und ohne Supabase-Client im Browser.
- Drizzle ORM nutzt den Treiber postgres.js. Drizzle Kit erzeugt die Migrationen.
- Alle Zugriffe laufen serverseitig über `@up/db`.

**Tabellen:**

- `tenants`
- `properties`
- `units`
- `external_mappings`

Mehr gibt es in dieser Phase nicht.

**IDs:**

- Primärschlüssel sind eigene, stabile, unveränderliche **Text-IDs**. Das Format ist `^[a-z0-9][a-z0-9-]{0,63}$`, geprüft per Check-Constraint und in `@up/core`.
- Die bestehenden IDs werden übernommen: `unique-places`, `hov`, `huesle`, `alpila`, `laeke`, `khu` … `space`. Bestehende Content-Scopes bleiben dadurch gültig, ohne Übersetzungstabelle.
- Neue Entitäten bekommen später generierte IDs. Weil die IDs global eindeutig sind, kann eine ID nie zweideutig zwischen Tenants sein.
- Slugs sind für URLs gedacht und dürfen sich ändern. Eindeutig sind sie pro Tenant (Properties) bzw. pro Property (Units). Referenzen nutzen immer IDs.
- Apaleo-IDs sind nie Primärschlüssel.

**Integrität:**

- `tenant_id NOT NULL` überall.
- Units referenzieren `(tenant_id, property_id)` → `properties(tenant_id, id)`. Eine Unit kann damit strukturell nie an einer Property eines anderen Tenants hängen.
- Löschen ist `RESTRICT`. Deaktiviert wird über `is_active`.

**Externe Identitäten:**

- Dafür gibt es die generische Tabelle `external_mappings`, mit den Spalten `tenant_id`, `provider`, `entity_type`, `internal_entity_id` und `external_id`. Anbieter-Spalten in `properties` oder `units` gibt es nicht.
- Erlaubte Werte, jeweils per Check-Constraint und als Konstante in `@up/core`:
  - `provider`: `apaleo`
  - `entity_type`: `property`, `unit`
- Zwei Unique-Constraints sorgen für Eindeutigkeit:
  1. `(tenant_id, provider, entity_type, external_id)`: Eine externe ID löst genau eine interne Entität auf.
  2. `(tenant_id, provider, entity_type, internal_entity_id)`: Eine Entität hat höchstens eine ID pro Anbieter.
- `internal_entity_id` ist polymorph. Zwei generierte Spalten (`property_id`, `unit_id`) tragen deshalb echte, tenant-konsistente Fremdschlüssel. Ein Mapping auf eine fremde oder nicht existierende Entität ist damit unmöglich.
- Externe IDs werden exakt verglichen, ohne Namenszuordnung.

**Repository-Layer:**

- Funktionen: `getTenantBySlug`, `getPropertyById`, `getPropertyBySlug`, `getUnitsForProperty`, `resolveExternalMapping`.
- Alle außer `getTenantBySlug` verlangen einen `TenantContext` und filtern in SQL nach `tenant_id`.
- Unbekannte oder ungültige IDs ergeben `undefined` bzw. `[]`. Ungültige Provider- oder EntityType-Werte werfen einen Fehler.
- Es gibt keine generische CRUD-Schicht.

**RLS:**

- Auf allen Tabellen ist RLS **ohne Policies** aktiv. Zusätzlich hat Migration `0001` alle Rechte der Supabase-Rollen `anon` und `authenticated` entzogen, auch für künftige Tabellen.
- Die App verbindet sich als Tabelleneigentümer, umgeht RLS also bewusst. Die Isolation erzwingen Repository und Schema (siehe „Zugriffswege“).
- Tenant-Policies werden erst mit echten Endnutzer-Identitäten (Admin bzw. Login) gebaut. Vorher hätten sie nichts zu prüfen und wären Security-Theater.

**TEST-Property:**

- Die Apaleo-Property „TEST“ ist **keine** Stammdate von UNIQUE PLACES und wird nicht geseedet.
- Sie bleibt Preview-Fixture in der Code-Registry (`testOnly`), solange STAY im Preview-Modus läuft.
- Mit dem Gastzugang entscheiden wir neu, ob es dafür ein eigenes, in Production gesperrtes Fixture-Seed gibt.

**Übergang:**

- Die App liest weiter die Registry.
- Ein Konsistenztest (`apps/guest/src/config/properties.test.ts`) erzwingt, dass Registry und Seed identisch sind. So entstehen keine zwei konkurrierenden Modelle.
- Die Registry wird in der Migrationsphase entfernt.

## Zugriffswege und Isolation

| Zugriffsweg                                           | Rolle                       | Isolation                                                                       |
| ----------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| Guest App (Vercel, serverseitig), ab Folgephase       | `postgres` über Pooler      | Repository: `TenantContext` Pflicht, SQL-Filter; Schema: zusammengesetzte FKs   |
| CLI `db:migrate` / `db:seed` (Entwickler bzw. CI)     | `postgres` (Session Pooler) | explizites `--target`, Localhost-Prüfung, `--confirm-production`                |
| Supabase Data API (PostgREST, `anon`/`authenticated`) | –                           | gesperrt: RLS ohne Policies und `REVOKE ALL`                                    |
| Supabase Dashboard / SQL-Editor                       | Projektmitglieder           | organisatorisch: wenige Personen, getrennte Projekte für Staging und Production |
| Browser                                               | –                           | kein Zugriff, keine Credentials, kein Supabase-Client                           |

## Spätere RLS-Strategie (mit Admin bzw. Login)

1. Eine eigene Rolle `app_user` ohne `BYPASSRLS` und ohne Tabelleneigentum ersetzt `postgres` für die App. `postgres` bleibt für Migrationen.
2. Pro Request bzw. Transaktion: `SET LOCAL app.tenant_id = '<id>'`, im Repository zentral gekapselt.
3. Policies `USING (tenant_id = current_setting('app.tenant_id'))` für alle tenant-bezogenen Tabellen. Admin-Rechte kommen über eine `memberships`-Tabelle dazu.
4. Integrationstests gegen echtes Postgres prüfen, dass ohne gesetzten Kontext 0 Zeilen sichtbar sind.

## Konsequenzen

- Bestehende Content-Referenzen bleiben stabil. Datenbank und Code sprechen dieselben IDs.
- Text-IDs müssen global eindeutig sein. Für weitere Tenants werden IDs generiert, nicht frei gewählt.
- Ein neuer Anbieter (z. B. Nuki) braucht nur eine Migration, die den Check-Constraint und die Konstante erweitert. Eine neue Spalte ist nicht nötig.
- Ein Tenant mit mehreren Apaleo-Accounts ist noch nicht abgebildet. Dafür würde `external_mappings` um eine Verbindungs-ID erweitert.
