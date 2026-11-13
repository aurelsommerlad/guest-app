"use client";

import { useEffect, useState, useTransition } from "react";

import { registerDeviceAction } from "../push-actions";

type Support =
  | { kind: "checking" }
  | { kind: "unsupported"; reason: string }
  | { kind: "ready"; permission: NotificationPermission; subscribed: boolean };

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Turns on notifications for this device (ADR 0023). The browser asks for permission only
 * after a tap; on the iPhone this works only in the app added to the home screen.
 */
export function PushPanel({ vapidPublicKey }: { vapidPublicKey: string | undefined }) {
  const [support, setSupport] = useState<Support>({ kind: "checking" });
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const effect = { cancelled: false };
    void (async () => {
      const next: Support = await (async () => {
        if (
          !("serviceWorker" in navigator) ||
          !("PushManager" in window) ||
          !("Notification" in window)
        ) {
          return {
            kind: "unsupported",
            reason:
              isIos() && !isStandalone()
                ? "Auf dem iPhone: Öffne STAY Admin über „Teilen → Zum Home-Bildschirm“ und aktiviere Mitteilungen dort."
                : "Dieser Browser unterstützt keine Push-Mitteilungen.",
          } as const;
        }
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        const subscription = await registration.pushManager.getSubscription();
        return {
          kind: "ready",
          permission: Notification.permission,
          subscribed: Boolean(subscription),
        } as const;
      })();
      if (!effect.cancelled) setSupport(next);
    })();
    return () => {
      effect.cancelled = true;
    };
  }, []);

  const enable = () => {
    setMessage(null);
    start(async () => {
      if (!vapidPublicKey) {
        setMessage("Push ist auf diesem System noch nicht eingerichtet (VAPID-Schlüssel fehlen).");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setSupport({ kind: "ready", permission, subscribed: false });
        setMessage("Mitteilungen wurden nicht erlaubt. Du kannst das in den Einstellungen ändern.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(vapidPublicKey),
        }));
      const json = subscription.toJSON();
      const result = await registerDeviceAction({
        endpoint: json.endpoint ?? "",
        p256dh: json.keys?.["p256dh"] ?? "",
        auth: json.keys?.["auth"] ?? "",
        deviceLabel: label,
      });
      setMessage(result.status === "idle" ? null : result.message);
      if (result.status === "ok") setSupport({ kind: "ready", permission, subscribed: true });
    });
  };

  if (support.kind === "checking")
    return <p className="type-small text-text-muted">Gerät wird geprüft …</p>;
  if (support.kind === "unsupported")
    return (
      <p className="type-small border-l border-text pl-3 text-text" data-testid="push-unsupported">
        {support.reason}
      </p>
    );

  return (
    <div className="flex flex-col gap-3" data-testid="push-panel">
      <p className="type-small text-text-muted">
        Status auf diesem Gerät:{" "}
        <span className="text-text">
          {support.permission === "denied"
            ? "Mitteilungen blockiert"
            : support.subscribed
              ? "Mitteilungen aktiv"
              : "nicht aktiviert"}
        </span>
      </p>
      <label className="type-caption flex flex-col gap-1 text-text-muted">
        Gerätename (optional)
        <input
          value={label}
          maxLength={60}
          onChange={(event) => {
            setLabel(event.target.value);
          }}
          placeholder="z. B. iPhone Rezeption"
          className="type-body min-h-11 border-b border-border bg-transparent text-text outline-none focus:border-text"
        />
      </label>
      <button
        type="button"
        onClick={enable}
        disabled={pending || support.permission === "denied"}
        className="type-small min-h-11 self-start bg-text px-5 text-text-inverse disabled:opacity-40"
      >
        {pending
          ? "Einen Moment …"
          : support.subscribed
            ? "Gerät erneut registrieren"
            : "Mitteilungen auf diesem Gerät aktivieren"}
      </button>
      {message && (
        <p role="status" className="type-small text-text">
          {message}
        </p>
      )}
    </div>
  );
}
