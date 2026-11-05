-- Custom migration (Phase 12 B1, ADR 0018): safety rules for the payment tables that the
-- schema DSL cannot express. Safe on plain Postgres (role checks are conditional).

-- 1. Keep the Supabase Data API closed (second layer besides RLS without policies).
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.payment_requests, public.reservation_payment_states, public.payment_audit_events FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint

-- 2. Revision-safe audit trail: rows can only be added, never changed or removed.
CREATE OR REPLACE FUNCTION public.payment_audit_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'payment_audit_events is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER payment_audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON public.payment_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.payment_audit_events_append_only();
--> statement-breakpoint
CREATE TRIGGER payment_audit_events_no_truncate
  BEFORE TRUNCATE ON public.payment_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.payment_audit_events_append_only();
--> statement-breakpoint

-- 3. A confirmed payment stays confirmed: cleared_at (and its amount) is write-once.
CREATE OR REPLACE FUNCTION public.reservation_payment_states_cleared_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.cleared_at IS NOT NULL AND (
    NEW.cleared_at IS DISTINCT FROM OLD.cleared_at
    OR NEW.cleared_amount_minor IS DISTINCT FROM OLD.cleared_amount_minor
    OR NEW.cleared_currency IS DISTINCT FROM OLD.cleared_currency
  ) THEN
    RAISE EXCEPTION 'cleared_at is write-once'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER reservation_payment_states_cleared_once
  BEFORE UPDATE ON public.reservation_payment_states
  FOR EACH ROW EXECUTE FUNCTION public.reservation_payment_states_cleared_once();
--> statement-breakpoint

-- 4. Reservation states are not deleted by the application (history stays consistent).
CREATE OR REPLACE FUNCTION public.reservation_payment_states_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'reservation_payment_states rows are not deleted'
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER reservation_payment_states_no_delete
  BEFORE DELETE ON public.reservation_payment_states
  FOR EACH ROW EXECUTE FUNCTION public.reservation_payment_states_no_delete();
