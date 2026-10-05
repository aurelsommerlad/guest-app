import { boundaries } from "@up/config/eslint/base";
import { reactConfig } from "@up/config/eslint/react";

export default reactConfig({
  tsconfigRootDir: import.meta.dirname,
  forbiddenImports: boundaries.ui,
});
