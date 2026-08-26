import type { Editor } from "@tiptap/react";

interface ToolbarButtonProps {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}

function ToolbarButton({ active, disabled, onClick, label, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded px-2 py-1 text-sm font-medium hover:bg-gray-100 disabled:opacity-40 ${
        active ? "bg-gray-200 text-gray-900" : "text-gray-600"
      }`}
    >
      {children}
    </button>
  );
}

export function EditorToolbar({
  editor,
  onInsertImage,
  imageUploading,
}: {
  editor: Editor | null;
  onInsertImage: () => void;
  imageUploading: boolean;
}) {
  if (!editor) return null;

  function setLink() {
    const previousUrl = editor!.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previousUrl ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor!.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor!.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 bg-white px-3 py-2">
      <ToolbarButton
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        B
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <span className="italic">I</span>
      </ToolbarButton>
      <ToolbarButton
        label="Underline"
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <span className="underline">U</span>
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-gray-200" />

      <ToolbarButton
        label="Heading 1"
        active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        H1
      </ToolbarButton>
      <ToolbarButton
        label="Heading 2"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        label="Heading 3"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-gray-200" />

      <ToolbarButton
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        • List
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1. List
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-gray-200" />

      <ToolbarButton label="Link" active={editor.isActive("link")} onClick={setLink}>
        Link
      </ToolbarButton>
      <ToolbarButton label="Insert image" disabled={imageUploading} onClick={onInsertImage}>
        {imageUploading ? "Uploading..." : "Image"}
      </ToolbarButton>
    </div>
  );
}
