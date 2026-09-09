import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Collaboration from "@tiptap/extension-collaboration";
import { useDocument, useRenameDocument } from "../features/documents/hooks";
import type { DocumentDetail } from "../features/documents/api";
import { useCollaborationDoc, YJS_FIELD } from "../features/realtime/useCollaborationDoc";
import { uploadImage } from "../features/uploads/api";
import { EditorToolbar } from "../features/editor/EditorToolbar";
import { SaveStatusIndicator } from "../components/SaveStatusIndicator";
import { SharePanel } from "../features/documents/SharePanel";
import { extractErrorMessage } from "../lib/apiClient";

function EditorView({ document }: { document: DocumentDetail }) {
  const navigate = useNavigate();
  const rename = useRenameDocument(document.id);
  const canEdit = document.role !== "VIEWER";
  const isOwner = document.role === "OWNER";

  const [title, setTitle] = useState(document.title);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [sharePanelOpen, setSharePanelOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { ydoc, status } = useCollaborationDoc(document.id);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      Placeholder.configure({ placeholder: "Start writing..." }),
      Collaboration.configure({ document: ydoc, field: YJS_FIELD }),
    ],
    editable: canEdit,
  });

  function commitTitle() {
    const trimmed = title.trim();
    if (trimmed && trimmed !== document.title) {
      rename.mutate(trimmed);
    } else {
      setTitle(document.title);
    }
  }

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !editor) return;

    setImageError(null);
    setImageUploading(true);
    try {
      const url = await uploadImage(file);
      editor.chain().focus().setImage({ src: url }).run();
    } catch (err) {
      setImageError(extractErrorMessage(err, "Image upload failed"));
    } finally {
      setImageUploading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="flex-shrink-0 text-sm text-gray-500 hover:text-gray-900"
            >
              &larr; Dashboard
            </button>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              disabled={!canEdit}
              className="min-w-0 flex-1 truncate rounded px-2 py-1 text-lg font-medium text-gray-900 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none disabled:hover:bg-transparent"
            />
          </div>
          <div className="flex flex-shrink-0 items-center gap-4">
            <SaveStatusIndicator status={status} />
            {isOwner && (
              <button
                onClick={() => setSharePanelOpen((open) => !open)}
                className="text-sm text-gray-500 hover:text-gray-900"
              >
                Share
              </button>
            )}
          </div>
        </div>
      </header>

      {isOwner && sharePanelOpen && <SharePanel documentId={document.id} />}

      {imageError && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-center text-sm text-red-700">
          {imageError}
        </div>
      )}

      <div className="mx-auto max-w-3xl bg-white shadow-sm">
        {canEdit && (
          <>
            <EditorToolbar
              editor={editor}
              onInsertImage={() => fileInputRef.current?.click()}
              imageUploading={imageUploading}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={(e) => void handleFileSelected(e)}
            />
          </>
        )}
        <div className="px-10 py-8">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

export function DocumentEditorPage() {
  const { id } = useParams<{ id: string }>();
  const { data: document, isLoading, isError } = useDocument(id!);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-500">Loading...</div>
    );
  }

  if (isError || !document) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-gray-500">
        <p>Document not found.</p>
      </div>
    );
  }

  // Keyed on document.id so the editor only reinitializes when navigating
  // to a different document, not on every background refetch.
  return <EditorView key={document.id} document={document} />;
}
