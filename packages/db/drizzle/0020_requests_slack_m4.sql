ALTER TABLE "notification_outbox" DROP CONSTRAINT "notification_outbox_values_valid";--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "delivery_mode" text;--> statement-breakpoint
ALTER TABLE "offer_requests" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "offer_requests" ADD COLUMN "decision_reason" text;--> statement-breakpoint
ALTER TABLE "property_service_settings" ADD COLUMN "slack_decision_updates" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "offer_requests_idempotency_idx" ON "offer_requests" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_values_valid" CHECK ("notification_outbox"."template" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' AND char_length("notification_outbox"."template") <= 80
        AND "notification_outbox"."dedup_key" ~ '^[A-Za-z0-9_:.-]{1,200}$'
        AND "notification_outbox"."attempts" BETWEEN 0 AND 50
        AND ("notification_outbox"."last_error_code" IS NULL OR "notification_outbox"."last_error_code" ~ '^[a-z0-9_]{1,60}$')
        AND ("notification_outbox"."property_id" IS NULL OR "notification_outbox"."property_id" ~ '^[a-z0-9][a-z0-9-]{0,63}$')
        AND jsonb_typeof("notification_outbox"."payload") = 'object' AND pg_column_size("notification_outbox"."payload") <= 16384
        AND (("notification_outbox"."status" = 'sent') = ("notification_outbox"."sent_at" IS NOT NULL))
        AND ("notification_outbox"."delivery_mode" IS NULL OR "notification_outbox"."delivery_mode" IN ('simulated', 'live')));--> statement-breakpoint
ALTER TABLE "offer_requests" ADD CONSTRAINT "offer_requests_m4_values_valid" CHECK (("offer_requests"."idempotency_key" IS NULL OR "offer_requests"."idempotency_key" ~ '^[A-Za-z0-9_:.-]{8,200}$')
        AND ("offer_requests"."decision_reason" IS NULL OR (char_length("offer_requests"."decision_reason") BETWEEN 1 AND 500 AND "offer_requests"."decision_reason" !~ '[<>]')));