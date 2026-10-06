import { type GuideStatus } from "@up/core";
import { cx } from "@up/ui";

const labels: Record<GuideStatus, string> = {
  draft: "Entwurf",
  published: "Veröffentlicht",
  archived: "Archiviert",
};

/** Quiet status: tinted surface and a small dot – sage, warm ochre or neutral. */
const styles: Record<GuideStatus, { badge: string; dot: string }> = {
  published: { badge: "bg-status-published text-on-status-published", dot: "bg-action" },
  draft: { badge: "bg-status-draft text-text", dot: "bg-status-draft-mark" },
  archived: { badge: "bg-status-archived text-text-muted", dot: "bg-text-muted" },
};

export function StatusBadge({ status }: { status: GuideStatus }) {
  return (
    <span
      className={cx(
        "type-caption inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 whitespace-nowrap",
        styles[status].badge,
      )}
    >
      <span aria-hidden className={cx("size-1.5 rounded-full", styles[status].dot)} />
      {labels[status]}
    </span>
  );
}

export const statusLabel = (status: GuideStatus) => labels[status];
