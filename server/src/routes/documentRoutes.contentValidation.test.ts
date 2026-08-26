import express, { type Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateDocumentContent = vi.fn(
  async (
    _documentId: string,
    userId: string,
    { content, version }: { content: Record<string, unknown>; version: number },
  ) => ({
    id: "doc-1",
    title: "Untitled document",
    content,
    version: version + 1,
    ownerId: userId,
    lastEditedBy: userId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
);

vi.mock("../services/documentService.js", () => ({
  listDocuments: vi.fn(),
  createDocument: vi.fn(),
  getDocument: vi.fn(),
  renameDocument: vi.fn(),
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

describe("PUT /api/documents/:id/content - server-side sanitization", () => {
  beforeEach(() => {
    updateDocumentContent.mockClear();
  });

  it("accepts well-formed content and forwards the sanitized result to the service layer", async () => {
    const app = buildApp();

    const res = await request(app)
      .put("/api/documents/doc-1/content")
      .set("Authorization", authHeader)
      .send({
        content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] },
        version: 1,
      });

    expect(res.status).toBe(200);
    expect(updateDocumentContent).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown/injected node type before it reaches the service layer", async () => {
    const app = buildApp();

    const res = await request(app)
      .put("/api/documents/doc-1/content")
      .set("Authorization", authHeader)
      .send({
        content: { type: "doc", content: [{ type: "scriptInjection", evil: true }] },
        version: 1,
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { message: "Invalid document content" } });
    expect(updateDocumentContent).not.toHaveBeenCalled();
  });

  it("rejects a javascript: link href before it reaches the service layer", async () => {
    const app = buildApp();

    const res = await request(app)
      .put("/api/documents/doc-1/content")
      .set("Authorization", authHeader)
      .send({
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "click me", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
              ],
            },
          ],
        },
        version: 1,
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { message: "Document contains a disallowed link or image URL" } });
    expect(updateDocumentContent).not.toHaveBeenCalled();
  });

  it("rejects a data: image src before it reaches the service layer", async () => {
    const app = buildApp();

    const res = await request(app)
      .put("/api/documents/doc-1/content")
      .set("Authorization", authHeader)
      .send({
        content: {
          type: "doc",
          content: [{ type: "image", attrs: { src: "data:image/png;base64,iVBORw0KGgo=" } }],
        },
        version: 1,
      });

    expect(res.status).toBe(400);
    expect(updateDocumentContent).not.toHaveBeenCalled();
  });

  it("still rejects non-doc content via the existing zod boundary check", async () => {
    const app = buildApp();

    const res = await request(app)
      .put("/api/documents/doc-1/content")
      .set("Authorization", authHeader)
      .send({ content: { type: "notADoc" }, version: 1 });

    expect(res.status).toBe(400);
    expect(updateDocumentContent).not.toHaveBeenCalled();
  });
});
