import type { JSONContent } from "@tiptap/react";
import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import * as documentsApi from "./api";
import type { ConflictInfo } from "./api";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "conflict";

const AUTOSAVE_DEBOUNCE_MS = 1500;

interface UseAutosaveOptions {
  documentId: string;
  initialVersion: number;
  onConflict: (conflict: ConflictInfo) => void;
}

interface UseAutosaveResult {
  status: SaveStatus;
  /** Call on every editor change; internally debounced. */
  scheduleSave: (content: JSONContent) => void;
  /** Re-attempt the most recent save after a network/server error. */
  retry: () => void;
  /** After a conflict is resolved (editor content reloaded from server), sync local version tracking. */
  acceptServerVersion: (version: number) => void;
}

/**
 * Debounced autosave with a single in-flight request at a time. If content
 * changes again while a save is in flight, the new content is queued and
 * flushed immediately after the current request resolves - so two saves
 * are never racing, and a slow request can't land after (and overwrite) a
 * newer one. Server-side version checks (see documentService) are the
 * second layer of defense, covering multi-tab/multi-request edge cases.
 */
export function useAutosave({
  documentId,
  initialVersion,
  onConflict,
}: UseAutosaveOptions): UseAutosaveResult {
  const [status, setStatus] = useState<SaveStatus>("idle");

  const versionRef = useRef(initialVersion);
  const pendingContentRef = useRef<JSONContent | null>(null);
  const isSavingRef = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAttemptedContentRef = useRef<JSONContent | null>(null);

  useEffect(() => {
    versionRef.current = initialVersion;
  }, [initialVersion]);

  const flush = useCallback(async () => {
    if (isSavingRef.current) return;
    const content = pendingContentRef.current;
    if (content === null) return;

    pendingContentRef.current = null;
    lastAttemptedContentRef.current = content;
    isSavingRef.current = true;
    setStatus("saving");

    try {
      const updated = await documentsApi.updateDocumentContent(
        documentId,
        content,
        versionRef.current,
      );
      versionRef.current = updated.version;
      setStatus("saved");
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        const conflict = error.response.data as { error: { details: ConflictInfo } };
        setStatus("conflict");
        onConflict(conflict.error.details);
      } else {
        setStatus("error");
      }
    } finally {
      isSavingRef.current = false;
      if (pendingContentRef.current !== null) {
        void flush();
      }
    }
  }, [documentId, onConflict]);

  const scheduleSave = useCallback(
    (content: JSONContent) => {
      pendingContentRef.current = content;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        void flush();
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  const retry = useCallback(() => {
    if (lastAttemptedContentRef.current !== null) {
      pendingContentRef.current = lastAttemptedContentRef.current;
      void flush();
    }
  }, [flush]);

  const acceptServerVersion = useCallback((version: number) => {
    versionRef.current = version;
    pendingContentRef.current = null;
    lastAttemptedContentRef.current = null;
    setStatus("saved");
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  return { status, scheduleSave, retry, acceptServerVersion };
}
