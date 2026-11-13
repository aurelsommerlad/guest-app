CREATE TABLE "admin_user_grants" (
	"tenant_id" text NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"granted_by_admin_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_user_grants_pkey" PRIMARY KEY("admin_user_id","permission"),
	CONSTRAINT "admin_user_grants_permission_valid" CHECK ("admin_user_grants"."permission" IN ('inbox.read'))
);
--> statement-breakpoint
ALTER TABLE "admin_user_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "channel_account_properties" (
	"tenant_id" text NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"property_id" text NOT NULL,
	"external_property_id" text,
	"messaging_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_account_properties_pkey" PRIMARY KEY("channel_account_id","property_id"),
	CONSTRAINT "channel_account_properties_external_key" UNIQUE("channel_account_id","external_property_id"),
	CONSTRAINT "channel_account_properties_external_valid" CHECK ("channel_account_properties"."external_property_id" IS NULL OR "channel_account_properties"."external_property_id" ~ '^[A-Za-z0-9_-]{1,100}$')
);
--> statement-breakpoint
ALTER TABLE "channel_account_properties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "channel_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"environment" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_accounts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "channel_accounts_label_key" UNIQUE("tenant_id","provider","label"),
	CONSTRAINT "channel_accounts_provider_valid" CHECK ("channel_accounts"."provider" IN ('stay', 'channex', 'whatsapp', 'simulated')),
	CONSTRAINT "channel_accounts_environment_valid" CHECK ("channel_accounts"."environment" IN ('simulated', 'staging', 'production')),
	CONSTRAINT "channel_accounts_values_valid" CHECK (char_length(btrim("channel_accounts"."label")) BETWEEN 1 AND 120
        AND "channel_accounts"."status" IN ('active', 'paused', 'error')
        AND jsonb_typeof("channel_accounts"."config") = 'object' AND pg_column_size("channel_accounts"."config") <= 4096
        AND ("channel_accounts"."secret_ref" IS NULL OR "channel_accounts"."secret_ref" ~ '^[A-Z][A-Z0-9_]{2,63}$'))
);
--> statement-breakpoint
ALTER TABLE "channel_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_admin_user_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_events_type_valid" CHECK ("conversation_events"."type" IN ('created', 'status_changed', 'assigned', 'unassigned', 'reservation_linked', 'reservation_unlinked', 'note_added', 'reply_queued', 'message_failed', 'message_uncertain', 'delivery_retried', 'external_closed', 'no_reply_needed', 'attachment_rejected')),
	CONSTRAINT "conversation_events_values_valid" CHECK ("conversation_events"."actor_kind" IN ('staff', 'system', 'guest')
        AND ("conversation_events"."actor_kind" <> 'staff' OR "conversation_events"."actor_admin_user_id" IS NOT NULL)
        AND jsonb_typeof("conversation_events"."details") = 'object' AND pg_column_size("conversation_events"."details") <= 2048)
);
--> statement-breakpoint
ALTER TABLE "conversation_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"origin" text NOT NULL,
	"sender_participant_id" uuid,
	"author_admin_user_id" uuid,
	"body" text NOT NULL,
	"language" text,
	"client_message_id" uuid,
	"external_message_id" text,
	"delivery_status" text,
	"delivery_error_code" text,
	"provider_created_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_messages_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "conversation_messages_external_key" UNIQUE("tenant_id","conversation_id","external_message_id"),
	CONSTRAINT "conversation_messages_client_key" UNIQUE("tenant_id","client_message_id"),
	CONSTRAINT "conversation_messages_direction_valid" CHECK ("conversation_messages"."direction" IN ('inbound', 'outbound', 'internal')),
	CONSTRAINT "conversation_messages_origin_valid" CHECK ("conversation_messages"."origin" IN ('guest', 'staff', 'staff_ai_assisted', 'ai_auto', 'system', 'ota_system')),
	CONSTRAINT "conversation_messages_values_valid" CHECK (char_length(btrim("conversation_messages"."body")) BETWEEN 1 AND 8000
        AND ("conversation_messages"."language" IS NULL OR "conversation_messages"."language" ~ '^[a-z]{2}$')
        AND ("conversation_messages"."external_message_id" IS NULL OR "conversation_messages"."external_message_id" ~ '^[A-Za-z0-9_:.-]{1,200}$')
        AND ("conversation_messages"."delivery_error_code" IS NULL OR "conversation_messages"."delivery_error_code" ~ '^[a-z0-9_]{1,60}$')
        AND ("conversation_messages"."delivery_status" IS NULL OR "conversation_messages"."delivery_status" IN ('received', 'queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'uncertain'))),
	CONSTRAINT "conversation_messages_direction_shape" CHECK (("conversation_messages"."direction" = 'internal' AND "conversation_messages"."delivery_status" IS NULL AND "conversation_messages"."author_admin_user_id" IS NOT NULL
             AND char_length("conversation_messages"."body") <= 4000)
        OR ("conversation_messages"."direction" = 'inbound' AND "conversation_messages"."delivery_status" = 'received')
        OR ("conversation_messages"."direction" = 'outbound' AND "conversation_messages"."delivery_status" IS NOT NULL AND "conversation_messages"."delivery_status" <> 'received'))
);
--> statement-breakpoint
ALTER TABLE "conversation_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"display_name" text NOT NULL,
	"admin_user_id" uuid,
	"guest_access_id" uuid,
	"external_participant_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_participants_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "conversation_participants_kind_valid" CHECK ("conversation_participants"."kind" IN ('guest', 'staff', 'ai', 'system', 'ota')),
	CONSTRAINT "conversation_participants_values_valid" CHECK (char_length(btrim("conversation_participants"."display_name")) BETWEEN 1 AND 120
        AND ("conversation_participants"."external_participant_id" IS NULL OR "conversation_participants"."external_participant_id" ~ '^[A-Za-z0-9_:.+-]{1,200}$')
        AND ("conversation_participants"."kind" <> 'staff' OR "conversation_participants"."admin_user_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "conversation_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversation_reads" (
	"tenant_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "conversation_reads_pkey" PRIMARY KEY("conversation_id","admin_user_id")
);
--> statement-breakpoint
ALTER TABLE "conversation_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversation_reservation_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"property_id" text NOT NULL,
	"reservation_provider" text NOT NULL,
	"external_reservation_id" text NOT NULL,
	"external_booking_ref" text,
	"link_method" text NOT NULL,
	"confidence" text DEFAULT 'exact' NOT NULL,
	"linked_by_admin_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_reservation_links_key" UNIQUE("conversation_id","reservation_provider","external_reservation_id"),
	CONSTRAINT "conversation_reservation_links_values_valid" CHECK ("conversation_reservation_links"."reservation_provider" IN ('apaleo', 'mock')
        AND "conversation_reservation_links"."link_method" IN ('guest_session', 'channex_booking', 'ota_code_match', 'manual', 'simulated')
        AND "conversation_reservation_links"."confidence" IN ('exact', 'suggested')
        AND "conversation_reservation_links"."external_reservation_id" ~ '^[A-Za-z0-9_-]{1,100}$'
        AND ("conversation_reservation_links"."external_booking_ref" IS NULL OR "conversation_reservation_links"."external_booking_ref" ~ '^[A-Za-z0-9_:.-]{1,120}$'))
);
--> statement-breakpoint
ALTER TABLE "conversation_reservation_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"property_id" text,
	"channel_account_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"kind" text DEFAULT 'reservation' NOT NULL,
	"external_thread_id" text,
	"title" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assigned_admin_user_id" uuid,
	"snoozed_until" timestamp with time zone,
	"external_closed" boolean DEFAULT false NOT NULL,
	"guest_language" text,
	"last_message_preview" text,
	"last_message_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "conversations_thread_key" UNIQUE("tenant_id","channel_account_id","external_thread_id"),
	CONSTRAINT "conversations_channel_valid" CHECK ("conversations"."channel" IN ('stay_chat', 'booking_com', 'airbnb', 'expedia', 'whatsapp', 'other')),
	CONSTRAINT "conversations_kind_valid" CHECK ("conversations"."kind" IN ('reservation', 'inquiry', 'reservation_request', 'general')),
	CONSTRAINT "conversations_status_valid" CHECK ("conversations"."status" IN ('open', 'pending', 'done')),
	CONSTRAINT "conversations_values_valid" CHECK (char_length(btrim("conversations"."title")) BETWEEN 1 AND 200
        AND "conversations"."priority" IN ('normal', 'high')
        AND ("conversations"."property_id" IS NULL OR "conversations"."property_id" ~ '^[a-z0-9][a-z0-9-]{0,63}$')
        AND ("conversations"."external_thread_id" IS NULL OR "conversations"."external_thread_id" ~ '^[A-Za-z0-9_:.-]{1,200}$')
        AND ("conversations"."guest_language" IS NULL OR "conversations"."guest_language" ~ '^[a-z]{2}$')
        AND ("conversations"."last_message_preview" IS NULL OR char_length("conversations"."last_message_preview") <= 200)
        AND "conversations"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"message_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer,
	"sha256" text,
	"storage_path" text,
	"external_attachment_id" text,
	"status" text DEFAULT 'pending_download' NOT NULL,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_attachments_values_valid" CHECK (char_length(btrim("message_attachments"."file_name")) BETWEEN 1 AND 200
        AND "message_attachments"."mime_type" ~ '^[a-z]+/[a-z0-9.+-]{1,100}$'
        AND ("message_attachments"."size_bytes" IS NULL OR "message_attachments"."size_bytes" BETWEEN 0 AND 26214400)
        AND ("message_attachments"."sha256" IS NULL OR "message_attachments"."sha256" ~ '^[0-9a-f]{64}$')
        AND "message_attachments"."status" IN ('pending_download', 'stored', 'rejected', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "message_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "message_delivery_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"message_id" uuid NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_delivery_jobs_message_key" UNIQUE("message_id"),
	CONSTRAINT "message_delivery_jobs_values_valid" CHECK ("message_delivery_jobs"."status" IN ('pending', 'sending', 'sent', 'failed', 'uncertain')
        AND "message_delivery_jobs"."attempts" BETWEEN 0 AND 50
        AND ("message_delivery_jobs"."last_error_code" IS NULL OR "message_delivery_jobs"."last_error_code" ~ '^[a-z0-9_]{1,60}$'))
);
--> statement-breakpoint
ALTER TABLE "message_delivery_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"subscription_id" uuid NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"dedup_key" text NOT NULL,
	"conversation_id" uuid,
	"status" text NOT NULL,
	"http_status" integer,
	"error_code" text,
	"purge_after" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_deliveries_dedup_key" UNIQUE("subscription_id","dedup_key"),
	CONSTRAINT "push_deliveries_kind_valid" CHECK ("push_deliveries"."kind" IN ('test', 'message', 'reminder')),
	CONSTRAINT "push_deliveries_status_valid" CHECK ("push_deliveries"."status" IN ('simulated', 'sent', 'failed', 'expired', 'skipped')),
	CONSTRAINT "push_deliveries_values_valid" CHECK ("push_deliveries"."dedup_key" ~ '^[A-Za-z0-9_:.-]{1,200}$'
        AND ("push_deliveries"."http_status" IS NULL OR "push_deliveries"."http_status" BETWEEN 100 AND 599)
        AND ("push_deliveries"."error_code" IS NULL OR "push_deliveries"."error_code" ~ '^[a-z0-9_]{1,60}$'))
);
--> statement-breakpoint
ALTER TABLE "push_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"device_label" text,
	"user_agent_family" text,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE("endpoint"),
	CONSTRAINT "push_subscriptions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "push_subscriptions_values_valid" CHECK ("push_subscriptions"."endpoint" ~ '^https://[^[:space:]]+$' AND char_length("push_subscriptions"."endpoint") BETWEEN 16 AND 1000
        AND "push_subscriptions"."p256dh" ~ '^[A-Za-z0-9_=-]{20,200}$'
        AND "push_subscriptions"."auth" ~ '^[A-Za-z0-9_=-]{8,100}$'
        AND ("push_subscriptions"."device_label" IS NULL OR char_length(btrim("push_subscriptions"."device_label")) BETWEEN 1 AND 60)
        AND ("push_subscriptions"."user_agent_family" IS NULL OR char_length("push_subscriptions"."user_agent_family") <= 60)
        AND "push_subscriptions"."failure_count" BETWEEN 0 AND 1000
        AND (("push_subscriptions"."revoked_at" IS NULL) = ("push_subscriptions"."revoked_reason" IS NULL))
        AND ("push_subscriptions"."revoked_reason" IS NULL OR "push_subscriptions"."revoked_reason" IN ('user', 'expired', 'gone', 'user_disabled', 'inactive')))
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_user_grants" ADD CONSTRAINT "admin_user_grants_user_fkey" FOREIGN KEY ("tenant_id","admin_user_id") REFERENCES "public"."admin_users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_account_properties" ADD CONSTRAINT "channel_account_properties_account_fkey" FOREIGN KEY ("tenant_id","channel_account_id") REFERENCES "public"."channel_accounts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_account_properties" ADD CONSTRAINT "channel_account_properties_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_conversation_fkey" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_fkey" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_sender_fkey" FOREIGN KEY ("tenant_id","sender_participant_id") REFERENCES "public"."conversation_participants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_fkey" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_conversation_fkey" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_user_fkey" FOREIGN KEY ("tenant_id","admin_user_id") REFERENCES "public"."admin_users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reservation_links" ADD CONSTRAINT "conversation_reservation_links_conversation_fkey" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reservation_links" ADD CONSTRAINT "conversation_reservation_links_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_property_fkey" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel_account_fkey" FOREIGN KEY ("tenant_id","channel_account_id") REFERENCES "public"."channel_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignee_fkey" FOREIGN KEY ("tenant_id","assigned_admin_user_id") REFERENCES "public"."admin_users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_fkey" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."conversation_messages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_delivery_jobs" ADD CONSTRAINT "message_delivery_jobs_message_fkey" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."conversation_messages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_delivery_jobs" ADD CONSTRAINT "message_delivery_jobs_account_fkey" FOREIGN KEY ("tenant_id","channel_account_id") REFERENCES "public"."channel_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_subscription_fkey" FOREIGN KEY ("tenant_id","subscription_id") REFERENCES "public"."push_subscriptions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_fkey" FOREIGN KEY ("tenant_id","admin_user_id") REFERENCES "public"."admin_users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_events_conversation_idx" ON "conversation_events" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_messages_conversation_idx" ON "conversation_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_reservation_links_reservation_idx" ON "conversation_reservation_links" USING btree ("tenant_id","reservation_provider","external_reservation_id");--> statement-breakpoint
CREATE INDEX "conversations_recent_idx" ON "conversations" USING btree ("tenant_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_property_idx" ON "conversations" USING btree ("tenant_id","property_id","status");--> statement-breakpoint
CREATE INDEX "message_delivery_jobs_due_idx" ON "message_delivery_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("tenant_id","admin_user_id");--> statement-breakpoint
-- Unified Inbox (ADR 0023): row level security for the role `stay_inbox`.
-- The inbox repository runs every query in a transaction with
--   set_config('app.tenant_id' | 'app.property_ids' | 'app.all_properties' | 'app.can_read_notes'
--              | 'app.admin_user_id' | 'app.actor', …, true) and SET LOCAL ROLE stay_inbox.
-- stay_inbox has no BYPASSRLS and owns no table, so these policies always apply to it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stay_inbox') THEN
    CREATE ROLE stay_inbox NOLOGIN NOINHERIT;
  END IF;
END
$$;
--> statement-breakpoint
GRANT stay_inbox TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO stay_inbox;
--> statement-breakpoint
GRANT SELECT ON public.channel_accounts, public.channel_account_properties TO stay_inbox;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.conversations, public.conversation_reservation_links,
  public.conversation_participants, public.conversation_messages, public.conversation_reads,
  public.message_attachments, public.message_delivery_jobs, public.push_subscriptions,
  public.push_deliveries TO stay_inbox;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.conversation_events TO stay_inbox;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.inbox_tenant_ok(row_tenant text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT row_tenant IS NOT NULL AND row_tenant = current_setting('app.tenant_id', true)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.inbox_property_ok(row_property text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(current_setting('app.all_properties', true), '') = 'on'
    OR (row_property IS NOT NULL AND row_property = ANY (
          string_to_array(nullif(current_setting('app.property_ids', true), ''), ',')))
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.inbox_tenant_ok(text), public.inbox_property_ok(text) TO stay_inbox;
--> statement-breakpoint
CREATE POLICY channel_accounts_inbox ON public.channel_accounts FOR SELECT TO stay_inbox
  USING (public.inbox_tenant_ok(tenant_id));
--> statement-breakpoint
CREATE POLICY channel_account_properties_inbox ON public.channel_account_properties FOR SELECT TO stay_inbox
  USING (public.inbox_tenant_ok(tenant_id) AND public.inbox_property_ok(property_id));
--> statement-breakpoint
CREATE POLICY conversations_inbox ON public.conversations FOR ALL TO stay_inbox
  USING (public.inbox_tenant_ok(tenant_id) AND public.inbox_property_ok(property_id))
  WITH CHECK (public.inbox_tenant_ok(tenant_id) AND public.inbox_property_ok(property_id));
--> statement-breakpoint
-- Child rows are visible exactly when their conversation is (the subquery is itself subject to RLS).
CREATE POLICY conversation_reservation_links_inbox ON public.conversation_reservation_links FOR ALL TO stay_inbox
  USING (public.inbox_tenant_ok(tenant_id) AND EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.tenant_id = conversation_reservation_links.tenant_id AND c.id = conversation_reservation_links.conversation_id))
  WITH CHECK (public.inbox_tenant_ok(tenant_id) AND EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.tenant_id = conversation_reservation_links.tenant_id AND c.id = conversation_reservation_links.conversation_id));
--> statement-breakpoint
CREATE POLICY conversation_participants_inbox ON public.conversation_participants FOR ALL TO stay_inbox
  USING (public.inbox_tenant_ok(tenant_id) AND EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.tenant_id = conversation_participants.tenant_id AND c.id = conversation_participants.conversation_id))
  WITH CHECK (public.inbox_tenant_ok(tenant_id) AND EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.tenant_id = conversation_participants.tenant_id AND c.id = conversation_participants.conversation_id));
--> statement-breakpoint
-- Internal notes only with app.can_read_notes = on (inbox.notes); viewers never see them.
CREATE POLICY conversation_messages_inbox ON public.conversation_messages FOR ALL TO stay_inbox
  USING (public.inbox_tenant_ok(tenant_id)
    AND (direction <> 'internal' OR coalesce(current_setting('app.can_read_notes', true), '') = 'on')
    AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.tenant_id = conversation_messages.tenant_id AND c.id = conversation_messages.conversation_id))
  WITH CHECK (public.inbox_tenant_ok(tenant_id)
    AND (direction <> 'internal' OR coalesce(current_setting('app.can_read_notes', true), '') = 'on')
    AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.tenant_id = conversation_messages.tenant_id AND c.id = conversation_messages.conversation_id));
--> statement-breakpoint
CREATE POLICY conversation_reads_select ON public.conversation_reads FOR SELECT TO stay_inbox
  USING (public.inbox_tenant_ok(tenant_id) AND EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.tenant_id = conversation_reads.tenant_id AND c.id = conversation_reads.conversation_id));
--> statement-breakpoint
CREATE POLICY conversation_reads_own_insert ON public.conversation_reads FOR INSERT TO stay_inbox
  WITH CHECK (public.inbox_tenant_ok(tenant_id) AND admin_user_id::text = current_setting('app.admin_user_id', true)
    AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.tenant_id = conversation_reads.tenant_id AND c.id = conversation_reads.conversation_id));
--> statement-breakpoint
CREATE POLICY conversation_reads_own_update ON public.conversation_reads FOR UPDATE TO stay_inbox
  USING (public.inbox_tenant_ok(tenant_id) AND admin_user_id::text = current_setting('app.admin_user_id', true))
  WITH CHECK (public.inbox_tenant_ok(tenant_id) AND admin_user_id::text = current_setting('app.admin_user_id', true));
--> statement-breakpoint
CREATE POLICY conversation_events_select ON public.conversation_events FOR SELECT TO stay_inbox
  USING (public.inbox_tenant_ok(tenant_id) AND EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.tenant_id = conversation_events.tenant_id AND c.id = conversation_events.conversation_id));
--> statement-breakpoint
CREATE POLICY conversation_events_insert ON public.conversation_events FOR INSERT TO stay_inbox
  WITH CHECK (public.inbox_tenant_ok(tenant_id) AND EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.tenant_id = conversation_events.tenant_id AND c.id = conversation_events.conversation_id));
--> statement-breakpoint
CREATE POLICY message_attachments_inbox ON public.message_attachments FOR ALL TO stay_inbox
  USING (public.inbox_tenant_ok(tenant_id) AND EXISTS (
    SELECT 1 FROM public.conversation_messages m WHERE m.tenant_id = message_attachments.tenant_id AND m.id = message_attachments.message_id))
  WITH CHECK (public.inbox_tenant_ok(tenant_id) AND EXISTS (
    SELECT 1 FROM public.conversation_messages m WHERE m.tenant_id = message_attachments.tenant_id AND m.id = message_attachments.message_id));
--> statement-breakpoint
CREATE POLICY message_delivery_jobs_inbox ON public.message_delivery_jobs FOR ALL TO stay_inbox
  USING (public.inbox_tenant_ok(tenant_id) AND EXISTS (
    SELECT 1 FROM public.conversation_messages m WHERE m.tenant_id = message_delivery_jobs.tenant_id AND m.id = message_delivery_jobs.message_id))
  WITH CHECK (public.inbox_tenant_ok(tenant_id) AND EXISTS (
    SELECT 1 FROM public.conversation_messages m WHERE m.tenant_id = message_delivery_jobs.tenant_id AND m.id = message_delivery_jobs.message_id));
--> statement-breakpoint
-- Push devices: each staff member sees only their own; the system context (push dispatch) the tenant's.
CREATE POLICY push_subscriptions_inbox ON public.push_subscriptions FOR ALL TO stay_inbox
  USING (public.inbox_tenant_ok(tenant_id) AND (admin_user_id::text = current_setting('app.admin_user_id', true)
    OR coalesce(current_setting('app.actor', true), '') = 'system'))
  WITH CHECK (public.inbox_tenant_ok(tenant_id) AND (admin_user_id::text = current_setting('app.admin_user_id', true)
    OR coalesce(current_setting('app.actor', true), '') = 'system'));
--> statement-breakpoint
CREATE POLICY push_deliveries_inbox ON public.push_deliveries FOR ALL TO stay_inbox
  USING (public.inbox_tenant_ok(tenant_id) AND (admin_user_id::text = current_setting('app.admin_user_id', true)
    OR coalesce(current_setting('app.actor', true), '') = 'system'))
  WITH CHECK (public.inbox_tenant_ok(tenant_id) AND (admin_user_id::text = current_setting('app.admin_user_id', true)
    OR coalesce(current_setting('app.actor', true), '') = 'system'));
--> statement-breakpoint
-- Conversation timeline: rows are only added, never changed or deleted (except by cascading
-- purge of the whole conversation, which runs as the table owner).
CREATE OR REPLACE FUNCTION public.conversation_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'conversation_events is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER conversation_events_no_update_delete
  BEFORE UPDATE OR DELETE ON public.conversation_events
  FOR EACH ROW EXECUTE FUNCTION public.conversation_events_append_only();
--> statement-breakpoint
-- Keep the Supabase Data API closed for the new tables (second layer besides RLS).
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.admin_user_grants, public.channel_accounts, public.channel_account_properties, public.conversations, public.conversation_reservation_links, public.conversation_participants, public.conversation_messages, public.conversation_reads, public.conversation_events, public.message_attachments, public.message_delivery_jobs, public.push_subscriptions, public.push_deliveries FROM %I',
        api_role
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.inbox_tenant_ok(text), public.inbox_property_ok(text), public.conversation_events_append_only() FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END
$$;
