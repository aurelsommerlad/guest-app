import type { Metadata } from "next";

import { Specimen } from "../_components/Specimen";

export const metadata: Metadata = { title: "Design Lab · Komposition" };

/** Bare specimen, embedded by the Design Lab in iframes of real viewport widths. */
export default function SpecimenFramePage() {
  return (
    <main>
      <Specimen />
    </main>
  );
}
