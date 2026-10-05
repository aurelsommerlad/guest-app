// ESLint flat config for framework-free React packages (@up/ui):
// shared base + React hooks rules + strict accessibility rules.
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig } from "eslint/config";
import globals from "globals";

import { baseConfig } from "./base.js";

/**
 * @param {{ tsconfigRootDir: string, forbiddenImports?: string[] }} options
 */
export function reactConfig(options) {
  return defineConfig(
    ...baseConfig(options),
    jsxA11y.flatConfigs.strict,
    reactHooks.configs.flat.recommended,
    {
      files: ["**/*.tsx"],
      languageOptions: { globals: { ...globals.browser } },
    },
  );
}
