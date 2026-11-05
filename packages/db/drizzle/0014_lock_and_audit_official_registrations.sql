-- Custom migration (ADR 0022, F2): safety rules for the official registration tables that the
-- schema DSL cannot express. Safe on plain Postgres (role checks are conditional).
-- Retention purges run in one transaction with SET LOCAL up.official_retention_purge = 'on'
-- and may only remove rows whose purge_after has passed.

-- 1. Keep the Supabase Data API closed (second layer besides RLS without policies).
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.official_registration_settings, public.official_registrations, public.official_guest_cards, public.official_registration_events FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint

-- 2. Shared guard: deletion only by the retention purge and only when due.
CREATE OR REPLACE FUNCTION public.official_retention_delete_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF coalesce(current_setting('up.official_retention_purge', true), '') <> 'on'
    OR OLD.purge_after IS NULL
    OR OLD.purge_after > now() THEN
    RAISE EXCEPTION '% rows are only removed by the retention purge when due', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END
$$;
--> statement-breakpoint

-- 3. Revision-safe protocol: rows are only added; never changed, truncated or deleted early.
CREATE OR REPLACE FUNCTION public.official_registration_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'official_registration_events is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER official_registration_events_no_update
  BEFORE UPDATE ON public.official_registration_events
  FOR EACH ROW EXECUTE FUNCTION public.official_registration_events_append_only();
--> statement-breakpoint
CREATE TRIGGER official_registration_events_no_truncate
  BEFORE TRUNCATE ON public.official_registration_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.official_registration_events_append_only();
--> statement-breakpoint
CREATE TRIGGER official_registration_events_retention_delete
  BEFORE DELETE ON public.official_registration_events
  FOR EACH ROW EXECUTE FUNCTION public.official_retention_delete_only();
--> statement-breakpoint

-- 4. A protocol entry must belong to the same property and target as its registration state.
CREATE OR REPLACE FUNCTION public.official_registration_events_consistent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.official_registrations r
    WHERE r.tenant_id = NEW.tenant_id
      AND r.id = NEW.official_registration_id
      AND r.property_id = NEW.property_id
      AND r.target = NEW.target
  ) THEN
    RAISE EXCEPTION 'protocol entry does not match its registration'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER official_registration_events_consistent
  BEFORE INSERT ON public.official_registration_events
  FOR EACH ROW EXECUTE FUNCTION public.official_registration_events_consistent();
--> statement-breakpoint

-- 5. Registration state: bound to exactly the check-in and reservation it was created for.
CREATE OR REPLACE FUNCTION public.official_registrations_bound()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.guest_registrations g
      WHERE g.tenant_id = NEW.tenant_id
        AND g.id = NEW.registration_id
        AND g.property_id = NEW.property_id
        AND g.reservation_provider = NEW.reservation_provider
        AND g.external_reservation_id = NEW.external_reservation_id
    ) THEN
      RAISE EXCEPTION 'official registration does not match its check-in (property/reservation)'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.property_id IS DISTINCT FROM OLD.property_id
    OR NEW.target IS DISTINCT FROM OLD.target
    OR NEW.registration_id IS DISTINCT FROM OLD.registration_id
    OR NEW.reservation_provider IS DISTINCT FROM OLD.reservation_provider
    OR NEW.external_reservation_id IS DISTINCT FROM OLD.external_reservation_id
    OR NEW.our_reference IS DISTINCT FROM OLD.our_reference THEN
    RAISE EXCEPTION 'identity of an official registration is immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- The target's reference is write-once: replacing it could hide a duplicate registration.
  IF OLD.external_reference IS NOT NULL
    AND NEW.external_reference IS DISTINCT FROM OLD.external_reference THEN
    RAISE EXCEPTION 'external_reference is write-once'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER official_registrations_bound
  BEFORE INSERT OR UPDATE ON public.official_registrations
  FOR EACH ROW EXECUTE FUNCTION public.official_registrations_bound();
--> statement-breakpoint
CREATE TRIGGER official_registrations_retention_delete
  BEFORE DELETE ON public.official_registrations
  FOR EACH ROW EXECUTE FUNCTION public.official_retention_delete_only();
--> statement-breakpoint
CREATE TRIGGER official_registrations_no_truncate
  BEFORE TRUNCATE ON public.official_registrations
  FOR EACH STATEMENT EXECUTE FUNCTION public.official_registration_events_append_only();
--> statement-breakpoint

-- 6. Guest cards: identity immutable, removed together with their registration only.
CREATE OR REPLACE FUNCTION public.official_guest_cards_bound()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('up.official_retention_purge', true), '') <> 'on'
      OR NOT EXISTS (
        SELECT 1 FROM public.official_registrations r
        WHERE r.tenant_id = OLD.tenant_id
          AND r.id = OLD.official_registration_id
          AND r.purge_after IS NOT NULL
          AND r.purge_after <= now()
      ) THEN
      RAISE EXCEPTION 'official_guest_cards rows are only removed with their due registration'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.official_registration_id IS DISTINCT FROM OLD.official_registration_id THEN
    RAISE EXCEPTION 'identity of a guest card status is immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER official_guest_cards_bound
  BEFORE UPDATE OR DELETE ON public.official_guest_cards
  FOR EACH ROW EXECUTE FUNCTION public.official_guest_cards_bound();
--> statement-breakpoint
CREATE TRIGGER official_guest_cards_no_truncate
  BEFORE TRUNCATE ON public.official_guest_cards
  FOR EACH STATEMENT EXECUTE FUNCTION public.official_registration_events_append_only();
--> statement-breakpoint

-- 7. Settings hold no secrets: provider settings are short strings under plain keys.
CREATE OR REPLACE FUNCTION public.official_registration_settings_no_secrets()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  entry record;
BEGIN
  FOR entry IN SELECT key, value FROM jsonb_each(NEW.provider_settings) LOOP
    IF entry.key !~ '^[a-zA-Z][a-zA-Z0-9]{0,40}$'
      OR entry.key ~* '(secret|password|passwd|token|credential|apikey|privatekey)'
      OR jsonb_typeof(entry.value) <> 'string'
      OR char_length(entry.value #>> '{}') NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'provider_settings may only hold non-secret short strings (key %)', entry.key
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER official_registration_settings_no_secrets
  BEFORE INSERT OR UPDATE ON public.official_registration_settings
  FOR EACH ROW EXECUTE FUNCTION public.official_registration_settings_no_secrets();
