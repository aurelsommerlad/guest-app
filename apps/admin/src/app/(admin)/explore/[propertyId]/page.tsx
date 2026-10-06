import type { Metadata } from "next";

import { ExploreListView } from "../../../../features/explore/components/views";

export const metadata: Metadata = { title: "Explore" };

type Props = {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ status?: string; archived?: string }>;
};

/** EXPLORE of one property: the places its guests see. */
export default async function ExplorePropertyPage({ params, searchParams }: Props) {
  const [{ propertyId }, query] = await Promise.all([params, searchParams]);
  return <ExploreListView viewProperty={propertyId} searchParams={query} />;
}
