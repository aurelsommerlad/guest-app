import { ADMIN_ROLES, canAssignRole } from "@up/core";
import { listAdminInvitations, listAdminUsers } from "@up/db";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader, SectionHeader } from "../../../components/PageHeader";
import { isAllowed, principalOf } from "../../../features/auth/authorization";
import { requirePermission } from "../../../features/auth/server";
import { getTenantProperties } from "../../../features/property-context/server";
import { revokeInvitationAction } from "../../../features/team/actions";
import { InviteForm } from "../../../features/team/components/TeamForms";
import { ROLE_LABELS } from "../../../features/team/labels";
import { getDatabase } from "../../../server/database";

export const metadata: Metadata = { title: "Team" };

const dateFormat = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeZone: "Europe/Berlin",
});

/** Team members, open invitations and – for owners and admins – the invitation form. */
export default async function TeamPage() {
  const admin = await requirePermission("users.read");
  const context = { tenantId: admin.tenantId };
  const [members, invitations, properties] = await Promise.all([
    listAdminUsers(getDatabase(), context),
    listAdminInvitations(getDatabase(), context),
    getTenantProperties(),
  ]);
  const canManage = isAllowed(admin, "users.manage");
  const principal = principalOf(admin);
  const assignableRoles = ADMIN_ROLES.filter((role) => canAssignRole(principal, null, role));
  const now = new Date();
  const open = invitations.filter((i) => !i.acceptedAt && !i.revokedAt && i.expiresAt > now);
  const propertyName = (id: string) => properties.find((p) => p.id === id)?.displayName ?? id;

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Team"
        description="Wer Zugriff auf den Admin hat, mit welcher Rolle und für welche Objekte. Änderungen gelten sofort."
      />
      <section aria-labelledby="members" className="flex flex-col gap-4">
        <SectionHeader id="members" title="Mitglieder" />
        <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-raised">
          {members.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="type-body truncate text-text">
                  {member.displayName ?? member.email}
                  {member.id === admin.adminUserId ? " (Du)" : ""}
                </span>
                <span className="type-caption text-text-muted">
                  {ROLE_LABELS[member.role]} ·{" "}
                  {member.propertyScope === "all"
                    ? "Alle Objekte"
                    : member.propertyIds.map(propertyName).join(", ")}
                  {member.status === "disabled" ? " · deaktiviert" : ""}
                </span>
              </div>
              {canManage &&
                member.id !== admin.adminUserId &&
                canAssignRole(principal, member.role, member.role) && (
                  <Link href={`/team/${member.id}`} className="type-small text-text underline">
                    Bearbeiten
                  </Link>
                )}
            </li>
          ))}
        </ul>
      </section>
      {open.length > 0 && (
        <section aria-labelledby="invitations" className="flex flex-col gap-4">
          <SectionHeader id="invitations" title="Offene Einladungen" />
          <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-raised">
            {open.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="type-body truncate text-text">{invitation.email}</span>
                  <span className="type-caption text-text-muted">
                    {ROLE_LABELS[invitation.role]} · gültig bis{" "}
                    {dateFormat.format(invitation.expiresAt)}
                  </span>
                </div>
                {canManage && (
                  <form action={revokeInvitationAction.bind(null, invitation.id)}>
                    <button type="submit" className="type-small text-text underline">
                      Zurückziehen
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {canManage && (
        <section aria-labelledby="invite" className="flex max-w-168 flex-col gap-4">
          <SectionHeader
            id="invite"
            title="Neues Mitglied einladen"
            description="Die Person legt ihr Passwort selbst fest. Passwörter aus der bisherigen Extras-App werden nicht übernommen."
          />
          <div className="rounded-card border border-border bg-surface-raised p-5 md:p-8">
            <InviteForm properties={properties} assignableRoles={assignableRoles} />
          </div>
        </section>
      )}
    </div>
  );
}
