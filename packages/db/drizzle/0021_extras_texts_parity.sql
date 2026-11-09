ALTER TABLE "offer_properties" ADD COLUMN "extras_texts" jsonb;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD CONSTRAINT "offer_properties_extras_texts_valid" CHECK ("offer_properties"."extras_texts" IS NULL OR (jsonb_typeof("offer_properties"."extras_texts") = 'object'
        AND pg_column_size("offer_properties"."extras_texts") <= 16384));