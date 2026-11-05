import { Nunito_Sans } from "next/font/google";

/*
 * Design V2 typeface: Nunito Sans (variable, 200–1000) – the closest match to the light,
 * open humanist sans of the V2 reference. Self-hosted by next/font (no runtime requests to
 * Google) and only loaded by the V2 layout; the current app keeps Roboto / Josefin Sans.
 */
export const v2Font = Nunito_Sans({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-v2",
});
