import { Josefin_Sans, Roboto } from "next/font/google";

/*
 * Brand typefaces, self-hosted by next/font: the files are downloaded at build
 * time and served from our own domain – no runtime requests to Google (GDPR).
 * Both are variable fonts, so every weight comes from a single file per subset.
 * `latin-ext` covers names like HŪSLE. Greek (ΛLPILΛ) is NOT covered by
 * Josefin Sans – see docs/design-system.md, open points.
 */

export const josefinSans = Josefin_Sans({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-josefin",
});

export const roboto = Roboto({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-roboto",
});
