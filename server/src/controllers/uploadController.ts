import type { Request, Response } from "express";
import multer from "multer";
import { env } from "../lib/env.js";
import { storage } from "../services/storageService.js";
import { BadRequestError } from "../lib/errors.js";
import { asyncHandler } from "../lib/asyncHandler.js";

const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TO_EXT[file.mimetype]) {
      cb(new BadRequestError("Unsupported image type. Use PNG, JPEG, GIF, or WebP."));
      return;
    }
    cb(null, true);
  },
});

export const uploadMiddleware = upload.single("image");

export const uploadImage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new BadRequestError("No image file provided");
  }

  const extension = ALLOWED_MIME_TO_EXT[req.file.mimetype];
  if (!extension) {
    throw new BadRequestError("Unsupported image type");
  }

  const { url } = await storage.save(req.file.buffer, extension);
  res.status(201).json({ data: { url } });
});
