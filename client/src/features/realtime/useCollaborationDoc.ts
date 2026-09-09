import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { getAccessToken } from "../../store/authStore";

/** Must match YJS_FIELD in server/src/realtime/collaboration.ts. */
export const YJS_FIELD = "default";

const SOCKET_URL = (import.meta.env.VITE_API_URL as string).replace(/\/api\/?$/, "");

/** Tags updates applied from the server so they aren't echoed back as local edits. */
const REMOTE_ORIGIN = "remote";

export type SyncStatus = "connecting" | "synced" | "offline" | "error";

/** Mirrors server/src/realtime/collaboration.ts's PresenceUser wire shape. */
export interface PresenceUser {
  userId: string;
  name: string | null;
  email: string;
}

const CURSOR_COLORS = ["#f97316", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6", "#eab308"];

/** A stable cursor/avatar color per user, so the same person looks the same everywhere. */
export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length]!;
}

/**
 * Owns the Socket.io connection, shared Y.Doc, and Yjs Awareness instance
 * for one open document (M3 doc sync + M4 presence/cursors). Joins the
 * document's room on connect/reconnect, applies the server's current Yjs
 * state, relays local edits and cursor/selection (awareness) changes, and
 * merges incoming updates from other collaborators. Reconnection is
 * handled by Socket.io's built-in reconnect; on each successful
 * (re)connect this re-joins and receives the server's full current state,
 * which Yjs can safely merge with any edits made locally while offline.
 * Awareness state is purely ephemeral - never persisted, relayed only to
 * sockets currently in the room.
 */
export function useCollaborationDoc(
  documentId: string,
): { ydoc: Y.Doc; awareness: Awareness; status: SyncStatus; presence: PresenceUser[] } {
  const ydocRef = useRef<Y.Doc | null>(null);
  if (!ydocRef.current) ydocRef.current = new Y.Doc();
  const ydoc = ydocRef.current;

  const awarenessRef = useRef<Awareness | null>(null);
  if (!awarenessRef.current) awarenessRef.current = new Awareness(ydoc);
  const awareness = awarenessRef.current;

  const [status, setStatus] = useState<SyncStatus>("connecting");
  const [presence, setPresence] = useState<PresenceUser[]>([]);

  useEffect(() => {
    const socket: Socket = io(SOCKET_URL, {
      auth: (cb) => cb({ token: getAccessToken() }),
    });

    function join() {
      setStatus("connecting");
      socket.emit("document:join", { documentId });
    }

    function onSync({ state }: { state: ArrayBuffer | Uint8Array }) {
      Y.applyUpdate(ydoc, new Uint8Array(state), REMOTE_ORIGIN);
      setStatus("synced");
    }

    function onUpdate({ update }: { update: ArrayBuffer | Uint8Array }) {
      Y.applyUpdate(ydoc, new Uint8Array(update), REMOTE_ORIGIN);
    }

    function onAwareness({ update }: { update: ArrayBuffer | Uint8Array }) {
      applyAwarenessUpdate(awareness, new Uint8Array(update), REMOTE_ORIGIN);
    }

    function onPresence({ users }: { users: PresenceUser[] }) {
      setPresence(users);
    }

    function onServerError({ message }: { message: string }) {
      console.error("[collaboration]", message);
      setStatus("error");
    }

    function onConnectError(err: Error) {
      console.error("[collaboration] connection error", err.message);
      setStatus("error");
    }

    function onDisconnect() {
      setStatus("offline");
      setPresence([]);
    }

    function onLocalUpdate(update: Uint8Array, origin: unknown) {
      if (origin === REMOTE_ORIGIN) return;
      socket.emit("document:update", { documentId, update });
    }

    function onLocalAwarenessUpdate(
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) {
      if (origin === REMOTE_ORIGIN) return;
      const changedClients = added.concat(updated, removed);
      const update = encodeAwarenessUpdate(awareness, changedClients);
      socket.emit("document:awareness", { documentId, update });
    }

    socket.on("connect", join);
    socket.on("document:sync", onSync);
    socket.on("document:update", onUpdate);
    socket.on("document:awareness", onAwareness);
    socket.on("document:presence", onPresence);
    socket.on("document:error", onServerError);
    socket.on("connect_error", onConnectError);
    socket.on("disconnect", onDisconnect);
    ydoc.on("update", onLocalUpdate);
    awareness.on("update", onLocalAwarenessUpdate);

    return () => {
      ydoc.off("update", onLocalUpdate);
      awareness.off("update", onLocalAwarenessUpdate);
      socket.disconnect();
    };
  }, [documentId, ydoc, awareness]);

  return { ydoc, awareness, status, presence };
}
