import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useCreateDocument,
  useDeleteDocument,
  useDocuments,
  useRenameDocument,
} from "../features/documents/hooks";
import type { DocumentSummary } from "../features/documents/api";
import * as authApi from "../features/auth/api";
import { useAuthStore } from "../store/authStore";

function formatUpdatedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function DocumentRow({ doc }: { doc: DocumentSummary }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(doc.title);
  const rename = useRenameDocument(doc.id);
  const remove = useDeleteDocument();
  const canEdit = doc.role !== "VIEWER";
  const isOwner = doc.role === "OWNER";

  function commitRename() {
    setEditing(false);
    const trimmed = title.trim();
    if (trimmed && trimmed !== doc.title) {
      rename.mutate(trimmed);
    } else {
      setTitle(doc.title);
    }
  }

  return (
    <li className="flex items-center justify-between gap-4 border-b border-gray-100 px-4 py-3 last:border-b-0 hover:bg-gray-50">
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setTitle(doc.title);
                setEditing(false);
              }
            }}
            className="w-full rounded border border-blue-400 px-2 py-1 text-sm"
          />
        ) : (
          <button
            className="truncate text-left text-sm font-medium text-gray-900 hover:underline"
            onClick={() => navigate(`/documents/${doc.id}`)}
          >
            {doc.title}
          </button>
        )}
        <p className="mt-0.5 text-xs text-gray-500">Updated {formatUpdatedAt(doc.updatedAt)}</p>
      </div>

      <div className="flex flex-shrink-0 items-center gap-3 text-sm">
        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            className="text-gray-500 hover:text-gray-900"
            title="Rename"
          >
            Rename
          </button>
        )}
        {isOwner && (
          <button
            onClick={() => {
              if (confirm(`Delete "${doc.title}"? This cannot be undone.`)) {
                remove.mutate(doc.id);
              }
            }}
            className="text-red-500 hover:text-red-700"
            title="Delete"
          >
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { data: documents, isLoading, isError } = useDocuments();
  const createDocument = useCreateDocument();
  const clearSession = useAuthStore((state) => state.clearSession);
  const user = useAuthStore((state) => state.user);

  async function handleCreate() {
    const doc = await createDocument.mutateAsync(undefined);
    navigate(`/documents/${doc.id}`);
  }

  async function handleLogout() {
    await authApi.logout().catch(() => undefined);
    clearSession();
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">CollabDocs</h1>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>{user?.email}</span>
          <button onClick={() => void handleLogout()} className="text-gray-500 hover:text-gray-900">
            Log out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-medium text-gray-900">Your documents</h2>
          <button
            onClick={() => void handleCreate()}
            disabled={createDocument.isPending}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {createDocument.isPending ? "Creating..." : "+ New document"}
          </button>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white">
          {isLoading && <p className="px-4 py-6 text-sm text-gray-500">Loading documents...</p>}
          {isError && (
            <p className="px-4 py-6 text-sm text-red-600">Failed to load documents.</p>
          )}
          {documents && documents.length === 0 && (
            <p className="px-4 py-6 text-sm text-gray-500">
              No documents yet. Create your first one.
            </p>
          )}
          {documents && documents.length > 0 && (
            <ul>
              {documents.map((doc) => (
                <DocumentRow key={doc.id} doc={doc} />
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
