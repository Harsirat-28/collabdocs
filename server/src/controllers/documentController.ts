import type { Request, Response } from "express";
import { z } from "zod";
import * as documentService from "../services/documentService.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { sanitizeDocumentContent } from "../lib/documentSchema.js";

const createDocumentSchema = z.object({
  title: z.string().max(200).optional(),
});

const renameDocumentSchema = z.object({
  title: z.string().min(1).max(200),
});

// Cheap shape gate before the real ProseMirror-schema validation in
// sanitizeDocumentContent: rejects non-object/non-doc payloads early with a
// clear zod error, rather than a RangeError from deep inside prosemirror-model.
const documentContentSchema = z
  .object({ type: z.literal("doc") })
  .passthrough();

const updateContentSchema = z.object({
  content: documentContentSchema,
  version: z.number().int().nonnegative(),
});

const shareDocumentSchema = z.object({
  email: z.string().email(),
  role: z.enum(["VIEWER", "EDITOR"]),
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const documents = await documentService.listDocuments(req.userId!);
  res.status(200).json({ data: { documents } });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const { title } = createDocumentSchema.parse(req.body);
  const document = await documentService.createDocument(req.userId!, title);
  res.status(201).json({ data: { document } });
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const document = await documentService.getDocument(req.params.id!, req.userId!);
  res.status(200).json({ data: { document } });
});

export const rename = asyncHandler(async (req: Request, res: Response) => {
  const { title } = renameDocumentSchema.parse(req.body);
  const document = await documentService.renameDocument(req.params.id!, req.userId!, title);
  res.status(200).json({ data: { document } });
});

export const updateContent = asyncHandler(async (req: Request, res: Response) => {
  const body = updateContentSchema.parse(req.body);
  const content = sanitizeDocumentContent(body.content);
  const document = await documentService.updateDocumentContent(req.params.id!, req.userId!, {
    content,
    version: body.version,
  });
  res.status(200).json({ data: { document } });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await documentService.deleteDocument(req.params.id!, req.userId!);
  res.status(204).send();
});

export const share = asyncHandler(async (req: Request, res: Response) => {
  const { email, role } = shareDocumentSchema.parse(req.body);
  const access = await documentService.shareDocument(req.params.id!, req.userId!, email, role);
  res.status(200).json({ data: { access } });
});

export const revokeAccess = asyncHandler(async (req: Request, res: Response) => {
  const email = z.string().email().parse(req.params.email);
  await documentService.revokeAccess(req.params.id!, req.userId!, email);
  res.status(204).send();
});
