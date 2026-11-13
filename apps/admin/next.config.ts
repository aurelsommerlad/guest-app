import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";

import { validateServerEnv } from "./src/env/schema";
import { legacyRedirects } from "./src/navigation";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // The admin is never indexed.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

function storageImagePatterns(): NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]> {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) return [];
  return [
    {
      protocol: "https",
      hostname: new URL(supabaseUrl).hostname,
      pathname: "/storage/v1/object/public/**",
    },
  ];
}

const baseConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@up/core", "@up/db", "@up/ui"],
  images: { remotePatterns: storageImagePatterns() },
  headers: () =>
    Promise.resolve([
      { source: "/:path*", headers: securityHeaders },
      {
        // Service worker (ADR 0023): always fresh, same-origin scripts only.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ]),
  redirects: () => Promise.resolve([...legacyRedirects]),
};

export default function nextConfig(phase: string): NextConfig {
  const isBuildOrDev = phase === PHASE_PRODUCTION_BUILD || phase === PHASE_DEVELOPMENT_SERVER;
  if (isBuildOrDev && process.env.SKIP_ENV_VALIDATION !== "1") {
    validateServerEnv(process.env);
  }
  return baseConfig;
}
