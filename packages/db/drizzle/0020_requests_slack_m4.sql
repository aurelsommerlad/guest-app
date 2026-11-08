ALTER TABLE "offer_requests" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "offer_requests" ADD COLUMN "decision_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "offer_requests_idempotency_idx" ON "offer_requests" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "offer_requests" ADD CONSTRAINT "offer_requests_m4_values_valid" CHECK (("offer_requests"."idempotency_key" IS NULL OR "offer_requests"."idempotency_key" ~ '^[A-Za-z0-9_:.-]{8,200}$')
        AND ("offer_requests"."decision_reason" IS NULL OR (char_length("offer_requests"."decision_reason") BETWEEN 1 AND 500 AND "offer_requests"."decision_reason" !~ '[<>]')));