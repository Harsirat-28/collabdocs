import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./lib/env.js";
import { UPLOAD_ROOT } from "./services/storageService.js";
import { errorHandler } from "./middleware/errorHandler.js";
import authRoutes from "./routes/authRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";

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

app.listen(env.PORT, () => {
  console.log(`Server listening on http://localhost:${env.PORT}`);
});
