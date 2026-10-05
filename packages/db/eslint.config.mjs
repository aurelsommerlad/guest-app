import { baseConfig, boundaries } from "@up/config/eslint/base";

export default baseConfig({
  tsconfigRootDir: import.meta.dirname,
  forbiddenImports: boundaries.db,
});
