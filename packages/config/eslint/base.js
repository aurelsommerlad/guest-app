// Shared ESLint flat config for all workspace packages.
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Architecture boundaries (see docs/architecture.md, "Repository-Struktur").
 * Every package declares which workspace packages / frameworks it must NOT import.
 */
export const boundaries = {
  core: ["@up/db", "@up/integrations", "@up/ui", "next", "react", "react-dom"],
  ui: ["@up/core", "@up/db", "@up/integrations"],
  db: ["@up/integrations", "@up/ui", "next", "react", "react-dom"],
  integrations: ["@up/db", "@up/ui", "next", "react", "react-dom"],
  app: [],
};

/**
 * @param {{ tsconfigRootDir: string, forbiddenImports?: string[] }} options
 */
export function baseConfig({ tsconfigRootDir, forbiddenImports = [] }) {
  return defineConfig(
    globalIgnores([
      "**/node_modules/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/dist/**",
      "next-env.d.ts",
    ]),
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    {
      languageOptions: {
        globals: { ...globals.node },
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        "@typescript-eslint/consistent-type-imports": [
          "error",
          { fixStyle: "inline-type-imports" },
        ],
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
        "no-console": "error",
        eqeqeq: ["error", "always"],
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["@up/*/src", "@up/*/src/*"],
                message:
                  "Import workspace packages via their public entry point, not internal paths.",
              },
              ...forbiddenImports.map((name) => ({
                group: [name, `${name}/*`],
                message: `Architecture boundary: this package must not depend on "${name}".`,
              })),
            ],
          },
        ],
      },
    },
    {
      files: ["**/*.{js,mjs,cjs}"],
      extends: [tseslint.configs.disableTypeChecked],
    },
    prettier,
  );
}
