-- Q — Kontaktdaten trennen, Adressstatus, Rechnungsadresse (ADR 0021) (Supabase Staging)
-- Unveränderte Drizzle-Migrationen 0015_separate_contacts_and_billing (packages/db/drizzle) in Journal-Reihenfolge, in
-- einer Transaktion. Keine Seeds, keine Gästedaten. Danach – wie der Drizzle-Migrator – Eintrag
-- in drizzle.__drizzle_migrations, damit spätere `pnpm db:migrate`-Läufe sie überspringen.
-- Voraussetzung: Migration 0014_lock_and_audit_official_registrations ist eingetragen (P-migration-0013-0014.sql). Ein zweiter Lauf bricht ab.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = 1793876481748) THEN
    RAISE EXCEPTION 'Migration 0014_lock_and_audit_official_registrations fehlt – zuerst P-migration-0013-0014.sql ausführen';
  END IF;
  IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at >= 1793966391119) THEN
    RAISE EXCEPTION 'Migration(en) 0015_separate_contacts_and_billing sind bereits eingetragen – nichts zu tun';
  END IF;
END
$$;

-- ════ 0015_separate_contacts_and_billing.sql ════
CREATE TABLE "guest_registration_billing" (
	"tenant_id" text NOT NULL,
	"registration_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"company_name" text,
	"street" text,
	"postal_code" text,
	"city" text,
	"country" text,
	"vat_id" text,
	"contact_first_name" text,
	"contact_last_name" text,
	"address_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_registration_billing_pkey" PRIMARY KEY("tenant_id","registration_id"),
	CONSTRAINT "guest_registration_billing_kind_valid" CHECK ("guest_registration_billing"."kind" IN ('private', 'company')),
	CONSTRAINT "guest_registration_billing_shape" CHECK (("guest_registration_billing"."kind" = 'private' AND "guest_registration_billing"."company_name" IS NULL AND "guest_registration_billing"."street" IS NULL AND "guest_registration_billing"."postal_code" IS NULL AND "guest_registration_billing"."city" IS NULL AND "guest_registration_billing"."country" IS NULL AND "guest_registration_billing"."vat_id" IS NULL AND "guest_registration_billing"."contact_first_name" IS NULL AND "guest_registration_billing"."contact_last_name" IS NULL AND "guest_registration_billing"."address_status" IS NULL)
        OR ("guest_registration_billing"."kind" = 'company' AND "guest_registration_billing"."company_name" IS NOT NULL AND "guest_registration_billing"."street" IS NOT NULL AND "guest_registration_billing"."city" IS NOT NULL AND "guest_registration_billing"."country" ~ '^[A-Z]{2}$' AND "guest_registration_billing"."address_status" IS NOT NULL)),
	CONSTRAINT "guest_registration_billing_contact_person" CHECK (("guest_registration_billing"."contact_first_name" IS NULL) = ("guest_registration_billing"."contact_last_name" IS NULL)),
	CONSTRAINT "guest_registration_billing_vat_id_format" CHECK ("guest_registration_billing"."vat_id" IS NULL OR "guest_registration_billing"."vat_id" ~ '^[A-Z]{2}[A-Z0-9+*]{2,14}$'),
	CONSTRAINT "guest_registration_billing_address_status_valid" CHECK ("guest_registration_billing"."address_status" IS NULL OR "guest_registration_billing"."address_status" IN ('unverified', 'formally-valid', 'postally-plausible')),
	CONSTRAINT "guest_registration_billing_text_lengths" CHECK (("guest_registration_billing"."company_name" IS NULL OR char_length("guest_registration_billing"."company_name") BETWEEN 1 AND 200) AND ("guest_registration_billing"."street" IS NULL OR char_length("guest_registration_billing"."street") BETWEEN 1 AND 200) AND ("guest_registration_billing"."postal_code" IS NULL OR char_length("guest_registration_billing"."postal_code") BETWEEN 1 AND 12)
        AND ("guest_registration_billing"."city" IS NULL OR char_length("guest_registration_billing"."city") BETWEEN 1 AND 100) AND ("guest_registration_billing"."contact_first_name" IS NULL OR char_length("guest_registration_billing"."contact_first_name") BETWEEN 1 AND 100) AND ("guest_registration_billing"."contact_last_name" IS NULL OR char_length("guest_registration_billing"."contact_last_name") BETWEEN 1 AND 100))
);
--> statement-breakpoint
ALTER TABLE "guest_registration_billing" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guest_registration_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"registration_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"email" text,
	"phone" text,
	"email_verified_at" timestamp with time zone,
	"email_verified_hash" text,
	"phone_verified_at" timestamp with time zone,
	"phone_verified_hash" text,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_registration_contacts_position_key" UNIQUE("registration_id","position"),
	CONSTRAINT "guest_registration_contacts_position_range" CHECK ("guest_registration_contacts"."position" BETWEEN 0 AND 11),
	CONSTRAINT "guest_registration_contacts_email_valid" CHECK ("guest_registration_contacts"."email" IS NULL OR ("guest_registration_contacts"."email" = lower("guest_registration_contacts"."email")
        AND char_length("guest_registration_contacts"."email") BETWEEN 3 AND 254 AND position('@' in "guest_registration_contacts"."email") > 1
        AND "guest_registration_contacts"."email" !~ '@([a-z0-9-]+\.)*guest\.booking\.com$')),
	CONSTRAINT "guest_registration_contacts_phone_e164" CHECK ("guest_registration_contacts"."phone" IS NULL OR "guest_registration_contacts"."phone" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "guest_registration_contacts_email_verified_consistent" CHECK (("guest_registration_contacts"."email_verified_at" IS NULL) = ("guest_registration_contacts"."email_verified_hash" IS NULL) AND ("guest_registration_contacts"."email_verified_hash" IS NULL OR "guest_registration_contacts"."email_verified_hash" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "guest_registration_contacts_phone_verified_consistent" CHECK (("guest_registration_contacts"."phone_verified_at" IS NULL) = ("guest_registration_contacts"."phone_verified_hash" IS NULL) AND ("guest_registration_contacts"."phone_verified_hash" IS NULL OR "guest_registration_contacts"."phone_verified_hash" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
ALTER TABLE "guest_registration_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guest_registration_guests" DROP CONSTRAINT "guest_registration_guests_email_valid";--> statement-breakpoint
ALTER TABLE "guest_registration_guests" DROP CONSTRAINT "guest_registration_guests_phone_e164";--> statement-breakpoint
ALTER TABLE "guest_registration_guests" ADD COLUMN "address_source" text DEFAULT 'own' NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_registration_guests" ADD COLUMN "address_status" text;--> statement-breakpoint
ALTER TABLE "guest_registration_billing" ADD CONSTRAINT "guest_registration_billing_registration_fkey" FOREIGN KEY ("tenant_id","registration_id") REFERENCES "public"."guest_registrations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_registration_contacts" ADD CONSTRAINT "guest_registration_contacts_registration_fkey" FOREIGN KEY ("tenant_id","registration_id") REFERENCES "public"."guest_registrations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_registration_contacts_purge_after_idx" ON "guest_registration_contacts" USING btree ("purge_after");--> statement-breakpoint
-- ADR 0021: move existing contact data to its own table before the columns are dropped
-- (no data loss; purge date follows the registration's).
INSERT INTO "guest_registration_contacts" ("tenant_id", "registration_id", "position", "email", "phone", "purge_after")
SELECT g."tenant_id", g."registration_id", g."position", g."email", g."phone", r."purge_after"
FROM "guest_registration_guests" g
JOIN "guest_registrations" r ON r."tenant_id" = g."tenant_id" AND r."id" = g."registration_id"
WHERE g."email" IS NOT NULL OR g."phone" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_registration_guests" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "guest_registration_guests" DROP COLUMN "phone";--> statement-breakpoint
ALTER TABLE "guest_registration_guests" ADD CONSTRAINT "guest_registration_guests_address_source_valid" CHECK ("guest_registration_guests"."address_source" IN ('own', 'same-as-primary') AND ("guest_registration_guests"."position" > 0 OR "guest_registration_guests"."address_source" = 'own')
        AND ("guest_registration_guests"."address_source" = 'own' OR ("guest_registration_guests"."street" IS NULL AND "guest_registration_guests"."postal_code" IS NULL AND "guest_registration_guests"."city" IS NULL AND "guest_registration_guests"."country" IS NULL)));--> statement-breakpoint
ALTER TABLE "guest_registration_guests" ADD CONSTRAINT "guest_registration_guests_address_status_valid" CHECK ("guest_registration_guests"."address_status" IS NULL OR "guest_registration_guests"."address_status" IN ('unverified', 'formally-valid', 'postally-plausible'));--> statement-breakpoint
-- Keep the Supabase Data API closed for the new tables (second layer besides RLS).
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.guest_registration_contacts, public.guest_registration_billing FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END
$$;

-- ════ Drizzle-Migrationstabelle ════
INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES
  ('c77d82e365c53bf5c9009f4800ffed397de93f1ad33ed694c9696b2b2aa057ac', 1793966391119);

COMMIT;
