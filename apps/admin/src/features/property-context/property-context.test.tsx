import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminNav } from "../../components/AdminNav";
import { propertyCookie, rememberedProperty } from "./property-context";
import { PropertyContextProvider } from "./PropertyContext";
import { PropertySelector } from "./PropertySelector";

const navigation = vi.hoisted(() => ({ pathname: "/guide/hov" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ refresh: vi.fn() }),
}));

const properties = [
  { id: "hov", displayName: "HØV", spokenName: "Höv", locationName: "Altusried" },
  { id: "laeke", displayName: "LÆKE", spokenName: "Läke", locationName: "Wiggensbach" },
  { id: "alpila", displayName: "ΛLPILΛ", spokenName: "Alpila", locationName: "Oberstaufen" },
];

function selector(pathname: string, rememberedId: string | null = null) {
  navigation.pathname = pathname;
  return renderToStaticMarkup(
    <PropertyContextProvider properties={properties} rememberedId={rememberedId}>
      <PropertySelector />
    </PropertyContextProvider>,
  );
}

/** Visible text of the selector button (the global context label). */
const buttonText = (markup: string) =>
  (/<button[^>]*>([\s\S]*?)<\/button>/.exec(markup)?.[1] ?? "")
    .replace(/<span class="sr-only">[^<]*<\/span>/g, "")
    .replace(/<span aria-hidden="true">([^<]*)<\/span>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

const hrefs = (markup: string) => [...markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

/** hrefs of links carrying `attribute` (attribute order in the markup does not matter). */
const linksWith = (markup: string, attribute: string) =>
  [...markup.matchAll(/<a\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => tag.includes(attribute))
    .map((tag) => /href="([^"]+)"/.exec(tag)?.[1]);

beforeEach(() => {
  navigation.pathname = "/guide/hov";
});

describe("remembered property", () => {
  it("accepts only the tenant's own properties", () => {
    expect(rememberedProperty("hov", properties)).toBe("hov");
    expect(rememberedProperty("other-hov", properties)).toBeNull();
    expect(rememberedProperty("", properties)).toBeNull();
    expect(rememberedProperty(undefined, properties)).toBeNull();
  });

  it("writes a plain, long-lived, non-sensitive cookie", () => {
    expect(propertyCookie("hov", true)).toBe(
      "up_admin_property=hov; Path=/; Max-Age=31536000; SameSite=Lax; Secure",
    );
    expect(propertyCookie(null, false)).toBe(
      "up_admin_property=; Path=/; Max-Age=31536000; SameSite=Lax",
    );
  });
});

describe("property selector", () => {
  it("shows the property from the URL and offers all tenant properties as links", () => {
    const markup = selector("/guide/hov");
    expect(markup).toContain('aria-expanded="false"');
    expect(buttonText(markup)).toContain("HØV");
    expect(buttonText(markup)).toContain("· Altusried");
    expect(markup).toContain('<span class="sr-only">Objekt: </span>');
    expect(hrefs(markup)).toEqual(["/guide", "/guide/hov", "/guide/laeke", "/guide/alpila"]);
    expect(linksWith(markup, 'aria-current="true"')).toEqual(["/guide/hov"]);
  });

  it("shows Alle Objekte at a property module's root, even if another property is remembered", () => {
    const markup = selector("/guide", "laeke");
    expect(buttonText(markup)).toBe("Alle Objekte");
    expect(linksWith(markup, 'aria-current="true"')).toEqual(["/guide"]);
  });

  it("keeps the remembered property on pages without a property in the URL", () => {
    const markup = selector("/properties", "laeke");
    expect(markup).toContain("Läke");
    expect(new Set(hrefs(markup))).toEqual(new Set(["/properties"]));
  });

  it("ignores unknown and other tenants' property ids (URL and cookie)", () => {
    expect(buttonText(selector("/guide/other-hov"))).toBe("Alle Objekte");
    expect(buttonText(selector("/properties", "other-hov"))).toBe("Alle Objekte");
  });
});

describe("sidebar navigation", () => {
  it("marks the active module and carries the property into property modules", () => {
    const markup = renderToStaticMarkup(
      <AdminNav pathname="/guide/hov/new" activePropertyId="hov" />,
    );
    expect(linksWith(markup, 'aria-current="page"')).toEqual(["/guide/hov"]);
    expect(markup).toContain('href="/properties"');
    expect(markup).toContain("Inhalte");
    expect(markup).toContain("Verwaltung");
    // Future areas are not shown before they exist.
    for (const future of ["Inbox", "Aufenthalte", "Check-in", "Explore", "Extras", "Dashboard"]) {
      expect(markup).not.toContain(future);
    }
  });

  it("links Guide without a property when Alle Objekte is selected", () => {
    const markup = renderToStaticMarkup(
      <AdminNav pathname="/properties" activePropertyId={null} />,
    );
    expect(markup).toContain('href="/guide"');
    expect(linksWith(markup, 'aria-current="page"')).toEqual(["/properties"]);
  });
});
