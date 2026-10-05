import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";

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

const baseConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript sources and are compiled by Next.js.
  transpilePackages: ["@up/core"],
  headers: () =>
    Promise.resolve([
      {
        source: "/:path*",
        headers: securityHeaders,
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
  return baseConfig;
}
