import { listOwnPushDeliveries, listOwnPushDevices } from "@up/db";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "../../../../components/PageHeader";
import { requireAdmin } from "../../../../features/auth/server";
import { PushPanel } from "../../../../features/inbox/components/PushPanel";
import { TestPushButton } from "../../../../features/inbox/components/TestPushButton";
import { inboxScopeFor } from "../../../../features/inbox/inbox-service";
import { messageTime } from "../../../../features/inbox/labels";
import { removeDeviceAction } from "../../../../features/inbox/push-actions";
import { pushDeps, vapidPublicKey } from "../../../../features/inbox/server";
import { getDatabase } from "../../../../server/database";

export const metadata: Metadata = { title: "Geräte & Mitteilungen" };

const STATUS: Record<string, string> = {
  sent: "übergeben",
  simulated: "simuliert",
  failed: "fehlgeschlagen",
  expired: "Gerät abgemeldet",
  skipped: "übersprungen",
};

export default async function DevicesPage() {
  const admin = await requireAdmin();
  const scope = inboxScopeFor(admin);
  if (!scope) redirect("/forbidden");
  const db = getDatabase();
  const [devices, deliveries] = await Promise.all([
    listOwnPushDevices(db, scope),
    listOwnPushDeliveries(db, scope, 10),
  ]);
  const deps = pushDeps();
  const testEnabled = deps.mode === "test" && Boolean(deps.sender);
  return (
    <div className="flex max-w-168 flex-col gap-10" data-testid="devices">
      <PageHeader
        title="Geräte & Mitteilungen"
        breadcrumbs={[{ label: "Posteingang", href: "/inbox" }]}
        description="Push-Mitteilungen bei neuen Gästenachrichten – ohne Nachrichteninhalt. Die Inbox funktioniert auch ohne Mitteilungen."
      />
      <section className="flex flex-col gap-4 border-t border-text pt-6">
        <h2 className="type-eyebrow text-text-muted">Dieses Gerät</h2>
        <PushPanel vapidPublicKey={vapidPublicKey()} />
        <p className="type-caption text-text-muted">
          iPhone: Web Push gibt es nur in der installierten App (Safari → Teilen → Zum
          Home-Bildschirm, iOS 16.4 oder neuer). Automatische Mitteilungen an das Team sind noch
          nicht eingeschaltet; möglich ist nur eine Test-Mitteilung an das eigene Gerät
          {testEnabled ? "." : " – auf diesem System derzeit ausgeschaltet."}
        </p>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="type-eyebrow text-text-muted">Meine Geräte</h2>
        {devices.length === 0 ? (
          <p className="type-small text-text-muted">Noch kein Gerät registriert.</p>
        ) : (
          <ul className="border-t border-border" data-testid="device-list">
            {devices.map((device) => (
              <li key={device.id} className="flex flex-col gap-2 border-b border-border py-4">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="type-body text-text">
                    {device.deviceLabel ?? device.userAgentFamily ?? "Gerät"}
                  </span>
                  <span className="type-caption text-text-muted">
                    {device.revokedAt ? "entfernt" : "aktiv"}
                  </span>
                </div>
                <p className="type-caption text-text-muted">
                  {device.userAgentFamily ?? ""} · registriert {messageTime(device.createdAt)}
                  {device.lastSuccessAt
                    ? ` · zuletzt zugestellt ${messageTime(device.lastSuccessAt)}`
                    : ""}
                  {device.failureCount ? ` · ${String(device.failureCount)} Fehler` : ""}
                </p>
                {!device.revokedAt && (
                  <div className="flex flex-wrap items-start gap-6">
                    <TestPushButton subscriptionId={device.id} enabled={testEnabled} />
                    <form action={removeDeviceAction.bind(null, device.id)}>
                      <button
                        type="submit"
                        className="type-small min-h-11 text-text-muted underline md:min-h-9"
                      >
                        Entfernen
                      </button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {deliveries.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="type-eyebrow text-text-muted">Zustellprotokoll</h2>
          <ol className="type-caption flex flex-col gap-1 text-text-muted">
            {deliveries.map((d) => (
              <li key={d.id}>
                {messageTime(d.createdAt)} · {d.kind === "test" ? "Test" : "Nachricht"} ·{" "}
                {STATUS[d.status] ?? d.status}
                {d.httpStatus ? ` (${String(d.httpStatus)})` : ""}
                {d.errorCode ? ` · ${d.errorCode}` : ""}
              </li>
            ))}
          </ol>
          <p className="type-caption text-text-muted">
            „Übergeben“ heißt: der Push-Dienst hat die Mitteilung angenommen – nicht, dass sie
            angezeigt wurde.
          </p>
        </section>
      )}
      <Link href="/inbox" className="type-small text-text underline">
        Zum Posteingang
      </Link>
    </div>
  );
}
