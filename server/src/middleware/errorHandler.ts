import type { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof MulterError) {
    res.status(400).json({ error: { message: err.message } });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: { message: "Validation failed", issues: err.flatten().fieldErrors },
    });
    return;
  }

  if (err instanceof AppError) {
    const body: Record<string, unknown> = { message: err.message };
    if ("details" in err && err.details !== undefined) {
      body.details = err.details;
    }
    res.status(err.statusCode).json({ error: body });
    return;
  }

  console.error(err);
  res.status(500).json({ error: { message: "Internal server error" } });
}
