/**
 * Stand-ins while no provider is approved (ADR 0021): nothing leaves the server. The outbox
 * keeps the last messages in memory so local end-to-end tests can read a code; it is only
 * wired up in local development (APP_ENV=local), never on staging or production.
 */
import {
  type MessageSendResult,
  type VerificationEmailSender,
  type VerificationMessage,
  type VerificationSmsSender,
} from "@up/core";

export type OutboxEntry = { channel: "email" | "sms"; message: VerificationMessage; at: Date };

export class VerificationOutbox {
  readonly #entries: OutboxEntry[] = [];
  readonly #max: number;
  readonly #onAdd: ((entry: OutboxEntry) => void) | undefined;

  constructor(options: { max?: number; onAdd?: (entry: OutboxEntry) => void } = {}) {
    this.#max = options.max ?? 50;
    this.#onAdd = options.onAdd;
  }

  add(entry: OutboxEntry): void {
    this.#entries.push(entry);
    if (this.#entries.length > this.#max) this.#entries.shift();
    this.#onAdd?.(entry);
  }

  /** Newest message to `to` on `channel`, if any. */
  latest(channel: OutboxEntry["channel"], to: string): OutboxEntry | undefined {
    return [...this.#entries].reverse().find((e) => e.channel === channel && e.message.to === to);
  }

  get size(): number {
    return this.#entries.length;
  }
}

export class SimulatedEmailSender implements VerificationEmailSender {
  readonly simulated = true;
  constructor(private readonly outbox?: VerificationOutbox) {}

  sendVerificationCode(message: VerificationMessage): Promise<MessageSendResult> {
    this.outbox?.add({ channel: "email", message, at: new Date() });
    return Promise.resolve({ ok: true });
  }
}

export class SimulatedSmsSender implements VerificationSmsSender {
  readonly simulated = true;
  constructor(private readonly outbox?: VerificationOutbox) {}

  sendVerificationCode(message: VerificationMessage): Promise<MessageSendResult> {
    this.outbox?.add({ channel: "sms", message, at: new Date() });
    return Promise.resolve({ ok: true });
  }
}
