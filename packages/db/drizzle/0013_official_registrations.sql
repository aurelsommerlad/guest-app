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