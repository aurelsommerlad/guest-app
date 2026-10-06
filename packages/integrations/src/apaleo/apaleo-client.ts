import { type Logger, PmsError, type PmsErrorKind } from "@up/core";
import { type z } from "zod";

import {
  APALEO_API_URL,
  APALEO_IDENTITY_URL,
  APALEO_TIMEOUT_MS,
  RETRY_DELAY_MS,
  TOKEN_EXPIRY_MARGIN_MS,
} from "./constants";
import { tokenResponseSchema } from "./schemas";

export type ApaleoClientOptions = {
  clientId: string;
  clientSecret: string;
  logger: Logger;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  apiUrl?: string;
  identityUrl?: string;
  timeoutMs?: number;
  retryDelayMs?: number;
  now?: () => number;
};

const PROVIDER = "apaleo";

/** One JSON Patch operation (RFC 6902) – values are sent, never logged. */
export type JsonPatchOperation = { op: "add" | "replace"; path: string; value: unknown };

/**
 * Minimal Apaleo HTTP client: client-credentials token (cached, single-flight),
 * timeouts, one retry for idempotent requests on network/5xx/429, a fresh token
 * after 401, response validation and structured logs without secrets or guest data.
 */
export class ApaleoClient {
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #log: Logger;
  readonly #fetch: typeof fetch;
  readonly #apiUrl: string;
  readonly #identityUrl: string;
  readonly #timeoutMs: number;
  readonly #retryDelayMs: number;
  readonly #now: () => number;
  #token: { value: string; expiresAt: number } | undefined;
  #pendingToken: Promise<string> | undefined;

  constructor(options: ApaleoClientOptions) {
    this.#clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.#log = options.logger.child({ provider: PROVIDER });
    this.#fetch = options.fetch ?? fetch;
    this.#apiUrl = options.apiUrl ?? APALEO_API_URL;
    this.#identityUrl = options.identityUrl ?? APALEO_IDENTITY_URL;
    this.#timeoutMs = options.timeoutMs ?? APALEO_TIMEOUT_MS;
    this.#retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
    this.#now = options.now ?? Date.now;
  }

  /** GET a JSON resource and validate it. `operation` names the call in logs. */
  async get<T extends z.ZodType>(path: string, schema: T, operation: string): Promise<z.infer<T>> {
    const response = await this.#authorizedGet(path, operation);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw this.#fail(
        "invalid-response",
        operation,
        "Response is not valid JSON",
        response.status,
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      // Only field paths are logged – never values.
      this.#log.error("apaleo response validation failed", {
        operation,
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.code}`),
      });
      throw this.#fail(
        "invalid-response",
        operation,
        "Response does not match the expected schema",
      );
    }
    return parsed.data;
  }

  /**
   * JSON Patch (RFC 6902) against a resource. Only "replace"/"add" operations are sent,
   * which are idempotent – so the single retry on network/5xx/429 is safe.
   */
  async patch(
    path: string,
    operations: readonly JsonPatchOperation[],
    operation: string,
  ): Promise<void> {
    await this.#authorizedRequest("PATCH", path, operation, JSON.stringify(operations));
  }

  async #authorizedGet(path: string, operation: string): Promise<Response> {
    return this.#authorizedRequest("GET", path, operation);
  }

  async #authorizedRequest(
    method: "GET" | "PATCH",
    path: string,
    operation: string,
    body?: string,
  ): Promise<Response> {
    let refreshedToken = false;
    for (let attempt = 1; ; attempt++) {
      const token = await this.#getToken();
      const response = await this.#request(operation, attempt, () =>
        this.#fetch(`${this.#apiUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            ...(body === undefined ? {} : { "Content-Type": "application/json-patch+json" }),
          },
          ...(body === undefined ? {} : { body }),
          signal: AbortSignal.timeout(this.#timeoutMs),
        }),
      );

      if (response.ok) return response;

      if (response.status === 401 && !refreshedToken) {
        // Token revoked or expired early: fetch a new one once.
        refreshedToken = true;
        this.#token = undefined;
        continue;
      }
      if (isRetryable(response.status) && attempt === 1) {
        await this.#delay();
        continue;
      }
      throw this.#fail(
        kindForStatus(response.status),
        operation,
        `Apaleo responded with ${response.status}`,
        response.status,
      );
    }
  }

  /** Runs a fetch with timeout handling and one retry on network errors. */
  async #request(
    operation: string,
    attempt: number,
    send: () => Promise<Response>,
  ): Promise<Response> {
    const started = this.#now();
    try {
      const response = await send();
      this.#log.debug("apaleo request", {
        operation,
        attempt,
        status: response.status,
        durationMs: this.#now() - started,
      });
      return response;
    } catch (error) {
      const timedOut =
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      this.#log.warn("apaleo request failed", {
        operation,
        attempt,
        reason: timedOut ? "timeout" : "network",
        durationMs: this.#now() - started,
      });
      if (timedOut)
        throw this.#fail("timeout", operation, `No response within ${this.#timeoutMs} ms`);
      if (attempt === 1) {
        await this.#delay();
        return this.#request(operation, attempt + 1, send);
      }
      throw this.#fail("unavailable", operation, "Apaleo is not reachable");
    }
  }

  #getToken(): Promise<string> {
    if (this.#token && this.#token.expiresAt - TOKEN_EXPIRY_MARGIN_MS > this.#now()) {
      return Promise.resolve(this.#token.value);
    }
    // Single-flight: concurrent callers share one token request.
    this.#pendingToken ??= this.#requestToken().finally(() => {
      this.#pendingToken = undefined;
    });
    return this.#pendingToken;
  }

  async #requestToken(): Promise<string> {
    const operation = "token";
    const credentials = Buffer.from(`${this.#clientId}:${this.#clientSecret}`).toString("base64");
    let response: Response | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      response = await this.#request(operation, attempt, () =>
        this.#fetch(this.#identityUrl, {
          method: "POST",
          headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
          signal: AbortSignal.timeout(this.#timeoutMs),
        }),
      );
      if (!(isRetryable(response.status) && attempt === 1)) break;
      await this.#delay();
    }
    if (!response?.ok) {
      const status = response?.status;
      // 400 (invalid_client) and 401 both mean: credentials not accepted.
      const kind: PmsErrorKind =
        status === 400 || status === 401 || status === 403 ? "auth" : kindForStatus(status ?? 503);
      throw this.#fail(kind, operation, `Token request failed with ${String(status)}`, status);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw this.#fail(
        "invalid-response",
        operation,
        "Token response is not valid JSON",
        response.status,
      );
    }
    const parsed = tokenResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw this.#fail(
        "invalid-response",
        operation,
        "Token response does not match the expected schema",
      );
    }
    this.#token = {
      value: parsed.data.access_token,
      expiresAt: this.#now() + parsed.data.expires_in * 1000,
    };
    return this.#token.value;
  }

  #fail(kind: PmsErrorKind, operation: string, message: string, status?: number): PmsError {
    this.#log.error("apaleo call failed", { operation, kind, status });
    return new PmsError(kind, `${operation}: ${message}`, { provider: PROVIDER, status });
  }

  #delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.#retryDelayMs));
  }
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function kindForStatus(status: number): PmsErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not-found";
  if (status === 429 || status >= 500) return "unavailable";
  return "invalid-response";
}
