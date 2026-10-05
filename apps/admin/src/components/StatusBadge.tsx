import { type GuideStatus } from "@up/core";
import { cx } from "@up/ui";

const labels: Record<GuideStatus, string> = {
  draft: "Entwurf",
  published: "Veröffentlicht",
  archived: "Archiviert",
};

export function StatusBadge({ status }: { status: GuideStatus }) {
  return (
    <span
      className={cx(
        "type-caption inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
        status === "published" ? "bg-surface-accent text-on-accent" : "bg-surface text-text-muted",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "size-1.5 rounded-full",
          status === "published" ? "bg-action" : "bg-text-muted",
        )}
      />
      {labels[status]}
    </span>
  );
}

export const statusLabel = (status: GuideStatus) => labels[status];
