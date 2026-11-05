-- P — Feratel: Meldeeinstellungen, Meldestatus, Gästekarten, Protokoll (ADR 0022 F2) (Supabase Staging)
-- Unveränderte Drizzle-Migrationen 0013_official_registrations, 0014_lock_and_audit_official_registrations (packages/db/drizzle) in Journal-Reihenfolge, in
-- einer Transaktion. Keine Seeds, keine Gästedaten. Danach – wie der Drizzle-Migrator – Eintrag
-- in drizzle.__drizzle_migrations, damit spätere `pnpm db:migrate`-Läufe sie überspringen.
-- Voraussetzung: Migration 0012_lock_and_audit_payments ist eingetragen (O-migration-0011-0012.sql). Ein zweiter Lauf bricht ab.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = 1793869039634) THEN
    RAISE EXCEPTION 'Migration 0012_lock_and_audit_payments fehlt – zuerst O-migration-0011-0012.sql ausführen';
  END IF;
  IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at >= 1793876480499) THEN
    RAISE EXCEPTION 'Migration(en) 0013_official_registrations, 0014_lock_and_audit_official_registrations sind bereits eingetragen – nichts zu tun';
  END IF;
END
$$;

-- ════ 0013_official_registrations.sql ════
CREATE TABLE "official_guest_cards" (
	"tenant_id" text NOT NULL,
	"official_registration_id" uuid NOT NULL,
	"status" text NOT NULL,
	"delivery_channel" text,
	"external_card_reference" text,
	"card_count" integer,
	"last_error_code" text,
	"status_changed_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "official_guest_cards_pkey" PRIMARY KEY("tenant_id","official_registration_id"),
	CONSTRAINT "official_guest_cards_status_valid" CHECK ("official_guest_cards"."status" IN ('not-applicable', 'waiting', 'requested', 'issued', 'delivered', 'failed', 'manual')),
	CONSTRAINT "official_guest_cards_channel_valid" CHECK ("official_guest_cards"."delivery_channel" IS NULL OR "official_guest_cards"."delivery_channel" IN ('target-email', 'app', 'print')),
	CONSTRAINT "official_guest_cards_reference_length" CHECK ("official_guest_cards"."external_card_reference" IS NULL OR char_length("official_guest_cards"."external_card_reference") BETWEEN 1 AND 255),
	CONSTRAINT "official_guest_cards_card_count" CHECK ("official_guest_cards"."card_count" IS NULL OR "official_guest_cards"."card_count" BETWEEN 1 AND 12),
	CONSTRAINT "official_guest_cards_error_code_valid" CHECK ("official_guest_cards"."last_error_code" IS NULL OR "official_guest_cards"."last_error_code" IN ('timeout', 'unavailable', 'rate_limited', 'auth', 'not_found', 'rejected', 'conflict', 'invalid_data', 'not_configured', 'unknown', 'ambiguous_outcome', 'not_supported')),
	CONSTRAINT "official_guest_cards_version_positive" CHECK ("official_guest_cards"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "official_guest_cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "official_registration_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"property_id" text NOT NULL,
	"target" text NOT NULL,
	"official_registration_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"result" text NOT NULL,
	"code" text,
	"attempt" integer,
	"idempotency_key" text,
	"manual_reason" text,
	"actor" text NOT NULL,
	"admin_user_id" uuid,
	"stage_after" text NOT NULL,
	"transmission_after" text NOT NULL,
	"guest_card_after" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "official_registration_events_target_valid" CHECK ("official_registration_events"."target" IN ('feratel')),
	CONSTRAINT "official_registration_events_operation_valid" CHECK ("official_registration_events"."operation" IN ('create-pre-registration', 'update-pre-registration', 'delete-pre-registration', 'create-registration', 'convert-to-registration', 'update-departure', 'check-out', 'cancel-registration', 'lookup-by-reference', 'handover-to-staff', 'admin-retry', 'admin-resolve', 'guest-card-update')),
	CONSTRAINT "official_registration_events_result_valid" CHECK ("official_registration_events"."result" IN ('ok', 'rejected', 'temporary', 'ambiguous', 'not-supported', 'manual', 'skipped')),
	CONSTRAINT "official_registration_events_code_valid" CHECK ("official_registration_events"."code" IS NULL OR "official_registration_events"."code" IN ('timeout', 'unavailable', 'rate_limited', 'auth', 'not_found', 'rejected', 'conflict', 'invalid_data', 'not_configured', 'unknown', 'ambiguous_outcome', 'not_supported')),
	CONSTRAINT "official_registration_events_manual_reason_valid" CHECK ("official_registration_events"."manual_reason" IS NULL OR "official_registration_events"."manual_reason" IN ('not-supported', 'ambiguous-outcome', 'registration-immutable', 'cancelled-after-registration', 'attempts-exhausted', 'rejected', 'changed-after-check-out')),
	CONSTRAINT "official_registration_events_actor_valid" CHECK ("official_registration_events"."actor" IN ('system', 'admin')),
	CONSTRAINT "official_registration_events_admin_consistent" CHECK (("official_registration_events"."actor" = 'admin') = ("official_registration_events"."admin_user_id" IS NOT NULL)),
	CONSTRAINT "official_registration_events_idempotency_key_format" CHECK ("official_registration_events"."idempotency_key" IS NULL OR "official_registration_events"."idempotency_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "official_registration_events_attempt_range" CHECK ("official_registration_events"."attempt" IS NULL OR "official_registration_events"."attempt" >= 1),
	CONSTRAINT "official_registration_events_stage_valid" CHECK ("official_registration_events"."stage_after" IN ('none', 'pre-registered', 'registered', 'checked-out', 'cancelled')),
	CONSTRAINT "official_registration_events_transmission_valid" CHECK ("official_registration_events"."transmission_after" IN ('pending', 'transmitted', 'confirmed', 'failed', 'manual')),
	CONSTRAINT "official_registration_events_guest_card_valid" CHECK ("official_registration_events"."guest_card_after" IS NULL OR "official_registration_events"."guest_card_after" IN ('not-applicable', 'waiting', 'requested', 'issued', 'delivered', 'failed', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "official_registration_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "official_registration_settings" (
	"tenant_id" text NOT NULL,
	"property_id" text NOT NULL,
	"target" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"environment" text DEFAULT 'simulated' NOT NULL,
	"binding_registration_rule" text DEFAULT 'arrival-day' NOT NULL,
	"binding_registration_days" integer,
	"pre_registration_lead_days" integer,
	"allowed_operations" text[] DEFAULT '{}'::text[] NOT NULL,
	"guest_cards" boolean DEFAULT false NOT NULL,
	"child_under_age" integer NOT NULL,
	"provider_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state_retention_days" integer,
	"event_retention_days" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "official_registration_settings_pkey" PRIMARY KEY("tenant_id","property_id","target"),
	CONSTRAINT "official_registration_settings_target_valid" CHECK ("official_registration_settings"."target" IN ('feratel')),
	CONSTRAINT "official_registration_settings_environment_valid" CHECK ("official_registration_settings"."environment" IN ('simulated', 'test', 'production')),
	CONSTRAINT "official_registration_settings_live_guard" CHECK (NOT "official_registration_settings"."enabled" OR "official_registration_settings"."environment" = 'simulated'),
	CONSTRAINT "official_registration_settings_rule_valid" CHECK ("official_registration_settings"."binding_registration_rule" IN ('arrival-day', 'days-before-arrival')),
	CONSTRAINT "official_registration_settings_rule_days" CHECK (("official_registration_settings"."binding_registration_rule" = 'days-before-arrival') = ("official_registration_settings"."binding_registration_days" IS NOT NULL) AND ("official_registration_settings"."binding_registration_days" IS NULL OR "official_registration_settings"."binding_registration_days" BETWEEN 1 AND 30)),
	CONSTRAINT "official_registration_settings_lead_days" CHECK ("official_registration_settings"."pre_registration_lead_days" IS NULL OR "official_registration_settings"."pre_registration_lead_days" BETWEEN 1 AND 365),
	CONSTRAINT "official_registration_settings_operations_known" CHECK ("official_registration_settings"."allowed_operations" <@ ARRAY['create-pre-registration', 'update-pre-registration', 'delete-pre-registration', 'create-registration', 'convert-to-registration', 'update-departure', 'check-out', 'cancel-registration', 'lookup-by-reference']::text[]),
	CONSTRAINT "official_registration_settings_child_age" CHECK ("official_registration_settings"."child_under_age" BETWEEN 1 AND 18),
	CONSTRAINT "official_registration_settings_provider_settings_object" CHECK (jsonb_typeof("official_registration_settings"."provider_settings") = 'object' AND octet_length("official_registration_settings"."provider_settings"::text) <= 4096),
	CONSTRAINT "official_registration_settings_state_retention" CHECK ("official_registration_settings"."state_retention_days" IS NULL OR "official_registration_settings"."state_retention_days" BETWEEN 1 AND 3650),
	CONSTRAINT "official_registration_settings_event_retention" CHECK ("official_registration_settings"."event_retention_days" IS NULL OR "official_registration_settings"."event_retention_days" BETWEEN 1 AND 3650),
	CONSTRAINT "official_registration_settings_version_positive" CHECK ("official_registration_settings"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "official_registration_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "official_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"property_id" text NOT NULL,
	"target" text NOT NULL,
	"registration_id" uuid NOT NULL,
	"reservation_provider" text NOT NULL,
	"external_reservation_id" text NOT NULL,
	"our_reference" text NOT NULL,
	"stage" text DEFAULT 'none' NOT NULL,
	"transmission" text DEFAULT 'pending' NOT NULL,
	"external_reference" text,
	"accepted_fingerprint" text,
	"accepted_guest_fingerprint" text,
	"accepted_arrival_date" date,
	"accepted_departure_date" date,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"last_error_code" text,
	"manual_reason" text,
	"unresolved_operation" text,
	"unresolved_idempotency_key" text,
	"unresolved_fingerprint" text,
	"unresolved_guest_fingerprint" text,
	"unresolved_arrival_date" date,
	"unresolved_departure_date" date,
	"unresolved_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "official_registrations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "official_registrations_registration_key" UNIQUE("tenant_id","registration_id","target"),
	CONSTRAINT "official_registrations_reservation_key" UNIQUE("tenant_id","reservation_provider","external_reservation_id","target"),
	CONSTRAINT "official_registrations_our_reference_key" UNIQUE("target","our_reference"),
	CONSTRAINT "official_registrations_target_valid" CHECK ("official_registrations"."target" IN ('feratel')),
	CONSTRAINT "official_registrations_reservation_provider_valid" CHECK ("official_registrations"."reservation_provider" IN ('apaleo', 'mock')),
	CONSTRAINT "official_registrations_external_reservation_id_not_blank" CHECK (char_length(btrim("official_registrations"."external_reservation_id")) BETWEEN 1 AND 255),
	CONSTRAINT "official_registrations_our_reference_format" CHECK ("official_registrations"."our_reference" = 'up-' || "official_registrations"."registration_id"::text),
	CONSTRAINT "official_registrations_stage_valid" CHECK ("official_registrations"."stage" IN ('none', 'pre-registered', 'registered', 'checked-out', 'cancelled')),
	CONSTRAINT "official_registrations_transmission_valid" CHECK ("official_registrations"."transmission" IN ('pending', 'transmitted', 'confirmed', 'failed', 'manual')),
	CONSTRAINT "official_registrations_external_reference_length" CHECK ("official_registrations"."external_reference" IS NULL OR char_length("official_registrations"."external_reference") BETWEEN 1 AND 255),
	CONSTRAINT "official_registrations_confirmed_has_reference" CHECK ("official_registrations"."transmission" <> 'confirmed' OR "official_registrations"."external_reference" IS NOT NULL),
	CONSTRAINT "official_registrations_staff_reason" CHECK (("official_registrations"."transmission" IN ('manual', 'failed')) = ("official_registrations"."manual_reason" IS NOT NULL)),
	CONSTRAINT "official_registrations_error_code_valid" CHECK ("official_registrations"."last_error_code" IS NULL OR "official_registrations"."last_error_code" IN ('timeout', 'unavailable', 'rate_limited', 'auth', 'not_found', 'rejected', 'conflict', 'invalid_data', 'not_configured', 'unknown', 'ambiguous_outcome', 'not_supported')),
	CONSTRAINT "official_registrations_manual_reason_valid" CHECK ("official_registrations"."manual_reason" IS NULL OR "official_registrations"."manual_reason" IN ('not-supported', 'ambiguous-outcome', 'registration-immutable', 'cancelled-after-registration', 'attempts-exhausted', 'rejected', 'changed-after-check-out')),
	CONSTRAINT "official_registrations_accepted_consistent" CHECK (("official_registrations"."accepted_fingerprint" IS NULL AND "official_registrations"."accepted_guest_fingerprint" IS NULL AND "official_registrations"."accepted_arrival_date" IS NULL AND "official_registrations"."accepted_departure_date" IS NULL)
        OR ("official_registrations"."accepted_fingerprint" ~ '^[0-9a-f]{64}$' AND "official_registrations"."accepted_guest_fingerprint" ~ '^[0-9a-f]{64}$' AND "official_registrations"."accepted_departure_date" > "official_registrations"."accepted_arrival_date")),
	CONSTRAINT "official_registrations_unresolved_consistent" CHECK (("official_registrations"."unresolved_operation" IS NULL AND "official_registrations"."unresolved_idempotency_key" IS NULL AND "official_registrations"."unresolved_fingerprint" IS NULL AND "official_registrations"."unresolved_guest_fingerprint" IS NULL AND "official_registrations"."unresolved_arrival_date" IS NULL AND "official_registrations"."unresolved_departure_date" IS NULL AND "official_registrations"."unresolved_at" IS NULL)
        OR ("official_registrations"."unresolved_operation" IN ('create-pre-registration', 'create-registration', 'convert-to-registration') AND "official_registrations"."unresolved_idempotency_key" ~ '^[0-9a-f]{64}$' AND "official_registrations"."unresolved_fingerprint" ~ '^[0-9a-f]{64}$' AND "official_registrations"."unresolved_guest_fingerprint" ~ '^[0-9a-f]{64}$' AND "official_registrations"."unresolved_departure_date" > "official_registrations"."unresolved_arrival_date" AND "official_registrations"."unresolved_at" IS NOT NULL)),
	CONSTRAINT "official_registrations_attempts_range" CHECK ("official_registrations"."attempts" >= 0),
	CONSTRAINT "official_registrations_version_positive" CHECK ("official_registrations"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "official_registrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "official_guest_cards" ADD CONSTRAINT "official_guest_cards_registration_fkey" FOREIGN KEY ("tenant_id","official_registration_id") REFERENCES "public"."official_registrations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_registration_events" ADD CONSTRAINT "official_registration_events_registration_fkey" FOREIGN KEY ("tenant_id","official_registration_id") REFERENCES "public"."official_registrations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_registration_events" ADD CONSTRAINT "official_registration_events_admin_fkey" FOREIGN KEY ("tenant_id","admin_user_id") REFERENCES "public"."admin_users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_registration_settings" ADD CONSTRAINT "official_registration_settings_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_registrations" ADD CONSTRAINT "official_registrations_registration_fkey" FOREIGN KEY ("tenant_id","registration_id") REFERENCES "public"."guest_registrations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_registrations" ADD CONSTRAINT "official_registrations_settings_fkey" FOREIGN KEY ("tenant_id","property_id","target") REFERENCES "public"."official_registration_settings"("tenant_id","property_id","target") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "official_registration_events_registration_idx" ON "official_registration_events" USING btree ("tenant_id","official_registration_id","occurred_at");--> statement-breakpoint
CREATE INDEX "official_registration_events_purge_idx" ON "official_registration_events" USING btree ("purge_after");--> statement-breakpoint
CREATE UNIQUE INDEX "official_registration_events_one_successful_create" ON "official_registration_events" USING btree ("official_registration_id","idempotency_key") WHERE "official_registration_events"."result" = 'ok' AND "official_registration_events"."idempotency_key" IS NOT NULL AND "official_registration_events"."operation" IN ('create-pre-registration', 'create-registration', 'convert-to-registration');--> statement-breakpoint
CREATE UNIQUE INDEX "official_registrations_external_reference_key" ON "official_registrations" USING btree ("target","external_reference") WHERE "official_registrations"."external_reference" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "official_registrations_due_idx" ON "official_registrations" USING btree ("transmission","next_attempt_at");--> statement-breakpoint
CREATE INDEX "official_registrations_property_idx" ON "official_registrations" USING btree ("tenant_id","property_id","transmission");

-- ════ 0014_lock_and_audit_official_registrations.sql ════
-- Custom migration (ADR 0022, F2): safety rules for the official registration tables that the
-- schema DSL cannot express. Safe on plain Postgres (role checks are conditional).
-- Retention purges run in one transaction with SET LOCAL up.official_retention_purge = 'on'
-- and may only remove rows whose purge_after has passed.

-- 1. Keep the Supabase Data API closed (second layer besides RLS without policies).
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.official_registration_settings, public.official_registrations, public.official_guest_cards, public.official_registration_events FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint

-- 2. Shared guard: deletion only by the retention purge and only when due.
CREATE OR REPLACE FUNCTION public.official_retention_delete_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF coalesce(current_setting('up.official_retention_purge', true), '') <> 'on'
    OR OLD.purge_after IS NULL
    OR OLD.purge_after > now() THEN
    RAISE EXCEPTION '% rows are only removed by the retention purge when due', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END
$$;
--> statement-breakpoint

-- 3. Revision-safe protocol: rows are only added; never changed, truncated or deleted early.
CREATE OR REPLACE FUNCTION public.official_registration_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'official_registration_events is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER official_registration_events_no_update
  BEFORE UPDATE ON public.official_registration_events
  FOR EACH ROW EXECUTE FUNCTION public.official_registration_events_append_only();
--> statement-breakpoint
CREATE TRIGGER official_registration_events_no_truncate
  BEFORE TRUNCATE ON public.official_registration_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.official_registration_events_append_only();
--> statement-breakpoint
CREATE TRIGGER official_registration_events_retention_delete
  BEFORE DELETE ON public.official_registration_events
  FOR EACH ROW EXECUTE FUNCTION public.official_retention_delete_only();
--> statement-breakpoint

-- 4. A protocol entry must belong to the same property and target as its registration state.
CREATE OR REPLACE FUNCTION public.official_registration_events_consistent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.official_registrations r
    WHERE r.tenant_id = NEW.tenant_id
      AND r.id = NEW.official_registration_id
      AND r.property_id = NEW.property_id
      AND r.target = NEW.target
  ) THEN
    RAISE EXCEPTION 'protocol entry does not match its registration'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER official_registration_events_consistent
  BEFORE INSERT ON public.official_registration_events
  FOR EACH ROW EXECUTE FUNCTION public.official_registration_events_consistent();
--> statement-breakpoint

-- 5. Registration state: bound to exactly the check-in and reservation it was created for.
CREATE OR REPLACE FUNCTION public.official_registrations_bound()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.guest_registrations g
      WHERE g.tenant_id = NEW.tenant_id
        AND g.id = NEW.registration_id
        AND g.property_id = NEW.property_id
        AND g.reservation_provider = NEW.reservation_provider
        AND g.external_reservation_id = NEW.external_reservation_id
    ) THEN
      RAISE EXCEPTION 'official registration does not match its check-in (property/reservation)'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.property_id IS DISTINCT FROM OLD.property_id
    OR NEW.target IS DISTINCT FROM OLD.target
    OR NEW.registration_id IS DISTINCT FROM OLD.registration_id
    OR NEW.reservation_provider IS DISTINCT FROM OLD.reservation_provider
    OR NEW.external_reservation_id IS DISTINCT FROM OLD.external_reservation_id
    OR NEW.our_reference IS DISTINCT FROM OLD.our_reference THEN
    RAISE EXCEPTION 'identity of an official registration is immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- The target's reference is write-once: replacing it could hide a duplicate registration.
  IF OLD.external_reference IS NOT NULL
    AND NEW.external_reference IS DISTINCT FROM OLD.external_reference THEN
    RAISE EXCEPTION 'external_reference is write-once'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER official_registrations_bound
  BEFORE INSERT OR UPDATE ON public.official_registrations
  FOR EACH ROW EXECUTE FUNCTION public.official_registrations_bound();
--> statement-breakpoint
CREATE TRIGGER official_registrations_retention_delete
  BEFORE DELETE ON public.official_registrations
  FOR EACH ROW EXECUTE FUNCTION public.official_retention_delete_only();
--> statement-breakpoint
CREATE TRIGGER official_registrations_no_truncate
  BEFORE TRUNCATE ON public.official_registrations
  FOR EACH STATEMENT EXECUTE FUNCTION public.official_registration_events_append_only();
--> statement-breakpoint

-- 6. Guest cards: identity immutable, removed together with their registration only.
CREATE OR REPLACE FUNCTION public.official_guest_cards_bound()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('up.official_retention_purge', true), '') <> 'on'
      OR NOT EXISTS (
        SELECT 1 FROM public.official_registrations r
        WHERE r.tenant_id = OLD.tenant_id
          AND r.id = OLD.official_registration_id
          AND r.purge_after IS NOT NULL
          AND r.purge_after <= now()
      ) THEN
      RAISE EXCEPTION 'official_guest_cards rows are only removed with their due registration'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.official_registration_id IS DISTINCT FROM OLD.official_registration_id THEN
    RAISE EXCEPTION 'identity of a guest card status is immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER official_guest_cards_bound
  BEFORE UPDATE OR DELETE ON public.official_guest_cards
  FOR EACH ROW EXECUTE FUNCTION public.official_guest_cards_bound();
--> statement-breakpoint
CREATE TRIGGER official_guest_cards_no_truncate
  BEFORE TRUNCATE ON public.official_guest_cards
  FOR EACH STATEMENT EXECUTE FUNCTION public.official_registration_events_append_only();
--> statement-breakpoint

-- 7. Settings hold no secrets: provider settings are short strings under plain keys.
CREATE OR REPLACE FUNCTION public.official_registration_settings_no_secrets()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  entry record;
BEGIN
  FOR entry IN SELECT key, value FROM jsonb_each(NEW.provider_settings) LOOP
    IF entry.key !~ '^[a-zA-Z][a-zA-Z0-9]{0,40}$'
      OR entry.key ~* '(secret|password|passwd|token|credential|apikey|privatekey)'
      OR jsonb_typeof(entry.value) <> 'string'
      OR char_length(entry.value #>> '{}') NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'provider_settings may only hold non-secret short strings (key %)', entry.key
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER official_registration_settings_no_secrets
  BEFORE INSERT OR UPDATE ON public.official_registration_settings
  FOR EACH ROW EXECUTE FUNCTION public.official_registration_settings_no_secrets();

-- ════ Drizzle-Migrationstabelle ════
INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES
  ('fd99c63752e5f6811b835cf65fdefd40584793a079ced47053ff661f4ceb888d', 1793876480499),
  ('d885bfc8468e2da05147472242a422a1c6cd7c596a9f5db24b0542ed27dcfa2e', 1793876481748);

COMMIT;
