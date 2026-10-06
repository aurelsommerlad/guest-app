import { describe, expect, it } from "vitest";

import { addressLines, buildPlaceActions } from "./place-actions";

describe("place actions", () => {
  it("offers only actions whose data exists, in a fixed order", () => {
    expect(buildPlaceActions({})).toEqual([]);
    expect(
      buildPlaceActions({
        address: "Seepromenade 1\n88131 Lindau",
        websiteUrl: "https://seecafe.example.org",
        phone: "+49 (0) 8382 123-45",
        reservationUrl: "https://seecafe.example.org/tisch",
      }).map((action) => [action.kind, action.href, action.external]),
    ).toEqual([
      [
        "route",
        "https://www.google.com/maps/dir/?api=1&destination=Seepromenade%201%2C%2088131%20Lindau",
        true,
      ],
      ["website", "https://seecafe.example.org/", true],
      ["call", "tel:+490838212345", false],
      ["reserve", "https://seecafe.example.org/tisch", true],
    ]);
  });

  it("prefers the maintained maps link over the address", () => {
    expect(
      buildPlaceActions({ address: "Seepromenade 1", mapsUrl: "https://maps.example.org/x" }),
    ).toEqual([{ kind: "route", href: "https://maps.example.org/x", external: true }]);
  });

  it("drops anything that is not an http(s) link (defence in depth)", () => {
    expect(
      buildPlaceActions({
        mapsUrl: "javascript:alert(1)",
        websiteUrl: "data:text/html,<script>",
        reservationUrl: "mailto:x@example.org",
        phone: "call me",
      }),
    ).toEqual([]);
  });

  it("splits the address into lines", () => {
    expect(addressLines(" Seepromenade 1 \r\n\n88131 Lindau ")).toEqual([
      "Seepromenade 1",
      "88131 Lindau",
    ]);
    expect(addressLines(undefined)).toBeUndefined();
    expect(addressLines("  ")).toBeUndefined();
  });
});
