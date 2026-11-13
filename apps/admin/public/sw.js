/*
 * STAY admin service worker (ADR 0023) – push notifications and notification clicks only.
 * No fetch handler and no cache: guest messages are never stored offline on the device.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

const FALLBACK = { title: "STAY", body: "Neue Mitteilung", url: "/inbox", tag: "stay" };

function safePath(value) {
  // Deep links are same-origin inbox paths only.
  return typeof value === "string" && /^\/inbox(\/[A-Za-z0-9/_-]*)?$/.test(value)
    ? value
    : "/inbox";
}

self.addEventListener("push", (event) => {
  let data = FALLBACK;
  try {
    data = { ...FALLBACK, ...(event.data ? event.data.json() : {}) };
  } catch {
    data = FALLBACK;
  }
  // iOS requires a visible notification for every push.
  event.waitUntil(
    self.registration.showNotification(String(data.title).slice(0, 80), {
      body: String(data.body).slice(0, 160),
      tag: String(data.tag).slice(0, 100),
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: safePath(data.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    safePath(event.notification.data && event.notification.data.url),
    self.location.origin,
  );
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === target.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) return client.navigate(target.href);
          return undefined;
        }
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
