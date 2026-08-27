# CollabDocs

A Google Docs-inspired real-time collaborative document editor. Users can create, edit, and share rich-text documents, with role-based permissions, autosave, and image uploads.

## Status

- **M1 - Single-user document editor**: complete (auth, document CRUD, rich text editing, image uploads, autosave).
- **M2 - Sharing and permissions**: complete (viewer/editor roles, share/revoke by email, server-side role enforcement, minimal share UI).
- **M3 - Real-time collaboration** and **M4 - Presence and polish**: not started.

## Tech stack

| Layer               | Choice                                                       |
| ------------------- | -------------------------------------------------------------|
| Frontend             | React 18 + TypeScript + Vite                                 |
| Rich text editor      | Tiptap (ProseMirror-based)                                    |
| Frontend data          | TanStack Query (REST) + Zustand for local UI state             |
| Backend                 | Node.js + TypeScript + Express                                  |
| Database                 | PostgreSQL + Prisma                                               |
| Auth                       | JWT access token + httpOnly refresh cookie, argon2 password hashing |
| Validation                   | zod                                                                    |
| Image storage                  | Local disk in development, behind a storage interface                    |
| Repo layout                       | npm workspaces monorepo (`/client`, `/server`)                              |

## Getting started

### Prerequisites

- Node.js 20+
- A PostgreSQL database (e.g. [Neon](https://neon.tech), Supabase, or local Postgres)

### Setup

```bash
# Install dependencies (client + server)
npm install

# Configure environment variables
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Edit `server/.env` and fill in:
- `DATABASE_URL` - your Postgres connection string
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` - generate with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

Then apply the database schema:

```bash
cd server
npx prisma migrate deploy
```

### Running locally

```bash
# In separate terminals:
npm run dev:server   # http://localhost:4000
npm run dev:client   # http://localhost:5173
```

## Scripts

| Command                | Description                                  |
| ----------------------- | --------------------------------------------- |
| `npm run dev:server`      | Start the API server in watch mode              |
| `npm run dev:client`        | Start the Vite dev server                          |
| `npm run build:server`        | Build the server for production                     |
| `npm run build:client`          | Build the client for production                       |
| `npm run typecheck`               | Type-check both workspaces                               |
| `npm run test:server`               | Run the server test suite (Vitest)                          |

## Project structure

```
client/src/
  features/       API calls, hooks, and feature-specific components
  pages/          Route-level pages
  components/     Shared UI components
  store/          Zustand stores (auth state)

server/src/
  routes/         Express route definitions
  controllers/     HTTP layer: request validation, response shaping
  services/          Business logic and database access
  middleware/          Auth, rate limiting, error handling
  lib/                  Shared utilities (JWT, hashing, env config, errors)
  prisma/                Database schema and migrations
```
