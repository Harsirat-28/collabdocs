import { getSchema } from "@tiptap/core";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { BadRequestError } from "./errors.js";

/**
 * Mirrors the exact extension set the client's editor is configured with
 * (see DocumentEditorPage.tsx) so the server accepts precisely what the
 * editor can produce, and nothing else. Placeholder is omitted: it only
 * adds a display-time ProseMirror plugin and contributes no nodes/marks,
 * so it can't affect what `getSchema` builds.
 */
const documentSchema = getSchema([
  StarterKit,
  Underline,
  Link.configure({ openOnClick: false, autolink: true }),
  Image,
]);

const ALLOWED_URI_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Tiptap's own URL allowlisting for link/image attributes (see
 * `isAllowedUri` in `@tiptap/extension-link`) only runs when parsing/
 * rendering DOM - never when deserializing a node from JSON - and the
 * Image extension's `src` has no allowlisting at all. ProseMirror's schema
 * layer likewise only constrains attribute *types* where a node spec
 * declares `validate`, which neither extension does for these fields. So a
 * raw `javascript:`/`data:` URL placed directly in stored JSON would pass
 * both untouched; this is the explicit check that catches it.
 */
function hasAllowedProtocol(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.startsWith("/")) return true; // same-origin relative URL (e.g. our own /uploads/...)
  try {
    return ALLOWED_URI_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * Validates untrusted document JSON against the real ProseMirror schema the
 * editor uses - rejecting unknown node/mark types, invalid nesting, and
 * malformed attributes - then re-serializes the parsed tree so that any
 * unrecognized/extraneous keys in the input are dropped rather than stored.
 * Throws BadRequestError if the content doesn't conform.
 */
export function sanitizeDocumentContent(content: unknown): Record<string, unknown> {
  let node: ProseMirrorNode;
  try {
    node = ProseMirrorNode.fromJSON(documentSchema, content);
    node.check();
  } catch {
    throw new BadRequestError("Invalid document content");
  }

  let hasDisallowedUri = false;
  node.descendants((child) => {
    if (child.type.name === "image" && !hasAllowedProtocol(child.attrs.src)) {
      hasDisallowedUri = true;
    }
    child.marks.forEach((mark) => {
      if (mark.type.name === "link" && !hasAllowedProtocol(mark.attrs.href)) {
        hasDisallowedUri = true;
      }
    });
  });

  if (hasDisallowedUri) {
    throw new BadRequestError("Document contains a disallowed link or image URL");
  }

  return node.toJSON() as Record<string, unknown>;
}
