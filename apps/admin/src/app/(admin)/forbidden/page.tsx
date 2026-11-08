import { Heading, Text } from "@up/ui";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Kein Zugriff" };

/** Shown when the signed-in admin lacks the permission or property for a page or action. */
export default function ForbiddenPage() {
  return (
    <div className="flex flex-col gap-4">
      <Heading level={1} variant="title-lg">
        Kein Zugriff
      </Heading>
      <Text tone="muted">
        Für diese Seite oder Aktion fehlt Dir die Berechtigung. Wende Dich an eine Inhaberin oder
        einen Administrator Eures Teams, wenn Du Zugriff brauchst.
      </Text>
    </div>
  );
}
