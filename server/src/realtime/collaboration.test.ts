import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Server as SocketIOServer } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import * as Y from "yjs";
import { yDocToProsemirrorJSON } from "y-prosemirror";

vi.mock("../lib/prisma.js", async () => {
  const { createFakePrisma } = await import("../test/fakePrisma.js");
  return { prisma: createFakePrisma() };
});

import { prisma } from "../lib/prisma.js";
import type { FakePrisma } from "../test/fakePrisma.js";
import * as documentService from "../services/documentService.js";
import { signAccessToken } from "../lib/jwt.js";
import {
  registerCollaboration,
  YJS_FIELD,
  __flushRoomForTesting,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketData,
  type PresenceUser,
} from "./collaboration.js";

const fakePrisma = prisma as unknown as FakePrisma;

/**
 * A socket that actually joins a room now needs a real User row behind its
 * JWT subject (getDocumentForRealtime looks it up for the presence
 * roster) - this creates one, mirroring documentService.test.ts's helper.
 */
async function createFakeUser(email: string) {
  return fakePrisma.user.create({ data: { email, passwordHash: "unused", name: null } });
}

let httpServer: HttpServer;
let io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
let port: number;
const openSockets: ClientSocket[] = [];

beforeEach(async () => {
  fakePrisma.__reset();
  httpServer = createServer();
  io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
    httpServer,
  );
  registerCollaboration(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  port = (httpServer.address() as AddressInfo).port;
});

afterEach(async () => {
  for (const socket of openSockets.splice(0)) socket.disconnect();
  io.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

function connect(token?: string): ClientSocket {
  const socket = ioClient(`http://localhost:${port}`, {
    auth: token === undefined ? {} : { token },
    transports: ["websocket"],
    forceNew: true,
  });
  openSockets.push(socket);
  return socket;
}

function waitFor<T = unknown>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, (payload: T) => resolve(payload)));
}

function waitForConnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve) => socket.once("connect", () => resolve()));
}

/** A real, well-formed Yjs update (a fresh doc's whole state) inserting one paragraph of text. */
function makeRealUpdate(text: string): Uint8Array {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(YJS_FIELD);
  const paragraph = new Y.XmlElement("paragraph");
  const textNode = new Y.XmlText();
  textNode.insert(0, text);
  paragraph.insert(0, [textNode]);
  fragment.insert(0, [paragraph]);
  return Y.encodeStateAsUpdate(doc);
}

async function joinAndSync(socket: ClientSocket, documentId: string) {
  socket.emit("document:join", { documentId });
  return waitFor<{ state: Uint8Array }>(socket, "document:sync");
}

describe("socket handshake auth", () => {
  it("rejects a connection with no token", async () => {
    const socket = connect(undefined);
    const err = await waitFor<Error>(socket, "connect_error");
    expect(err.message).toMatch(/missing access token/i);
  });

  it("rejects a connection with an invalid token", async () => {
    const socket = connect("not-a-real-token");
    const err = await waitFor<Error>(socket, "connect_error");
    expect(err.message).toMatch(/invalid or expired access token/i);
  });

  it("accepts a connection with a valid access token", async () => {
    const socket = connect(signAccessToken("owner-1"));
    await expect(waitForConnect(socket)).resolves.toBeUndefined();
  });
});

describe("joining a document room", () => {
  it("seeds a new room from the document's existing content and syncs it to the joiner", async () => {
    const owner = await createFakeUser("realtime-seed-owner@example.com");
    const doc = await documentService.createDocument(owner.id, "Doc");
    const socket = connect(signAccessToken(owner.id));
    await waitForConnect(socket);

    const { state } = await joinAndSync(socket, doc.id);

    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, new Uint8Array(state));
    expect(yDocToProsemirrorJSON(ydoc, YJS_FIELD)).toEqual(doc.content);
  });

  it("rejects a join for a user with no access, and sends no sync state", async () => {
    const doc = await documentService.createDocument("owner-1", "Doc");
    const socket = connect(signAccessToken("stranger-1"));
    await waitForConnect(socket);

    socket.emit("document:join", { documentId: doc.id });
    const err = await waitFor<{ message: string }>(socket, "document:error");
    expect(err.message).toMatch(/do not have access/i);
  });

  it("lets a VIEWER join (read access) even though they cannot write", async () => {
    const owner = "owner-2";
    const viewerEmail = "viewer@example.com";
    await fakePrisma.user.create({ data: { email: viewerEmail, passwordHash: "x", name: null } });
    const viewer = await fakePrisma.user.findUnique({ where: { email: viewerEmail } });
    const doc = await documentService.createDocument(owner, "Doc");
    await documentService.shareDocument(doc.id, owner, viewerEmail, "VIEWER");

    const socket = connect(signAccessToken(viewer!.id));
    await waitForConnect(socket);
    await expect(joinAndSync(socket, doc.id)).resolves.toBeDefined();
  });
});

describe("relaying and authorizing updates", () => {
  async function makeShared(role: "VIEWER" | "EDITOR") {
    const owner = await createFakeUser(`collab-owner-${role}@example.com`);
    const email = `collab-${role}@example.com`;
    await fakePrisma.user.create({ data: { email, passwordHash: "x", name: null } });
    const collaborator = await fakePrisma.user.findUnique({ where: { email } });
    const doc = await documentService.createDocument(owner.id, "Doc");
    await documentService.shareDocument(doc.id, owner.id, email, role);
    return { doc, ownerId: owner.id, collaboratorId: collaborator!.id };
  }

  it("relays an EDITOR's update to other room members but not back to the sender", async () => {
    const { doc, ownerId, collaboratorId } = await makeShared("EDITOR");

    const ownerSocket = connect(signAccessToken(ownerId));
    const editorSocket = connect(signAccessToken(collaboratorId));
    await waitForConnect(ownerSocket);
    await waitForConnect(editorSocket);
    await joinAndSync(ownerSocket, doc.id);
    await joinAndSync(editorSocket, doc.id);

    const update = makeRealUpdate("relayed edit");
    const receivedByOwner = waitFor<{ update: Uint8Array }>(ownerSocket, "document:update");
    let echoedBackToSender = false;
    editorSocket.once("document:update", () => {
      echoedBackToSender = true;
    });

    editorSocket.emit("document:update", { documentId: doc.id, update });
    await receivedByOwner;

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(echoedBackToSender).toBe(false);
  });

  it("rejects a VIEWER's update attempt and does not relay it", async () => {
    const { doc, ownerId, collaboratorId } = await makeShared("VIEWER");

    const ownerSocket = connect(signAccessToken(ownerId));
    const viewerSocket = connect(signAccessToken(collaboratorId));
    await waitForConnect(ownerSocket);
    await waitForConnect(viewerSocket);
    await joinAndSync(ownerSocket, doc.id);
    await joinAndSync(viewerSocket, doc.id);

    let ownerReceivedUpdate = false;
    ownerSocket.once("document:update", () => {
      ownerReceivedUpdate = true;
    });
    const errorPromise = waitFor<{ message: string }>(viewerSocket, "document:error");

    viewerSocket.emit("document:update", { documentId: doc.id, update: new Uint8Array([9]) });

    const err = await errorPromise;
    expect(err.message).toMatch(/do not have permission/i);
    expect(ownerReceivedUpdate).toBe(false);
  });
});

describe("persistence", () => {
  it("flushes accumulated updates to yjsState and a re-derived content snapshot", async () => {
    const owner = await createFakeUser("realtime-flush-owner@example.com");
    const doc = await documentService.createDocument(owner.id, "Doc");
    const socket = connect(signAccessToken(owner.id));
    await waitForConnect(socket);
    await joinAndSync(socket, doc.id);

    const update = makeRealUpdate("hello from a real edit");
    socket.emit("document:update", { documentId: doc.id, update });
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the server apply it

    await __flushRoomForTesting(doc.id);

    const stored = await documentService.getDocument(doc.id, owner.id);
    expect(stored.yjsState).toBeInstanceOf(Buffer);
    expect((stored.yjsState as Buffer).length).toBeGreaterThan(0);
    expect(JSON.stringify(stored.content)).toContain("hello from a real edit");
    expect(stored.lastEditedBy).toBe(owner.id);
  });
});

describe("reconnection resync", () => {
  it("a fresh join after a disconnect receives the room's current full state, including edits made by others while it was away", async () => {
    const { doc, ownerId, collaboratorId } = await makeSharedEditor();

    const socketA = connect(signAccessToken(ownerId));
    await waitForConnect(socketA);
    await joinAndSync(socketA, doc.id);
    socketA.disconnect();

    // Someone else edits while socket A is away.
    const socketB = connect(signAccessToken(collaboratorId));
    await waitForConnect(socketB);
    await joinAndSync(socketB, doc.id);

    const update = makeRealUpdate("edited while offline");
    socketB.emit("document:update", { documentId: doc.id, update });
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Socket A "reconnects" (a fresh socket + rejoin, mirroring the client
    // provider's connect-handler-driven rejoin behavior).
    const socketAAgain = connect(signAccessToken(ownerId));
    await waitForConnect(socketAAgain);
    const { state } = await joinAndSync(socketAAgain, doc.id);

    const merged = new Y.Doc();
    Y.applyUpdate(merged, new Uint8Array(state));
    expect(JSON.stringify(yDocToProsemirrorJSON(merged, YJS_FIELD))).toContain(
      "edited while offline",
    );
  });

  async function makeSharedEditor() {
    const owner = await createFakeUser("realtime-reconnect-owner@example.com");
    const email = "editor5@example.com";
    await fakePrisma.user.create({ data: { email, passwordHash: "x", name: null } });
    const collaborator = await fakePrisma.user.findUnique({ where: { email } });
    const doc = await documentService.createDocument(owner.id, "Doc");
    await documentService.shareDocument(doc.id, owner.id, email, "EDITOR");
    return { doc, ownerId: owner.id, collaboratorId: collaborator!.id };
  }
});

describe("active-users presence roster (M4)", () => {
  it("broadcasts the roster on join, and an updated roster to remaining members on leave", async () => {
    const owner = await createFakeUser("presence-owner@example.com");
    const editorEmail = "presence-editor@example.com";
    await fakePrisma.user.create({ data: { email: editorEmail, passwordHash: "x", name: "Editor Name" } });
    const editor = await fakePrisma.user.findUnique({ where: { email: editorEmail } });
    const doc = await documentService.createDocument(owner.id, "Doc");
    await documentService.shareDocument(doc.id, owner.id, editorEmail, "EDITOR");

    const ownerSocket = connect(signAccessToken(owner.id));
    await waitForConnect(ownerSocket);
    const soloRoster = waitFor<{ users: PresenceUser[] }>(ownerSocket, "document:presence");
    ownerSocket.emit("document:join", { documentId: doc.id });
    expect((await soloRoster).users.map((u) => u.userId)).toEqual([owner.id]);

    const editorSocket = connect(signAccessToken(editor!.id));
    await waitForConnect(editorSocket);
    const bothRoster = waitFor<{ users: PresenceUser[] }>(ownerSocket, "document:presence");
    await joinAndSync(editorSocket, doc.id);
    const rosterAfterJoin = (await bothRoster).users;
    expect(rosterAfterJoin.map((u) => u.userId).sort()).toEqual([editor!.id, owner.id].sort());
    expect(rosterAfterJoin.find((u) => u.userId === editor!.id)).toEqual({
      userId: editor!.id,
      name: "Editor Name",
      email: editorEmail,
    });

    const rosterAfterLeave = waitFor<{ users: PresenceUser[] }>(ownerSocket, "document:presence");
    editorSocket.disconnect();
    expect((await rosterAfterLeave).users.map((u) => u.userId)).toEqual([owner.id]);
  });
});

describe("cursor/selection awareness relay (M4)", () => {
  it("relays a VIEWER's awareness update to other room members, even though they cannot edit", async () => {
    const { doc, ownerId, collaboratorId } = await makeSharedViewer();

    const ownerSocket = connect(signAccessToken(ownerId));
    const viewerSocket = connect(signAccessToken(collaboratorId));
    await waitForConnect(ownerSocket);
    await waitForConnect(viewerSocket);
    await joinAndSync(ownerSocket, doc.id);
    await joinAndSync(viewerSocket, doc.id);

    const cursorUpdate = new Uint8Array([1, 2, 3]);
    const received = waitFor<{ update: Uint8Array }>(ownerSocket, "document:awareness");
    let echoedBackToSender = false;
    viewerSocket.once("document:awareness", () => {
      echoedBackToSender = true;
    });

    viewerSocket.emit("document:awareness", { documentId: doc.id, update: cursorUpdate });
    expect(new Uint8Array((await received).update)).toEqual(cursorUpdate);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(echoedBackToSender).toBe(false);
  });

  it("replays an already-joined member's last awareness update to a new joiner", async () => {
    const { doc, ownerId, collaboratorId } = await makeSharedViewer();

    const ownerSocket = connect(signAccessToken(ownerId));
    await waitForConnect(ownerSocket);
    await joinAndSync(ownerSocket, doc.id);

    const cursorUpdate = new Uint8Array([9, 9, 9]);
    ownerSocket.emit("document:awareness", { documentId: doc.id, update: cursorUpdate });
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the server record it

    const viewerSocket = connect(signAccessToken(collaboratorId));
    await waitForConnect(viewerSocket);
    const replayed = waitFor<{ update: Uint8Array }>(viewerSocket, "document:awareness");
    viewerSocket.emit("document:join", { documentId: doc.id });

    expect(new Uint8Array((await replayed).update)).toEqual(cursorUpdate);
  });

  async function makeSharedViewer() {
    const owner = await createFakeUser("awareness-owner@example.com");
    const email = "awareness-viewer@example.com";
    await fakePrisma.user.create({ data: { email, passwordHash: "x", name: null } });
    const collaborator = await fakePrisma.user.findUnique({ where: { email } });
    const doc = await documentService.createDocument(owner.id, "Doc");
    await documentService.shareDocument(doc.id, owner.id, email, "VIEWER");
    return { doc, ownerId: owner.id, collaboratorId: collaborator!.id };
  }
});
