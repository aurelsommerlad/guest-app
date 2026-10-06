import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  guideMediaDeps: vi.fn(),
  requestImageUpload: vi.fn(),
  confirmImageUpload: vi.fn(),
}));

vi.mock("../auth/server", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("./server", () => ({ guideDeps: vi.fn(), guideMediaDeps: mocks.guideMediaDeps }));
vi.mock("./guide-media-service", () => ({
  requestImageUpload: mocks.requestImageUpload,
  confirmImageUpload: mocks.confirmImageUpload,
}));

const { confirmImageUploadAction, requestImageUploadAction } = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("upload actions", () => {
  it("require a valid admin session before anything else", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("NEXT_REDIRECT /login"));
    await expect(
      requestImageUploadAction("hov", { contentType: "image/png", size: 10 }),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(
      confirmImageUploadAction("hov", { path: "x", width: 1, height: 1 }),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(mocks.guideMediaDeps).not.toHaveBeenCalled();
    expect(mocks.requestImageUpload).not.toHaveBeenCalled();
    expect(mocks.confirmImageUpload).not.toHaveBeenCalled();
  });

  it("use the session's tenant – never one from the browser", async () => {
    const admin = { adminUserId: "a", tenantId: "unique-places", email: "a@example.com" };
    mocks.requireAdmin.mockResolvedValue(admin);
    mocks.guideMediaDeps.mockReturnValue({ storage: {} });
    mocks.requestImageUpload.mockResolvedValue({ ok: true, uploadUrl: "u", path: "p" });
    await requestImageUploadAction("hov", {
      contentType: "image/png",
      size: 10,
      ...{ tenantId: "other-tenant", path: "other-tenant/x" },
    });
    expect(mocks.requestImageUpload).toHaveBeenCalledWith({ storage: {} }, admin, "hov", {
      contentType: "image/png",
      size: 10,
    });
  });

  it("answer clearly when uploads are not configured", async () => {
    mocks.requireAdmin.mockResolvedValue({ adminUserId: "a", tenantId: "unique-places" });
    mocks.guideMediaDeps.mockReturnValue(undefined);
    expect(await requestImageUploadAction("hov", { contentType: "image/png", size: 10 })).toEqual({
      ok: false,
      error: "Der Bild-Upload ist nicht konfiguriert.",
    });
  });
});
