CREATE TABLE "guest_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"property_id" text NOT NULL,
	"unit_id" text,
	"reservation_provider" text NOT NULL,
	"external_reservation_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_access_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "guest_access_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "guest_access_reservation_provider_valid" CHECK ("guest_access"."reservation_provider" IN ('apaleo', 'mock')),
	CONSTRAINT "guest_access_external_reservation_id_not_blank" CHECK (char_length(btrim("guest_access"."external_reservation_id")) BETWEEN 1 AND 255),
	CONSTRAINT "guest_access_token_hash_format" CHECK ("guest_access"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "guest_access_valid_range" CHECK ("guest_access"."valid_until" > "guest_access"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "guest_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guest_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"guest_access_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_sessions_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "guest_sessions_token_hash_format" CHECK ("guest_sessions"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "guest_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"hits" integer NOT NULL,
	CONSTRAINT "rate_limit_buckets_hits_positive" CHECK ("rate_limit_buckets"."hits" > 0),
	CONSTRAINT "rate_limit_buckets_key_length" CHECK (char_length("rate_limit_buckets"."key") BETWEEN 1 AND 128)
);
--> statement-breakpoint
ALTER TABLE "rate_limit_buckets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Moved up by hand: the unique constraint must exist before guest_access_unit_fkey references it.
ALTER TABLE "units" ADD CONSTRAINT "units_tenant_id_property_id_id_key" UNIQUE("tenant_id","property_id","id");--> statement-breakpoint
ALTER TABLE "guest_access" ADD CONSTRAINT "guest_access_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_access" ADD CONSTRAINT "guest_access_unit_fkey" FOREIGN KEY ("tenant_id","property_id","unit_id") REFERENCES "public"."units"("tenant_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_guest_access_fkey" FOREIGN KEY ("tenant_id","guest_access_id") REFERENCES "public"."guest_access"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_access_reservation_idx" ON "guest_access" USING btree ("tenant_id","reservation_provider","external_reservation_id");--> statement-breakpoint
CREATE INDEX "guest_sessions_guest_access_id_idx" ON "guest_sessions" USING btree ("guest_access_id");--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_window_started_at_idx" ON "rate_limit_buckets" USING btree ("window_started_at");