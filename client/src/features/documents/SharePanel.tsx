import { useState } from "react";
import { useShareDocument, useRevokeAccess } from "./hooks";
import type { AccessGrant } from "./api";
import { extractErrorMessage } from "../../lib/apiClient";

/**
 * There is no endpoint to list a document's existing access grants (only
 * share/revoke), so this list is session-local: it starts empty and is
 * populated by shares/revokes made in this panel, not fetched from the
 * server. Reopening the document later won't show grants made elsewhere.
 */
export function SharePanel({ documentId }: { documentId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"VIEWER" | "EDITOR">("VIEWER");
  const [shares, setShares] = useState<AccessGrant[]>([]);
  const [error, setError] = useState<string | null>(null);

  const share = useShareDocument(documentId);
  const revoke = useRevokeAccess(documentId);

  async function handleShare(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setError(null);
    try {
      const access = await share.mutateAsync({ email: trimmed, role });
      setShares((prev) => [...prev.filter((s) => s.email !== access.email), access]);
      setEmail("");
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't share this document"));
    }
  }

  async function handleRevoke(targetEmail: string) {
    setError(null);
    try {
      await revoke.mutateAsync(targetEmail);
      setShares((prev) => prev.filter((s) => s.email !== targetEmail));
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't revoke access"));
    }
  }

  return (
    <div className="border-b border-gray-200 bg-white px-6 py-4">
      <div className="mx-auto max-w-3xl">
        <h2 className="mb-2 text-sm font-medium text-gray-900">Share this document</h2>

        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

        <form onSubmit={(e) => void handleShare(e)} className="mb-3 flex items-center gap-2">
          <input
            type="email"
            required
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "VIEWER" | "EDITOR")}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="VIEWER">Viewer</option>
            <option value="EDITOR">Editor</option>
          </select>
          <button
            type="submit"
            disabled={share.isPending}
            className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {share.isPending ? "Sharing..." : "Share"}
          </button>
        </form>

        {shares.length > 0 && (
          <ul className="space-y-1">
            {shares.map((s) => (
              <li
                key={s.userId}
                className="flex items-center justify-between text-sm text-gray-700"
              >
                <span>
                  {s.email} <span className="text-gray-400">({s.role === "EDITOR" ? "Editor" : "Viewer"})</span>
                </span>
                <button
                  onClick={() => void handleRevoke(s.email)}
                  className="text-red-500 hover:text-red-700"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
