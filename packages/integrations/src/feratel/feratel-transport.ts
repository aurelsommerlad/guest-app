/**
 * Feratel transport port (ADR 0022) – the boundary to the Visitor Registration Interface.
 *
 * Deliberately WITHOUT endpoints, operation names, message formats or authentication: none of
 * this is documented to us yet. The only implementation in F1 is SimulatedFeratelTransport.
 * The real SOAP/XML (or other) transport is written in F4 strictly from the official
 * documentation and tested against Feratel's test environment.
 *
 * The request is our provider-neutral payload; mapping onto Feratel fields (code lists for
 * nationality, document types, guest categories …) also happens in F4.
 */
import { type OfficialOperation, type OfficialRegistrationPayload } from "@up/core";

export type FeratelTransportRequest = {
  operation: OfficialOperation;
  payload: OfficialRegistrationPayload;
  externalReference?: string;
  idempotencyKey: string;
  /** Non-secret per-property settings, e.g. the mapping code issued by the municipality. */
  propertySettings: Readonly<Record<string, string>>;
};

export type FeratelTransportResult =
  | {
      ok: true;
      reference?: string;
      /** lookup-by-reference only */
      found?: "none" | "pre-registered" | "registered" | "checked-out" | "cancelled";
      guestCard?: "requested" | "issued" | "delivered" | "failed";
    }
  | {
      ok: false;
      error:
        | "validation" // data refused
        | "auth" // credentials / mapping code refused
        | "not-found" // reference unknown
        | "conflict" // e.g. form already binding
        | "rate-limited"
        | "unavailable" // 5xx, connection refused before sending
        | "timeout"; // no answer – the request may have been processed
      /** Whether the request certainly did NOT reach the target (connection refused …). */
      notSent?: boolean;
    };

export interface FeratelTransport {
  readonly environment: "simulated";
  send(request: FeratelTransportRequest): Promise<FeratelTransportResult>;
}
