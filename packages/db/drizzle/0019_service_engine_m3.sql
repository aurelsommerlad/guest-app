CREATE TABLE "service_locks" (
	"tenant_id" text NOT NULL,
	"lock_key" text NOT NULL,
	"holder" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_locks_pkey" PRIMARY KEY("tenant_id","lock_key"),
	CONSTRAINT "service_locks_values_valid" CHECK ("service_locks"."lock_key" ~ '^[A-Za-z0-9_:.-]{1,200}$' AND char_length("service_locks"."holder") BETWEEN 1 AND 100)
);
--> statement-breakpoint
ALTER TABLE "service_locks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "apaleo_write_operations" DROP CONSTRAINT "apaleo_write_operations_operation_valid";--> statement-breakpoint
ALTER TABLE "service_locks" ADD CONSTRAINT "service_locks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_locks_expires_idx" ON "service_locks" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "apaleo_write_operations" ADD CONSTRAINT "apaleo_write_operations_operation_valid" CHECK ("apaleo_write_operations"."operation" IN ('book-service', 'amend-occupancy', 'amend-stay', 'move-service', 'update-vehicle', 'append-comment'));