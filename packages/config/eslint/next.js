// ESLint flat config for Next.js apps: shared base + Next.js core-web-vitals rules.
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { defineConfig } from "eslint/config";

import { baseConfig, boundaries } from "./base.js";

/**
 * @param {{ tsconfigRootDir: string }} options
 */
export function nextConfig({ tsconfigRootDir }) {
  return defineConfig(
    ...nextVitals,
    ...nextTs,
    ...baseConfig({ tsconfigRootDir, forbiddenImports: boundaries.app }),
  );
}
