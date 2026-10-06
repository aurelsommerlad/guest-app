import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/guide/hov" }));
vi.mock("../features/auth/actions", () => ({ logoutAction: vi.fn() }));

const { AdminShell } = await import("./AdminShell");

const markup = renderToStaticMarkup(
  <AdminShell
    email="redaktion@example.com"
    properties={[{ id: "hov", displayName: "HØV", spokenName: "Höv", locationName: "Altusried" }]}
    rememberedPropertyId={null}
  >
    <p>Arbeitsfläche</p>
  </AdminShell>,
);

describe("admin shell", () => {
  it("has a fixed desktop sidebar and a modal drawer for tablet/mobile with the same navigation", () => {
    expect(markup).toMatch(/class="hidden bg-surface lg:block[^"]*"><aside class="sticky top-0/);
    expect(markup).toMatch(/<dialog[^>]*aria-label="Navigation"/);
    expect(markup.match(/aria-label="Hauptnavigation"/g)).toHaveLength(2);
    expect(markup).toContain('aria-label="Navigation öffnen"');
    expect(markup).toMatch(/class="-ml-2 lg:hidden"/);
  });

  it("shows the global context in a sticky top bar and the user with logout in the sidebar", () => {
    expect(markup).toMatch(/<header class="sticky top-0 z-20[^"]*">[\s\S]*aria-expanded="false"/);
    expect(markup).toContain("Altusried");
    expect(markup).toContain("redaktion@example.com");
    expect(markup).toContain("Abmelden");
    expect(markup).toContain('href="#main"');
    expect(markup).toContain("Arbeitsfläche");
  });
});
