import "dotenv/config";
import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { Server as SocketIOServer } from "socket.io";
import { env } from "./lib/env.js";
import { UPLOAD_ROOT } from "./services/storageService.js";
import { errorHandler } from "./middleware/errorHandler.js";
import authRoutes from "./routes/authRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import {
  registerCollaboration,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from "./realtime/collaboration.js";

const app = express();

app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(UPLOAD_ROOT));

app.get("/api/health", (_req, res) => {
  res.status(200).json({ data: { status: "ok" } });
});

app.use("/api/auth", authRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/uploads", uploadRoutes);

app.use(errorHandler);

const httpServer = createServer(app);

const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
  httpServer,
  { cors: { origin: env.CLIENT_ORIGIN, credentials: true } },
);
registerCollaboration(io);

httpServer.listen(env.PORT, () => {
  console.log(`Server listening on http://localhost:${env.PORT}`);
});
