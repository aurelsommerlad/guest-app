CREATE TABLE "guest_registration_guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"registration_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"role" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"birth_date" date,
	"nationality" text,
	"street" text,
	"postal_code" text,
	"city" text,
	"country" text,
	"document_type" text,
	"document_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_registration_guests_position_key" UNIQUE("registration_id","position"),
	CONSTRAINT "guest_registration_guests_position_range" CHECK ("guest_registration_guests"."position" BETWEEN 0 AND 11),
	CONSTRAINT "guest_registration_guests_role_matches_position" CHECK (("guest_registration_guests"."position" = 0) = ("guest_registration_guests"."role" = 'primary')),
	CONSTRAINT "guest_registration_guests_role_valid" CHECK ("guest_registration_guests"."role" IN ('primary', 'companion')),
	CONSTRAINT "guest_registration_guests_document_type_valid" CHECK ("guest_registration_guests"."document_type" IS NULL OR "guest_registration_guests"."document_type" IN ('passport', 'id-card', 'other')),
	CONSTRAINT "guest_registration_guests_country_codes" CHECK (("guest_registration_guests"."nationality" IS NULL OR "guest_registration_guests"."nationality" ~ '^[A-Z]{2}$')
        AND ("guest_registration_guests"."country" IS NULL OR "guest_registration_guests"."country" ~ '^[A-Z]{2}$')),
	CONSTRAINT "guest_registration_guests_text_lengths" CHECK (("guest_registration_guests"."first_name" IS NULL OR char_length("guest_registration_guests"."first_name") BETWEEN 1 AND 100) AND ("guest_registration_guests"."last_name" IS NULL OR char_length("guest_registration_guests"."last_name") BETWEEN 1 AND 100)
        AND ("guest_registration_guests"."street" IS NULL OR char_length("guest_registration_guests"."street") BETWEEN 1 AND 200) AND ("guest_registration_guests"."postal_code" IS NULL OR char_length("guest_registration_guests"."postal_code") BETWEEN 1 AND 12)
        AND ("guest_registration_guests"."city" IS NULL OR char_length("guest_registration_guests"."city") BETWEEN 1 AND 100) AND ("guest_registration_guests"."document_number" IS NULL OR char_length("guest_registration_guests"."document_number") BETWEEN 1 AND 40))
);
--> statement-breakpoint
ALTER TABLE "guest_registration_guests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guest_registration_syncs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"registration_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" text,
	"external_reference" text,
	"fingerprint" text,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_registration_syncs_target_key" UNIQUE("registration_id","provider"),
	CONSTRAINT "guest_registration_syncs_provider_valid" CHECK ("guest_registration_syncs"."provider" IN ('apaleo', 'feratel')),
	CONSTRAINT "guest_registration_syncs_status_valid" CHECK ("guest_registration_syncs"."status" IN ('pending', 'processing', 'synced', 'failed', 'retry_required')),
	CONSTRAINT "guest_registration_syncs_error_code_valid" CHECK ("guest_registration_syncs"."last_error_code" IS NULL OR "guest_registration_syncs"."last_error_code" IN ('timeout', 'unavailable', 'rate_limited', 'auth', 'not_found', 'rejected', 'conflict', 'invalid_data', 'not_configured', 'unknown')),
	CONSTRAINT "guest_registration_syncs_attempts_range" CHECK ("guest_registration_syncs"."attempts" >= 0),
	CONSTRAINT "guest_registration_syncs_fingerprint_format" CHECK ("guest_registration_syncs"."fingerprint" IS NULL OR "guest_registration_syncs"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "guest_registration_syncs_external_reference_length" CHECK ("guest_registration_syncs"."external_reference" IS NULL OR char_length("guest_registration_syncs"."external_reference") BETWEEN 1 AND 255)
);
--> statement-breakpoint
ALTER TABLE "guest_registration_syncs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guest_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"property_id" text NOT NULL,
	"reservation_provider" text NOT NULL,
	"external_reservation_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"guest_count" integer NOT NULL,
	"guest_count_source" text NOT NULL,
	"arrival_at" timestamp with time zone NOT NULL,
	"departure_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_registrations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "guest_registrations_reservation_key" UNIQUE("tenant_id","reservation_provider","external_reservation_id"),
	CONSTRAINT "guest_registrations_status_valid" CHECK ("guest_registrations"."status" IN ('draft', 'submitted')),
	CONSTRAINT "guest_registrations_reservation_provider_valid" CHECK ("guest_registrations"."reservation_provider" IN ('apaleo', 'mock')),
	CONSTRAINT "guest_registrations_guest_count_source_valid" CHECK ("guest_registrations"."guest_count_source" IN ('reservation', 'guest')),
	CONSTRAINT "guest_registrations_external_reservation_id_not_blank" CHECK (char_length(btrim("guest_registrations"."external_reservation_id")) BETWEEN 1 AND 255),
	CONSTRAINT "guest_registrations_guest_count_range" CHECK ("guest_registrations"."guest_count" BETWEEN 1 AND 12),
	CONSTRAINT "guest_registrations_stay_range" CHECK ("guest_registrations"."departure_at" > "guest_registrations"."arrival_at"),
	CONSTRAINT "guest_registrations_submitted_consistent" CHECK (("guest_registrations"."status" = 'submitted') = ("guest_registrations"."submitted_at" IS NOT NULL)),
	CONSTRAINT "guest_registrations_version_positive" CHECK ("guest_registrations"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "guest_registrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "property_journey_settings" (
	"tenant_id" text NOT NULL,
	"property_id" text NOT NULL,
	"registration" jsonb NOT NULL,
	"access" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_journey_settings_pkey" PRIMARY KEY("tenant_id","property_id"),
	CONSTRAINT "property_journey_settings_documents_are_objects" CHECK (jsonb_typeof("property_journey_settings"."registration") = 'object' AND jsonb_typeof("property_journey_settings"."access") = 'object')
);
--> statement-breakpoint
ALTER TABLE "property_journey_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "unit_access_codes" (
	"tenant_id" text NOT NULL,
	"property_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"code_ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_access_codes_pkey" PRIMARY KEY("tenant_id","property_id","unit_id"),
	CONSTRAINT "unit_access_codes_ciphertext_format" CHECK ("unit_access_codes"."code_ciphertext" ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
);
--> statement-breakpoint
ALTER TABLE "unit_access_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guest_registration_guests" ADD CONSTRAINT "guest_registration_guests_registration_fkey" FOREIGN KEY ("tenant_id","registration_id") REFERENCES "public"."guest_registrations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_registration_syncs" ADD CONSTRAINT "guest_registration_syncs_registration_fkey" FOREIGN KEY ("tenant_id","registration_id") REFERENCES "public"."guest_registrations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_registrations" ADD CONSTRAINT "guest_registrations_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_journey_settings" ADD CONSTRAINT "property_journey_settings_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_access_codes" ADD CONSTRAINT "unit_access_codes_unit_fkey" FOREIGN KEY ("tenant_id","property_id","unit_id") REFERENCES "public"."units"("tenant_id","property_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_registration_syncs_due_idx" ON "guest_registration_syncs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "guest_registrations_purge_after_idx" ON "guest_registrations" USING btree ("purge_after");