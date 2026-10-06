/**
 * Feratel guest registration (Meldewesen) – SKELETON ONLY (ADR 0016).
 *
 * The official interface documentation (Deskline Visitor Registration / "VT PMS Web
 * Services") and credentials were not available in Phase 11, so nothing here talks to
 * Feratel. Publicly visible pointers (not verified, see
 * docs/integrations/feratel-guest-registration.md): a SOAP/HTTP-POST web service with an
 * import operation for registration sheets per destination; guest cards and registration
 * sheets can be printed via further services.
 *
 * Until the interface is verified against official documentation and a confirmed test
 * environment exists, this provider never sends data: it reports "not_configured", the
 * sync row stays visible, and the canonical registration is kept unchanged.
 *
 * Open requirements before implementing `submit` (must come from Feratel / the destination):
 *  - endpoint per environment, authentication (per host? per municipality/destination?)
 *  - test/sandbox environment and test credentials
 *  - registration sheet structure: arrival/departure, primary guest, fellow travellers,
 *    nationality, birth date, address, document data, guest categories (tourist tax)
 *  - create / update / cancel semantics and the reference returned for later changes
 *  - guest card issuing and delivery
 *  - error model (validation vs. temporary) to map onto SyncErrorCode
 */
import {
  type GuestRegistrationProvider,
  type RegistrationSubmission,
  type SyncMemory,
  type SyncOutcome,
} from "@up/core";

/** Non-secret settings per property (providerSettings.feratel) – keys to be confirmed. */
export type FeratelPropertySettings = Readonly<Record<string, string>>;

export class FeratelRegistrationProvider implements GuestRegistrationProvider {
  readonly target = "feratel" as const;
  /** False until the interface is verified and implemented – never enable by config alone. */
  static readonly implemented: boolean = false;

  submit(_submission: RegistrationSubmission, _previous: SyncMemory): Promise<SyncOutcome> {
    // Deliberately no request: no fake integration, no guest data leaves the system.
    return Promise.resolve({ status: "failed", code: "not_configured" });
  }
}
