CREATE TABLE "external_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"provider" text NOT NULL,
	"entity_type" text NOT NULL,
	"internal_entity_id" text NOT NULL,
	"external_id" text NOT NULL,
	"property_id" text GENERATED ALWAYS AS (CASE WHEN entity_type = 'property' THEN internal_entity_id END) STORED,
	"unit_id" text GENERATED ALWAYS AS (CASE WHEN entity_type = 'unit' THEN internal_entity_id END) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_mappings_external_key" UNIQUE("tenant_id","provider","entity_type","external_id"),
	CONSTRAINT "external_mappings_internal_key" UNIQUE("tenant_id","provider","entity_type","internal_entity_id"),
	CONSTRAINT "external_mappings_provider_valid" CHECK ("external_mappings"."provider" IN ('apaleo')),
	CONSTRAINT "external_mappings_entity_type_valid" CHECK ("external_mappings"."entity_type" IN ('property', 'unit')),
	CONSTRAINT "external_mappings_external_id_not_blank" CHECK (char_length(btrim("external_mappings"."external_id")) BETWEEN 1 AND 255)
);
--> statement-breakpoint
ALTER TABLE "external_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "properties" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"spoken_name" text NOT NULL,
	"location_name" text NOT NULL,
	"timezone" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "properties_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "properties_tenant_id_slug_key" UNIQUE("tenant_id","slug"),
	CONSTRAINT "properties_id_format" CHECK ("properties"."id" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
	CONSTRAINT "properties_slug_format" CHECK ("properties"."slug" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
	CONSTRAINT "properties_display_name_not_blank" CHECK (char_length(btrim("properties"."display_name")) BETWEEN 1 AND 100),
	CONSTRAINT "properties_spoken_name_not_blank" CHECK (char_length(btrim("properties"."spoken_name")) BETWEEN 1 AND 100),
	CONSTRAINT "properties_location_name_not_blank" CHECK (char_length(btrim("properties"."location_name")) BETWEEN 1 AND 100),
	CONSTRAINT "properties_timezone_not_blank" CHECK (char_length(btrim("properties"."timezone")) BETWEEN 1 AND 64)
);
--> statement-breakpoint
ALTER TABLE "properties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_key" UNIQUE("slug"),
	CONSTRAINT "tenants_id_format" CHECK ("tenants"."id" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
	CONSTRAINT "tenants_slug_format" CHECK ("tenants"."slug" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
	CONSTRAINT "tenants_name_not_blank" CHECK (char_length(btrim("tenants"."name")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "units" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"property_id" text NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "units_property_id_slug_key" UNIQUE("property_id","slug"),
	CONSTRAINT "units_id_format" CHECK ("units"."id" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
	CONSTRAINT "units_slug_format" CHECK ("units"."slug" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
	CONSTRAINT "units_display_name_not_blank" CHECK (char_length(btrim("units"."display_name")) BETWEEN 1 AND 100)
);
--> statement-breakpoint
ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "external_mappings" ADD CONSTRAINT "external_mappings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_mappings" ADD CONSTRAINT "external_mappings_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_mappings" ADD CONSTRAINT "external_mappings_unit_fkey" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "units_tenant_id_property_id_idx" ON "units" USING btree ("tenant_id","property_id");