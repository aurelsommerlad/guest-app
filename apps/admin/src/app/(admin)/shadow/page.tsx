import type { Metadata } from "next";

import { ShadowView } from "../../../features/shadow/components/ShadowView";

export const metadata: Metadata = { title: "Schattenbetrieb" };

export default function Page() {
  return <ShadowView propertyId={null} />;
}
