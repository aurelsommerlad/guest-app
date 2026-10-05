import { Josefin_Sans, Roboto } from "next/font/google";

/* Same self-hosted brand typefaces as the guest app (no runtime requests to Google). */
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
