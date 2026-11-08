import { type VerificationMessage } from "@up/core";
import { describe, expect, it } from "vitest";

import { ResendEmailSender, RESEND_EMAILS_URL } from "./resend-email-sender";
import { SEVEN_SMS_URL, SevenSmsSender } from "./seven-sms-sender";
import { SimulatedEmailSender, VerificationOutbox } from "./simulated-senders";

const message: VerificationMessage = {
  to: "lea@example.org",
  code: "042517",
  locale: "de",
  propertyName: "HŪSLE",
  validMinutes: 10,
  idempotencyKey: "0b8f6a52-6c43-4d77-9d1e-1f2d3c4b5a69",
};

function fakeFetch(status: number, body: unknown, calls: { url: string; init: RequestInit }[]) {
  return ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: url instanceof Request ? url.url : url.toString(), init: init ?? {} });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
}

function bodyText(init: RequestInit | undefined): string {
  const body = init?.body;
  return typeof body === "string" ? body : body instanceof URLSearchParams ? body.toString() : "";
}

describe("ResendEmailSender", () => {
  const options = { apiKey: "re_test_key_123", from: "UNIQUE PLACES <check-in@example.org>" };

  it("posts one idempotent mail with only code and property name", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const sender = new ResendEmailSender({
      ...options,
      fetch: fakeFetch(200, { id: "em_1" }, calls),
    });
    expect(await sender.sendVerificationCode(message)).toEqual({
      ok: true,
      providerMessageId: "em_1",
    });
    const [call] = calls;
    expect(call?.url).toBe(RESEND_EMAILS_URL);
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key_123");
    expect(headers["Idempotency-Key"]).toBe(message.idempotencyKey);
    const body = JSON.parse(bodyText(call?.init)) as Record<string, unknown>;
    expect(body).toMatchObject({ to: ["lea@example.org"], from: options.from });
    expect(String(body.subject)).toContain("042517");
    expect(String(body.text)).toContain("HŪSLE");
    expect(String(body.text)).toContain("10 Minuten");
  });

  it("maps failures to safe outcomes and never throws", async () => {
    const outcome = async (status: number) =>
      new ResendEmailSender({
        ...options,
        fetch: fakeFetch(status, { message: "secret detail" }, []),
      }).sendVerificationCode(message);
    expect(await outcome(429)).toEqual({ ok: false, reason: "rate-limited" });
    expect(await outcome(401)).toEqual({ ok: false, reason: "not-configured" });
    expect(await outcome(422)).toEqual({ ok: false, reason: "rejected" });
    expect(await outcome(503)).toEqual({ ok: false, reason: "unavailable" });
    const broken = new ResendEmailSender({
      ...options,
      fetch: () => Promise.reject(new Error("network")),
    });
    expect(await broken.sendVerificationCode(message)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("refuses an implausible configuration", () => {
    expect(() => new ResendEmailSender({ ...options, apiKey: "nope" })).toThrow();
  });
});

describe("SevenSmsSender (prepared, never called in the app without approval)", () => {
  const options = { apiKey: "seven-test-key-123", from: "UNIQUEPLACE" };
  const sms = { ...message, to: "+436641234567" };

  it("posts form data with X-Api-Key, foreign_id and a short text", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const sender = new SevenSmsSender({
      ...options,
      fetch: fakeFetch(200, { success: "100", messages: [{ id: 77 }] }, calls),
    });
    expect(await sender.sendVerificationCode(sms)).toEqual({ ok: true, providerMessageId: "77" });
    const [call] = calls;
    expect(call?.url).toBe(SEVEN_SMS_URL);
    expect((call?.init.headers as Record<string, string>)["X-Api-Key"]).toBe(options.apiKey);
    const form = new URLSearchParams(bodyText(call?.init));
    expect(form.get("to")).toBe("+436641234567");
    expect(form.get("foreign_id")).toBe(message.idempotencyKey);
    expect(form.get("text")).toMatch(/^042517 /);
  });

  it("maps seven.io return codes", async () => {
    const outcome = async (success: string) =>
      new SevenSmsSender({
        ...options,
        fetch: fakeFetch(200, { success }, []),
      }).sendVerificationCode(sms);
    expect(await outcome("202")).toEqual({ ok: false, reason: "rejected" });
    expect(await outcome("403")).toEqual({ ok: false, reason: "rate-limited" });
    expect(await outcome("500")).toEqual({ ok: false, reason: "not-configured" });
    expect(await outcome("600")).toEqual({ ok: false, reason: "unavailable" });
  });

  it("refuses non-E.164 numbers before any request", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const sender = new SevenSmsSender({
      ...options,
      fetch: fakeFetch(200, { success: "100" }, calls),
    });
    expect(await sender.sendVerificationCode({ ...sms, to: "0664 1234567" })).toEqual({
      ok: false,
      reason: "rejected",
    });
    expect(calls).toHaveLength(0);
  });
});

describe("simulated sender", () => {
  it("sends nothing and keeps the message in the local outbox", async () => {
    const outbox = new VerificationOutbox({ max: 2 });
    const sender = new SimulatedEmailSender(outbox);
    await sender.sendVerificationCode(message);
    expect(outbox.latest("email", message.to)?.message.code).toBe("042517");
    expect(outbox.latest("sms", message.to)).toBeUndefined();
  });
});
