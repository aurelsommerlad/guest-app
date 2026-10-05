import { notFound } from "next/navigation";

/** Unmatched paths below a locale render the localized not-found page. */
export default function CatchAll() {
  notFound();
}
