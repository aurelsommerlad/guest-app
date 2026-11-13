import type { MetadataRoute } from "next";

/** Installable STAY admin (ADR 0023): the inbox opens first; standalone like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/inbox",
    name: "STAY Admin · UNIQUE PLACES",
    short_name: "STAY Admin",
    description: "Gästekommunikation und Verwaltung von UNIQUE PLACES.",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f8f6f1",
    theme_color: "#f8f6f1",
    lang: "de",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
