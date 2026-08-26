import { randomUUID } from "node:crypto";

/**
 * A minimal in-memory stand-in for the subset of the Prisma Client API that
 * authService/documentService actually call, implementing the same query
 * shapes (where/data/select/orderBy) against plain Maps instead of Postgres.
 *
 * This lets tests exercise the real service modules unmodified - the actual
 * rotation/reuse-detection and ownership/concurrency logic under test -
 * without needing a live database. It is not a general Prisma mock; it only
 * supports the specific calls present in authService.ts and
 * documentService.ts today.
 *
 * Every method returns a *copy* of the stored record, never the live
 * reference held in the map - matching real Prisma (which always
 * deserializes a fresh object per call). Handing out live references would
 * let an object returned by an earlier call silently change value when a
 * later call mutates the "same" record, which real Prisma never does.
 */

interface FakeUser {
  id: string;
  email: string;
  passwordHash: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeRefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenHash: string | null;
  createdAt: Date;
}

interface FakeDocument {
  id: string;
  title: string;
  content: unknown;
  version: number;
  ownerId: string;
  lastEditedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeDocumentAccess {
  id: string;
  documentId: string;
  userId: string;
  role: "VIEWER" | "EDITOR";
  createdAt: Date;
}

export function createFakePrisma() {
  const users = new Map<string, FakeUser>();
  const refreshTokens = new Map<string, FakeRefreshToken>();
  const documents = new Map<string, FakeDocument>();
  const documentAccessGrants = new Map<string, FakeDocumentAccess>();

  return {
    user: {
      async findUnique({ where }: { where: { id?: string; email?: string } }) {
        let found: FakeUser | undefined;
        if (where.id) found = users.get(where.id);
        else if (where.email) found = [...users.values()].find((u) => u.email === where.email);
        return found ? { ...found } : null;
      },
      async create({
        data,
      }: {
        data: { email: string; passwordHash: string; name: string | null };
      }) {
        const now = new Date();
        const user: FakeUser = {
          id: randomUUID(),
          email: data.email,
          passwordHash: data.passwordHash,
          name: data.name,
          createdAt: now,
          updatedAt: now,
        };
        users.set(user.id, user);
        return { ...user };
      },
    },

    refreshToken: {
      async create({
        data,
      }: {
        data: { userId: string; tokenHash: string; expiresAt: Date };
      }) {
        const token: FakeRefreshToken = {
          id: randomUUID(),
          userId: data.userId,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
          revokedAt: null,
          replacedByTokenHash: null,
          createdAt: new Date(),
        };
        refreshTokens.set(token.id, token);
        return { ...token };
      },
      async findUnique({ where }: { where: { tokenHash: string } }) {
        const found = [...refreshTokens.values()].find((t) => t.tokenHash === where.tokenHash);
        return found ? { ...found } : null;
      },
      async update({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<Pick<FakeRefreshToken, "revokedAt" | "replacedByTokenHash" | "expiresAt">>;
      }) {
        const token = refreshTokens.get(where.id);
        if (!token) throw new Error("FakePrisma: refreshToken not found");
        Object.assign(token, data);
        return { ...token };
      },
      async updateMany({
        where,
        data,
      }: {
        where: { userId?: string; tokenHash?: string; revokedAt: null };
        data: Partial<Pick<FakeRefreshToken, "revokedAt">>;
      }) {
        let count = 0;
        for (const token of refreshTokens.values()) {
          const matchesUser = where.userId === undefined || token.userId === where.userId;
          const matchesHash = where.tokenHash === undefined || token.tokenHash === where.tokenHash;
          if (matchesUser && matchesHash && token.revokedAt === where.revokedAt) {
            Object.assign(token, data);
            count++;
          }
        }
        return { count };
      },
    },

    document: {
      async findMany({
        where,
        orderBy,
        select,
      }: {
        where: { OR: [{ ownerId: string }, { accessGrants: { some: { userId: string } } }] };
        orderBy?: { updatedAt: "asc" | "desc" };
        select?: Record<string, boolean | { where: { userId: string }; select: { role: true } }>;
      }) {
        const userId = where.OR[0].ownerId;
        const accessibleIds = new Set(
          [...documentAccessGrants.values()]
            .filter((a) => a.userId === userId)
            .map((a) => a.documentId),
        );
        let list = [...documents.values()].filter(
          (d) => d.ownerId === userId || accessibleIds.has(d.id),
        );
        if (orderBy?.updatedAt === "desc") {
          list = [...list].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        } else if (orderBy?.updatedAt === "asc") {
          list = [...list].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
        }
        if (!select) return list.map((doc) => ({ ...doc }));
        return list.map((doc) => {
          const picked: Record<string, unknown> = {};
          for (const key of Object.keys(select)) {
            const spec = select[key];
            if (key === "accessGrants" && typeof spec === "object") {
              picked.accessGrants = [...documentAccessGrants.values()]
                .filter((a) => a.documentId === doc.id && a.userId === spec.where.userId)
                .map((a) => ({ role: a.role }));
              continue;
            }
            if (spec === true) picked[key] = (doc as unknown as Record<string, unknown>)[key];
          }
          return picked;
        });
      },
      async findUnique({ where }: { where: { id: string } }) {
        const found = documents.get(where.id);
        return found ? { ...found } : null;
      },
      async create({
        data,
      }: {
        data: {
          ownerId: string;
          title: string;
          content: unknown;
          lastEditedBy: string | null;
        };
      }) {
        const now = new Date();
        const doc: FakeDocument = {
          id: randomUUID(),
          title: data.title,
          content: data.content,
          version: 1,
          ownerId: data.ownerId,
          lastEditedBy: data.lastEditedBy,
          createdAt: now,
          updatedAt: now,
        };
        documents.set(doc.id, doc);
        return { ...doc };
      },
      async update({
        where,
        data,
      }: {
        where: { id: string };
        data: {
          title?: string;
          content?: unknown;
          lastEditedBy?: string;
          version?: number | { increment: number };
        };
      }) {
        const doc = documents.get(where.id);
        if (!doc) throw new Error("FakePrisma: document not found");
        if (data.title !== undefined) doc.title = data.title;
        if (data.content !== undefined) doc.content = data.content;
        if (data.lastEditedBy !== undefined) doc.lastEditedBy = data.lastEditedBy;
        if (data.version !== undefined) {
          doc.version =
            typeof data.version === "object"
              ? doc.version + data.version.increment
              : data.version;
        }
        doc.updatedAt = new Date();
        return { ...doc };
      },
      async delete({ where }: { where: { id: string } }) {
        const doc = documents.get(where.id) ?? null;
        documents.delete(where.id);
        return doc ? { ...doc } : null;
      },
    },

    documentAccess: {
      async findUnique({
        where,
      }: {
        where: { documentId_userId: { documentId: string; userId: string } };
      }) {
        const { documentId, userId } = where.documentId_userId;
        const found = [...documentAccessGrants.values()].find(
          (a) => a.documentId === documentId && a.userId === userId,
        );
        return found ? { ...found } : null;
      },
      async upsert({
        where,
        create,
        update,
      }: {
        where: { documentId_userId: { documentId: string; userId: string } };
        create: { documentId: string; userId: string; role: "VIEWER" | "EDITOR" };
        update: { role: "VIEWER" | "EDITOR" };
      }) {
        const { documentId, userId } = where.documentId_userId;
        const existing = [...documentAccessGrants.values()].find(
          (a) => a.documentId === documentId && a.userId === userId,
        );
        if (existing) {
          existing.role = update.role;
          return { ...existing };
        }
        const record: FakeDocumentAccess = {
          id: randomUUID(),
          documentId: create.documentId,
          userId: create.userId,
          role: create.role,
          createdAt: new Date(),
        };
        documentAccessGrants.set(record.id, record);
        return { ...record };
      },
      async deleteMany({ where }: { where: { documentId: string; userId: string } }) {
        let count = 0;
        for (const [id, grant] of documentAccessGrants.entries()) {
          if (grant.documentId === where.documentId && grant.userId === where.userId) {
            documentAccessGrants.delete(id);
            count++;
          }
        }
        return { count };
      },
    },

    /** Test-only helper, not part of the real Prisma Client API. */
    __reset() {
      users.clear();
      refreshTokens.clear();
      documents.clear();
      documentAccessGrants.clear();
    },
  };
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;
