import type { Server, Socket } from "socket.io";
import * as Y from "yjs";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "y-prosemirror";
import { z } from "zod";
import { verifyAccessToken } from "../lib/jwt.js";
import { documentSchema, sanitizeDocumentContent } from "../lib/documentSchema.js";
import * as documentService from "../services/documentService.js";

/**
 * Fragment name Tiptap's Collaboration extension binds to inside the Y.Doc
 * (see client's useCollaborationDoc.ts). Must match exactly on both ends -
 * y-prosemirror and Tiptap each default to a different name, so this is set
 * explicitly here rather than relying on either library's default.
 */
export const YJS_FIELD = "default";

/** How often a room's accumulated edits are flushed to Postgres while active. */
const FLUSH_INTERVAL_MS = 3000;

export interface ClientToServerEvents {
  "document:join": (payload: unknown) => void;
  "document:update": (payload: unknown) => void;
}

export interface ServerToClientEvents {
  "document:sync": (payload: { state: Uint8Array }) => void;
  "document:update": (payload: { update: Uint8Array }) => void;
  "document:error": (payload: { message: string }) => void;
}

export interface SocketData {
  userId: string;
  documentId?: string;
}

type CollabServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type CollabSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

interface Room {
  doc: Y.Doc;
  sockets: Set<CollabSocket>;
  writers: Set<string>;
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  lastEditedBy: string | null;
}

const rooms = new Map<string, Room>();

const joinSchema = z.object({ documentId: z.string().uuid() });
const updateSchema = z.object({
  documentId: z.string().uuid(),
  update: z.instanceof(Uint8Array),
});

function roomName(documentId: string): string {
  return `doc:${documentId}`;
}

function createSeededDoc(seed: { content: unknown; yjsState: Buffer | null }): Y.Doc {
  if (seed.yjsState) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, seed.yjsState);
    return doc;
  }
  return prosemirrorJSONToYDoc(documentSchema, seed.content as Record<string, unknown>, YJS_FIELD);
}

function getOrCreateRoom(documentId: string, seed: { content: unknown; yjsState: Buffer | null }): Room {
  const existing = rooms.get(documentId);
  if (existing) return existing;

  const room: Room = {
    doc: createSeededDoc(seed),
    sockets: new Set(),
    writers: new Set(),
    dirty: false,
    timer: null,
    lastEditedBy: null,
  };
  rooms.set(documentId, room);
  return room;
}

function scheduleFlush(documentId: string, room: Room): void {
  if (room.timer) return;
  room.timer = setTimeout(() => {
    room.timer = null;
    void flush(documentId, room);
  }, FLUSH_INTERVAL_MS);
}

/**
 * Writes the room's compacted Yjs state to `yjsState`, and - best-effort -
 * the equivalent ProseMirror JSON to `content` so REST reads of the
 * document stay current. A decode/validation failure only skips the
 * `content` half of the write; `yjsState` (the source of truth while the
 * room is live) is still persisted.
 */
async function flush(documentId: string, room: Room): Promise<void> {
  if (!room.dirty) return;
  room.dirty = false;
  const state = Buffer.from(Y.encodeStateAsUpdate(room.doc));

  let content: Record<string, unknown> | null = null;
  try {
    content = sanitizeDocumentContent(yDocToProsemirrorJSON(room.doc, YJS_FIELD));
  } catch (err) {
    console.error(`[realtime] failed to derive content for document ${documentId}`, err);
  }

  try {
    await documentService.saveYjsSnapshot(documentId, room.lastEditedBy, { yjsState: state, content });
  } catch (err) {
    console.error(`[realtime] failed to persist snapshot for document ${documentId}`, err);
    room.dirty = true;
  }
}

async function cleanupRoomIfEmpty(documentId: string, room: Room): Promise<void> {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  if (room.dirty) {
    await flush(documentId, room);
  }
  if (room.sockets.size === 0 && rooms.get(documentId) === room) {
    rooms.delete(documentId);
  }
}

function leaveCurrentRoom(socket: CollabSocket): void {
  const documentId = socket.data.documentId;
  if (!documentId) return;
  const room = rooms.get(documentId);
  if (!room) return;

  room.sockets.delete(socket);
  room.writers.delete(socket.id);
  if (room.sockets.size === 0) {
    void cleanupRoomIfEmpty(documentId, room);
  }
}

/** Test-only: bypasses the debounce timer to flush a room's pending changes immediately. */
export async function __flushRoomForTesting(documentId: string): Promise<void> {
  const room = rooms.get(documentId);
  if (room) await flush(documentId, room);
}

/**
 * Wires up the M3 real-time collaboration namespace: JWT-authenticated
 * socket handshake (mirroring `requireAuth`), one room per document, and a
 * minimal Yjs update relay + periodic persistence. Presence/cursors are
 * explicitly out of scope (M4).
 */
export function registerCollaboration(io: CollabServer): void {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string") {
      next(new Error("Missing access token"));
      return;
    }
    try {
      const { sub } = verifyAccessToken(token);
      socket.data.userId = sub;
      next();
    } catch {
      next(new Error("Invalid or expired access token"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("document:join", (payload) => {
      const parsed = joinSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit("document:error", { message: "Invalid join request" });
        return;
      }
      const { documentId } = parsed.data;

      void (async () => {
        // A socket only ever holds one live document at a time in this
        // minimal implementation (one editor page per connection).
        leaveCurrentRoom(socket);

        let canWrite: boolean;
        let seed: { content: unknown; yjsState: Buffer | null };
        try {
          const result = await documentService.getDocumentForRealtime(documentId, socket.data.userId);
          canWrite = result.canWrite;
          seed = { content: result.document.content, yjsState: result.document.yjsState as Buffer | null };
        } catch {
          socket.emit("document:error", { message: "You do not have access to this document" });
          return;
        }

        const room = getOrCreateRoom(documentId, seed);
        room.sockets.add(socket);
        if (canWrite) room.writers.add(socket.id);
        socket.data.documentId = documentId;
        await socket.join(roomName(documentId));

        socket.emit("document:sync", { state: Y.encodeStateAsUpdate(room.doc) });
      })();
    });

    socket.on("document:update", (payload) => {
      const parsed = updateSchema.safeParse(payload);
      if (!parsed.success) return;
      const { documentId, update } = parsed.data;

      const room = rooms.get(documentId);
      if (!room || socket.data.documentId !== documentId || !room.sockets.has(socket)) {
        socket.emit("document:error", { message: "Not joined to this document" });
        return;
      }
      if (!room.writers.has(socket.id)) {
        socket.emit("document:error", { message: "You do not have permission to edit this document" });
        return;
      }

      try {
        Y.applyUpdate(room.doc, update);
      } catch (err) {
        // A malformed update (corrupt payload, client bug) must not crash
        // the process or poison the room for other members.
        console.error(`[realtime] rejected malformed update for document ${documentId}`, err);
        socket.emit("document:error", { message: "Malformed update" });
        return;
      }
      socket.to(roomName(documentId)).emit("document:update", { update });
      room.dirty = true;
      room.lastEditedBy = socket.data.userId;
      scheduleFlush(documentId, room);
    });

    socket.on("disconnect", () => {
      leaveCurrentRoom(socket);
    });
  });
}
