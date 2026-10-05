import { describe, expect, it } from "vitest";

import { contrastRatio, parseColor, toHex, wcagRating } from "./contrast";

describe("contrast helpers", () => {
  it("parses computed rgb() and hex colors", () => {
    expect(parseColor("rgb(248, 246, 241)")).toEqual([248, 246, 241]);
    expect(parseColor("rgb(23 24 23)")).toEqual([23, 24, 23]);
    expect(parseColor("#87977E")).toEqual([135, 151, 126]);
    expect(parseColor("#fff")).toEqual([255, 255, 255]);
    expect(parseColor("transparent")).toBeNull();
  });

  it("formats hex", () => {
    expect(toHex([82, 102, 78])).toBe("#52664E");
  });

  it("computes WCAG ratios", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
    // text-secondary (#6B6A65) on background (#F8F6F1) must pass AA
    expect(contrastRatio([107, 106, 101], [248, 246, 241])).toBeGreaterThanOrEqual(4.5);
    // primary-dark (#52664E) on background passes AA
    expect(contrastRatio([82, 102, 78], [248, 246, 241])).toBeGreaterThanOrEqual(4.5);
    // chalk on sage (#87977E) is only sufficient for large text
    const sage = contrastRatio([250, 250, 247], [135, 151, 126]);
    expect(sage).toBeLessThan(3.5);
  });

  it("rates ratios", () => {
    expect(wcagRating(7.2)).toBe("AAA");
    expect(wcagRating(4.6)).toBe("AA");
    expect(wcagRating(3.1)).toBe("AA groß");
    expect(wcagRating(2.9)).toBe("nicht ausreichend");
  });
});
