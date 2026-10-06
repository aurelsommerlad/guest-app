import { type GuestRegistrationProvider } from "@up/core";
import { describe, expect, it, vi } from "vitest";

import { selectRegistrationProviders } from "./select-providers";

const apaleo = (): GuestRegistrationProvider => ({
  target: "apaleo",
  submit: () => Promise.resolve({ status: "synced" }),
});

describe("registration targets per environment (case 11)", () => {
  it("calls neither Apaleo nor Feratel while the write-back flag is disabled", () => {
    const create = vi.fn(apaleo);
    const providers = selectRegistrationProviders(
      {
        APALEO_REGISTRATION_WRITEBACK: "disabled",
        APALEO_CLIENT_ID: "id",
        APALEO_CLIENT_SECRET: "secret",
      },
      { apaleo: create },
    );
    expect(providers).toEqual({});
    expect(create).not.toHaveBeenCalled();
  });

  it("needs the flag and credentials for Apaleo; Feratel stays off until implemented", () => {
    expect(
      selectRegistrationProviders({ APALEO_REGISTRATION_WRITEBACK: "enabled" }, { apaleo }),
    ).toEqual({});
    const enabled = selectRegistrationProviders(
      {
        APALEO_REGISTRATION_WRITEBACK: "enabled",
        APALEO_CLIENT_ID: "id",
        APALEO_CLIENT_SECRET: "secret",
      },
      { apaleo },
    );
    expect(Object.keys(enabled)).toEqual(["apaleo"]);
    expect(enabled).not.toHaveProperty("feratel");
  });
});
