import { describe, expect, it } from "vitest";

import { addressLines, buildPlaceActions } from "./place-actions";

describe("buildPlaceActions", () => {
  it("offers no actions without data", () => {
    expect(buildPlaceActions({})).toEqual([]);
  });

  it("only offers actions whose information exists", () => {
    expect(buildPlaceActions({ website: "https://example.com" }).map((a) => a.kind)).toEqual([
      "website",
    ]);
    expect(buildPlaceActions({ phone: "+49 000 0000000" })).toEqual([
      { kind: "call", href: "tel:+490000000000", external: false },
    ]);
    expect(buildPlaceActions({ bookingUrl: "https://example.com/r" }).map((a) => a.kind)).toEqual([
      "reserve",
    ]);
  });

  it("builds an external maps link for the route – from the address", () => {
    const [route] = buildPlaceActions({
      address: { street: "Beispielweg 1", postalCode: "00000", city: "Musterort" },
    });
    expect(route).toEqual({
      kind: "route",
      href: "https://www.google.com/maps/dir/?api=1&destination=Beispielweg%201%2C%2000000%20Musterort",
      external: true,
    });
  });

  it("prefers coordinates for the route", () => {
    const [route] = buildPlaceActions({
      coordinates: { lat: 47.8, lng: 10.2 },
      address: { city: "Musterort" },
    });
    expect(route?.href).toBe("https://www.google.com/maps/dir/?api=1&destination=47.8%2C10.2");
  });

  it("orders actions: route, website, call, reserve", () => {
    const kinds = buildPlaceActions({
      bookingUrl: "https://example.com/r",
      phone: "+49 1",
      website: "https://example.com",
      address: { city: "Musterort" },
    }).map((a) => a.kind);
    expect(kinds).toEqual(["route", "website", "call", "reserve"]);
  });
});

describe("addressLines", () => {
  it("formats street and postal code with city", () => {
    expect(
      addressLines({ street: "Beispielweg 1", postalCode: "00000", city: "Musterort" }),
    ).toEqual(["Beispielweg 1", "00000 Musterort"]);
  });

  it("returns undefined for empty addresses", () => {
    expect(addressLines(undefined)).toBeUndefined();
    expect(addressLines({ street: " " })).toBeUndefined();
  });
});
