import express, { type Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createDocument = vi.fn(async (ownerId: string, title?: string) => ({
  id: "doc-1",
  title: title ?? "Untitled document",
  content: { type: "doc", content: [{ type: "paragraph" }] },
  version: 1,
  ownerId,
  lastEditedBy: ownerId,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}));
const renameDocument = vi.fn(async (_id: string, _userId: string, title: string) => ({
  id: "doc-1",
  title,
  content: { type: "doc", content: [{ type: "paragraph" }] },
  version: 1,
  ownerId: "user-1",
  lastEditedBy: "user-1",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}));
const updateDocumentContent = vi.fn();

vi.mock("../services/documentService.js", () => ({
  listDocuments: vi.fn(),
  createDocument: (...args: Parameters<typeof createDocument>) => createDocument(...args),
  getDocument: vi.fn(),
  renameDocument: (...args: Parameters<typeof renameDocument>) => renameDocument(...args),
  deleteDocument: vi.fn(),
  updateDocumentContent: (...args: Parameters<typeof updateDocumentContent>) =>
    updateDocumentContent(...args),
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

const authHeader = `Bearer ${signAccessToken("user-1")}`;

describe("zod boundary validation - POST /api/documents", () => {
  beforeEach(() => {
    createDocument.mockClear();
  });

  it("rejects a title over 200 characters", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/documents")
      .set("Authorization", authHeader)
      .send({ title: "x".repeat(201) });

    expect(res.status).toBe(400);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("accepts an omitted title", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/documents").set("Authorization", authHeader).send({});

    expect(res.status).toBe(201);
    expect(createDocument).toHaveBeenCalledWith("user-1", undefined);
  });
});

describe("zod boundary validation - PATCH /api/documents/:id (rename)", () => {
  beforeEach(() => {
    renameDocument.mockClear();
  });

  it("rejects an empty title", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch("/api/documents/doc-1")
      .set("Authorization", authHeader)
      .send({ title: "" });

    expect(res.status).toBe(400);
    expect(renameDocument).not.toHaveBeenCalled();
  });

  it("rejects a missing title", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch("/api/documents/doc-1")
      .set("Authorization", authHeader)
      .send({});

    expect(res.status).toBe(400);
    expect(renameDocument).not.toHaveBeenCalled();
  });
});

describe("zod boundary validation - PUT /api/documents/:id/content", () => {
  beforeEach(() => {
    updateDocumentContent.mockClear();
  });

  it("rejects a negative version", async () => {
    const app = buildApp();
    const res = await request(app)
      .put("/api/documents/doc-1/content")
      .set("Authorization", authHeader)
      .send({ content: { type: "doc", content: [{ type: "paragraph" }] }, version: -1 });

    expect(res.status).toBe(400);
    expect(updateDocumentContent).not.toHaveBeenCalled();
  });

  it("rejects a non-integer version", async () => {
    const app = buildApp();
    const res = await request(app)
      .put("/api/documents/doc-1/content")
      .set("Authorization", authHeader)
      .send({ content: { type: "doc", content: [{ type: "paragraph" }] }, version: 1.5 });

    expect(res.status).toBe(400);
    expect(updateDocumentContent).not.toHaveBeenCalled();
  });

  it("rejects a missing content field", async () => {
    const app = buildApp();
    const res = await request(app)
      .put("/api/documents/doc-1/content")
      .set("Authorization", authHeader)
      .send({ version: 1 });

    expect(res.status).toBe(400);
    expect(updateDocumentContent).not.toHaveBeenCalled();
  });
});

describe("authentication boundary", () => {
  it("rejects requests with no access token at all", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/documents");
    expect(res.status).toBe(401);
  });
});
