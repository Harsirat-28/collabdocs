import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", async () => {
  const { createFakePrisma } = await import("../test/fakePrisma.js");
  return { prisma: createFakePrisma() };
});

import { prisma } from "../lib/prisma.js";
import type { FakePrisma } from "../test/fakePrisma.js";
import * as documentService from "./documentService.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../lib/errors.js";

const fakePrisma = prisma as unknown as FakePrisma;

const OWNER = "owner-1";
const OTHER_USER = "other-user-2";

beforeEach(() => {
  fakePrisma.__reset();
});

/** Share/revoke resolve by email, so these tests need real User rows. */
async function createFakeUser(email: string) {
  return fakePrisma.user.create({ data: { email, passwordHash: "unused", name: null } });
}

describe("ownership enforcement", () => {
  it("lets the owner read, rename, and delete their own document", async () => {
    const doc = await documentService.createDocument(OWNER, "My doc");

    const fetched = await documentService.getDocument(doc.id, OWNER);
    expect(fetched.id).toBe(doc.id);

    const renamed = await documentService.renameDocument(doc.id, OWNER, "Renamed");
    expect(renamed.title).toBe("Renamed");

    await documentService.deleteDocument(doc.id, OWNER);
    await expect(documentService.getDocument(doc.id, OWNER)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("returns NotFoundError (not ForbiddenError) for a non-owner reading someone else's document", async () => {
    const doc = await documentService.createDocument(OWNER, "Private doc");

    const error = await documentService.getDocument(doc.id, OTHER_USER).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundError);
  });

  it("gives a truly nonexistent id and a non-owned id the identical error, so existence isn't leaked", async () => {
    const doc = await documentService.createDocument(OWNER, "Private doc");

    let notOwnedMessage = "";
    let notFoundMessage = "";
    try {
      await documentService.getDocument(doc.id, OTHER_USER);
    } catch (err) {
      notOwnedMessage = (err as NotFoundError).message;
    }
    try {
      await documentService.getDocument("does-not-exist", OTHER_USER);
    } catch (err) {
      notFoundMessage = (err as NotFoundError).message;
    }

    expect(notOwnedMessage).toBe(notFoundMessage);
  });

  it("blocks a non-owner from renaming, and leaves the title untouched", async () => {
    const doc = await documentService.createDocument(OWNER, "Original title");

    await expect(
      documentService.renameDocument(doc.id, OTHER_USER, "Hijacked title"),
    ).rejects.toBeInstanceOf(NotFoundError);

    const stillOwned = await documentService.getDocument(doc.id, OWNER);
    expect(stillOwned.title).toBe("Original title");
  });

  it("blocks a non-owner from deleting, and the document still exists afterward", async () => {
    const doc = await documentService.createDocument(OWNER, "Keep me");

    await expect(documentService.deleteDocument(doc.id, OTHER_USER)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const stillThere = await documentService.getDocument(doc.id, OWNER);
    expect(stillThere.id).toBe(doc.id);
  });

  it("blocks a non-owner from writing content, and leaves the stored content untouched", async () => {
    const doc = await documentService.createDocument(OWNER, "Doc");
    const originalContent = doc.content;

    await expect(
      documentService.updateDocumentContent(doc.id, OTHER_USER, {
        content: { type: "doc", content: [{ type: "paragraph" }] },
        version: doc.version,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const stillOriginal = await documentService.getDocument(doc.id, OWNER);
    expect(stillOriginal.content).toEqual(originalContent);
    expect(stillOriginal.version).toBe(doc.version);
  });

  it("only lists a user's own documents, never another user's", async () => {
    await documentService.createDocument(OWNER, "Owner doc A");
    await documentService.createDocument(OWNER, "Owner doc B");
    await documentService.createDocument(OTHER_USER, "Other user's doc");

    const ownerList = await documentService.listDocuments(OWNER);
    expect(ownerList).toHaveLength(2);
    expect(ownerList.every((d) => d.title.startsWith("Owner doc"))).toBe(true);
  });
});

describe("optimistic concurrency on content updates", () => {
  it("accepts a write at the correct version, increments version, and records the editor", async () => {
    const doc = await documentService.createDocument(OWNER, "Doc");
    const newContent = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] };

    const updated = await documentService.updateDocumentContent(doc.id, OWNER, {
      content: newContent,
      version: doc.version,
    });

    expect(updated.version).toBe(doc.version + 1);
    expect(updated.content).toEqual(newContent);
    expect(updated.lastEditedBy).toBe(OWNER);
  });

  it("rejects a stale version with a ConflictError carrying the real current state", async () => {
    const doc = await documentService.createDocument(OWNER, "Doc");
    const firstEdit = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] };
    const afterFirst = await documentService.updateDocumentContent(doc.id, OWNER, {
      content: firstEdit,
      version: doc.version,
    });

    // A second writer (e.g. a slow/out-of-order autosave request) still
    // holds the version from before the first edit landed.
    const staleAttempt = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "stale" }] }] };
    let error: ConflictError | undefined;
    try {
      await documentService.updateDocumentContent(doc.id, OWNER, {
        content: staleAttempt,
        version: doc.version,
      });
    } catch (err) {
      error = err as ConflictError;
    }

    expect(error).toBeInstanceOf(ConflictError);
    expect(error?.details).toEqual({
      currentVersion: afterFirst.version,
      currentContent: afterFirst.content,
      currentTitle: afterFirst.title,
    });
  });

  it("never clobbers the stored content when a stale write is rejected", async () => {
    const doc = await documentService.createDocument(OWNER, "Doc");
    const goodEdit = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "kept" }] }] };
    await documentService.updateDocumentContent(doc.id, OWNER, {
      content: goodEdit,
      version: doc.version,
    });

    const staleEdit = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "lost" }] }] };
    await documentService
      .updateDocumentContent(doc.id, OWNER, { content: staleEdit, version: doc.version })
      .catch(() => undefined);

    const current = await documentService.getDocument(doc.id, OWNER);
    expect(current.content).toEqual(goodEdit);
  });

  it("allows a chained sequence of correct-version writes, then rejects reuse of an now-stale version", async () => {
    const doc = await documentService.createDocument(OWNER, "Doc");

    const first = await documentService.updateDocumentContent(doc.id, OWNER, {
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "v1" }] }] },
      version: doc.version,
    });
    const second = await documentService.updateDocumentContent(doc.id, OWNER, {
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "v2" }] }] },
      version: first.version,
    });
    expect(second.version).toBe(first.version + 1);

    // Reusing the version from the *first* write (now two saves behind) must fail.
    await expect(
      documentService.updateDocumentContent(doc.id, OWNER, {
        content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "v1-again" }] }] },
        version: doc.version,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("M3: realtime collaboration support", () => {
  describe("getDocumentForRealtime", () => {
    it("resolves canWrite=true for the owner, returns the document row, and the owner's own presence info", async () => {
      const owner = await createFakeUser("realtime-owner-self@example.com");
      const doc = await documentService.createDocument(owner.id, "Doc");

      const result = await documentService.getDocumentForRealtime(doc.id, owner.id);

      expect(result.canWrite).toBe(true);
      expect(result.document.id).toBe(doc.id);
      // fakePrisma's user.findUnique doesn't trim fields by `select` the way
      // real Prisma does, so assert on the fields documentService actually
      // relies on rather than exact equality.
      expect(result.user).toMatchObject({
        id: owner.id,
        name: null,
        email: "realtime-owner-self@example.com",
      });
    });

    it("resolves canWrite=false for a VIEWER grant", async () => {
      const owner = await createFakeUser("realtime-owner1@example.com");
      const viewer = await createFakeUser("realtime-viewer1@example.com");
      const doc = await documentService.createDocument(owner.id, "Doc");
      await documentService.shareDocument(doc.id, owner.id, viewer.email, "VIEWER");

      const result = await documentService.getDocumentForRealtime(doc.id, viewer.id);

      expect(result.canWrite).toBe(false);
    });

    it("resolves canWrite=true for an EDITOR grant", async () => {
      const owner = await createFakeUser("realtime-owner2@example.com");
      const editor = await createFakeUser("realtime-editor2@example.com");
      const doc = await documentService.createDocument(owner.id, "Doc");
      await documentService.shareDocument(doc.id, owner.id, editor.email, "EDITOR");

      const result = await documentService.getDocumentForRealtime(doc.id, editor.id);

      expect(result.canWrite).toBe(true);
    });

    it("throws NotFoundError for a user with no access at all", async () => {
      const owner = await createFakeUser("realtime-owner3@example.com");
      const doc = await documentService.createDocument(owner.id, "Doc");

      await expect(
        documentService.getDocumentForRealtime(doc.id, "no-access-user"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("saveYjsSnapshot", () => {
    it("persists yjsState and, when content is provided, bumps version and records the editor", async () => {
      const doc = await documentService.createDocument(OWNER, "Doc");
      const state = Buffer.from([1, 2, 3, 4]);
      const content = { type: "doc", content: [{ type: "paragraph" }] };

      await documentService.saveYjsSnapshot(doc.id, OWNER, { yjsState: state, content });

      const stored = await documentService.getDocument(doc.id, OWNER);
      expect(stored.yjsState).toEqual(state);
      expect(stored.content).toEqual(content);
      expect(stored.version).toBe(doc.version + 1);
      expect(stored.lastEditedBy).toBe(OWNER);
    });

    it("persists yjsState without touching content/version when content is null", async () => {
      const doc = await documentService.createDocument(OWNER, "Doc");
      const originalContent = doc.content;
      const state = Buffer.from([5, 6, 7]);

      await documentService.saveYjsSnapshot(doc.id, OWNER, { yjsState: state, content: null });

      const stored = await documentService.getDocument(doc.id, OWNER);
      expect(stored.yjsState).toEqual(state);
      expect(stored.content).toEqual(originalContent);
      expect(stored.version).toBe(doc.version);
    });
  });
});

describe("M2: sharing and role-based access", () => {
  describe("shareDocument", () => {
    it("grants a role to an existing user by email", async () => {
      const owner = await createFakeUser("owner@example.com");
      const collaborator = await createFakeUser("collab@example.com");
      const doc = await documentService.createDocument(owner.id, "Doc");

      const access = await documentService.shareDocument(doc.id, owner.id, collaborator.email, "VIEWER");

      expect(access).toEqual({ userId: collaborator.id, email: collaborator.email, role: "VIEWER" });
    });

    it("re-sharing with the same person changes their role instead of erroring", async () => {
      const owner = await createFakeUser("owner2@example.com");
      const collaborator = await createFakeUser("collab2@example.com");
      const doc = await documentService.createDocument(owner.id, "Doc");

      await documentService.shareDocument(doc.id, owner.id, collaborator.email, "VIEWER");
      const upgraded = await documentService.shareDocument(doc.id, owner.id, collaborator.email, "EDITOR");

      expect(upgraded.role).toBe("EDITOR");
      // Confirm it's an upgrade, not a second grant: the collaborator should
      // now have write access, which only a single EDITOR grant explains.
      await expect(
        documentService.updateDocumentContent(doc.id, collaborator.id, {
          content: { type: "doc", content: [{ type: "paragraph" }] },
          version: doc.version,
        }),
      ).resolves.toBeDefined();
    });

    it("rejects sharing with an email that has no account", async () => {
      const owner = await createFakeUser("owner3@example.com");
      const doc = await documentService.createDocument(owner.id, "Doc");

      await expect(
        documentService.shareDocument(doc.id, owner.id, "nobody@example.com", "VIEWER"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("rejects sharing a document with its own owner", async () => {
      const owner = await createFakeUser("owner4@example.com");
      const doc = await documentService.createDocument(owner.id, "Doc");

      await expect(
        documentService.shareDocument(doc.id, owner.id, owner.email, "EDITOR"),
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it("is owner-only: an editor cannot share the document with someone else", async () => {
      const owner = await createFakeUser("owner5@example.com");
      const editor = await createFakeUser("editor5@example.com");
      const outsider = await createFakeUser("outsider5@example.com");
      const doc = await documentService.createDocument(owner.id, "Doc");
      await documentService.shareDocument(doc.id, owner.id, editor.email, "EDITOR");

      await expect(
        documentService.shareDocument(doc.id, editor.id, outsider.email, "VIEWER"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("revokeAccess", () => {
    it("removes a previously granted role, and the user loses read access", async () => {
      const owner = await createFakeUser("owner6@example.com");
      const collaborator = await createFakeUser("collab6@example.com");
      const doc = await documentService.createDocument(owner.id, "Doc");
      await documentService.shareDocument(doc.id, owner.id, collaborator.email, "VIEWER");

      await documentService.getDocument(doc.id, collaborator.id); // sanity: has access first

      await documentService.revokeAccess(doc.id, owner.id, collaborator.email);

      await expect(documentService.getDocument(doc.id, collaborator.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("is idempotent: revoking access that was never granted doesn't throw", async () => {
      const owner = await createFakeUser("owner7@example.com");
      const neverShared = await createFakeUser("never7@example.com");
      const doc = await documentService.createDocument(owner.id, "Doc");

      await expect(
        documentService.revokeAccess(doc.id, owner.id, neverShared.email),
      ).resolves.toBeUndefined();
    });

    it("is owner-only: an editor cannot revoke another collaborator's access", async () => {
      const owner = await createFakeUser("owner8@example.com");
      const editor = await createFakeUser("editor8@example.com");
      const viewer = await createFakeUser("viewer8@example.com");
      const doc = await documentService.createDocument(owner.id, "Doc");
      await documentService.shareDocument(doc.id, owner.id, editor.email, "EDITOR");
      await documentService.shareDocument(doc.id, owner.id, viewer.email, "VIEWER");

      await expect(
        documentService.revokeAccess(doc.id, editor.id, viewer.email),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("role enforcement on read/write", () => {
    it("a VIEWER can read but not rename or edit content", async () => {
      const owner = await createFakeUser("owner9@example.com");
      const viewer = await createFakeUser("viewer9@example.com");
      const doc = await documentService.createDocument(owner.id, "Doc");
      await documentService.shareDocument(doc.id, owner.id, viewer.email, "VIEWER");

      await expect(documentService.getDocument(doc.id, viewer.id)).resolves.toBeDefined();

      await expect(
        documentService.renameDocument(doc.id, viewer.id, "Renamed by viewer"),
      ).rejects.toBeInstanceOf(ForbiddenError);

      await expect(
        documentService.updateDocumentContent(doc.id, viewer.id, {
          content: { type: "doc", content: [{ type: "paragraph" }] },
          version: doc.version,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("an EDITOR can read, rename, and edit content, but still cannot delete", async () => {
      const owner = await createFakeUser("owner10@example.com");
      const editor = await createFakeUser("editor10@example.com");
      const doc = await documentService.createDocument(owner.id, "Doc");
      await documentService.shareDocument(doc.id, owner.id, editor.email, "EDITOR");

      await expect(documentService.getDocument(doc.id, editor.id)).resolves.toBeDefined();
      await expect(
        documentService.renameDocument(doc.id, editor.id, "Renamed by editor"),
      ).resolves.toBeDefined();
      await expect(
        documentService.updateDocumentContent(doc.id, editor.id, {
          // Renaming doesn't bump `version` - only content writes do - so
          // the version from creation is still current here.
          content: { type: "doc", content: [{ type: "paragraph" }] },
          version: doc.version,
        }),
      ).resolves.toBeDefined();

      // Deletion stays owner-only even for an editor - a bigger blast
      // radius than editing, and not something M2 asks editors to have.
      await expect(documentService.deleteDocument(doc.id, editor.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("a user with no grant at all still gets NotFoundError, not ForbiddenError (no existence leak)", async () => {
      const owner = await createFakeUser("owner11@example.com");
      const stranger = await createFakeUser("stranger11@example.com");
      const doc = await documentService.createDocument(owner.id, "Doc");

      const error = await documentService
        .getDocument(doc.id, stranger.id)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotFoundError);
    });
  });

  describe("listDocuments includes shared documents", () => {
    it("includes documents shared with the user alongside their own", async () => {
      const owner = await createFakeUser("owner12@example.com");
      const collaborator = await createFakeUser("collab12@example.com");
      const ownedByCollaborator = await documentService.createDocument(collaborator.id, "My own doc");
      const sharedDoc = await documentService.createDocument(owner.id, "Shared with me");
      const unsharedDoc = await documentService.createDocument(owner.id, "Not shared");
      await documentService.shareDocument(sharedDoc.id, owner.id, collaborator.email, "VIEWER");

      const list = await documentService.listDocuments(collaborator.id);

      expect(list.map((d) => d.id).sort()).toEqual(
        [ownedByCollaborator.id, sharedDoc.id].sort(),
      );
      expect(list.some((d) => d.id === unsharedDoc.id)).toBe(false);
    });
  });
});
