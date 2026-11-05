/**
 * Port for an official registration target (ADR 0022). Implemented per target in
 * @up/integrations (Feratel). Must not throw for expected failures – it returns an outcome.
 */
import {
  type OfficialOperation,
  type OfficialRegistrationTarget,
  type ProviderCapabilities,
} from "./model";
import { type ProviderOutcome } from "./outcome";
import { type OfficialRegistrationPayload } from "./payload";

export type OfficialRequest = {
  operation: OfficialOperation;
  payload: OfficialRegistrationPayload;
  /** Reference returned by the target earlier (required for everything but creating). */
  externalReference?: string;
  idempotencyKey: string;
  /** Non-secret property settings (e.g. mapping code), credentials stay in the adapter. */
  propertyId: string;
};

export interface OfficialRegistrationProvider {
  readonly target: OfficialRegistrationTarget;
  /** "simulated" in F1; a real environment needs documentation, access and approval. */
  readonly environment: "simulated";
  readonly capabilities: ProviderCapabilities;
  execute(request: OfficialRequest): Promise<ProviderOutcome>;
}
