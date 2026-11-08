import { Heading, Text } from "@up/ui";
import type { Metadata } from "next";

import { previewInvitation } from "../../../../features/auth/admin-auth-service";
import { InvitationForm } from "../../../../features/auth/components/AuthForms";
import { authDeps } from "../../../../features/auth/server";
import { ROLE_LABELS } from "../../../../features/team/labels";

export const metadata: Metadata = { title: "Einladung", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

/** Accepting an invitation: the invited person sets their own password. */
export default async function InvitationPage({ params }: Props) {
  const { token } = await params;
  const invitation = await previewInvitation(authDeps(), token);
  if (!invitation) {
    return (
      <div className="flex flex-col gap-4">
        <Heading level={1} variant="title-lg">
          Einladung nicht gültig
        </Heading>
        <Text tone="muted">
          Dieser Link ist abgelaufen, wurde zurückgezogen oder bereits verwendet. Bitte frage nach
          einer neuen Einladung.
        </Text>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <Heading level={1} variant="title-lg">
        Willkommen im Team
      </Heading>
      <Text tone="muted">
        Du wurdest als {ROLE_LABELS[invitation.role]} eingeladen ({invitation.email}). Lege jetzt
        Dein Passwort fest.
      </Text>
      <InvitationForm token={token} />
    </div>
  );
}
