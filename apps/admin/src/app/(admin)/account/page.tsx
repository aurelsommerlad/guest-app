import type { Metadata } from "next";

import { PageHeader, SectionHeader } from "../../../components/PageHeader";
import { PasswordForm } from "../../../features/account/components/PasswordForm";
import { requireAdmin } from "../../../features/auth/server";
import { ROLE_LABELS } from "../../../features/team/labels";

export const metadata: Metadata = { title: "Mein Konto" };

/** Own account: who am I, which access do I have, change my password. */
export default async function AccountPage() {
  const admin = await requireAdmin();
  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Mein Konto"
        description={`${admin.email} · ${ROLE_LABELS[admin.role]} · ${
          admin.propertyScope === "all"
            ? "alle Objekte"
            : `${String(admin.propertyIds.length)} Objekt(e)`
        }`}
      />
      <section className="flex flex-col gap-5">
        <SectionHeader id="password" title="Passwort ändern" />
        <PasswordForm />
      </section>
    </div>
  );
}
