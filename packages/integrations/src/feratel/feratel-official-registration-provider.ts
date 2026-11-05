/**
 * Our own direct Feratel adapter (ADR 0022) – maps transport results onto the core outcome
 * model. Talks only to a FeratelTransport; in F1 that is the simulated one.
 *
 * Safety:
 * - environment must be "simulated" (type and runtime check) – there is no test or
 *   production transport yet;
 * - capabilities default to the documented ones (none); simulations pass their own;
 * - non-secret settings per property only; credentials will live in the transport (env).
 * - The old FeratelRegistrationProvider (registration sync, ADR 0016) stays untouched and
 *   inactive, so existing processes do not change.
 */
import {
  CREATING_OPERATIONS,
  type OfficialErrorCode,
  type OfficialRegistrationProvider,
  type OfficialRequest,
  type ProviderCapabilities,
  type ProviderOutcome,
} from "@up/core";

import { FERATEL_DOCUMENTED_CAPABILITIES } from "./feratel-capabilities";
import { type FeratelTransport, type FeratelTransportResult } from "./feratel-transport";

const ERROR_CODES: Record<
  Exclude<FeratelTransportResult, { ok: true }>["error"],
  OfficialErrorCode
> = {
  validation: "invalid_data",
  auth: "auth",
  "not-found": "not_found",
  conflict: "conflict",
  "rate-limited": "rate_limited",
  unavailable: "unavailable",
  timeout: "timeout",
};

export class FeratelOfficialRegistrationProvider implements OfficialRegistrationProvider {
  readonly target = "feratel" as const;
  readonly environment = "simulated" as const;

  constructor(
    private readonly transport: FeratelTransport,
    private readonly settingsFor: (
      propertyId: string,
    ) => Readonly<Record<string, string>> | undefined,
    readonly capabilities: ProviderCapabilities = FERATEL_DOCUMENTED_CAPABILITIES,
  ) {
    if ((transport.environment as string) !== "simulated") {
      throw new Error("Only the simulated Feratel transport is allowed in this phase");
    }
  }

  async execute(request: OfficialRequest): Promise<ProviderOutcome> {
    if (!this.capabilities[request.operation]) return { kind: "not-supported" };
    const settings = this.settingsFor(request.propertyId);
    if (!settings) return { kind: "rejected", code: "not_configured" };
    if (
      !CREATING_OPERATIONS.has(request.operation) &&
      request.operation !== "lookup-by-reference" &&
      !request.externalReference
    ) {
      return { kind: "rejected", code: "invalid_data" };
    }
    const result = await this.transport.send({
      operation: request.operation,
      payload: request.payload,
      ...(request.externalReference ? { externalReference: request.externalReference } : {}),
      idempotencyKey: request.idempotencyKey,
      propertySettings: settings,
    });
    if (result.ok) {
      return {
        kind: "ok",
        ...(result.reference ? { externalReference: result.reference } : {}),
        ...(result.found ? { foundStage: result.found } : {}),
        ...(result.guestCard ? { guestCard: result.guestCard } : {}),
      };
    }
    const code = ERROR_CODES[result.error];
    switch (result.error) {
      case "validation":
      case "auth":
      case "not-found":
      case "conflict":
        return { kind: "rejected", code };
      case "rate-limited":
      case "unavailable":
        return result.notSent === false ? { kind: "ambiguous", code } : { kind: "temporary", code };
      case "timeout":
        return result.notSent ? { kind: "temporary", code } : { kind: "ambiguous", code };
    }
  }
}
