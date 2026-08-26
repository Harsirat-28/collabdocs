import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../lib/jwt.js";
import { UnauthorizedError } from "../lib/errors.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing access token");
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    next();
  } catch {
    throw new UnauthorizedError("Invalid or expired access token");
  }
}
