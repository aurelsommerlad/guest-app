CREATE TABLE "payment_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"property_id" text NOT NULL,
	"reservation_provider" text NOT NULL,
	"external_reservation_id" text NOT NULL,
	"folio_id" text,
	"payment_request_id" uuid,
	"kind" text NOT NULL,
	"state" text,
	"amount_minor" integer,
	"currency" text,
	"provider_payment_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"actor" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_audit_events_kind_valid" CHECK ("payment_audit_events"."kind" IN ('state-observed', 'payment-confirmed', 'request-created', 'request-status-changed')),
	CONSTRAINT "payment_audit_events_actor_valid" CHECK ("payment_audit_events"."actor" IN ('system', 'guest', 'admin')),
	CONSTRAINT "payment_audit_events_reservation_provider_valid" CHECK ("payment_audit_events"."reservation_provider" IN ('apaleo', 'mock')),
	CONSTRAINT "payment_audit_events_state_valid" CHECK ("payment_audit_events"."state" IS NULL OR "payment_audit_events"."state" IN ('not-applicable', 'not-due', 'due', 'pending', 'paid', 'credit', 'review', 'unknown', 'preparing', 'succeeded', 'failed', 'canceled', 'expired')),
	CONSTRAINT "payment_audit_events_amount_currency" CHECK (("payment_audit_events"."amount_minor" IS NULL) = ("payment_audit_events"."currency" IS NULL) AND ("payment_audit_events"."currency" IS NULL OR "payment_audit_events"."currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "payment_audit_events_folio_id_length" CHECK ("payment_audit_events"."folio_id" IS NULL OR char_length("payment_audit_events"."folio_id") BETWEEN 1 AND 255)
);
--> statement-breakpoint
ALTER TABLE "payment_audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"property_id" text NOT NULL,
	"reservation_provider" text NOT NULL,
	"external_reservation_id" text NOT NULL,
	"external_booking_id" text,
	"payment_provider" text NOT NULL,
	"folio_id" text NOT NULL,
	"provider_payment_id" text,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'preparing' NOT NULL,
	"idempotency_key" text NOT NULL,
	"return_ref" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_checked_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_requests_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_requests_idempotency_key_key" UNIQUE("payment_provider","idempotency_key"),
	CONSTRAINT "payment_requests_return_ref_key" UNIQUE("return_ref"),
	CONSTRAINT "payment_requests_reservation_provider_valid" CHECK ("payment_requests"."reservation_provider" IN ('apaleo', 'mock')),
	CONSTRAINT "payment_requests_payment_provider_valid" CHECK ("payment_requests"."payment_provider" IN ('apaleo')),
	CONSTRAINT "payment_requests_status_valid" CHECK ("payment_requests"."status" IN ('preparing', 'pending', 'succeeded', 'failed', 'canceled', 'expired')),
	CONSTRAINT "payment_requests_external_reservation_id_not_blank" CHECK (char_length(btrim("payment_requests"."external_reservation_id")) BETWEEN 1 AND 255),
	CONSTRAINT "payment_requests_external_booking_id_length" CHECK ("payment_requests"."external_booking_id" IS NULL OR char_length("payment_requests"."external_booking_id") BETWEEN 1 AND 255),
	CONSTRAINT "payment_requests_folio_id_not_blank" CHECK (char_length(btrim("payment_requests"."folio_id")) BETWEEN 1 AND 255),
	CONSTRAINT "payment_requests_provider_payment_id_length" CHECK ("payment_requests"."provider_payment_id" IS NULL OR char_length("payment_requests"."provider_payment_id") BETWEEN 1 AND 255),
	CONSTRAINT "payment_requests_amount_positive" CHECK ("payment_requests"."amount_minor" > 0),
	CONSTRAINT "payment_requests_currency_format" CHECK ("payment_requests"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_requests_idempotency_key_format" CHECK ("payment_requests"."idempotency_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "payment_requests_return_ref_format" CHECK ("payment_requests"."return_ref" ~ '^[A-Za-z0-9_-]{32,64}$'),
	CONSTRAINT "payment_requests_provider_payment_id_required" CHECK ("payment_requests"."status" NOT IN ('pending', 'succeeded') OR "payment_requests"."provider_payment_id" IS NOT NULL),
	CONSTRAINT "payment_requests_settled_consistent" CHECK (("payment_requests"."status" IN ('succeeded', 'failed', 'canceled', 'expired')) = ("payment_requests"."settled_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "payment_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reservation_payment_states" (
	"tenant_id" text NOT NULL,
	"property_id" text NOT NULL,
	"reservation_provider" text NOT NULL,
	"external_reservation_id" text NOT NULL,
	"external_booking_id" text,
	"last_state" text NOT NULL,
	"last_checked_at" timestamp with time zone NOT NULL,
	"cleared_at" timestamp with time zone,
	"cleared_amount_minor" integer,
	"cleared_currency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_payment_states_pkey" PRIMARY KEY("tenant_id","reservation_provider","external_reservation_id"),
	CONSTRAINT "reservation_payment_states_reservation_provider_valid" CHECK ("reservation_payment_states"."reservation_provider" IN ('apaleo', 'mock')),
	CONSTRAINT "reservation_payment_states_last_state_valid" CHECK ("reservation_payment_states"."last_state" IN ('not-applicable', 'not-due', 'due', 'pending', 'paid', 'credit', 'review', 'unknown')),
	CONSTRAINT "reservation_payment_states_external_reservation_id_not_blank" CHECK (char_length(btrim("reservation_payment_states"."external_reservation_id")) BETWEEN 1 AND 255),
	CONSTRAINT "reservation_payment_states_external_booking_id_length" CHECK ("reservation_payment_states"."external_booking_id" IS NULL OR char_length("reservation_payment_states"."external_booking_id") BETWEEN 1 AND 255),
	CONSTRAINT "reservation_payment_states_cleared_consistent" CHECK (("reservation_payment_states"."cleared_at" IS NULL AND "reservation_payment_states"."cleared_amount_minor" IS NULL AND "reservation_payment_states"."cleared_currency" IS NULL) OR ("reservation_payment_states"."cleared_at" IS NOT NULL AND "reservation_payment_states"."cleared_amount_minor" > 0 AND "reservation_payment_states"."cleared_currency" ~ '^[A-Z]{3}$'))
);
--> statement-breakpoint
ALTER TABLE "reservation_payment_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_audit_events" ADD CONSTRAINT "payment_audit_events_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_audit_events" ADD CONSTRAINT "payment_audit_events_request_fkey" FOREIGN KEY ("tenant_id","payment_request_id") REFERENCES "public"."payment_requests"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_payment_states" ADD CONSTRAINT "reservation_payment_states_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_audit_events_reservation_idx" ON "payment_audit_events" USING btree ("tenant_id","reservation_provider","external_reservation_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_provider_payment_key" ON "payment_requests" USING btree ("payment_provider","provider_payment_id") WHERE "payment_requests"."provider_payment_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_one_open_per_folio" ON "payment_requests" USING btree ("tenant_id","payment_provider","folio_id") WHERE "payment_requests"."status" IN ('preparing', 'pending');--> statement-breakpoint
CREATE INDEX "payment_requests_reservation_idx" ON "payment_requests" USING btree ("tenant_id","reservation_provider","external_reservation_id");--> statement-breakpoint
CREATE INDEX "payment_requests_open_due_idx" ON "payment_requests" USING btree ("status","expires_at");