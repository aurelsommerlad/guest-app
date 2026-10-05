CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_sessions_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "admin_sessions_token_hash_format" CHECK ("admin_sessions"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"password_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_key" UNIQUE("email"),
	CONSTRAINT "admin_users_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "admin_users_email_format" CHECK ("admin_users"."email" = lower("admin_users"."email") AND char_length("admin_users"."email") BETWEEN 3 AND 254 AND position('@' in "admin_users"."email") > 1),
	CONSTRAINT "admin_users_password_hash_format" CHECK ("admin_users"."password_hash" LIKE 'scrypt$%'),
	CONSTRAINT "admin_users_status_valid" CHECK ("admin_users"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "admin_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guide_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"scope_level" text NOT NULL,
	"property_id" text,
	"unit_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"icon" text,
	"slug" jsonb,
	"eyebrow" jsonb,
	"title" jsonb,
	"short_description" jsonb,
	"visibility" jsonb,
	"intro" jsonb,
	"hero_image" jsonb,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_locale" text DEFAULT 'de' NOT NULL,
	"translation_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_sections_key_format" CHECK ("guide_sections"."key" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
	CONSTRAINT "guide_sections_kind_valid" CHECK ("guide_sections"."kind" IN ('topic', 'override')),
	CONSTRAINT "guide_sections_scope_level_valid" CHECK ("guide_sections"."scope_level" IN ('tenant', 'property', 'unit')),
	CONSTRAINT "guide_sections_status_valid" CHECK ("guide_sections"."status" IN ('draft', 'published', 'archived')),
	CONSTRAINT "guide_sections_source_locale_valid" CHECK ("guide_sections"."source_locale" IN ('de', 'en')),
	CONSTRAINT "guide_sections_scope_shape" CHECK (("guide_sections"."scope_level" = 'tenant' AND "guide_sections"."property_id" IS NULL AND "guide_sections"."unit_id" IS NULL)
        OR ("guide_sections"."scope_level" = 'property' AND "guide_sections"."property_id" IS NOT NULL AND "guide_sections"."unit_id" IS NULL)
        OR ("guide_sections"."scope_level" = 'unit' AND "guide_sections"."property_id" IS NOT NULL AND "guide_sections"."unit_id" IS NOT NULL)),
	CONSTRAINT "guide_sections_topic_shape" CHECK ("guide_sections"."kind" <> 'topic' OR ("guide_sections"."title" IS NOT NULL AND "guide_sections"."slug" IS NOT NULL
        AND "guide_sections"."short_description" IS NOT NULL AND "guide_sections"."icon" IS NOT NULL)),
	CONSTRAINT "guide_sections_override_shape" CHECK ("guide_sections"."kind" <> 'override' OR ("guide_sections"."scope_level" = 'unit' AND "guide_sections"."title" IS NULL
        AND "guide_sections"."slug" IS NULL AND "guide_sections"."short_description" IS NULL AND "guide_sections"."eyebrow" IS NULL
        AND "guide_sections"."icon" IS NULL AND "guide_sections"."visibility" IS NULL)),
	CONSTRAINT "guide_sections_icon_valid" CHECK ("guide_sections"."icon" IS NULL OR "guide_sections"."icon" IN ('car', 'wifi', 'home', 'plug', 'thermometer', 'trash', 'book-open', 'log-out', 'key', 'info')),
	CONSTRAINT "guide_sections_blocks_array" CHECK (jsonb_typeof("guide_sections"."blocks") = 'array')
);
--> statement-breakpoint
ALTER TABLE "guide_sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_fkey" FOREIGN KEY ("tenant_id","admin_user_id") REFERENCES "public"."admin_users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_sections" ADD CONSTRAINT "guide_sections_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_sections" ADD CONSTRAINT "guide_sections_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_sections" ADD CONSTRAINT "guide_sections_unit_fkey" FOREIGN KEY ("tenant_id","property_id","unit_id") REFERENCES "public"."units"("tenant_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_sessions_admin_user_id_idx" ON "admin_sessions" USING btree ("admin_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guide_sections_live_key_idx" ON "guide_sections" USING btree ("tenant_id","kind",coalesce("property_id", ''),coalesce("unit_id", ''),"key") WHERE "guide_sections"."status" <> 'archived';--> statement-breakpoint
CREATE INDEX "guide_sections_tenant_property_idx" ON "guide_sections" USING btree ("tenant_id","property_id");