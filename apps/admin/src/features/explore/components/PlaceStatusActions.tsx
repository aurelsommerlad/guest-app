import type { ExploreStatus } from "@up/core";
import { buttonStyles } from "@up/ui";

import { changePlaceStatusAction, deletePlaceAction } from "../actions";

/** Publish / unpublish / archive / restore – and delete for never-published places. */
export function PlaceStatusActions({
  placeId,
  status,
  deletable,
  viewProperty,
}: {
  placeId: string;
  status: ExploreStatus;
  deletable: boolean;
  viewProperty: string | null;
}) {
  const action = (
    next: ExploreStatus,
    label: string,
    variant: "primary" | "secondary" = "secondary",
  ) => (
    <form action={changePlaceStatusAction.bind(null, placeId, next, viewProperty)}>
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
        <form action={deletePlaceAction.bind(null, placeId, viewProperty)}>
          <button type="submit" className={buttonStyles("secondary")}>
            Endgültig löschen
          </button>
        </form>
      )}
    </div>
  );
}
