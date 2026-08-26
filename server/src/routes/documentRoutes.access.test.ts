import express, { type Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const shareDocument = vi.fn(async (_id: string, _ownerId: string, email: string, role: string) => ({
  userId: "collab-1",
  email,
  role,
}));
const revokeAccess = vi.fn(async () => undefined);

vi.mock("../services/documentService.js", () => ({
  listDocuments: vi.fn(),
  createDocument: vi.fn(),
  getDocument: vi.fn(),
  renameDocument: vi.fn(),
  deleteDocument: vi.fn(),
  updateDocumentContent: vi.fn(),
  shareDocument: (...args: Parameters<typeof shareDocument>) => shareDocument(...args),
  revokeAccess: (...args: Parameters<typeof revokeAccess>) => revokeAccess(...args),
}));

const { default: documentRoutes } = await import("./documentRoutes.js");
const { errorHandler } = await import("../middleware/errorHandler.js");
const { signAccessToken } = await import("../lib/jwt.js");

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/documents", documentRoutes);
  app.use(errorHandler);
  return app;
}

const authHeader = `Bearer ${signAccessToken("owner-1")}`;

describe("POST /api/documents/:id/access (share)", () => {
  beforeEach(() => {
    shareDocument.mockClear();
  });

  it("shares with a valid email/role and returns the grant", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/documents/doc-1/access")
      .set("Authorization", authHeader)
      .send({ email: "collab@example.com", role: "EDITOR" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: { access: { userId: "collab-1", email: "collab@example.com", role: "EDITOR" } },
    });
    expect(shareDocument).toHaveBeenCalledWith("doc-1", "owner-1", "collab@example.com", "EDITOR");
  });

  it("rejects an invalid email before calling the service", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/documents/doc-1/access")
      .set("Authorization", authHeader)
      .send({ email: "not-an-email", role: "VIEWER" });

    expect(res.status).toBe(400);
    expect(shareDocument).not.toHaveBeenCalled();
  });

  it("rejects a role outside VIEWER/EDITOR before calling the service", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/documents/doc-1/access")
      .set("Authorization", authHeader)
      .send({ email: "collab@example.com", role: "ADMIN" });

    expect(res.status).toBe(400);
    expect(shareDocument).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/documents/doc-1/access")
      .send({ email: "collab@example.com", role: "VIEWER" });

    expect(res.status).toBe(401);
    expect(shareDocument).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/documents/:id/access/:email (revoke)", () => {
  beforeEach(() => {
    revokeAccess.mockClear();
  });

  it("revokes access for the given email", async () => {
    const app = buildApp();
    const res = await request(app)
      .delete(`/api/documents/doc-1/access/${encodeURIComponent("collab@example.com")}`)
      .set("Authorization", authHeader);

    expect(res.status).toBe(204);
    expect(revokeAccess).toHaveBeenCalledWith("doc-1", "owner-1", "collab@example.com");
  });

  it("rejects a malformed email in the path before calling the service", async () => {
    const app = buildApp();
    const res = await request(app)
      .delete(`/api/documents/doc-1/access/${encodeURIComponent("not-an-email")}`)
      .set("Authorization", authHeader);

    expect(res.status).toBe(400);
    expect(revokeAccess).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    const app = buildApp();
    const res = await request(app).delete(
      `/api/documents/doc-1/access/${encodeURIComponent("collab@example.com")}`,
    );

    expect(res.status).toBe(401);
    expect(revokeAccess).not.toHaveBeenCalled();
  });
});
