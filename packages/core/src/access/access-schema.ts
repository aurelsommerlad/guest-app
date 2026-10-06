import { z } from "zod";

import { optionalLocalizedTextSchema } from "../guide/guide-schema";
import { ACCESS_MODES, ACCESS_RELEASES } from "./access-model";

export const propertyAccessConfigSchema = z.strictObject({
  mode: z.enum(ACCESS_MODES),
  release: z.enum(ACCESS_RELEASES),
  requiresCompletedRegistration: z.boolean(),
  instructions: optionalLocalizedTextSchema(1000).optional(),
});

/** Key box codes: 3–12 letters or digits (no spaces) – validated before encryption. */
export const keyboxCodeSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^[A-Za-z0-9]{3,12}$/));
