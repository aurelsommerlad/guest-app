-- W — Migrationen 0019–0022 (M3, M4, Konfigurationsparität, Nachtrag) für Supabase Staging
-- Unveränderte Drizzle-Migrationen 0019_service_engine_m3, 0020_requests_slack_m4,
-- 0021_extras_texts_parity und 0022_history_decisions_sort (packages/db/drizzle) in
-- Journal-Reihenfolge, in einer Transaktion. Nur Struktur, keine Daten werden geändert oder
-- gelöscht (neue Tabelle service_locks, neue Spalten, sort_order integer → double precision,
-- angepasste Prüfregeln). Danach – wie der Drizzle-Migrator – Einträge in
-- drizzle.__drizzle_migrations, damit spätere `pnpm db:migrate`-Läufe sie überspringen.
-- Voraussetzung: 0018 ist eingetragen (V-migration-0018.sql). Ein zweiter Lauf bricht ab.
-- Nur Staging – nie Production.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = 1794163263673) THEN
    RAISE EXCEPTION 'Migration 0018_extras_migration_m1 fehlt – zuerst V-migration-0018.sql ausführen';
  END IF;
  IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at >= 1794171589407) THEN
    RAISE EXCEPTION 'Migration(en) ab 0019 sind bereits eingetragen – nichts zu tun';
  END IF;
END
$$;
-- ════ 0019_service_engine_m3.sql ════
CREATE TABLE "service_locks" (
	"tenant_id" text NOT NULL,
	"lock_key" text NOT NULL,
	"holder" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_locks_pkey" PRIMARY KEY("tenant_id","lock_key"),
	CONSTRAINT "service_locks_values_valid" CHECK ("service_locks"."lock_key" ~ '^[A-Za-z0-9_:.-]{1,200}$' AND char_length("service_locks"."holder") BETWEEN 1 AND 100)
);

ALTER TABLE "service_locks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "apaleo_write_operations" DROP CONSTRAINT "apaleo_write_operations_operation_valid";
ALTER TABLE "service_locks" ADD CONSTRAINT "service_locks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "service_locks_expires_idx" ON "service_locks" USING btree ("expires_at");
ALTER TABLE "apaleo_write_operations" ADD CONSTRAINT "apaleo_write_operations_operation_valid" CHECK ("apaleo_write_operations"."operation" IN ('book-service', 'amend-occupancy', 'amend-stay', 'move-service', 'update-vehicle', 'append-comment'));

-- ════ 0020_requests_slack_m4.sql ════
ALTER TABLE "notification_outbox" DROP CONSTRAINT "notification_outbox_values_valid";
ALTER TABLE "notification_outbox" ADD COLUMN "delivery_mode" text;
ALTER TABLE "offer_requests" ADD COLUMN "idempotency_key" text;
ALTER TABLE "offer_requests" ADD COLUMN "decision_reason" text;
ALTER TABLE "property_service_settings" ADD COLUMN "slack_decision_updates" boolean DEFAULT false NOT NULL;
CREATE UNIQUE INDEX "offer_requests_idempotency_idx" ON "offer_requests" USING btree ("tenant_id","idempotency_key");
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_values_valid" CHECK ("notification_outbox"."template" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' AND char_length("notification_outbox"."template") <= 80
        AND "notification_outbox"."dedup_key" ~ '^[A-Za-z0-9_:.-]{1,200}$'
        AND "notification_outbox"."attempts" BETWEEN 0 AND 50
        AND ("notification_outbox"."last_error_code" IS NULL OR "notification_outbox"."last_error_code" ~ '^[a-z0-9_]{1,60}$')
        AND ("notification_outbox"."property_id" IS NULL OR "notification_outbox"."property_id" ~ '^[a-z0-9][a-z0-9-]{0,63}$')
        AND jsonb_typeof("notification_outbox"."payload") = 'object' AND pg_column_size("notification_outbox"."payload") <= 16384
        AND (("notification_outbox"."status" = 'sent') = ("notification_outbox"."sent_at" IS NOT NULL))
        AND ("notification_outbox"."delivery_mode" IS NULL OR "notification_outbox"."delivery_mode" IN ('simulated', 'live')));
ALTER TABLE "offer_requests" ADD CONSTRAINT "offer_requests_m4_values_valid" CHECK (("offer_requests"."idempotency_key" IS NULL OR "offer_requests"."idempotency_key" ~ '^[A-Za-z0-9_:.-]{8,200}$')
        AND ("offer_requests"."decision_reason" IS NULL OR (char_length("offer_requests"."decision_reason") BETWEEN 1 AND 500 AND "offer_requests"."decision_reason" !~ '[<>]')));

-- ════ 0021_extras_texts_parity.sql ════
ALTER TABLE "offer_properties" ADD COLUMN "extras_texts" jsonb;
ALTER TABLE "offer_properties" ADD CONSTRAINT "offer_properties_extras_texts_valid" CHECK ("offer_properties"."extras_texts" IS NULL OR (jsonb_typeof("offer_properties"."extras_texts") = 'object'
        AND pg_column_size("offer_properties"."extras_texts") <= 16384));

-- ════ 0022_history_decisions_sort.sql ════
ALTER TABLE "offer_requests" DROP CONSTRAINT "offer_requests_values_valid";
ALTER TABLE "offer_properties" ALTER COLUMN "sort_order" SET DATA TYPE double precision;
ALTER TABLE "offer_requests" ADD COLUMN "handled_by_external" text;
ALTER TABLE "offer_requests" ADD COLUMN "service_name_snapshot" text;
ALTER TABLE "offer_properties" ADD CONSTRAINT "offer_properties_sort_order_valid" CHECK ("offer_properties"."sort_order" BETWEEN -1000000000 AND 1000000000);
ALTER TABLE "offer_requests" ADD CONSTRAINT "offer_requests_values_valid" CHECK (("offer_requests"."people" IS NULL OR "offer_requests"."people" BETWEEN 1 AND 50)
        AND ("offer_requests"."requested_time" IS NULL OR "offer_requests"."requested_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
        AND ("offer_requests"."note" IS NULL OR (char_length("offer_requests"."note") <= 500 AND "offer_requests"."note" !~ '[<>]'))
        AND ("offer_requests"."quoted_cents" IS NULL OR "offer_requests"."quoted_cents" >= 0)
        AND ("offer_requests"."currency" IS NULL OR "offer_requests"."currency" ~ '^[A-Z]{3}$')
        AND (("offer_requests"."handled_at" IS NULL) = ("offer_requests"."handled_by" IS NULL AND "offer_requests"."handled_by_external" IS NULL))
        AND ("offer_requests"."handled_by" IS NULL OR "offer_requests"."handled_by_external" IS NULL)
        AND ("offer_requests"."handled_by_external" IS NULL OR "offer_requests"."handled_by_external" ~ '^[A-Za-z0-9 ._:()-]{1,80}$')
        AND ("offer_requests"."service_name_snapshot" IS NULL OR (char_length("offer_requests"."service_name_snapshot") BETWEEN 1 AND 200 AND "offer_requests"."service_name_snapshot" !~ '[<>]')));

-- Keep the Supabase Data API closed for the new table (second layer besides RLS).
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.service_locks FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;

-- ════ Drizzle-Migrationstabelle ════
SELECT setval(pg_get_serial_sequence('drizzle.__drizzle_migrations', 'id'),
  (SELECT max(id) FROM drizzle.__drizzle_migrations));
INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES
  ('701a7b28e6bfcef0c6ec2803be17bac18eb918c25bf41f951549d4ca39535265', 1794171589407),
  ('7901500b67f09e60661a7c5a14c6a49a1b1573b61b6158c7e25248804421d2bd', 1794180964208),
  ('3c9c1d2d71d3c94cfaec3a0a8afd36e557705fc24210d4a735dd24703c81a08e', 1794205627262),
  ('ece6f3fa9af0e76d7f86d9cb1cb70dd81c9e5233a794a6095465db0bcc8360f0', 1794209926134);

COMMIT;
