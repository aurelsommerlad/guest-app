CREATE TABLE "offer_metrics_daily" (
	"tenant_id" text NOT NULL,
	"property_id" text NOT NULL,
	"offer_id" uuid NOT NULL,
	"day" date NOT NULL,
	"placement" text NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"click_outs" integer DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"bookings" integer DEFAULT 0 NOT NULL,
	"revenue_cents" bigint DEFAULT 0 NOT NULL,
	"commission_cents" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_metrics_daily_pkey" PRIMARY KEY("tenant_id","property_id","offer_id","day","placement"),
	CONSTRAINT "offer_metrics_daily_placement_valid" CHECK ("offer_metrics_daily"."placement" IN ('home', 'services', 'detail', 'booked')),
	CONSTRAINT "offer_metrics_daily_counts_valid" CHECK ("offer_metrics_daily"."impressions" >= 0 AND "offer_metrics_daily"."views" >= 0 AND "offer_metrics_daily"."click_outs" >= 0 AND "offer_metrics_daily"."requests" >= 0
        AND "offer_metrics_daily"."bookings" >= 0 AND "offer_metrics_daily"."revenue_cents" >= 0 AND "offer_metrics_daily"."commission_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "offer_metrics_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "offer_properties" (
	"tenant_id" text NOT NULL,
	"offer_id" uuid NOT NULL,
	"property_id" text NOT NULL,
	"extras_service_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_properties_pkey" PRIMARY KEY("offer_id","property_id"),
	CONSTRAINT "offer_properties_extras_service_id_valid" CHECK ("offer_properties"."extras_service_id" IS NULL OR "offer_properties"."extras_service_id" ~ '^[A-Za-z0-9_-]{1,120}$')
);
--> statement-breakpoint
ALTER TABLE "offer_properties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "offer_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"offer_id" uuid NOT NULL,
	"property_id" text NOT NULL,
	"reservation_provider" text NOT NULL,
	"external_reservation_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_date" date,
	"requested_time" text,
	"people" integer,
	"note" text,
	"placement" text,
	"quoted_cents" integer,
	"currency" text,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"slack_notified_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_requests_status_valid" CHECK ("offer_requests"."status" IN ('pending', 'confirmed', 'declined', 'cancelled')),
	CONSTRAINT "offer_requests_values_valid" CHECK (("offer_requests"."people" IS NULL OR "offer_requests"."people" BETWEEN 1 AND 50)
        AND ("offer_requests"."requested_time" IS NULL OR "offer_requests"."requested_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
        AND ("offer_requests"."note" IS NULL OR (char_length("offer_requests"."note") <= 500 AND "offer_requests"."note" !~ '[<>]'))
        AND ("offer_requests"."quoted_cents" IS NULL OR "offer_requests"."quoted_cents" >= 0)
        AND ("offer_requests"."currency" IS NULL OR "offer_requests"."currency" ~ '^[A-Z]{3}$')
        AND (("offer_requests"."handled_by" IS NULL) = ("offer_requests"."handled_at" IS NULL)))
);
--> statement-breakpoint
ALTER TABLE "offer_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"partner_id" uuid,
	"category" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"slug" jsonb NOT NULL,
	"title" jsonb NOT NULL,
	"teaser" jsonb NOT NULL,
	"body" jsonb,
	"details" jsonb,
	"hero_image" jsonb,
	"gallery" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fulfillment" text NOT NULL,
	"booking_url" text,
	"price" jsonb,
	"duration_minutes" integer,
	"cancellation" jsonb NOT NULL,
	"commission" jsonb,
	"availability" jsonb NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_locale" text DEFAULT 'de' NOT NULL,
	"translation_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "offers_kind_valid" CHECK ("offers"."kind" IN ('house-service', 'partner')),
	CONSTRAINT "offers_category_valid" CHECK ("offers"."category" IN ('arrival-departure', 'longer-stay', 'mobility', 'pets', 'comfort', 'food', 'food-drink', 'nature', 'activities', 'wellness', 'shopping', 'sights')),
	CONSTRAINT "offers_status_valid" CHECK ("offers"."status" IN ('draft', 'published', 'archived')),
	CONSTRAINT "offers_fulfillment_valid" CHECK ("offers"."fulfillment" IN ('instant', 'request', 'link')),
	CONSTRAINT "offers_source_locale_valid" CHECK ("offers"."source_locale" IN ('de', 'en')),
	CONSTRAINT "offers_kind_shape" CHECK (("offers"."kind" = 'partner' AND "offers"."partner_id" IS NOT NULL AND "offers"."price" IS NOT NULL
          AND "offers"."fulfillment" IN ('request', 'link'))
        OR ("offers"."kind" = 'house-service' AND "offers"."partner_id" IS NULL AND "offers"."price" IS NULL
          AND "offers"."commission" IS NULL AND "offers"."booking_url" IS NULL AND "offers"."fulfillment" IN ('instant', 'request'))),
	CONSTRAINT "offers_link_has_url" CHECK ("offers"."fulfillment" <> 'link' OR "offers"."booking_url" IS NOT NULL),
	CONSTRAINT "offers_booking_url_valid" CHECK ("offers"."booking_url" IS NULL OR ("offers"."booking_url" ~ '^https?://' AND char_length("offers"."booking_url") <= 2000)),
	CONSTRAINT "offers_texts_present" CHECK (jsonb_typeof("offers"."title") = 'object' AND "offers"."title" ? 'de'
        AND jsonb_typeof("offers"."teaser") = 'object' AND "offers"."teaser" ? 'de'
        AND jsonb_typeof("offers"."slug") = 'object' AND "offers"."slug" ? 'de'),
	CONSTRAINT "offers_price_valid" CHECK (coalesce("offers"."price" IS NULL OR "offers"."price"->>'model' = 'on-request'
        OR ("offers"."price"->>'model' IN ('fixed', 'from', 'per-person')
          AND ("offers"."price"->>'amountCents')::int >= 0 AND "offers"."price"->>'currency' ~ '^[A-Z]{3}$'), false)),
	CONSTRAINT "offers_cancellation_valid" CHECK (coalesce("offers"."cancellation"->>'type' IN ('non-refundable', 'on-request', 'partner-terms')
        OR ("offers"."cancellation"->>'type' = 'free-until' AND ("offers"."cancellation"->>'hoursBefore')::int BETWEEN 0 AND 720), false)),
	CONSTRAINT "offers_commission_valid" CHECK ("offers"."commission" IS NULL OR coalesce(("offers"."commission"->>'type' = 'none')
    OR ("offers"."commission"->>'type' = 'percent' AND ("offers"."commission"->>'basisPoints')::int BETWEEN 1 AND 5000)
    OR ("offers"."commission"->>'type' = 'fixed' AND ("offers"."commission"->>'amountCents')::int > 0
      AND "offers"."commission"->>'currency' ~ '^[A-Z]{3}$'), false)),
	CONSTRAINT "offers_duration_valid" CHECK ("offers"."duration_minutes" IS NULL OR "offers"."duration_minutes" BETWEEN 5 AND 20160),
	CONSTRAINT "offers_gallery_valid" CHECK (jsonb_typeof("offers"."gallery") = 'array' AND jsonb_array_length("offers"."gallery") <= 8)
);
--> statement-breakpoint
ALTER TABLE "offers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"explore_place_id" uuid,
	"website_url" text,
	"commission" jsonb DEFAULT '{"type":"none"}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "partners_status_valid" CHECK ("partners"."status" IN ('active', 'inactive')),
	CONSTRAINT "partners_name_length" CHECK (char_length("partners"."name") BETWEEN 2 AND 120 AND "partners"."name" !~ '[<>]'),
	CONSTRAINT "partners_website_url_valid" CHECK ("partners"."website_url" IS NULL OR ("partners"."website_url" ~ '^https?://' AND char_length("partners"."website_url") <= 2000)),
	CONSTRAINT "partners_commission_valid" CHECK (coalesce(("partners"."commission"->>'type' = 'none')
    OR ("partners"."commission"->>'type' = 'percent' AND ("partners"."commission"->>'basisPoints')::int BETWEEN 1 AND 5000)
    OR ("partners"."commission"->>'type' = 'fixed' AND ("partners"."commission"->>'amountCents')::int > 0
      AND "partners"."commission"->>'currency' ~ '^[A-Z]{3}$'), false))
);
--> statement-breakpoint
ALTER TABLE "partners" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "offer_metrics_daily" ADD CONSTRAINT "offer_metrics_daily_offer_fkey" FOREIGN KEY ("tenant_id","offer_id") REFERENCES "public"."offers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD CONSTRAINT "offer_properties_offer_fkey" FOREIGN KEY ("tenant_id","offer_id") REFERENCES "public"."offers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD CONSTRAINT "offer_properties_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_requests" ADD CONSTRAINT "offer_requests_offer_fkey" FOREIGN KEY ("tenant_id","offer_id") REFERENCES "public"."offers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_requests" ADD CONSTRAINT "offer_requests_handled_by_fkey" FOREIGN KEY ("tenant_id","handled_by") REFERENCES "public"."admin_users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_partner_fkey" FOREIGN KEY ("tenant_id","partner_id") REFERENCES "public"."partners"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_explore_place_fkey" FOREIGN KEY ("tenant_id","explore_place_id") REFERENCES "public"."explore_places"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offer_properties_property_idx" ON "offer_properties" USING btree ("tenant_id","property_id");--> statement-breakpoint
CREATE INDEX "offer_requests_reservation_idx" ON "offer_requests" USING btree ("tenant_id","reservation_provider","external_reservation_id");--> statement-breakpoint
CREATE INDEX "offer_requests_status_idx" ON "offer_requests" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "offer_requests_purge_idx" ON "offer_requests" USING btree ("purge_after");--> statement-breakpoint
CREATE INDEX "offers_tenant_status_idx" ON "offers" USING btree ("tenant_id","status");--> statement-breakpoint
-- Keep the Supabase Data API closed for the new tables (second layer besides RLS).
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.partners, public.offers, public.offer_properties, public.offer_metrics_daily, public.offer_requests FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END
$$;
