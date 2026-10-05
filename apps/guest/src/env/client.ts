import { parseEnv } from "@up/core";

import { clientEnvSchema } from "./schema";

/**
 * Validated public environment.
 * Next.js only inlines NEXT_PUBLIC_* variables when accessed statically,
 * therefore every variable is listed explicitly.
 */
export const clientEnv = parseEnv(clientEnvSchema, {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});
