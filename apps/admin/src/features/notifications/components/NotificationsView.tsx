import { buttonStyles, cx } from "@up/ui";
import { redirect } from "next/navigation";

import { EmptyState, PageHeader, SectionHeader } from "../../../components/PageHeader";
import { requireAdmin } from "../../auth/server";
import { runNotificationQueueAction, saveSlackRouteAction } from "../actions";
import { loadNotifications } from "../notifications-service";
import { notificationsDeps } from "../server";

const dateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" });

const STATUS: Record<string, string> = {
  pending: "Wartet",
  sending: "Wird gesendet",
  sent: "Gesendet",
  failed: "Fehlgeschlagen",
  suppressed: "Unterdrückt",
};
const KIND: Record<string, string> = {
  "service.request": "Neue Anfrage",
  "service.request_confirmed": "Anfrage bestätigt",
  "service.request_declined": "Anfrage abgelehnt",
  "service.order": "Sofortbuchung",
};
const ERRORS: Record<string, string> = {
  no_slack_route: "kein Slack-Ziel für das Objekt",
  decision_updates_off: "Statusmeldungen für das Objekt aus",
  not_a_slack_message: "Sofortbuchungen werden wie in Extras nicht gemeldet",
  slack_unavailable: "Slack nicht erreichbar",
  worker_error: "interner Fehler",
};

function Notice({ tone, text }: { tone: "notice" | "error"; text: string }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cx("type-small rounded-card p-3", tone === "error" ? "bg-surface text-text" : "bg-surface-accent text-on-accent")}
    >
      {text}
    </p>
  );
}

export async function NotificationsView({ notice, error }: { notice?: string; error?: string }) {
  const admin = await requireAdmin();
  const loaded = await loadNotifications(notificationsDeps(), admin);
  if (!loaded.ok) redirect("/forbidden");
  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Benachrichtigungen"
        description={`Slack-Meldungen bei neuen Anfragen und – je Objekt wählbar – bei Entscheidungen. Versand: ${
          loaded.mode === "simulated" ? "simuliert (es wird nichts an Slack gesendet)" : "ausgeschaltet"
        }. Webhook-Adressen liegen nur in der Serverkonfiguration, nie in der Datenbank.`}
      />
      {notice && <Notice tone="notice" text={notice} />}
      {error && <Notice tone="error" text={error} />}
      <section className="flex flex-col gap-4">
        <SectionHeader id="routes" title="Slack-Ziel je Objekt" />
        <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-raised">
          {loaded.settings.map((s) => (
            <li key={s.property.id} className="p-4">
              <form action={saveSlackRouteAction.bind(null, s.property.id)} className="flex flex-col gap-3 md:flex-row md:items-end">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <label htmlFor={`route-${s.property.id}`} className="type-eyebrow text-text">
                    {s.property.displayName}
                  </label>
                  <input
                    id={`route-${s.property.id}`}
                    name="route"
                    defaultValue={s.slackRoute ?? ""}
                    placeholder="z. B. front-office-test"
                    disabled={!s.canEdit}
                    className="type-body min-h-11 w-full rounded-control border border-text-muted bg-background px-3 text-text"
                  />
                </div>
                <label className="type-body flex min-h-11 items-center gap-3">
                  <input type="checkbox" name="decisionUpdates" defaultChecked={s.slackDecisionUpdates} disabled={!s.canEdit} />
                  Statusmeldung bei Entscheidung
                </label>
                {s.canEdit && (
                  <button type="submit" className={buttonStyles("secondary")}>
                    Speichern
                  </button>
                )}
              </form>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-4">
        <SectionHeader id="queue" title="Warteschlange und Fehlerprotokoll" description="Jede Meldung genau einmal je Ereignis; bei Fehlern bis zu fünf Wiederholungen mit wachsendem Abstand." />
        {loaded.canRun && (
          <form action={runNotificationQueueAction}>
            <button type="submit" className={buttonStyles("primary")}>
              Warteschlange jetzt verarbeiten (simuliert)
            </button>
          </form>
        )}
        {loaded.jobs.length === 0 ? (
          <EmptyState title="Keine Meldungen" description="Neue Anfragen erscheinen hier." />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-raised">
            {loaded.jobs.map((job) => (
              <li key={job.id} className="flex flex-col gap-1 p-4">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="type-body text-text">{KIND[job.template] ?? job.template}</span>
                  <span className="type-caption rounded-full bg-surface px-2.5 py-1 text-text">
                    {STATUS[job.status] ?? job.status}
                    {job.deliveryMode === "simulated" ? " (simuliert)" : ""}
                  </span>
                </span>
                <span className="type-caption text-text-muted">
                  {job.propertyName} · {dateTime.format(job.createdAt)} · Versuche {job.attempts}
                  {job.lastErrorCode ? ` · ${ERRORS[job.lastErrorCode] ?? job.lastErrorCode}` : ""}
                  {job.status === "pending" && job.attempts > 0 ? ` · nächster Versuch ${dateTime.format(job.nextAttemptAt)}` : ""}
                </span>
                {job.preview && <span className="type-small text-text">„{job.preview}“</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
