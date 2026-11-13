import { describe, expect, it } from "vitest";

import { generateVapidKeys, SimulatedPushSender, WebPushSender } from "./web-push-sender";

const payload = {
  title: "Neue Gästenachricht",
  body: "Booking.com · TEST",
  url: "/inbox/c/x",
  tag: "conversation:x",
};
const subscription = {
  endpoint: "https://127.0.0.1:1/push/never",
  // A valid P-256 public key and auth secret are needed for the encryption step.
  p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
  auth: "tBHItJI5svbpez7KI4CCXg",
};

describe("web push adapter", () => {
  it("generates VAPID keys in the format the env expects", () => {
    const keys = generateVapidKeys();
    expect(keys.publicKey).toMatch(/^[A-Za-z0-9_-]{80,100}$/);
    expect(keys.privateKey).toMatch(/^[A-Za-z0-9_-]{40,50}$/);
  });

  it("reports a network failure as retryable without throwing", async () => {
    const keys = generateVapidKeys();
    const sender = new WebPushSender({ ...keys, subject: "mailto:ops@example.test" });
    const result = await sender.send(subscription, payload);
    expect(result).toMatchObject({ status: "failed", retryable: true });
  });

  it("records simulated sends with the host only", async () => {
    const sender = new SimulatedPushSender();
    await sender.send({ ...subscription, endpoint: "https://web.push.apple.com/abc" }, payload);
    expect(sender.sent).toEqual([{ endpointHost: "web.push.apple.com", payload }]);
  });
});
