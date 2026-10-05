import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import createNextIntlPlugin from "next-intl/plugin";

import { validateServerEnv } from "./src/env/schema";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Guest links will carry access tokens in the path; never leak them to external sites.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // A full Content-Security-Policy (nonce-based) follows in the hardening phase.
];

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** Public GUIDE media in Supabase Storage (uploaded by the admin app, ADR 0013). */
function storageImagePatterns(): NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]> {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) return [];
  const url = new URL(supabaseUrl);
  return [
    {
      protocol: "https",
      hostname: url.hostname,
      pathname: "/storage/v1/object/public/**",
    },
  ];
}

const baseConfig: NextConfig = {
  images: { remotePatterns: storageImagePatterns() },
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript sources and are compiled by Next.js.
  transpilePackages: ["@up/core", "@up/db", "@up/integrations", "@up/ui"],
  // Until guest access exists, the app entry points to the default-locale stay screen.
  redirects: () => Promise.resolve([{ source: "/", destination: "/de/stay", permanent: false }]),
  headers: () =>
    Promise.resolve([
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // The Design Lab embeds this specimen in same-origin iframes (local/staging only).
        // Later entries override earlier ones for the same header key.
        source: "/dev/ui/frame",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
      {
        // Guest link entry: never send the URL (with its token) as Referer anywhere.
        source: "/:locale/s/:token",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ]),
};

export default function nextConfig(phase: string): NextConfig {
  // Fail fast: an invalid environment aborts `next build` / `next dev` instead of
  // surfacing later as a runtime error. Pure tooling runs (`next typegen` in the typecheck
  // script) opt out via SKIP_ENV_VALIDATION=1. At runtime (`next start`, Vercel functions)
  // src/instrumentation.ts validates again.
  const isBuildOrDev = phase === PHASE_PRODUCTION_BUILD || phase === PHASE_DEVELOPMENT_SERVER;
  if (isBuildOrDev && process.env.SKIP_ENV_VALIDATION !== "1") {
    validateServerEnv(process.env);
  }
  return withNextIntl(baseConfig);
}
