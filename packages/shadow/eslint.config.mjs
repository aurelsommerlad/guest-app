import { baseConfig } from "@up/config/eslint/base";

export default baseConfig({
  tsconfigRootDir: import.meta.dirname,
  forbiddenImports: ["@up/ui", "next", "react", "react-dom"],
});
