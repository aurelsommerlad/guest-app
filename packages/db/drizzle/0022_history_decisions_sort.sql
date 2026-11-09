ALTER TABLE "offer_requests" DROP CONSTRAINT "offer_requests_values_valid";--> statement-breakpoint
ALTER TABLE "offer_properties" ALTER COLUMN "sort_order" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "offer_requests" ADD COLUMN "handled_by_external" text;--> statement-breakpoint
ALTER TABLE "offer_requests" ADD COLUMN "service_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "offer_properties" ADD CONSTRAINT "offer_properties_sort_order_valid" CHECK ("offer_properties"."sort_order" BETWEEN -1000000000 AND 1000000000);--> statement-breakpoint
ALTER TABLE "offer_requests" ADD CONSTRAINT "offer_requests_values_valid" CHECK (("offer_requests"."people" IS NULL OR "offer_requests"."people" BETWEEN 1 AND 50)
        AND ("offer_requests"."requested_time" IS NULL OR "offer_requests"."requested_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
        AND ("offer_requests"."note" IS NULL OR (char_length("offer_requests"."note") <= 500 AND "offer_requests"."note" !~ '[<>]'))
        AND ("offer_requests"."quoted_cents" IS NULL OR "offer_requests"."quoted_cents" >= 0)
        AND ("offer_requests"."currency" IS NULL OR "offer_requests"."currency" ~ '^[A-Z]{3}$')
        AND (("offer_requests"."handled_at" IS NULL) = ("offer_requests"."handled_by" IS NULL AND "offer_requests"."handled_by_external" IS NULL))
        AND ("offer_requests"."handled_by" IS NULL OR "offer_requests"."handled_by_external" IS NULL)
        AND ("offer_requests"."handled_by_external" IS NULL OR "offer_requests"."handled_by_external" ~ '^[A-Za-z0-9 ._:()-]{1,80}$')
        AND ("offer_requests"."service_name_snapshot" IS NULL OR (char_length("offer_requests"."service_name_snapshot") BETWEEN 1 AND 200 AND "offer_requests"."service_name_snapshot" !~ '[<>]')));