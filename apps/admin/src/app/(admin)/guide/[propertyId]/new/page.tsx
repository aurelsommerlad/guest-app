import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "../../../../../components/PageHeader";
import { requireAdmin } from "../../../../../features/auth/server";
import { createTopicAction } from "../../../../../features/guide/actions";
import { NewTopicForm } from "../../../../../features/guide/components/NewTopicForm";
import { loadPropertyGuide } from "../../../../../features/guide/guide-admin-service";
import { guideDeps } from "../../../../../features/guide/server";

export const metadata: Metadata = { title: "Neues Thema" };

export default async function NewTopicPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const admin = await requireAdmin();
  const guide = await loadPropertyGuide(guideDeps(), { tenantId: admin.tenantId }, propertyId);
  if (!guide) notFound();
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader
        title="Neues Thema"
        breadcrumbs={[{ label: "Guide", href: `/guide/${propertyId}` }]}
      />
      <NewTopicForm
        units={guide.units.map((unit) => ({ id: unit.id, displayName: unit.displayName }))}
        action={createTopicAction.bind(null, propertyId)}
      />
    </div>
  );
}
