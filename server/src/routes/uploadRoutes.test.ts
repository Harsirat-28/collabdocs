import express, { type Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.fn(async (_buffer: Buffer, extension: string) => ({
  url: `/uploads/fixed-id${extension}`,
}));

vi.mock("../services/storageService.js", () => ({
  storage: { save: (...args: Parameters<typeof save>) => save(...args) },
  UPLOAD_ROOT: "unused-in-test",
}));

const { default: uploadRoutes } = await import("./uploadRoutes.js");
const { errorHandler } = await import("../middleware/errorHandler.js");
const { signAccessToken } = await import("../lib/jwt.js");

function buildApp(): Express {
  const app = express();
  app.use("/api/uploads", uploadRoutes);
  app.use(errorHandler);
  return app;
}

const authHeader = `Bearer ${signAccessToken("user-1")}`;

describe("POST /api/uploads/image - MIME/size validation", () => {
  beforeEach(() => {
    save.mockClear();
  });

  it("accepts an allowed image type and derives the extension from the MIME type", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/uploads/image")
      .set("Authorization", authHeader)
      .attach("image", Buffer.from("fake-png-bytes"), { filename: "photo.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ data: { url: "/uploads/fixed-id.png" } });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[1]).toBe(".png");
  });

  it("accepts all four allowlisted image types", async () => {
    const app = buildApp();
    const cases: Array<[string, string]> = [
      ["image/jpeg", ".jpg"],
      ["image/gif", ".gif"],
      ["image/webp", ".webp"],
    ];

    for (const [mimeType, expectedExt] of cases) {
      save.mockClear();
      const res = await request(app)
        .post("/api/uploads/image")
        .set("Authorization", authHeader)
        .attach("image", Buffer.from("fake-bytes"), { filename: "file", contentType: mimeType });

      expect(res.status).toBe(201);
      expect(save.mock.calls[0]?.[1]).toBe(expectedExt);
    }
  });

  it("rejects a disallowed MIME type (e.g. text/html) before storage is touched", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/uploads/image")
      .set("Authorization", authHeader)
      .attach("image", Buffer.from("<script>alert(1)</script>"), {
        filename: "shell.html",
        contentType: "text/html",
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { message: "Unsupported image type. Use PNG, JPEG, GIF, or WebP." },
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects image/svg+xml (a known stored-XSS vector) even though it's an image type", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/uploads/image")
      .set("Authorization", authHeader)
      .attach("image", Buffer.from("<svg onload=alert(1)></svg>"), {
        filename: "evil.svg",
        contentType: "image/svg+xml",
      });

    expect(res.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it("never trusts the client-supplied filename/extension - only the MIME type decides the stored extension", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/uploads/image")
      .set("Authorization", authHeader)
      .attach("image", Buffer.from("fake-png-bytes"), {
        filename: "not-actually-a-png.php",
        contentType: "image/png",
      });

    expect(res.status).toBe(201);
    expect(save.mock.calls[0]?.[1]).toBe(".png");
    expect(res.body.data.url).not.toContain("php");
  });

  it("rejects a file over the configured size limit", async () => {
    const app = buildApp();
    // MAX_UPLOAD_MB is set to 1 in the test env (see setupEnv.ts).
    const oversized = Buffer.alloc(2 * 1024 * 1024, 1);

    const res = await request(app)
      .post("/api/uploads/image")
      .set("Authorization", authHeader)
      .attach("image", oversized, { filename: "big.png", contentType: "image/png" });

    expect(res.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects a request with no file attached", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/uploads/image")
      .set("Authorization", authHeader)
      .field("notAFile", "x");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { message: "No image file provided" } });
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/uploads/image")
      .attach("image", Buffer.from("fake-png-bytes"), { filename: "photo.png", contentType: "image/png" });

    expect(res.status).toBe(401);
    expect(save).not.toHaveBeenCalled();
  });
});
