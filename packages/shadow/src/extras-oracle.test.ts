/**
 * Oracle tests: the Extras interpretation reproduced in @up/core (extras-semantics) against the
 * REAL Extras code (aurelsommerlad/guest-services, local checkout, imported read-only). Every
 * stored-value case of the configuration parity check is run through both.
 *
 * Skipped when no guest-services checkout is present (EXTRAS_REPO, default ../guest-services).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  extrasExtensionConfig,
  extrasExtensionEffectivelyEnabled,
  extrasExtraPersonPrice,
  extrasResolvePriceUnitLabel,
  extrasResolveText,
  extrasSortKey,
  extrasUnitGroupRestriction,
} from "@up/core";
import { describe, expect, it } from "vitest";

const EXTRAS_REPO =
  process.env.EXTRAS_REPO ?? path.join(import.meta.dirname, "../../../../guest-services");
const available = existsSync(path.join(EXTRAS_REPO, "lib/catalogLocalization.js"));

type Mod = Record<string, (...args: never[]) => unknown>;
const load = async (file: string): Promise<Mod> =>
  (await import(pathToFileURL(path.join(EXTRAS_REPO, "lib", file)).href)) as Mod;
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed result of an untyped JS function
const call = <T = unknown>(fn: unknown, ...args: unknown[]) =>
  (fn as (...a: unknown[]) => unknown)(...args) as T;

const VALUES: unknown[] = [
  undefined,
  "",
  null,
  0,
  "0",
  false,
  "false",
  true,
  "true",
  1,
  2.5,
  "35",
  "35,50",
  -1,
  "abc",
  [],
  [5],
];

describe.skipIf(!available)("Extras oracle (real guest-services code)", () => {
  it("additional guest price: buildExtraPersonPricing", async () => {
    const { buildExtraPersonPricing } = await load("occupancyAmendment.js");
    for (const value of VALUES) {
      const real = call<{ unitPrice: { amount: number } } | null>(buildExtraPersonPricing, {
        pricePerNight: value,
        nights: 2,
      });
      const amount = real?.unitPrice.amount ?? null;
      expect(extrasExtraPersonPrice(value), JSON.stringify(value)).toBe(amount);
    }
  });

  it("sort order: compareBySortOrder", async () => {
    const { compareBySortOrder } = await load("catalogSort.js");
    for (const a of VALUES)
      for (const b of [undefined, 1, 3, "2"]) {
        const real = call<number>(compareBySortOrder, { sortOrder: a }, { sortOrder: b });
        const ours = extrasSortKey(a) - extrasSortKey(b);
        expect(Math.sign(ours) || 0, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(
          Math.sign(real) || 0,
        );
      }
  });

  it("apartment types: isUnitGroupAllowed", async () => {
    const { isUnitGroupAllowed } = await load("unitGroupRestriction.js");
    const lists: unknown[] = [
      undefined,
      null,
      [],
      "UG1",
      ["UG1"],
      ["UG1", "UG2"],
      ["bad id!"],
      [123],
    ];
    for (const list of lists)
      for (const group of ["UG1", "UG2", "OTHER", null]) {
        const real = call<boolean>(isUnitGroupAllowed, list, group);
        const r = extrasUnitGroupRestriction(list);
        const ours = !r.restricted || (group !== null && r.allowed.includes(group));
        expect(ours, `${JSON.stringify(list)} / ${String(group)}`).toBe(real);
      }
  });

  it("texts and price unit labels: catalogLocalization + priceDisplay", async () => {
    const { resolveBilingualText, resolveBilingualPriceUnitLabel } =
      await load("catalogLocalization.js");
    const { resolvePriceUnitLabel } = await load("priceDisplay.js");
    const texts = [undefined, "", "  ", "Parkplatz", "Car park"];
    for (const overrideDe of texts)
      for (const apaleoDe of texts)
        for (const apaleoEn of [undefined, "Parking"])
          for (const generic of [undefined, "Car park"]) {
            const input = {
              overrideDe,
              overrideEn: "",
              apaleoDe,
              apaleoEn,
              genericFallback: generic,
              finalFallback: "PKW",
            };
            expect(extrasResolveText({ ...input, generic }), JSON.stringify(input)).toEqual(
              call(resolveBilingualText, input),
            );
          }
    for (const rule of [
      "per_night",
      "per_stay",
      "arrival_day",
      "departure_day",
      "per_person_per_night",
      "bogus",
      undefined,
    ])
      for (const generic of [undefined, "", "pro Stück"])
        for (const overrideEn of [undefined, "per piece"]) {
          const real = call(resolveBilingualPriceUnitLabel, {
            overrideDe: "",
            overrideEn,
            genericPriceUnitLabel: generic,
            bookingRule: rule,
            resolvePriceUnitLabel,
          });
          expect(
            extrasResolvePriceUnitLabel({ overrideDe: "", overrideEn, generic, bookingRule: rule }),
            `${String(rule)} ${String(generic)} ${String(overrideEn)}`,
          ).toEqual(real);
        }
  });

  it("extension decision: decideExtensionOffer agrees on 'any offer possible'", async () => {
    const { decideExtensionOffer } = await load("stayExtension.js");
    for (const min of VALUES) {
      const config = extrasExtensionConfig({
        extensionNightEnabled: true,
        minSellableStayNights: min,
      });
      const anyOffer = [0, 1, 2, 3, 4, 40].some(
        (gap) =>
          call<{ offer: boolean }>(decideExtensionOffer, {
            gap,
            minSellableStayNights: config.minSellableStayNights,
            discountOneNightGap: 10,
            discountStandard: 10,
          }).offer,
      );
      expect(extrasExtensionEffectivelyEnabled(config), JSON.stringify(min)).toBe(anyOffer);
    }
  });

  it("extension config: getExtensionConfig with every stored value (separate process, temp dir)", () => {
    // store.js reads the local JSON fallback from <cwd>/.data/db.json – run it in a throwaway
    // directory without KV credentials so nothing outside that directory is touched.
    const dir = mkdtempSync(path.join(tmpdir(), "extras-oracle-"));
    try {
      const cases = VALUES.filter((v) => v !== undefined);
      const configs = cases.flatMap((value) => [
        { extensionNightEnabled: value, minSellableStayNights: 2 },
        { extensionNightEnabled: true, minSellableStayNights: value },
        { extensionNightEnabled: true, extensionDiscountPreArrivalOneNightGap: value },
        {
          extensionNightEnabled: true,
          extensionDiscountOneNightGap: value,
          extensionDiscountStandard: value,
        },
      ]);
      configs.push({} as never);
      const script = `
        import { promises as fs } from "fs";
        const configs = ${JSON.stringify(configs)};
        await fs.mkdir(".data", { recursive: true });
        const db = {};
        configs.forEach((c, i) => { db["extension-night:config:P" + i] = c; });
        await fs.writeFile(".data/db.json", JSON.stringify(db));
        const { getExtensionConfig } = await import(${JSON.stringify(pathToFileURL(path.join(EXTRAS_REPO, "lib/store.js")).href)});
        const out = [];
        for (let i = 0; i < configs.length; i++) out.push(await getExtensionConfig("P" + i));
        console.log(JSON.stringify(out));
      `;
      const env = { ...process.env };
      delete env.KV_REST_API_URL;
      delete env.KV_REST_API_TOKEN;
      const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: dir,
        env,
        encoding: "utf8",
      });
      const real = JSON.parse(stdout.trim().split("\n").pop() ?? "[]") as Record<string, unknown>[];
      configs.forEach((config, i) => {
        const r = real[i] ?? {};
        const { extensionDiscountOneNightGap: _a, extensionDiscountStandard: _b, ...expected } = r;
        expect(
          extrasExtensionConfig(config as Record<string, unknown>),
          JSON.stringify(config),
        ).toEqual(expected);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
