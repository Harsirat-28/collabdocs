# CollabDocs

## Project Purpose

CollabDocs is a Google Docs-inspired real-time collaborative document editor.
Users can create, edit, and share rich-text documents, with support for
multiple people editing the same document concurrently, live presence
indicators, and permission-based access control.

The project is built incrementally across four milestones (see below). Each
milestone should be fully working and usable on its own before moving to the
next.

## Technology Stack

| Layer            | Choice                                   |
|-------------------|-------------------------------------------|
| Frontend           | React 18 + TypeScript + Vite              |
| Rich text editor   | Tiptap (ProseMirror-based)                |
| Frontend data      | TanStack Query (REST) + Zustand/Context for local UI state |
| Backend            | Node.js + TypeScript + Express            |
| Real-time transport| Socket.io                                 |
| Conflict resolution| Yjs (CRDT), via `y-prosemirror` + a Socket.io-based provider |
| Database           | PostgreSQL                                |
| ORM                | Prisma                                    |
| Auth               | JWT access token + httpOnly refresh cookie |
| Password hashing   | argon2                                    |
| Validation          | zod (shared schemas between client/server where practical) |
| Image storage       | Local disk in development, behind a storage interface so S3-compatible storage can be swapped in later |
| Repo layout          | npm workspaces monorepo: `/client` and `/server` |

This stack is a starting point, not dogma — see "Important Architecture
Decisions" for the reasoning, and revisit a decision explicitly (in
conversation, not silently in code) if a milestone reveals it doesn't fit.

## Core Features

- Rich text document editing (headings, lists, bold/italic/etc., images)
- Per-user authentication and document ownership
- Persistent storage with autosave
- Sharing documents with specific people as viewer or editor
- Real-time concurrent editing with automatic conflict resolution
- Live presence: who's currently viewing/editing, and where their cursor is

## Milestone Roadmap

Implement **one milestone at a time, fully**, before starting the next one.
Do not build ahead into a later milestone's features even if it seems
convenient (e.g., don't wire up Socket.io during M1 "for later").

### M1: Single-user document editor
- Authentication (signup/login/logout, session handling)
- Document CRUD (create, list, open, rename, delete)
- Rich text editor (Tiptap) with standard formatting
- Image insertion into documents
- Persistent storage in PostgreSQL
- Autosave (periodic/debounced save of document content)

### M2: Sharing and permissions
- Viewer and editor roles per document
- Share a document with another user by email
- Revoke a previously granted access
- Server-side enforcement of role on every read/write operation

### M3: Real-time collaboration
- Socket.io transport for live updates
- Yjs/CRDT-based document state for conflict-free concurrent edits
- Multiple users editing the same document at once
- Reconnection and state re-synchronization after a dropped connection

### M4: Presence and polish
- Active users list per document
- Live presence indicators (cursors/selections of other users)
- UI, accessibility, and responsive design polish across the app

## Important Architecture Decisions

Recorded here so the reasoning survives beyond a single conversation. When a
milestone's implementation calls a prior decision into question, discuss and
update this section rather than quietly diverging from it in code.

- **Tiptap over a hand-rolled ProseMirror setup or a non-ProseMirror editor
  (e.g. Slate, Draft.js).** Tiptap gives us rich text + image support out of
  the box for M1, and has first-party Yjs bindings (`y-prosemirror`) for M3,
  so the editor doesn't need to be swapped or rearchitected when
  collaboration is added.
- **Yjs for conflict resolution, not manual operational transform or
  last-write-wins.** CRDTs handle concurrent edits and out-of-order network
  delivery correctly without a central sequencing server, and Yjs is the
  de facto standard with strong ProseMirror/Tiptap integration.
- **Socket.io as the real-time transport, separate from the REST API.**
  Document CRUD, auth, and sharing remain plain REST/JSON (simple to
  reason about, cacheable, testable). Socket.io is used only for live
  document updates and presence in M3/M4. This keeps the collaboration
  layer additive rather than a rewrite of the CRUD layer.
- **PostgreSQL + Prisma for persistence.** Users, documents, and
  permissions are inherently relational (ownership, share grants,
  roles). Prisma gives type-safe queries and migrations, which matters
  once M2 adds join-heavy permission checks.
- **Yjs document state persisted as periodic binary snapshots in
  Postgres**, rather than a separate document store. Keeps the
  infrastructure footprint to one database through M3; only revisit if
  snapshot size/frequency becomes a real problem.
- **JWT access token + httpOnly refresh cookie**, not a third-party auth
  provider, for M1. Keeps auth self-contained and easy to reason about
  for a project this size. OAuth/social login is out of scope unless
  explicitly requested later.
- **Image storage behind a storage interface, backed by local disk in
  development.** Avoids a hard dependency on a cloud provider before
  it's needed, while keeping the switch to S3-compatible storage a
  configuration change rather than a rewrite.
- **Authorization is always enforced server-side**, never trusted from
  client-supplied role claims. Every document read/write checks the
  requesting user's actual permission in the database.

## Coding Conventions

- TypeScript everywhere, `strict: true`. No `any` without a comment
  explaining why it's unavoidable.
- Functional React components with hooks; no class components.
- ESLint + Prettier enforced; do not hand-format around them.
- Validate all API input with zod at the boundary; don't trust client
  payloads past that point.
- Prefer named exports over default exports.
- Keep client and server code in their own workspace (`/client`,
  `/server`); shared types/schemas go in a `/shared` package if and
  when duplication actually becomes a problem — don't create it
  preemptively.
- Commit messages describe *why*, not just *what*, for anything
  non-obvious.

## Security Requirements

- Passwords hashed with argon2; never logged or stored in plaintext.
- JWT access tokens short-lived; refresh tokens stored in httpOnly,
  secure, sameSite cookies.
- All document/permission checks happen server-side, on every request
  — the client's UI state (e.g. "I'm the editor") is never treated as
  authoritative.
- All external input (API bodies, query params, socket events)
  validated with zod before use.
- Rich text content is sanitized before storage/render to prevent
  stored XSS via document content.
- Image uploads validated by MIME type and size limit; never trust the
  client-provided extension alone.
- Rate limiting on authentication endpoints (login, signup, password
  reset if added).
- No secrets committed to the repo; all config via environment
  variables.
- CORS restricted to known frontend origin(s).
- HTTPS assumed in production deployments.

## Do NOT Implement Yet

These are explicitly out of scope until their milestone (or later)
comes up in conversation:

- No sharing, roles, or multi-user access before M2 — M1 documents are
  single-owner only.
- No Socket.io, Yjs, or any real-time sync before M3 — M1/M2 use plain
  REST + autosave.
- No presence indicators, cursors, or "who's online" UI before M4.
- No OAuth/social login — email+password only, unless explicitly
  requested.
- No comments, suggestion mode, or version history UI — not in scope
  for any current milestone.
- No offline support or mobile app.
- No public/anonymous document links.
- No billing, payments, or multi-tenant/org features.

If a task seems to require one of these, stop and raise it rather than
building it in "while you're in there."

## Working Process

- Implement **one milestone at a time**, completely, before starting
  the next. Don't build M2+ scaffolding while working on M1.
- Before writing code for a non-trivial architectural choice (new
  library, new data model, new service boundary, anything not already
  decided above), **explain the decision and its trade-offs first** and
  get agreement, rather than generating code and presenting it as a
  fait accompli. Small, obviously-correct implementation details
  within an already-agreed design don't need this — use judgment.
- When a decision recorded in "Important Architecture Decisions" turns
  out to be wrong for a milestone, say so explicitly and update this
  file — don't silently diverge from it in code.
