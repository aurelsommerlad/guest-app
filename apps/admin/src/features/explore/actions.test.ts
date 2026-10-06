import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  exploreDeps: vi.fn(),
  exploreMediaDeps: vi.fn(),
  updatePlace: vi.fn(),
  createPlace: vi.fn(),
  requestMediaUpload: vi.fn(),
}));

vi.mock("../auth/server", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("./server", () => ({
  exploreDeps: mocks.exploreDeps,
  exploreMediaDeps: mocks.exploreMediaDeps,
  exploreScope: (tenantId: string) => ({ tenantId, module: "explore" }),
}));
vi.mock("./explore-admin-service", () => ({
  updatePlace: mocks.updatePlace,
  createPlace: mocks.createPlace,
  changePlaceStatus: vi.fn(),
  deletePlace: vi.fn(),
  movePlace: vi.fn(),
}));
vi.mock("../media/media-upload-service", () => ({
  requestMediaUpload: mocks.requestMediaUpload,
  confirmMediaUpload: vi.fn(),
}));

const { createPlaceAction, requestPlaceImageUploadAction, savePlaceAction } =
  await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("explore actions", () => {
  it("require a valid admin session before anything else", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("NEXT_REDIRECT /login"));
    await expect(savePlaceAction("x", { status: "idle" }, new FormData())).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    await expect(createPlaceAction(null, { status: "idle" }, new FormData())).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    await expect(
      requestPlaceImageUploadAction({ contentType: "image/png", size: 1 }),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(mocks.updatePlace).not.toHaveBeenCalled();
    expect(mocks.createPlace).not.toHaveBeenCalled();
    expect(mocks.requestMediaUpload).not.toHaveBeenCalled();
  });

  it("use the session's tenant and scope – never values from the form", async () => {
    mocks.requireAdmin.mockResolvedValue({
      adminUserId: "a",
      tenantId: "unique-places",
      email: "a@example.com",
    });
    mocks.updatePlace.mockResolvedValue({ ok: true });
    mocks.exploreMediaDeps.mockReturnValue({ storage: {} });
    mocks.requestMediaUpload.mockResolvedValue({ ok: true, uploadUrl: "u", path: "p" });
    const formData = new FormData();
    formData.set("tenantId", "other-tenant");
    formData.append("propertyIds", "laeke");
    formData.append("propertyIds", "other-hov");
    await savePlaceAction("place-1", { status: "idle" }, formData);
    expect(mocks.updatePlace.mock.calls[0]?.[1]).toEqual({ tenantId: "unique-places" });
    // Assignments are passed on for server-side validation against the tenant.
    expect(mocks.updatePlace.mock.calls[0]?.[3]).toMatchObject({
      propertyIds: ["laeke", "other-hov"],
    });
    await requestPlaceImageUploadAction({
      contentType: "image/png",
      size: 10,
      ...{ path: "other-tenant/x" },
    });
    expect(mocks.requestMediaUpload.mock.calls[0]?.slice(1)).toEqual([
      { adminUserId: "a", tenantId: "unique-places", email: "a@example.com" },
      { tenantId: "unique-places", module: "explore" },
      { contentType: "image/png", size: 10 },
    ]);
  });
});
