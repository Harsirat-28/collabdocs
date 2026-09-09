import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import * as Y from "yjs";
import { getAccessToken } from "../../store/authStore";

/** Must match YJS_FIELD in server/src/realtime/collaboration.ts. */
export const YJS_FIELD = "default";

const SOCKET_URL = (import.meta.env.VITE_API_URL as string).replace(/\/api\/?$/, "");

/** Tags updates applied from the server so they aren't echoed back as local edits. */
const REMOTE_ORIGIN = "remote";

export type SyncStatus = "connecting" | "synced" | "offline" | "error";

/**
 * Owns the Socket.io connection and shared Y.Doc for one open document (M3).
 * Joins the document's room on connect/reconnect, applies the server's
 * current Yjs state, relays local edits, and merges incoming updates from
 * other collaborators. Reconnection is handled by Socket.io's built-in
 * reconnect; on each successful (re)connect this re-joins and receives the
 * server's full current state, which Yjs can safely merge with any edits
 * made locally while offline.
 */
export function useCollaborationDoc(documentId: string): { ydoc: Y.Doc; status: SyncStatus } {
  const ydocRef = useRef<Y.Doc | null>(null);
  if (!ydocRef.current) ydocRef.current = new Y.Doc();
  const ydoc = ydocRef.current;

  const [status, setStatus] = useState<SyncStatus>("connecting");

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
    }

    function onLocalUpdate(update: Uint8Array, origin: unknown) {
      if (origin === REMOTE_ORIGIN) return;
      socket.emit("document:update", { documentId, update });
    }

    socket.on("connect", join);
    socket.on("document:sync", onSync);
    socket.on("document:update", onUpdate);
    socket.on("document:error", onServerError);
    socket.on("connect_error", onConnectError);
    socket.on("disconnect", onDisconnect);
    ydoc.on("update", onLocalUpdate);

    return () => {
      ydoc.off("update", onLocalUpdate);
      socket.disconnect();
    };
  }, [documentId, ydoc]);

  return { ydoc, status };
}
