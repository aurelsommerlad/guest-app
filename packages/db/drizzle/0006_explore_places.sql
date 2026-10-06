CREATE TABLE "explore_place_properties" (
	"tenant_id" text NOT NULL,
	"place_id" uuid NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "explore_place_properties_pkey" PRIMARY KEY("place_id","property_id")
);
--> statement-breakpoint
ALTER TABLE "explore_place_properties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "explore_places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"category" text NOT NULL,
	"slug" jsonb NOT NULL,
	"title" jsonb NOT NULL,
	"teaser" jsonb NOT NULL,
	"description" jsonb,
	"tip" jsonb,
	"opening_hours" jsonb,
	"hero_image" jsonb,
	"address" text,
	"locality" text,
	"maps_url" text,
	"website_url" text,
	"phone" text,
	"reservation_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"source_locale" text DEFAULT 'de' NOT NULL,
	"translation_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "explore_places_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "explore_places_status_valid" CHECK ("explore_places"."status" IN ('draft', 'published', 'archived')),
	CONSTRAINT "explore_places_category_valid" CHECK ("explore_places"."category" IN ('food-drink', 'nature', 'activities', 'wellness', 'shopping', 'sights')),
	CONSTRAINT "explore_places_source_locale_valid" CHECK ("explore_places"."source_locale" IN ('de', 'en')),
	CONSTRAINT "explore_places_texts_present" CHECK (jsonb_typeof("explore_places"."title") = 'object' AND "explore_places"."title" ? 'de'
        AND jsonb_typeof("explore_places"."teaser") = 'object' AND "explore_places"."teaser" ? 'de'
        AND jsonb_typeof("explore_places"."slug") = 'object' AND "explore_places"."slug" ? 'de'),
	CONSTRAINT "explore_places_maps_url_valid" CHECK ("explore_places"."maps_url" IS NULL OR ("explore_places"."maps_url" ~ '^https?://' AND char_length("explore_places"."maps_url") <= 2000)),
	CONSTRAINT "explore_places_website_url_valid" CHECK ("explore_places"."website_url" IS NULL OR ("explore_places"."website_url" ~ '^https?://' AND char_length("explore_places"."website_url") <= 2000)),
	CONSTRAINT "explore_places_reservation_url_valid" CHECK ("explore_places"."reservation_url" IS NULL OR ("explore_places"."reservation_url" ~ '^https?://' AND char_length("explore_places"."reservation_url") <= 2000)),
	CONSTRAINT "explore_places_phone_valid" CHECK ("explore_places"."phone" IS NULL OR "explore_places"."phone" ~ '^\+?[0-9][0-9 ()/-]{2,38}$'),
	CONSTRAINT "explore_places_address_length" CHECK (("explore_places"."address" IS NULL OR char_length("explore_places"."address") <= 300)
        AND ("explore_places"."locality" IS NULL OR char_length("explore_places"."locality") <= 80))
);
--> statement-breakpoint
ALTER TABLE "explore_places" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "explore_place_properties" ADD CONSTRAINT "explore_place_properties_place_fkey" FOREIGN KEY ("tenant_id","place_id") REFERENCES "public"."explore_places"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explore_place_properties" ADD CONSTRAINT "explore_place_properties_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explore_places" ADD CONSTRAINT "explore_places_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "explore_place_properties_property_idx" ON "explore_place_properties" USING btree ("tenant_id","property_id");--> statement-breakpoint
CREATE INDEX "explore_places_tenant_status_idx" ON "explore_places" USING btree ("tenant_id","status");