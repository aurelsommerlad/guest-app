ALTER TABLE "guest_registration_guests" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "guest_registration_guests" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "guest_registration_guests" ADD COLUMN "prefilled_fields" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_registrations" ADD COLUMN "guest_count_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guest_registration_guests" ADD CONSTRAINT "guest_registration_guests_email_valid" CHECK ("guest_registration_guests"."email" IS NULL OR ("guest_registration_guests"."email" = lower("guest_registration_guests"."email")
        AND char_length("guest_registration_guests"."email") BETWEEN 3 AND 254 AND position('@' in "guest_registration_guests"."email") > 1
        AND "guest_registration_guests"."email" !~ '@([a-z0-9-]+\.)*guest\.booking\.com$'));--> statement-breakpoint
ALTER TABLE "guest_registration_guests" ADD CONSTRAINT "guest_registration_guests_phone_e164" CHECK ("guest_registration_guests"."phone" IS NULL OR "guest_registration_guests"."phone" ~ '^\+[1-9][0-9]{6,14}$');--> statement-breakpoint
ALTER TABLE "guest_registration_guests" ADD CONSTRAINT "guest_registration_guests_prefilled_fields_known" CHECK ("guest_registration_guests"."prefilled_fields" <@ ARRAY['firstName', 'lastName', 'email', 'phone', 'birthDate', 'nationality', 'street', 'postalCode', 'city', 'country', 'documentType', 'documentNumber']::text[]);