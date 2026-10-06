import type { Metadata } from "next";

import { ExploreListView } from "../../../features/explore/components/views";

export const metadata: Metadata = { title: "Explore" };

type Props = { searchParams: Promise<{ status?: string; archived?: string }> };

/** EXPLORE with "Alle Objekte": every place of the tenant with its property assignment. */
export default async function ExploreAllPage({ searchParams }: Props) {
  return <ExploreListView viewProperty={null} searchParams={await searchParams} />;
}
