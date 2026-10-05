import { EXTERNAL_PROVIDERS, isEntityKey, isValidTimeZone } from "@up/core";
import { z } from "zod";

const key = z.string().refine(isEntityKey, "must match ENTITY_KEY_PATTERN");
const name = z.string().trim().min(1).max(100);
const externalIds = z.partialRecord(z.enum(EXTERNAL_PROVIDERS), z.string().trim().min(1).max(255));

const unitSeedSchema = z.object({
  id: key,
  slug: key,
  displayName: name,
  isActive: z.boolean().default(true),
  externalIds: externalIds.default({}),
});

const propertySeedSchema = z.object({
  id: key,
  slug: key,
  displayName: name,
  spokenName: name,
  locationName: name,
  timezone: z.string().refine(isValidTimeZone, "must be an IANA time zone"),
  isActive: z.boolean().default(true),
  externalIds: externalIds.default({}),
  units: z.array(unitSeedSchema).default([]),
});

function duplicates(values: readonly string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

/** Master data of one tenant, validated before anything is written. */
export const tenantSeedSchema = z
  .object({
    tenant: z.object({ id: key, slug: key, name: z.string().trim().min(1).max(200) }),
    properties: z.array(propertySeedSchema),
  })
  .superRefine((seed, ctx) => {
    const units = seed.properties.flatMap((property) => property.units);
    const checks: [string, string[]][] = [
      ["property id", seed.properties.map((property) => property.id)],
      ["property slug", seed.properties.map((property) => property.slug)],
      ["unit id", units.map((unit) => unit.id)],
      ...seed.properties.map((property): [string, string[]] => [
        `unit slug in ${property.id}`,
        property.units.map((unit) => unit.slug),
      ]),
      ...EXTERNAL_PROVIDERS.flatMap((provider): [string, string[]][] => [
        [
          `${provider} property id`,
          seed.properties.flatMap((property) => property.externalIds[provider] ?? []),
        ],
        [`${provider} unit id`, units.flatMap((unit) => unit.externalIds[provider] ?? [])],
      ]),
    ];
    for (const [label, values] of checks) {
      for (const value of new Set(duplicates(values))) {
        ctx.addIssue({ code: "custom", message: `duplicate ${label}: ${value}` });
      }
    }
  });

export type TenantSeedInput = z.input<typeof tenantSeedSchema>;
export type TenantSeed = z.output<typeof tenantSeedSchema>;
