/**
 * In-memory Feratel stand-in for tests and local simulation (ADR 0022, F1). Not an imitation
 * of Feratel's real API – it implements our own neutral transport contract and keeps the
 * stages our state model expects. Scripted failures exercise retries and ambiguity.
 *
 * Records operations and references only, never payload contents.
 */
import { type OfficialOperation } from "@up/core";

import {
  type FeratelTransport,
  type FeratelTransportRequest,
  type FeratelTransportResult,
} from "./feratel-transport";

type Stage = "pre-registered" | "registered" | "checked-out" | "cancelled";

export type SimulatedFailure =
  | { error: "validation" | "auth" | "not-found" | "conflict" | "rate-limited" | "unavailable" }
  /** Times out; `processed` decides whether the simulated target applied it anyway. */
  | { error: "timeout"; processed: boolean };

export class SimulatedFeratelTransport implements FeratelTransport {
  readonly environment = "simulated" as const;
  /** Operations received, in order (no payload data). */
  readonly calls: { operation: OfficialOperation; reference?: string; idempotencyKey: string }[] =
    [];
  private readonly records = new Map<string, { stage: Stage; ourReference: string }>();
  private readonly byIdempotencyKey = new Map<string, string>();
  private readonly failures: SimulatedFailure[] = [];
  private counter = 0;

  constructor(private readonly options: { guestCards?: boolean } = {}) {}

  /** The next calls fail as scripted (FIFO). */
  failNext(...failures: SimulatedFailure[]): this {
    this.failures.push(...failures);
    return this;
  }

  /** Simulated registrations at the "target" (for assertions). */
  stageOf(reference: string): Stage | undefined {
    return this.records.get(reference)?.stage;
  }

  get registrationCount(): number {
    return this.records.size;
  }

  send(request: FeratelTransportRequest): Promise<FeratelTransportResult> {
    this.calls.push({
      operation: request.operation,
      ...(request.externalReference ? { reference: request.externalReference } : {}),
      idempotencyKey: request.idempotencyKey,
    });
    const failure = this.failures.shift();
    if (failure && failure.error !== "timeout")
      return Promise.resolve({ ok: false, error: failure.error, notSent: true });
    const result = this.apply(request);
    if (failure?.error === "timeout") {
      if (!failure.processed) this.rollback(request, result);
      return Promise.resolve({ ok: false, error: "timeout" });
    }
    return Promise.resolve(result);
  }

  private rollback(request: FeratelTransportRequest, result: FeratelTransportResult): void {
    if (result.ok && result.reference && request.operation.startsWith("create")) {
      this.records.delete(result.reference);
      this.byIdempotencyKey.delete(request.idempotencyKey);
    }
  }

  private card(): { guestCard?: "requested" } {
    return this.options.guestCards ? { guestCard: "requested" } : {};
  }

  private apply(request: FeratelTransportRequest): FeratelTransportResult {
    const ours = request.payload.reference;
    switch (request.operation) {
      case "create-pre-registration":
      case "create-registration": {
        // Idempotent on the key: a repeated create returns the same record.
        const existing = this.byIdempotencyKey.get(request.idempotencyKey);
        if (existing) return { ok: true, reference: existing, ...this.card() };
        const reference = `SIM-${++this.counter}`;
        this.records.set(reference, {
          stage: request.operation === "create-registration" ? "registered" : "pre-registered",
          ourReference: ours,
        });
        this.byIdempotencyKey.set(request.idempotencyKey, reference);
        return { ok: true, reference, ...this.card() };
      }
      case "lookup-by-reference": {
        for (const [reference, record] of this.records) {
          if (record.ourReference === ours) return { ok: true, reference, found: record.stage };
        }
        return { ok: true, found: "none" };
      }
      default:
        return this.transition(request);
    }
  }

  private transition(request: FeratelTransportRequest): FeratelTransportResult {
    const reference = request.externalReference;
    const record = reference ? this.records.get(reference) : undefined;
    if (!reference || !record) return { ok: false, error: "not-found", notSent: true };
    const allowed: Partial<Record<OfficialOperation, { from: Stage[]; to: Stage }>> = {
      "update-pre-registration": { from: ["pre-registered"], to: "pre-registered" },
      "delete-pre-registration": { from: ["pre-registered"], to: "cancelled" },
      "convert-to-registration": { from: ["pre-registered"], to: "registered" },
      "update-departure": { from: ["registered"], to: "registered" },
      "check-out": { from: ["registered"], to: "checked-out" },
      "cancel-registration": { from: ["registered"], to: "cancelled" },
    };
    const rule = allowed[request.operation];
    if (!rule || !rule.from.includes(record.stage))
      return { ok: false, error: "conflict", notSent: true };
    record.stage = rule.to;
    return { ok: true, reference };
  }
}
