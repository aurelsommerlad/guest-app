import { describe, expect, it } from "vitest";

import { resolveLocalizedText } from "./localized-text";

describe("resolveLocalizedText", () => {
  const text = { de: "Allgäu entdecken", en: "Discover the Allgäu" };

  it("returns the requested locale", () => {
    expect(resolveLocalizedText(text, "en", "de")).toBe("Discover the Allgäu");
  });

  it("falls back to the default locale, then to any translation", () => {
    expect(resolveLocalizedText({ de: "Extras" }, "en", "de")).toBe("Extras");
    expect(resolveLocalizedText({ fr: "Bonjour" }, "en", "de")).toBe("Bonjour");
    expect(resolveLocalizedText({}, "en", "de")).toBe("");
  });
});
