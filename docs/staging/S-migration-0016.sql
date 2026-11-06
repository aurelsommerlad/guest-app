-- S — Kontaktverifizierung: Code-Challenges, Freigaben, Prüfprotokoll (ADR 0021, C4/C5) (Supabase Staging)
-- Unveränderte Drizzle-Migrationen 0016_contact_verification (packages/db/drizzle) in Journal-Reihenfolge, in
-- einer Transaktion. Keine Seeds, keine Gästedaten. Danach – wie der Drizzle-Migrator – Eintrag
-- in drizzle.__drizzle_migrations, damit spätere `pnpm db:migrate`-Läufe sie überspringen.
-- Voraussetzung: Migration 0015_separate_contacts_and_billing ist eingetragen (Q-migration-0015.sql). Ein zweiter Lauf bricht ab.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = 1793966391119) THEN
    RAISE EXCEPTION 'Migration 0015_separate_contacts_and_billing fehlt – zuerst Q-migration-0015.sql ausführen';
  END IF;
  IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at >= 1793984659414) THEN
    RAISE EXCEPTION 'Migration(en) 0016_contact_verification sind bereits eingetragen – nichts zu tun';
  END IF;
END
$$;

-- ════ 0016_contact_verification.sql ════
CREATE TABLE "contact_verification_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"registration_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"channel" text NOT NULL,
	"target_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"delivery" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_verification_challenges_target_hash_format" CHECK ("contact_verification_challenges"."target_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "contact_verification_challenges_code_hash_format" CHECK ("contact_verification_challenges"."code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "contact_verification_challenges_position_range" CHECK ("contact_verification_challenges"."position" BETWEEN 0 AND 11),
	CONSTRAINT "contact_verification_challenges_attempts_range" CHECK ("contact_verification_challenges"."attempts" BETWEEN 0 AND 20),
	CONSTRAINT "contact_verification_challenges_verified_consistent" CHECK (("contact_verification_challenges"."status" = 'verified') = ("contact_verification_challenges"."verified_at" IS NOT NULL)),
	CONSTRAINT "contact_verification_challenges_failed_not_pending" CHECK ("contact_verification_challenges"."delivery" <> 'failed' OR "contact_verification_challenges"."status" <> 'pending')
);
--> statement-breakpoint
ALTER TABLE "contact_verification_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contact_verification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"registration_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"channel" text NOT NULL,
	"event" text NOT NULL,
	"actor" text NOT NULL,
	"admin_user_id" uuid,
	"waiver_reason" text,
	"challenge_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_verification_events_actor_consistent" CHECK (("contact_verification_events"."actor" = 'admin') = ("contact_verification_events"."admin_user_id" IS NOT NULL)),
	CONSTRAINT "contact_verification_events_waiver_reason" CHECK (("contact_verification_events"."event" = 'waived') = ("contact_verification_events"."waiver_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "contact_verification_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guest_registration_contacts" ADD COLUMN "email_waived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guest_registration_contacts" ADD COLUMN "email_waived_by" uuid;--> statement-breakpoint
ALTER TABLE "guest_registration_contacts" ADD COLUMN "email_waiver_reason" text;--> statement-breakpoint
ALTER TABLE "guest_registration_contacts" ADD COLUMN "email_waiver_note" text;--> statement-breakpoint
ALTER TABLE "guest_registration_contacts" ADD COLUMN "phone_waived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guest_registration_contacts" ADD COLUMN "phone_waived_by" uuid;--> statement-breakpoint
ALTER TABLE "guest_registration_contacts" ADD COLUMN "phone_waiver_reason" text;--> statement-breakpoint
ALTER TABLE "guest_registration_contacts" ADD COLUMN "phone_waiver_note" text;--> statement-breakpoint
ALTER TABLE "contact_verification_challenges" ADD CONSTRAINT "contact_verification_challenges_registration_fkey" FOREIGN KEY ("tenant_id","registration_id") REFERENCES "public"."guest_registrations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_verification_events" ADD CONSTRAINT "contact_verification_events_registration_fkey" FOREIGN KEY ("tenant_id","registration_id") REFERENCES "public"."guest_registrations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_verification_events" ADD CONSTRAINT "contact_verification_events_admin_fkey" FOREIGN KEY ("tenant_id","admin_user_id") REFERENCES "public"."admin_users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_verification_challenges_history_idx" ON "contact_verification_challenges" USING btree ("tenant_id","registration_id","channel","created_at");--> statement-breakpoint
CREATE INDEX "contact_verification_challenges_target_idx" ON "contact_verification_challenges" USING btree ("target_hash","created_at");--> statement-breakpoint
CREATE INDEX "contact_verification_events_registration_idx" ON "contact_verification_events" USING btree ("tenant_id","registration_id","occurred_at");--> statement-breakpoint
ALTER TABLE "guest_registration_contacts" ADD CONSTRAINT "guest_registration_contacts_email_waived_by_fkey" FOREIGN KEY ("tenant_id","email_waived_by") REFERENCES "public"."admin_users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_registration_contacts" ADD CONSTRAINT "guest_registration_contacts_phone_waived_by_fkey" FOREIGN KEY ("tenant_id","phone_waived_by") REFERENCES "public"."admin_users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_registration_contacts" ADD CONSTRAINT "guest_registration_contacts_email_waiver_valid" CHECK ((("guest_registration_contacts"."email_waived_at" IS NULL) = ("guest_registration_contacts"."email_waived_by" IS NULL) AND ("guest_registration_contacts"."email_waived_at" IS NULL) = ("guest_registration_contacts"."email_waiver_reason" IS NULL))
        AND ("guest_registration_contacts"."email_waiver_reason" IS NULL OR "guest_registration_contacts"."email_waiver_reason" IN ('guest-has-no-own-email', 'guest-has-no-reachable-mobile', 'delivery-failed', 'confirmed-in-person', 'other'))
        AND ("guest_registration_contacts"."email_waiver_note" IS NULL OR ("guest_registration_contacts"."email_waived_at" IS NOT NULL AND char_length("guest_registration_contacts"."email_waiver_note") <= 300 AND "guest_registration_contacts"."email_waiver_note" !~ '[<>[:cntrl:]]'))
        AND ("guest_registration_contacts"."email_waiver_reason" IS DISTINCT FROM 'other' OR char_length(coalesce("guest_registration_contacts"."email_waiver_note", '')) >= 5));--> statement-breakpoint
ALTER TABLE "guest_registration_contacts" ADD CONSTRAINT "guest_registration_contacts_phone_waiver_valid" CHECK ((("guest_registration_contacts"."phone_waived_at" IS NULL) = ("guest_registration_contacts"."phone_waived_by" IS NULL) AND ("guest_registration_contacts"."phone_waived_at" IS NULL) = ("guest_registration_contacts"."phone_waiver_reason" IS NULL))
        AND ("guest_registration_contacts"."phone_waiver_reason" IS NULL OR "guest_registration_contacts"."phone_waiver_reason" IN ('guest-has-no-own-email', 'guest-has-no-reachable-mobile', 'delivery-failed', 'confirmed-in-person', 'other'))
        AND ("guest_registration_contacts"."phone_waiver_note" IS NULL OR ("guest_registration_contacts"."phone_waived_at" IS NOT NULL AND char_length("guest_registration_contacts"."phone_waiver_note") <= 300 AND "guest_registration_contacts"."phone_waiver_note" !~ '[<>[:cntrl:]]'))
        AND ("guest_registration_contacts"."phone_waiver_reason" IS DISTINCT FROM 'other' OR char_length(coalesce("guest_registration_contacts"."phone_waiver_note", '')) >= 5));--> statement-breakpoint
-- Keep the Supabase Data API closed for the new tables (second layer besides RLS).
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.contact_verification_challenges, public.contact_verification_events FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END
$$;--> statement-breakpoint
-- The verification audit trail is append-only; rows only leave with their check-in (cascade).
CREATE OR REPLACE FUNCTION public.contact_verification_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'contact_verification_events is append-only' USING ERRCODE = 'P0001';
END
$$;--> statement-breakpoint
CREATE TRIGGER contact_verification_events_no_update
BEFORE UPDATE ON public.contact_verification_events
FOR EACH ROW EXECUTE FUNCTION public.contact_verification_events_append_only();

-- ════ Drizzle-Migrationstabelle ════
-- Keeps the id sequence in step with earlier manual entries (avoids a duplicate id).
SELECT setval(pg_get_serial_sequence('drizzle.__drizzle_migrations', 'id'),
  (SELECT max(id) FROM drizzle.__drizzle_migrations));
INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES
  ('2ed1d4112a37b08937b5289926c34b881894d203215480af30bda77695ea7ed4', 1793984659414);

COMMIT;
