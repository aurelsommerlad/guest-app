import type { Metadata } from "next";

import { PlaceEditorView } from "../../../../../features/explore/components/views";

export const metadata: Metadata = { title: "Empfehlung bearbeiten" };

type Props = {
  params: Promise<{ placeId: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function PlacePage({ params, searchParams }: Props) {
  const [{ placeId }, { error }] = await Promise.all([params, searchParams]);
  return <PlaceEditorView viewProperty={null} placeId={placeId} {...(error ? { error } : {})} />;
}
