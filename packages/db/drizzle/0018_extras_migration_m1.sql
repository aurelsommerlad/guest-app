CREATE TABLE "admin_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"property_id" text,
	"actor_type" text NOT NULL,
	"actor_admin_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_audit_events_actor_valid" CHECK ("admin_audit_events"."actor_type" IN ('admin', 'guest', 'system', 'import')),
	CONSTRAINT "admin_audit_events_values_valid" CHECK ("admin_audit_events"."action" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' AND char_length("admin_audit_events"."action") <= 80
        AND "admin_audit_events"."entity_type" ~ '^[a-z][a-z0-9_]{0,40}$'
        AND ("admin_audit_events"."entity_id" IS NULL OR char_length("admin_audit_events"."entity_id") BETWEEN 1 AND 200)
        AND ("admin_audit_events"."property_id" IS NULL OR "admin_audit_events"."property_id" ~ '^[a-z0-9][a-z0-9-]{0,63}$')
        AND jsonb_typeof("admin_audit_events"."details") = 'object' AND pg_column_size("admin_audit_events"."details") <= 8192)
);
--> statement-breakpoint
ALTER TABLE "admin_audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "admin_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"property_scope" text DEFAULT 'all' NOT NULL,
	"property_ids" text[] DEFAULT '{}' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"source" text DEFAULT 'stay' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_invitations_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "admin_invitations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "admin_invitations_token_hash_format" CHECK ("admin_invitations"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "admin_invitations_email_format" CHECK ("admin_invitations"."email" = lower("admin_invitations"."email") AND char_length("admin_invitations"."email") BETWEEN 3 AND 254 AND position('@' in "admin_invitations"."email") > 1),
	CONSTRAINT "admin_invitations_role_valid" CHECK ("admin_invitations"."role" IN ('owner', 'admin', 'manager', 'viewer')),
	CONSTRAINT "admin_invitations_scope_valid" CHECK ("admin_invitations"."property_scope" IN ('all', 'selected')),
	CONSTRAINT "admin_invitations_source_valid" CHECK ("admin_invitations"."source" IN ('stay', 'extras')),
	CONSTRAINT "admin_invitations_scope_shape" CHECK (("admin_invitations"."property_scope" = 'all' AND cardinality("admin_invitations"."property_ids") = 0)
        OR ("admin_invitations"."property_scope" = 'selected' AND "admin_invitations"."role" <> 'owner'
          AND cardinality("admin_invitations"."property_ids") BETWEEN 1 AND 100)),
	CONSTRAINT "admin_invitations_not_accepted_and_revoked" CHECK ("admin_invitations"."accepted_at" IS NULL OR "admin_invitations"."revoked_at" IS NULL),
	CONSTRAINT "admin_invitations_expiry_after_creation" CHECK ("admin_invitations"."expires_at" > "admin_invitations"."created_at")
);
--> statement-breakpoint
ALTER TABLE "admin_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "admin_user_properties" (
	"tenant_id" text NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_user_properties_pkey" PRIMARY KEY("admin_user_id","property_id")
);
--> statement-breakpoint
ALTER TABLE "admin_user_properties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "apaleo_write_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"property_id" text NOT NULL,
	"external_reservation_id" text NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"trigger" text NOT NULL,
	"actor_admin_id" uuid,
	"result_code" text,
	"http_status" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apaleo_write_operations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "apaleo_write_operations_idempotency_key" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "apaleo_write_operations_operation_valid" CHECK ("apaleo_write_operations"."operation" IN ('book-service', 'amend-occupancy', 'amend-stay', 'move-service', 'update-vehicle')),
	CONSTRAINT "apaleo_write_operations_status_valid" CHECK ("apaleo_write_operations"."status" IN ('pending', 'blocked', 'simulated', 'succeeded', 'failed')),
	CONSTRAINT "apaleo_write_operations_trigger_valid" CHECK ("apaleo_write_operations"."trigger" IN ('guest', 'admin', 'system')),
	CONSTRAINT "apaleo_write_operations_request_hash_valid" CHECK ("apaleo_write_operations"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "apaleo_write_operations_values_valid" CHECK ("apaleo_write_operations"."idempotency_key" ~ '^[A-Za-z0-9_:.-]{8,200}$'
        AND char_length("apaleo_write_operations"."external_reservation_id") BETWEEN 1 AND 100
        AND ("apaleo_write_operations"."result_code" IS NULL OR "apaleo_write_operations"."result_code" ~ '^[a-z0-9_]{1,60}$')
        AND ("apaleo_write_operations"."http_status" IS NULL OR "apaleo_write_operations"."http_status" BETWEEN 100 AND 599)
        AND "apaleo_write_operations"."attempts" BETWEEN 0 AND 20),
	CONSTRAINT "apaleo_write_operations_completion" CHECK (("apaleo_write_operations"."status" IN ('pending') AND "apaleo_write_operations"."completed_at" IS NULL)
        OR ("apaleo_write_operations"."status" <> 'pending' AND "apaleo_write_operations"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "apaleo_write_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "migration_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"source_key" text NOT NULL,
	"source_hash" text NOT NULL,
	"action" text NOT NULL,
	"target_id" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "migration_items_run_source_key" UNIQUE("run_id","entity_type","source_key"),
	CONSTRAINT "migration_items_action_valid" CHECK ("migration_items"."action" IN ('create', 'update', 'unchanged', 'conflict', 'skip', 'error')),
	CONSTRAINT "migration_items_source_hash_valid" CHECK ("migration_items"."source_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "migration_items_values_valid" CHECK ("migration_items"."entity_type" ~ '^[a-z][a-z0-9_]{0,40}$'
        AND char_length("migration_items"."source_key") BETWEEN 1 AND 200 AND "migration_items"."source_key" !~ '@'
        AND ("migration_items"."target_id" IS NULL OR char_length("migration_items"."target_id") BETWEEN 1 AND 200)
        AND ("migration_items"."reason" IS NULL OR "migration_items"."reason" ~ '^[a-z0-9_]{1,60}$'))
);
--> statement-breakpoint
ALTER TABLE "migration_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "migration_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"snapshot_sha256" text NOT NULL,
	"started_by" uuid,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "migration_runs_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "migration_runs_mode_valid" CHECK ("migration_runs"."mode" IN ('dry-run', 'apply')),
	CONSTRAINT "migration_runs_status_valid" CHECK ("migration_runs"."status" IN ('running', 'completed', 'failed')),
	CONSTRAINT "migration_runs_snapshot_valid" CHECK ("migration_runs"."snapshot_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "migration_runs_finished" CHECK (("migration_runs"."status" = 'running') = ("migration_runs"."finished_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "migration_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"property_id" text,
	"channel" text NOT NULL,
	"template" text NOT NULL,
	"dedup_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_code" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_outbox_dedup_key" UNIQUE("tenant_id","dedup_key"),
	CONSTRAINT "notification_outbox_channel_valid" CHECK ("notification_outbox"."channel" IN ('slack', 'guest-email', 'guest-push')),
	CONSTRAINT "notification_outbox_status_valid" CHECK ("notification_outbox"."status" IN ('pending', 'sending', 'sent', 'failed', 'suppressed')),
	CONSTRAINT "notification_outbox_values_valid" CHECK ("notification_outbox"."template" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' AND char_length("notification_outbox"."template") <= 80
        AND "notification_outbox"."dedup_key" ~ '^[A-Za-z0-9_:.-]{1,200}$'
        AND "notification_outbox"."attempts" BETWEEN 0 AND 50
        AND ("notification_outbox"."last_error_code" IS NULL OR "notification_outbox"."last_error_code" ~ '^[a-z0-9_]{1,60}$')
        AND ("notification_outbox"."property_id" IS NULL OR "notification_outbox"."property_id" ~ '^[a-z0-9][a-z0-9-]{0,63}$')
        AND jsonb_typeof("notification_outbox"."payload") = 'object' AND pg_column_size("notification_outbox"."payload") <= 16384
        AND (("notification_outbox"."status" = 'sent') = ("notification_outbox"."sent_at" IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "notification_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "property_service_settings" (
	"tenant_id" text NOT NULL,
	"property_id" text NOT NULL,
	"extension_night_enabled" boolean DEFAULT false NOT NULL,
	"discount_pre_arrival_one_night_gap" integer DEFAULT 15 NOT NULL,
	"discount_pre_arrival_standard" integer DEFAULT 10 NOT NULL,
	"discount_in_house_one_night_gap" integer DEFAULT 20 NOT NULL,
	"discount_in_house_standard" integer DEFAULT 15 NOT NULL,
	"min_sellable_stay_nights" integer DEFAULT 2 NOT NULL,
	"slack_route" text,
	"imported_hash" text,
	"imported_at" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_service_settings_pkey" PRIMARY KEY("tenant_id","property_id"),
	CONSTRAINT "property_service_settings_discounts_valid" CHECK ("property_service_settings"."discount_pre_arrival_one_night_gap" BETWEEN 0 AND 90 AND "property_service_settings"."discount_pre_arrival_standard" BETWEEN 0 AND 90
        AND "property_service_settings"."discount_in_house_one_night_gap" BETWEEN 0 AND 90 AND "property_service_settings"."discount_in_house_standard" BETWEEN 0 AND 90),
	CONSTRAINT "property_service_settings_min_nights_valid" CHECK ("property_service_settings"."min_sellable_stay_nights" BETWEEN 1 AND 30),
	CONSTRAINT "property_service_settings_slack_route_valid" CHECK ("property_service_settings"."slack_route" IS NULL OR "property_service_settings"."slack_route" ~ '^[a-z0-9-]{1,40}$'),
	CONSTRAINT "property_service_settings_imported_hash_valid" CHECK ("property_service_settings"."imported_hash" IS NULL OR "property_service_settings"."imported_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "property_service_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "service_booking_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"booking_id" uuid NOT NULL,
	"offer_id" uuid,
	"apaleo_service_id" text NOT NULL,
	"display_name" text NOT NULL,
	"action_type" text DEFAULT 'service' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"service_dates" date[] DEFAULT '{}' NOT NULL,
	"amount_cents" integer,
	"currency" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"write_operation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_booking_items_status_valid" CHECK ("service_booking_items"."status" IN ('pending', 'booked', 'failed', 'skipped')),
	CONSTRAINT "service_booking_items_action_type_valid" CHECK ("service_booking_items"."action_type" IN ('service', 'increase_occupancy')),
	CONSTRAINT "service_booking_items_values_valid" CHECK ("service_booking_items"."apaleo_service_id" ~ '^[A-Za-z0-9_-]{1,120}$'
        AND char_length(btrim("service_booking_items"."display_name")) BETWEEN 1 AND 200
        AND "service_booking_items"."quantity" BETWEEN 1 AND 50
        AND cardinality("service_booking_items"."service_dates") <= 400
        AND ("service_booking_items"."amount_cents" IS NULL OR "service_booking_items"."amount_cents" >= 0)
        AND ("service_booking_items"."currency" IS NULL OR "service_booking_items"."currency" ~ '^[A-Z]{3}$')
        AND ("service_booking_items"."error_code" IS NULL OR "service_booking_items"."error_code" ~ '^[a-z0-9_]{1,60}$'))
);
--> statement-breakpoint
ALTER TABLE "service_booking_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "service_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"property_id" text NOT NULL,
	"reservation_provider" text NOT NULL,
	"external_reservation_id" text NOT NULL,
	"external_booking_id" text,
	"status" text DEFAULT 'processing' NOT NULL,
	"idempotency_key" text,
	"total_cents" integer,
	"currency" text,
	"source" text DEFAULT 'stay' NOT NULL,
	"legacy_id" text,
	"slack_notified_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_bookings_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "service_bookings_status_valid" CHECK ("service_bookings"."status" IN ('processing', 'completed', 'partial', 'failed')),
	CONSTRAINT "service_bookings_source_valid" CHECK ("service_bookings"."source" IN ('stay', 'extras')),
	CONSTRAINT "service_bookings_reservation_provider_valid" CHECK ("service_bookings"."reservation_provider" IN ('apaleo', 'mock')),
	CONSTRAINT "service_bookings_values_valid" CHECK (char_length("service_bookings"."external_reservation_id") BETWEEN 1 AND 100
        AND ("service_bookings"."external_booking_id" IS NULL OR char_length("service_bookings"."external_booking_id") BETWEEN 1 AND 100)
        AND ("service_bookings"."idempotency_key" IS NULL OR "service_bookings"."idempotency_key" ~ '^[A-Za-z0-9_:.-]{8,200}$')
        AND ("service_bookings"."legacy_id" IS NULL OR char_length("service_bookings"."legacy_id") BETWEEN 1 AND 100)
        AND ("service_bookings"."total_cents" IS NULL OR "service_bookings"."total_cents" >= 0)
        AND ("service_bookings"."currency" IS NULL OR "service_bookings"."currency" ~ '^[A-Z]{3}$'))
);
--> statement-breakpoint
ALTER TABLE "service_bookings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stay_extensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"property_id" text NOT NULL,
	"reservation_provider" text NOT NULL,
	"external_reservation_id" text NOT NULL,
	"old_departure" date NOT NULL,
	"new_departure" date NOT NULL,
	"new_departure_confirmed" boolean DEFAULT false NOT NULL,
	"phase" text,
	"gap" integer,
	"average_nightly_rate_cents" integer,
	"discount_percent" integer,
	"extension_price_cents" integer,
	"total_additional_cents" integer,
	"currency" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mandatory_services_intact" boolean,
	"status" text DEFAULT 'processing' NOT NULL,
	"source" text DEFAULT 'stay' NOT NULL,
	"legacy_id" text,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stay_extensions_status_valid" CHECK ("stay_extensions"."status" IN ('processing', 'confirmed', 'confirmed_with_issues', 'failed')),
	CONSTRAINT "stay_extensions_phase_valid" CHECK ("stay_extensions"."phase" IS NULL OR "stay_extensions"."phase" IN ('pre_arrival', 'in_house')),
	CONSTRAINT "stay_extensions_source_valid" CHECK ("stay_extensions"."source" IN ('stay', 'extras')),
	CONSTRAINT "stay_extensions_reservation_provider_valid" CHECK ("stay_extensions"."reservation_provider" IN ('apaleo', 'mock')),
	CONSTRAINT "stay_extensions_dates_valid" CHECK ("stay_extensions"."new_departure" > "stay_extensions"."old_departure"),
	CONSTRAINT "stay_extensions_values_valid" CHECK (("stay_extensions"."gap" IS NULL OR "stay_extensions"."gap" BETWEEN 0 AND 365)
        AND ("stay_extensions"."discount_percent" IS NULL OR "stay_extensions"."discount_percent" BETWEEN 0 AND 90)
        AND ("stay_extensions"."average_nightly_rate_cents" IS NULL OR "stay_extensions"."average_nightly_rate_cents" >= 0)
        AND ("stay_extensions"."extension_price_cents" IS NULL OR "stay_extensions"."extension_price_cents" >= 0)
        AND ("stay_extensions"."total_additional_cents" IS NULL OR "stay_extensions"."total_additional_cents" >= 0)
        AND ("stay_extensions"."currency" IS NULL OR "stay_extensions"."currency" ~ '^[A-Z]{3}$')
        AND ("stay_extensions"."legacy_id" IS NULL OR char_length("stay_extensions"."legacy_id") BETWEEN 1 AND 100)
        AND jsonb_typeof("stay_extensions"."details") = 'object')
);
--> statement-breakpoint
ALTER TABLE "stay_extensions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant_service_settings" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"service_writer" text DEFAULT 'extras' NOT NULL,
	"go_live_state" text DEFAULT 'extras_active' NOT NULL,
	"changed_at" timestamp with time zone,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_service_settings_writer_valid" CHECK ("tenant_service_settings"."service_writer" IN ('extras', 'stay')),
	CONSTRAINT "tenant_service_settings_state_valid" CHECK ("tenant_service_settings"."go_live_state" IN ('extras_active', 'syncing', 'extras_locked', 'stay_active')),
	CONSTRAINT "tenant_service_settings_writer_matches_state" CHECK (("tenant_service_settings"."service_writer" = 'stay') = ("tenant_service_settings"."go_live_state" = 'stay_active'))
);
--> statement-breakpoint
ALTER TABLE "tenant_service_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "role" text DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "property_scope" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
-- Existing admin accounts (created before roles existed) keep their full access as owners.
UPDATE "admin_users" SET "role" = 'owner', "property_scope" = 'all';--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "action_type" text;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "booking_rule" text;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "fulfillment" text;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "extra_person_price_cents" integer;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "price_unit_label" jsonb;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "requires_remaining_capacity" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "requires_vehicle_registration" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "max_one_per_reservation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "allowed_unit_group_ids" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "title_override" jsonb;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "teaser_override" jsonb;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "body_override" jsonb;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "hero_image_override" jsonb;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "price_override" jsonb;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "availability_override" jsonb;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "legacy_key" text;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "imported_hash" text;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "offer_requests" ADD COLUMN "apaleo_service_id" text;--> statement-breakpoint
ALTER TABLE "offer_requests" ADD COLUMN "quantity" integer;--> statement-breakpoint
ALTER TABLE "offer_requests" ADD COLUMN "requested_dates" date[];--> statement-breakpoint
ALTER TABLE "offer_requests" ADD COLUMN "booked_service_dates" date[];--> statement-breakpoint
ALTER TABLE "offer_requests" ADD COLUMN "source" text DEFAULT 'stay' NOT NULL;--> statement-breakpoint
ALTER TABLE "offer_requests" ADD COLUMN "legacy_id" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "legacy_key" text;--> statement-breakpoint
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_invited_by_fkey" FOREIGN KEY ("tenant_id","invited_by") REFERENCES "public"."admin_users"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_accepted_user_fkey" FOREIGN KEY ("tenant_id","accepted_user_id") REFERENCES "public"."admin_users"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_user_properties" ADD CONSTRAINT "admin_user_properties_admin_user_fkey" FOREIGN KEY ("tenant_id","admin_user_id") REFERENCES "public"."admin_users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_user_properties" ADD CONSTRAINT "admin_user_properties_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apaleo_write_operations" ADD CONSTRAINT "apaleo_write_operations_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apaleo_write_operations" ADD CONSTRAINT "apaleo_write_operations_actor_fkey" FOREIGN KEY ("tenant_id","actor_admin_id") REFERENCES "public"."admin_users"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_items" ADD CONSTRAINT "migration_items_run_fkey" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."migration_runs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_runs" ADD CONSTRAINT "migration_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_runs" ADD CONSTRAINT "migration_runs_started_by_fkey" FOREIGN KEY ("tenant_id","started_by") REFERENCES "public"."admin_users"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_service_settings" ADD CONSTRAINT "property_service_settings_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_service_settings" ADD CONSTRAINT "property_service_settings_updated_by_fkey" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "public"."admin_users"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_booking_items" ADD CONSTRAINT "service_booking_items_booking_fkey" FOREIGN KEY ("tenant_id","booking_id") REFERENCES "public"."service_bookings"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_booking_items" ADD CONSTRAINT "service_booking_items_offer_fkey" FOREIGN KEY ("tenant_id","offer_id") REFERENCES "public"."offers"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_bookings" ADD CONSTRAINT "service_bookings_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_extensions" ADD CONSTRAINT "stay_extensions_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_service_settings" ADD CONSTRAINT "tenant_service_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_service_settings" ADD CONSTRAINT "tenant_service_settings_changed_by_fkey" FOREIGN KEY ("tenant_id","changed_by") REFERENCES "public"."admin_users"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_events_tenant_created_idx" ON "admin_audit_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_events_entity_idx" ON "admin_audit_events" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_invitations_open_email_idx" ON "admin_invitations" USING btree ("tenant_id","email") WHERE "admin_invitations"."accepted_at" IS NULL AND "admin_invitations"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "admin_user_properties_property_idx" ON "admin_user_properties" USING btree ("tenant_id","property_id");--> statement-breakpoint
CREATE INDEX "apaleo_write_operations_reservation_idx" ON "apaleo_write_operations" USING btree ("tenant_id","external_reservation_id","created_at");--> statement-breakpoint
CREATE INDEX "apaleo_write_operations_status_idx" ON "apaleo_write_operations" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "migration_runs_tenant_started_idx" ON "migration_runs" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE INDEX "notification_outbox_due_idx" ON "notification_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "service_booking_items_booking_idx" ON "service_booking_items" USING btree ("tenant_id","booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_bookings_legacy_id_idx" ON "service_bookings" USING btree ("tenant_id","legacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_bookings_idempotency_idx" ON "service_bookings" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "service_bookings_reservation_idx" ON "service_bookings" USING btree ("tenant_id","reservation_provider","external_reservation_id");--> statement-breakpoint
CREATE INDEX "service_bookings_property_created_idx" ON "service_bookings" USING btree ("tenant_id","property_id","created_at");--> statement-breakpoint
CREATE INDEX "service_bookings_purge_idx" ON "service_bookings" USING btree ("purge_after");--> statement-breakpoint
CREATE UNIQUE INDEX "stay_extensions_legacy_id_idx" ON "stay_extensions" USING btree ("tenant_id","legacy_id");--> statement-breakpoint
CREATE INDEX "stay_extensions_reservation_idx" ON "stay_extensions" USING btree ("tenant_id","reservation_provider","external_reservation_id");--> statement-breakpoint
CREATE INDEX "stay_extensions_property_created_idx" ON "stay_extensions" USING btree ("tenant_id","property_id","created_at");--> statement-breakpoint
ALTER TABLE "offer_properties" ADD CONSTRAINT "offer_properties_updated_by_fkey" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "public"."admin_users"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "offer_properties_legacy_key_idx" ON "offer_properties" USING btree ("tenant_id","legacy_key");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_properties_apaleo_service_idx" ON "offer_properties" USING btree ("tenant_id","property_id","extras_service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_requests_legacy_id_idx" ON "offer_requests" USING btree ("tenant_id","legacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_legacy_key_idx" ON "offers" USING btree ("tenant_id","legacy_key");--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_role_valid" CHECK ("admin_users"."role" IN ('owner', 'admin', 'manager', 'viewer'));--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_property_scope_valid" CHECK ("admin_users"."property_scope" IN ('all', 'selected'));--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_owner_all_properties" CHECK ("admin_users"."role" <> 'owner' OR "admin_users"."property_scope" = 'all');--> statement-breakpoint
ALTER TABLE "offer_properties" ADD CONSTRAINT "offer_properties_action_type_valid" CHECK ("offer_properties"."action_type" IS NULL OR "offer_properties"."action_type" IN ('service', 'increase_occupancy'));--> statement-breakpoint
ALTER TABLE "offer_properties" ADD CONSTRAINT "offer_properties_booking_rule_valid" CHECK ("offer_properties"."booking_rule" IS NULL OR "offer_properties"."booking_rule" IN ('per_stay', 'per_night', 'arrival_day', 'departure_day'));--> statement-breakpoint
ALTER TABLE "offer_properties" ADD CONSTRAINT "offer_properties_fulfillment_valid" CHECK ("offer_properties"."fulfillment" IS NULL OR "offer_properties"."fulfillment" IN ('instant', 'request', 'link'));--> statement-breakpoint
ALTER TABLE "offer_properties" ADD CONSTRAINT "offer_properties_occupancy_shape" CHECK ("offer_properties"."action_type" IS DISTINCT FROM 'increase_occupancy'
        OR (coalesce("offer_properties"."fulfillment", 'instant') = 'instant' AND "offer_properties"."requires_remaining_capacity"));--> statement-breakpoint
ALTER TABLE "offer_properties" ADD CONSTRAINT "offer_properties_extra_person_price_valid" CHECK (("offer_properties"."extra_person_price_cents" IS NULL OR "offer_properties"."extra_person_price_cents" BETWEEN 0 AND 10000000)
        AND ("offer_properties"."extra_person_price_cents" IS NULL OR "offer_properties"."action_type" = 'increase_occupancy')
        AND ("offer_properties"."currency" IS NULL OR "offer_properties"."currency" ~ '^[A-Z]{3}$'));--> statement-breakpoint
ALTER TABLE "offer_properties" ADD CONSTRAINT "offer_properties_unit_groups_valid" CHECK (cardinality("offer_properties"."allowed_unit_group_ids") <= 50
        AND array_to_string("offer_properties"."allowed_unit_group_ids", ',') ~ '^[A-Za-z0-9_,-]*$');--> statement-breakpoint
ALTER TABLE "offer_properties" ADD CONSTRAINT "offer_properties_legacy_key_valid" CHECK ("offer_properties"."legacy_key" IS NULL OR "offer_properties"."legacy_key" ~ '^[A-Za-z0-9_-]{1,40}:[A-Za-z0-9_-]{1,120}$');--> statement-breakpoint
ALTER TABLE "offer_properties" ADD CONSTRAINT "offer_properties_imported_hash_valid" CHECK ("offer_properties"."imported_hash" IS NULL OR "offer_properties"."imported_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "offer_requests" ADD CONSTRAINT "offer_requests_source_valid" CHECK ("offer_requests"."source" IN ('stay', 'extras'));--> statement-breakpoint
ALTER TABLE "offer_requests" ADD CONSTRAINT "offer_requests_service_valid" CHECK (("offer_requests"."apaleo_service_id" IS NULL OR "offer_requests"."apaleo_service_id" ~ '^[A-Za-z0-9_-]{1,120}$')
        AND ("offer_requests"."quantity" IS NULL OR "offer_requests"."quantity" BETWEEN 1 AND 50)
        AND ("offer_requests"."legacy_id" IS NULL OR char_length("offer_requests"."legacy_id") BETWEEN 1 AND 100));--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_legacy_key_valid" CHECK ("offers"."legacy_key" IS NULL OR "offers"."legacy_key" ~ '^extras:[A-Za-z0-9_-]{1,120}$');
--> statement-breakpoint
-- Revision-safe admin audit log: rows are only added; never changed, deleted or truncated.
CREATE OR REPLACE FUNCTION public.admin_audit_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_events is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER admin_audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON public.admin_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.admin_audit_events_append_only();
--> statement-breakpoint
CREATE TRIGGER admin_audit_events_no_truncate
  BEFORE TRUNCATE ON public.admin_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.admin_audit_events_append_only();
--> statement-breakpoint
-- Production writer switch (prepared, not active): STAY can only become the Apaleo service
-- writer through the go-live procedure, which sets up.writer_switch = 'on' for its
-- transaction. Any other write path (admin form, import, SQL slip) is rejected.
CREATE OR REPLACE FUNCTION public.tenant_service_settings_guard_writer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND (NEW.service_writer <> 'extras' OR NEW.go_live_state <> 'extras_active'))
    OR (TG_OP = 'UPDATE' AND (NEW.service_writer IS DISTINCT FROM OLD.service_writer
      OR NEW.go_live_state IS DISTINCT FROM OLD.go_live_state)) THEN
    IF coalesce(current_setting('up.writer_switch', true), '') <> 'on' THEN
      RAISE EXCEPTION 'service writer / go-live state change only via the go-live procedure'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER tenant_service_settings_guard_writer
  BEFORE INSERT OR UPDATE ON public.tenant_service_settings
  FOR EACH ROW EXECUTE FUNCTION public.tenant_service_settings_guard_writer();
--> statement-breakpoint
-- Property configuration must fit the offer kind: Apaleo booking fields only for own
-- services, price/availability overrides only for partner offers.
CREATE OR REPLACE FUNCTION public.offer_properties_kind_shape()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  offer_kind text;
BEGIN
  SELECT o.kind INTO offer_kind FROM public.offers o
    WHERE o.tenant_id = NEW.tenant_id AND o.id = NEW.offer_id;
  IF offer_kind = 'partner' AND (NEW.extras_service_id IS NOT NULL OR NEW.action_type IS NOT NULL
      OR NEW.booking_rule IS NOT NULL OR NEW.extra_person_price_cents IS NOT NULL
      OR NEW.requires_remaining_capacity OR NEW.requires_vehicle_registration
      OR NEW.max_one_per_reservation OR NEW.fulfillment = 'instant') THEN
    RAISE EXCEPTION 'offer_properties: Apaleo booking settings are only allowed for own services'
      USING ERRCODE = 'check_violation';
  END IF;
  IF offer_kind = 'house-service' AND (NEW.price_override IS NOT NULL
      OR NEW.availability_override IS NOT NULL OR NEW.fulfillment = 'link') THEN
    RAISE EXCEPTION 'offer_properties: price/availability overrides are only allowed for partner offers'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER offer_properties_kind_shape
  BEFORE INSERT OR UPDATE ON public.offer_properties
  FOR EACH ROW EXECUTE FUNCTION public.offer_properties_kind_shape();
--> statement-breakpoint
-- Keep the Supabase Data API closed for the new tables (second layer besides RLS).
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.admin_user_properties, public.admin_invitations, public.property_service_settings, public.tenant_service_settings, public.service_bookings, public.service_booking_items, public.stay_extensions, public.apaleo_write_operations, public.admin_audit_events, public.notification_outbox, public.migration_runs, public.migration_items FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END
$$;
