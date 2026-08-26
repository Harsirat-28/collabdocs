import rateLimit from "express-rate-limit";
import { env } from "../lib/env.js";

/**
 * Limits brute-force/credential-stuffing attempts against login and signup.
 * Keyed by IP (express-rate-limit's default) since these are the only
 * unauthenticated endpoints where that's the sole caller identity available.
 */
export function createAuthRateLimiter() {
  return rateLimit({
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    limit: env.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: { message: "Too many attempts. Please try again later." },
      });
    },
  });
}

export const authRateLimiter = createAuthRateLimiter();
