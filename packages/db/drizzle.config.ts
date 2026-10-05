import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit is used only to *generate* versioned SQL migrations from the schema
 * (`pnpm db:generate`). Migrations are applied with our guarded CLI (`pnpm db:migrate`),
 * never with `drizzle-kit push` – so no credentials are configured here.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
