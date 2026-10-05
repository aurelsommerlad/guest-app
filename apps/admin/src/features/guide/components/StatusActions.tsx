import { type GuideStatus } from "@up/core";
import { buttonStyles } from "@up/ui";

import { changeStatusAction, deleteEntryAction } from "../actions";

/** Publish / unpublish / archive / restore – and delete for never-published entries. */
export function StatusActions({
  entryId,
  status,
  deletable,
}: {
  entryId: string;
  status: GuideStatus;
  deletable: boolean;
}) {
  const action = (
    next: GuideStatus,
    label: string,
    variant: "primary" | "secondary" = "secondary",
  ) => (
    <form action={changeStatusAction.bind(null, entryId, next)}>
      <button type="submit" className={buttonStyles(variant)}>
        {label}
      </button>
    </form>
  );
  return (
    <div className="flex flex-wrap gap-2">
      {status === "draft" && action("published", "Veröffentlichen", "primary")}
      {status === "published" && action("draft", "Zurückziehen (Entwurf)")}
      {status !== "archived" && action("archived", "Archivieren")}
      {status === "archived" && action("draft", "Wiederherstellen")}
      {deletable && (
        <form action={deleteEntryAction.bind(null, entryId)}>
          <button type="submit" className={buttonStyles("secondary")}>
            Endgültig löschen
          </button>
        </form>
      )}
    </div>
  );
}
