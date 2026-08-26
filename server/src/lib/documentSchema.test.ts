import { describe, expect, it } from "vitest";
import { sanitizeDocumentContent } from "./documentSchema.js";

function paragraph(text: string, marks?: Record<string, unknown>[]) {
  return {
    type: "paragraph",
    content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
  };
}

describe("sanitizeDocumentContent", () => {
  describe("accepts well-formed content the real editor can produce", () => {
    it("an empty document", () => {
      const doc = { type: "doc", content: [{ type: "paragraph" }] };
      expect(sanitizeDocumentContent(doc)).toEqual(doc);
    });

    it("formatted text (bold/italic/underline)", () => {
      const doc = {
        type: "doc",
        content: [
          paragraph("hello", [{ type: "bold" }, { type: "italic" }, { type: "underline" }]),
        ],
      };
      expect(sanitizeDocumentContent(doc)).toEqual(doc);
    });

    it("headings, lists, and a safe https link", () => {
      const doc = {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [paragraph("item one")],
              },
            ],
          },
          paragraph("visit", [{ type: "link", attrs: { href: "https://example.com", target: null, rel: null, class: null } }]),
        ],
      };
      expect(sanitizeDocumentContent(doc)).toEqual(doc);
    });

    it("a safe https image and a mailto link", () => {
      const doc = {
        type: "doc",
        content: [
          { type: "image", attrs: { src: "https://cdn.example.com/pic.png", alt: null, title: null } },
          paragraph("contact", [
            { type: "link", attrs: { href: "mailto:someone@example.com", target: null, rel: null, class: null } },
          ]),
        ],
      };
      expect(sanitizeDocumentContent(doc)).toEqual(doc);
    });

    it("a same-origin relative image src", () => {
      const doc = {
        type: "doc",
        content: [{ type: "image", attrs: { src: "/uploads/abc.png", alt: null, title: null } }],
      };
      expect(sanitizeDocumentContent(doc)).toEqual(doc);
    });
  });

  describe("rejects malformed/malicious structure", () => {
    it("an unknown node type", () => {
      const doc = { type: "doc", content: [{ type: "scriptInjection" }] };
      expect(() => sanitizeDocumentContent(doc)).toThrow(/invalid document content/i);
    });

    it("an unknown mark type", () => {
      const doc = { type: "doc", content: [paragraph("x", [{ type: "evilMark" }])] };
      expect(() => sanitizeDocumentContent(doc)).toThrow(/invalid document content/i);
    });

    it("invalid nesting (text node directly under doc, not wrapped in a block)", () => {
      const doc = { type: "doc", content: [{ type: "text", text: "not allowed here" }] };
      expect(() => sanitizeDocumentContent(doc)).toThrow(/invalid document content/i);
    });

    it("a bulletList containing a paragraph directly instead of a listItem", () => {
      const doc = {
        type: "doc",
        content: [{ type: "bulletList", content: [paragraph("not wrapped in a listItem")] }],
      };
      expect(() => sanitizeDocumentContent(doc)).toThrow(/invalid document content/i);
    });

    it("non-array marks on a text node", () => {
      const doc = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: "not-an-array" }] }],
      };
      expect(() => sanitizeDocumentContent(doc)).toThrow(/invalid document content/i);
    });

    it("completely non-object input", () => {
      expect(() => sanitizeDocumentContent("<script>alert(1)</script>")).toThrow();
      expect(() => sanitizeDocumentContent(null)).toThrow();
      expect(() => sanitizeDocumentContent(["doc"])).toThrow();
    });
  });

  describe("rejects disallowed URL protocols (stored-XSS vectors)", () => {
    it("a javascript: link href", () => {
      const doc = {
        type: "doc",
        content: [paragraph("click me", [{ type: "link", attrs: { href: "javascript:alert(document.cookie)" } }])],
      };
      expect(() => sanitizeDocumentContent(doc)).toThrow(/disallowed link or image url/i);
    });

    it("a data: link href", () => {
      const doc = {
        type: "doc",
        content: [paragraph("click me", [{ type: "link", attrs: { href: "data:text/html,<script>alert(1)</script>" } }])],
      };
      expect(() => sanitizeDocumentContent(doc)).toThrow(/disallowed link or image url/i);
    });

    it("a javascript: image src", () => {
      const doc = {
        type: "doc",
        content: [{ type: "image", attrs: { src: "javascript:alert(1)" } }],
      };
      expect(() => sanitizeDocumentContent(doc)).toThrow(/disallowed link or image url/i);
    });

    it("a data: image src (bypasses the upload pipeline)", () => {
      const doc = {
        type: "doc",
        content: [{ type: "image", attrs: { src: "data:image/png;base64,iVBORw0KGgo=" } }],
      };
      expect(() => sanitizeDocumentContent(doc)).toThrow(/disallowed link or image url/i);
    });

    it("an image with no src at all", () => {
      const doc = { type: "doc", content: [{ type: "image", attrs: {} }] };
      expect(() => sanitizeDocumentContent(doc)).toThrow(/disallowed link or image url/i);
    });
  });

  describe("strips unrecognized data instead of storing it", () => {
    // Object-literal syntax special-cases a `__proto__` key as a prototype
    // assignment rather than an own property, so these payloads are built
    // via JSON.parse - exactly how a real request body arrives (Express's
    // body parser also uses JSON.parse), giving each an actual own
    // property literally named "__proto__" for the sanitizer to encounter.
    it("drops attributes not defined on the node's schema, including a __proto__-shaped attrs payload", () => {
      const doc = JSON.parse(
        '{"type":"doc","content":[{"type":"paragraph","attrs":{"__proto__":{"polluted":true},"evilAttr":"<img src=x onerror=alert(1)>"},"content":[{"type":"text","text":"hi"}]}]}',
      );

      const result = sanitizeDocumentContent(doc);
      expect(result).toEqual({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
      });
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("evilAttr");
      expect(JSON.stringify(result)).not.toContain("onerror");
    });

    it("drops unknown top-level keys on the doc node, including a __proto__-shaped one", () => {
      const doc = JSON.parse(
        '{"type":"doc","content":[{"type":"paragraph"}],"__proto__":{"polluted":true}}',
      );

      const result = sanitizeDocumentContent(doc);
      expect(result).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
  });
});
