import type { Metadata } from "next";

import { PlaceEditorView } from "../../../../../features/explore/components/views";

export const metadata: Metadata = { title: "Empfehlung bearbeiten" };

type Props = {
  params: Promise<{ propertyId: string; placeId: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function PropertyPlacePage({ params, searchParams }: Props) {
  const [{ propertyId, placeId }, { error }] = await Promise.all([params, searchParams]);
  return (
    <PlaceEditorView viewProperty={propertyId} placeId={placeId} {...(error ? { error } : {})} />
  );
}
