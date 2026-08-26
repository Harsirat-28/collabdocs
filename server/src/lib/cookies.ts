import type { Response } from "express";
import { env } from "./env.js";

const REFRESH_COOKIE_NAME = "refreshToken";

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    expires: expiresAt,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/auth" });
}

export { REFRESH_COOKIE_NAME };
