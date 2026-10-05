import { Heading } from "@up/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "../../../../../../features/auth/server";
import { createTopicAction } from "../../../../../../features/guide/actions";
import { NewTopicForm } from "../../../../../../features/guide/components/NewTopicForm";
import { loadPropertyGuide } from "../../../../../../features/guide/guide-admin-service";
import { guideDeps } from "../../../../../../features/guide/server";

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
    <div className="flex max-w-3xl flex-col gap-6">
      <Link
        href={`/properties/${propertyId}/guide`}
        className="type-small self-start rounded-sm text-text-muted hover:underline"
      >
        ← Guide-Themen
      </Link>
      <Heading level={1} variant="title">
        Neues Thema
      </Heading>
      <NewTopicForm
        units={guide.units.map((unit) => ({ id: unit.id, displayName: unit.displayName }))}
        action={createTopicAction.bind(null, propertyId)}
      />
    </div>
  );
}
