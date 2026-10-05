import "server-only";

import { validateServerEnv } from "./schema";

/** Validated server environment. Importing this from a client component fails the build. */
export const serverEnv = validateServerEnv(process.env);
