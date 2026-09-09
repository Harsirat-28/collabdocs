import type { DocumentRole, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../lib/errors.js";

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

export async function listDocuments(userId: string) {
  const documents = await prisma.document.findMany({
    where: {
      OR: [{ ownerId: userId }, { accessGrants: { some: { userId } } }],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      createdAt: true,
      ownerId: true,
      accessGrants: { where: { userId }, select: { role: true } },
    },
  });

  return documents.map(({ ownerId, accessGrants, ...rest }) => ({
    ...rest,
    role: ownerId === userId ? ("OWNER" as const) : accessGrants[0]!.role,
  }));
}

async function loadDocument(documentId: string) {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) {
    throw new NotFoundError("Document not found");
  }
  return document;
}

/** Owner-only: used for actions bigger than editing (delete, share, revoke). */
async function loadOwnedDocument(documentId: string, userId: string) {
  const document = await loadDocument(documentId);
  if (document.ownerId !== userId) {
    // 404 rather than 403 so existence of other users' documents isn't leaked.
    throw new NotFoundError("Document not found");
  }
  return document;
}

/** Owner, or any DocumentAccess grant (VIEWER or EDITOR), may read. */
async function loadDocumentForRead(documentId: string, userId: string) {
  const document = await loadDocument(documentId);
  if (document.ownerId === userId) {
    return { document, role: "OWNER" as const };
  }

  const grant = await prisma.documentAccess.findUnique({
    where: { documentId_userId: { documentId, userId } },
  });
  if (!grant) {
    // No relationship to this document at all: 404, same anti-enumeration
    // reasoning as loadOwnedDocument.
    throw new NotFoundError("Document not found");
  }
  return { document, role: grant.role };
}

/** Owner, or an EDITOR grant, may write. A VIEWER grant is not enough. */
async function loadDocumentForWrite(documentId: string, userId: string) {
  const document = await loadDocument(documentId);
  if (document.ownerId === userId) {
    return { document, role: "OWNER" as const };
  }

  const grant = await prisma.documentAccess.findUnique({
    where: { documentId_userId: { documentId, userId } },
  });
  if (!grant) {
    throw new NotFoundError("Document not found");
  }
  if (grant.role !== "EDITOR") {
    // They can see the document (a viewer grant exists) but aren't allowed
    // to write to it - a known relationship with insufficient permission,
    // not a hidden document, so 403 rather than 404.
    throw new ForbiddenError("You do not have permission to edit this document");
  }
  return { document, role: grant.role };
}

export async function createDocument(ownerId: string, title: string | undefined) {
  return prisma.document.create({
    data: {
      ownerId,
      title: title?.trim() || "Untitled document",
      content: EMPTY_DOC,
      lastEditedBy: ownerId,
    },
  });
}

export async function getDocument(documentId: string, userId: string) {
  const { document, role } = await loadDocumentForRead(documentId, userId);
  return { ...document, role };
}

export async function renameDocument(documentId: string, userId: string, title: string) {
  const { role } = await loadDocumentForWrite(documentId, userId);
  const document = await prisma.document.update({
    where: { id: documentId },
    data: { title: title.trim() || "Untitled document" },
  });
  return { ...document, role };
}

export async function deleteDocument(documentId: string, userId: string): Promise<void> {
  await loadOwnedDocument(documentId, userId);
  await prisma.document.delete({ where: { id: documentId } });
}

interface UpdateContentInput {
  // Parsed and sanitized against the real ProseMirror schema by
  // sanitizeDocumentContent at the controller boundary; cast to Prisma's
  // JSON input type here at the edge.
  content: Record<string, unknown>;
  version: number;
}

/**
 * Optimistic concurrency: the client must send the version it last loaded.
 * If the stored version has moved on, the write is rejected instead of
 * silently clobbering newer content (e.g. a slow/out-of-order autosave
 * request landing after a newer one already saved).
 */
export async function updateDocumentContent(
  documentId: string,
  userId: string,
  { content, version }: UpdateContentInput,
) {
  const { document: current, role } = await loadDocumentForWrite(documentId, userId);

  if (current.version !== version) {
    throw new ConflictError("Document has changed since it was loaded", {
      currentVersion: current.version,
      currentContent: current.content,
      currentTitle: current.title,
    });
  }

  const document = await prisma.document.update({
    where: { id: documentId },
    data: {
      content: content as Prisma.InputJsonValue,
      version: { increment: 1 },
      lastEditedBy: userId,
    },
  });
  return { ...document, role };
}

/**
 * Authorization + seed data for a Socket.io room join (M3). Reuses the same
 * read-access check as the REST GET, and derives write permission from the
 * resolved role - same OWNER/EDITOR-can-write, VIEWER-cannot rule as the
 * REST content endpoint, just checked once at join time rather than per
 * request.
 */
export async function getDocumentForRealtime(documentId: string, userId: string) {
  const { document, role } = await loadDocumentForRead(documentId, userId);
  return { document, canWrite: role !== "VIEWER" };
}

/**
 * Persists a periodic snapshot of a document's live Yjs state (M3). Always
 * updates `yjsState`; `content` is included only when the caller could
 * derive valid ProseMirror JSON from the Yjs doc, so a transient bad decode
 * never clobbers the last-known-good REST-readable snapshot. Bumps
 * `version` alongside `content`, same as any other content write, so the
 * REST optimistic-concurrency check stays meaningful if the document is
 * later opened outside a live collaboration session.
 */
export async function saveYjsSnapshot(
  documentId: string,
  editorUserId: string | null,
  { yjsState, content }: { yjsState: Buffer; content: Record<string, unknown> | null },
): Promise<void> {
  await prisma.document.update({
    where: { id: documentId },
    data: {
      yjsState,
      ...(content
        ? {
            content: content as Prisma.InputJsonValue,
            version: { increment: 1 },
            ...(editorUserId ? { lastEditedBy: editorUserId } : {}),
          }
        : {}),
    },
  });
}

/**
 * Grants (or changes) a VIEWER/EDITOR role for another existing user, by
 * email. Owner-only. Upserts, so re-sharing with someone just changes their
 * role rather than erroring.
 */
export async function shareDocument(
  documentId: string,
  ownerId: string,
  email: string,
  role: DocumentRole,
) {
  await loadOwnedDocument(documentId, ownerId);

  const targetUser = await prisma.user.findUnique({ where: { email } });
  if (!targetUser) {
    throw new NotFoundError("No user found with that email");
  }
  if (targetUser.id === ownerId) {
    throw new BadRequestError("You already own this document");
  }

  const access = await prisma.documentAccess.upsert({
    where: { documentId_userId: { documentId, userId: targetUser.id } },
    create: { documentId, userId: targetUser.id, role },
    update: { role },
  });

  return { userId: access.userId, email: targetUser.email, role: access.role };
}

/** Revokes a previously granted role, by email. Owner-only, idempotent. */
export async function revokeAccess(
  documentId: string,
  ownerId: string,
  email: string,
): Promise<void> {
  await loadOwnedDocument(documentId, ownerId);

  const targetUser = await prisma.user.findUnique({ where: { email } });
  if (!targetUser) {
    throw new NotFoundError("No user found with that email");
  }

  await prisma.documentAccess.deleteMany({
    where: { documentId, userId: targetUser.id },
  });
}
