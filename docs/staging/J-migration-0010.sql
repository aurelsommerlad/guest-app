-- J — MIGRATION PHASE 11.2 (CHECK-IN: KONTAKTDATEN, VORBEFÜLLUNG, BELEGUNG) (Supabase Staging)
-- Unveränderte Drizzle-Migrationen 0010_guest_contact_prefill (packages/db/drizzle) in Journal-Reihenfolge, in
-- einer Transaktion. Keine Seeds, keine Gästedaten. Danach – wie der Drizzle-Migrator – Eintrag
-- in drizzle.__drizzle_migrations, damit spätere `pnpm db:migrate`-Läufe sie überspringen.
-- Voraussetzung: Migration 0009_lock_data_api_guest_journey ist eingetragen (Skript H). Ein zweiter Lauf bricht ab.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = 1791302186545) THEN
    RAISE EXCEPTION 'Migration 0009_lock_data_api_guest_journey fehlt – zuerst Skript H ausführen';
  END IF;
  IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at >= 1791320712081) THEN
    RAISE EXCEPTION 'Migration(en) 0010_guest_contact_prefill sind bereits eingetragen – nichts zu tun';
  END IF;
END
$$;

-- ════ 0010_guest_contact_prefill.sql ════
ALTER TABLE "guest_registration_guests" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "guest_registration_guests" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "guest_registration_guests" ADD COLUMN "prefilled_fields" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_registrations" ADD COLUMN "guest_count_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guest_registration_guests" ADD CONSTRAINT "guest_registration_guests_email_valid" CHECK ("guest_registration_guests"."email" IS NULL OR ("guest_registration_guests"."email" = lower("guest_registration_guests"."email")
        AND char_length("guest_registration_guests"."email") BETWEEN 3 AND 254 AND position('@' in "guest_registration_guests"."email") > 1
        AND "guest_registration_guests"."email" !~ '@([a-z0-9-]+\.)*guest\.booking\.com$'));--> statement-breakpoint
ALTER TABLE "guest_registration_guests" ADD CONSTRAINT "guest_registration_guests_phone_e164" CHECK ("guest_registration_guests"."phone" IS NULL OR "guest_registration_guests"."phone" ~ '^\+[1-9][0-9]{6,14}$');--> statement-breakpoint
ALTER TABLE "guest_registration_guests" ADD CONSTRAINT "guest_registration_guests_prefilled_fields_known" CHECK ("guest_registration_guests"."prefilled_fields" <@ ARRAY['firstName', 'lastName', 'email', 'phone', 'birthDate', 'nationality', 'street', 'postalCode', 'city', 'country', 'documentType', 'documentNumber']::text[]);

-- ════ Drizzle-Migrationstabelle ════
INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES
  ('542fe1438489035a77e36d48fe0d14387acbeea1ad4f2520b12e1733692b3cb2', 1791320712081);

COMMIT;
