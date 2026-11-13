import { ADMIN_ROLES, canAssignRole } from "@up/core";
import { getAdminUser, listAdminUserGrants } from "@up/db";
import { Button } from "@up/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "../../../../components/PageHeader";
import { principalOf } from "../../../../features/auth/authorization";
import { requirePermission } from "../../../../features/auth/server";
import { getTenantProperties } from "../../../../features/property-context/server";
import {
  changeAccessAction,
  setInboxReadGrantAction,
  setMemberStatusAction,
} from "../../../../features/team/actions";
import { AccessForm } from "../../../../features/team/components/TeamForms";
import { ROLE_LABELS } from "../../../../features/team/labels";
import { getDatabase } from "../../../../server/database";

export const metadata: Metadata = { title: "Teammitglied" };

type Props = {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function TeamMemberPage({ params, searchParams }: Props) {
  const [{ userId }, { error }] = await Promise.all([params, searchParams]);
  const admin = await requirePermission("users.manage");
  const member = await getAdminUser(getDatabase(), { tenantId: admin.tenantId }, userId);
  if (!member) notFound();
  const principal = principalOf(admin);
  if (!canAssignRole(principal, member.role, member.role)) notFound();
  const properties = await getTenantProperties();
  const assignableRoles = ADMIN_ROLES.filter((role) => canAssignRole(principal, member.role, role));
  const disabled = member.status === "disabled";
  const inboxRead =
    member.role === "viewer" &&
    (await listAdminUserGrants(getDatabase(), { tenantId: admin.tenantId }, member.id)).includes(
      "inbox.read",
    );
  return (
    <div className="flex max-w-168 flex-col gap-8">
      <PageHeader
        title={member.displayName ?? member.email}
        breadcrumbs={[{ label: "Team", href: "/team" }]}
        description={`${ROLE_LABELS[member.role]}${disabled ? " · deaktiviert" : ""}`}
      />
      {error && (
        <p role="alert" className="type-small rounded-card bg-surface p-3 text-text">
          {error}
        </p>
      )}
      <section className="rounded-card border border-border bg-surface-raised p-5 md:p-8">
        <AccessForm
          action={changeAccessAction.bind(null, member.id)}
          properties={properties}
          assignableRoles={assignableRoles}
          initial={member}
        />
      </section>
      {member.role === "viewer" && (
        <section
          className="flex flex-col gap-3 border-t border-border pt-6"
          data-testid="inbox-grant"
        >
          <h2 className="type-heading text-text">Gästenachrichten</h2>
          <p className="type-small text-text-muted">
            {inboxRead
              ? "Darf Gästenachrichten der freigegebenen Objekte lesen – ohne interne Notizen, ohne Antworten."
              : "Leserechte schließen Gästenachrichten nicht ein. Nur mit ausdrücklicher Freigabe sichtbar."}
          </p>
          <form action={setInboxReadGrantAction.bind(null, member.id, !inboxRead)}>
            <Button type="submit" variant="secondary">
              {inboxRead ? "Freigabe für Nachrichten entziehen" : "Nachrichten lesen freigeben"}
            </Button>
          </form>
        </section>
      )}
      {member.id !== admin.adminUserId && (
        <form
          action={setMemberStatusAction.bind(null, member.id, disabled ? "active" : "disabled")}
        >
          <Button type="submit" variant="secondary">
            {disabled ? "Konto wieder aktivieren" : "Konto deaktivieren und abmelden"}
          </Button>
        </form>
      )}
    </div>
  );
}
