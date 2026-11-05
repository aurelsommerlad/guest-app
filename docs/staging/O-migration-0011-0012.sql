-- O — Zahlungen: Anforderungen, Zahlungsstatus, Prüfprotokoll (Phase 12 B1) (Supabase Staging)
-- Unveränderte Drizzle-Migrationen 0011_payments, 0012_lock_and_audit_payments (packages/db/drizzle) in Journal-Reihenfolge, in
-- einer Transaktion. Keine Seeds, keine Gästedaten. Danach – wie der Drizzle-Migrator – Eintrag
-- in drizzle.__drizzle_migrations, damit spätere `pnpm db:migrate`-Läufe sie überspringen.
-- Voraussetzung: Migration 0010_guest_contact_prefill ist eingetragen (J-migration-0010.sql). Ein zweiter Lauf bricht ab.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = 1791320712081) THEN
    RAISE EXCEPTION 'Migration 0010_guest_contact_prefill fehlt – zuerst J-migration-0010.sql ausführen';
  END IF;
  IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at >= 1793869038519) THEN
    RAISE EXCEPTION 'Migration(en) 0011_payments, 0012_lock_and_audit_payments sind bereits eingetragen – nichts zu tun';
  END IF;
END
$$;

-- ════ 0011_payments.sql ════
CREATE TABLE "payment_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"property_id" text NOT NULL,
	"reservation_provider" text NOT NULL,
	"external_reservation_id" text NOT NULL,
	"folio_id" text,
	"payment_request_id" uuid,
	"kind" text NOT NULL,
	"state" text,
	"amount_minor" integer,
	"currency" text,
	"provider_payment_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"actor" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_audit_events_kind_valid" CHECK ("payment_audit_events"."kind" IN ('state-observed', 'payment-confirmed', 'request-created', 'request-status-changed')),
	CONSTRAINT "payment_audit_events_actor_valid" CHECK ("payment_audit_events"."actor" IN ('system', 'guest', 'admin')),
	CONSTRAINT "payment_audit_events_reservation_provider_valid" CHECK ("payment_audit_events"."reservation_provider" IN ('apaleo', 'mock')),
	CONSTRAINT "payment_audit_events_state_valid" CHECK ("payment_audit_events"."state" IS NULL OR "payment_audit_events"."state" IN ('not-applicable', 'not-due', 'due', 'pending', 'paid', 'credit', 'review', 'unknown', 'preparing', 'succeeded', 'failed', 'canceled', 'expired')),
	CONSTRAINT "payment_audit_events_amount_currency" CHECK (("payment_audit_events"."amount_minor" IS NULL) = ("payment_audit_events"."currency" IS NULL) AND ("payment_audit_events"."currency" IS NULL OR "payment_audit_events"."currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "payment_audit_events_folio_id_length" CHECK ("payment_audit_events"."folio_id" IS NULL OR char_length("payment_audit_events"."folio_id") BETWEEN 1 AND 255)
);
--> statement-breakpoint
ALTER TABLE "payment_audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"property_id" text NOT NULL,
	"reservation_provider" text NOT NULL,
	"external_reservation_id" text NOT NULL,
	"external_booking_id" text,
	"payment_provider" text NOT NULL,
	"folio_id" text NOT NULL,
	"provider_payment_id" text,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'preparing' NOT NULL,
	"idempotency_key" text NOT NULL,
	"return_ref" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_checked_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_requests_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_requests_idempotency_key_key" UNIQUE("payment_provider","idempotency_key"),
	CONSTRAINT "payment_requests_return_ref_key" UNIQUE("return_ref"),
	CONSTRAINT "payment_requests_reservation_provider_valid" CHECK ("payment_requests"."reservation_provider" IN ('apaleo', 'mock')),
	CONSTRAINT "payment_requests_payment_provider_valid" CHECK ("payment_requests"."payment_provider" IN ('apaleo')),
	CONSTRAINT "payment_requests_status_valid" CHECK ("payment_requests"."status" IN ('preparing', 'pending', 'succeeded', 'failed', 'canceled', 'expired')),
	CONSTRAINT "payment_requests_external_reservation_id_not_blank" CHECK (char_length(btrim("payment_requests"."external_reservation_id")) BETWEEN 1 AND 255),
	CONSTRAINT "payment_requests_external_booking_id_length" CHECK ("payment_requests"."external_booking_id" IS NULL OR char_length("payment_requests"."external_booking_id") BETWEEN 1 AND 255),
	CONSTRAINT "payment_requests_folio_id_not_blank" CHECK (char_length(btrim("payment_requests"."folio_id")) BETWEEN 1 AND 255),
	CONSTRAINT "payment_requests_provider_payment_id_length" CHECK ("payment_requests"."provider_payment_id" IS NULL OR char_length("payment_requests"."provider_payment_id") BETWEEN 1 AND 255),
	CONSTRAINT "payment_requests_amount_positive" CHECK ("payment_requests"."amount_minor" > 0),
	CONSTRAINT "payment_requests_currency_format" CHECK ("payment_requests"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_requests_idempotency_key_format" CHECK ("payment_requests"."idempotency_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "payment_requests_return_ref_format" CHECK ("payment_requests"."return_ref" ~ '^[A-Za-z0-9_-]{32,64}$'),
	CONSTRAINT "payment_requests_provider_payment_id_required" CHECK ("payment_requests"."status" NOT IN ('pending', 'succeeded') OR "payment_requests"."provider_payment_id" IS NOT NULL),
	CONSTRAINT "payment_requests_settled_consistent" CHECK (("payment_requests"."status" IN ('succeeded', 'failed', 'canceled', 'expired')) = ("payment_requests"."settled_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "payment_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reservation_payment_states" (
	"tenant_id" text NOT NULL,
	"property_id" text NOT NULL,
	"reservation_provider" text NOT NULL,
	"external_reservation_id" text NOT NULL,
	"external_booking_id" text,
	"last_state" text NOT NULL,
	"last_checked_at" timestamp with time zone NOT NULL,
	"cleared_at" timestamp with time zone,
	"cleared_amount_minor" integer,
	"cleared_currency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_payment_states_pkey" PRIMARY KEY("tenant_id","reservation_provider","external_reservation_id"),
	CONSTRAINT "reservation_payment_states_reservation_provider_valid" CHECK ("reservation_payment_states"."reservation_provider" IN ('apaleo', 'mock')),
	CONSTRAINT "reservation_payment_states_last_state_valid" CHECK ("reservation_payment_states"."last_state" IN ('not-applicable', 'not-due', 'due', 'pending', 'paid', 'credit', 'review', 'unknown')),
	CONSTRAINT "reservation_payment_states_external_reservation_id_not_blank" CHECK (char_length(btrim("reservation_payment_states"."external_reservation_id")) BETWEEN 1 AND 255),
	CONSTRAINT "reservation_payment_states_external_booking_id_length" CHECK ("reservation_payment_states"."external_booking_id" IS NULL OR char_length("reservation_payment_states"."external_booking_id") BETWEEN 1 AND 255),
	CONSTRAINT "reservation_payment_states_cleared_consistent" CHECK (("reservation_payment_states"."cleared_at" IS NULL AND "reservation_payment_states"."cleared_amount_minor" IS NULL AND "reservation_payment_states"."cleared_currency" IS NULL) OR ("reservation_payment_states"."cleared_at" IS NOT NULL AND "reservation_payment_states"."cleared_amount_minor" > 0 AND "reservation_payment_states"."cleared_currency" ~ '^[A-Z]{3}$'))
);
--> statement-breakpoint
ALTER TABLE "reservation_payment_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_audit_events" ADD CONSTRAINT "payment_audit_events_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_audit_events" ADD CONSTRAINT "payment_audit_events_request_fkey" FOREIGN KEY ("tenant_id","payment_request_id") REFERENCES "public"."payment_requests"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_payment_states" ADD CONSTRAINT "reservation_payment_states_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_audit_events_reservation_idx" ON "payment_audit_events" USING btree ("tenant_id","reservation_provider","external_reservation_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_provider_payment_key" ON "payment_requests" USING btree ("payment_provider","provider_payment_id") WHERE "payment_requests"."provider_payment_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_one_open_per_folio" ON "payment_requests" USING btree ("tenant_id","payment_provider","folio_id") WHERE "payment_requests"."status" IN ('preparing', 'pending');--> statement-breakpoint
CREATE INDEX "payment_requests_reservation_idx" ON "payment_requests" USING btree ("tenant_id","reservation_provider","external_reservation_id");--> statement-breakpoint
CREATE INDEX "payment_requests_open_due_idx" ON "payment_requests" USING btree ("status","expires_at");

-- ════ 0012_lock_and_audit_payments.sql ════
-- Custom migration (Phase 12 B1, ADR 0018): safety rules for the payment tables that the
-- schema DSL cannot express. Safe on plain Postgres (role checks are conditional).

-- 1. Keep the Supabase Data API closed (second layer besides RLS without policies).
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.payment_requests, public.reservation_payment_states, public.payment_audit_events FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint

-- 2. Revision-safe audit trail: rows can only be added, never changed or removed.
CREATE OR REPLACE FUNCTION public.payment_audit_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'payment_audit_events is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER payment_audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON public.payment_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.payment_audit_events_append_only();
--> statement-breakpoint
CREATE TRIGGER payment_audit_events_no_truncate
  BEFORE TRUNCATE ON public.payment_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.payment_audit_events_append_only();
--> statement-breakpoint

-- 3. A confirmed payment stays confirmed: cleared_at (and its amount) is write-once.
CREATE OR REPLACE FUNCTION public.reservation_payment_states_cleared_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.cleared_at IS NOT NULL AND (
    NEW.cleared_at IS DISTINCT FROM OLD.cleared_at
    OR NEW.cleared_amount_minor IS DISTINCT FROM OLD.cleared_amount_minor
    OR NEW.cleared_currency IS DISTINCT FROM OLD.cleared_currency
  ) THEN
    RAISE EXCEPTION 'cleared_at is write-once'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER reservation_payment_states_cleared_once
  BEFORE UPDATE ON public.reservation_payment_states
  FOR EACH ROW EXECUTE FUNCTION public.reservation_payment_states_cleared_once();
--> statement-breakpoint

-- 4. Reservation states are not deleted by the application (history stays consistent).
CREATE OR REPLACE FUNCTION public.reservation_payment_states_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'reservation_payment_states rows are not deleted'
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER reservation_payment_states_no_delete
  BEFORE DELETE ON public.reservation_payment_states
  FOR EACH ROW EXECUTE FUNCTION public.reservation_payment_states_no_delete();

-- ════ Drizzle-Migrationstabelle ════
INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES
  ('f571092703994bb658fb5b60cbd848e3533380f173c7b697af6f75449397a205', 1793869038519),
  ('cf653289ba2d47c83a18700e82afa1014658f13af2716503bf676f8c78e37bdb', 1793869039634);

COMMIT;
