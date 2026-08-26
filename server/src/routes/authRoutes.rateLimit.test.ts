import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createAuthRateLimiter } from "../middleware/authRateLimit.js";

const MAX_ATTEMPTS = Number(process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS ?? "3");

function buildLimiterOnlyApp(): Express {
  const limiter = createAuthRateLimiter();
  const app = express();
  app.post("/signup", limiter, (_req, res) => res.status(201).json({ ok: true }));
  app.post("/login", limiter, (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe("authRateLimiter middleware", () => {
  it("allows requests up to the configured limit", async () => {
    const app = buildLimiterOnlyApp();

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const res = await request(app).post("/login");
      expect(res.status).toBe(200);
    }
  });

  it("rejects the request after the limit with 429 and the app's JSON error shape", async () => {
    const app = buildLimiterOnlyApp();

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await request(app).post("/login");
    }

    const blocked = await request(app).post("/login");
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      error: { message: "Too many attempts. Please try again later." },
    });
  });

  it("shares one bucket across every route it's applied to (login + signup)", async () => {
    const app = buildLimiterOnlyApp();

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await request(app).post("/login");
    }

    const blockedSignup = await request(app).post("/signup");
    expect(blockedSignup.status).toBe(429);
  });

  it("gives independent buckets to independent limiter instances", async () => {
    const appA = buildLimiterOnlyApp();
    const appB = buildLimiterOnlyApp();

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await request(appA).post("/login");
    }

    const stillOkOnB = await request(appB).post("/login");
    expect(stillOkOnB.status).toBe(200);
  });
});

// authService is mocked so this doesn't require a database; it only verifies
// that the real /api/auth router wires the limiter onto signup/login and not
// onto the other auth routes.
vi.mock("../services/authService.js", () => ({
  signup: vi.fn(async (email: string) => ({
    user: { id: "u1", email, name: null },
    tokens: {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      refreshTokenExpiresAt: new Date(Date.now() + 60_000),
    },
  })),
  login: vi.fn(async (email: string) => ({
    user: { id: "u1", email, name: null },
    tokens: {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      refreshTokenExpiresAt: new Date(Date.now() + 60_000),
    },
  })),
  logout: vi.fn(async () => undefined),
  refreshSession: vi.fn(),
  getCurrentUser: vi.fn(),
}));

const { default: authRoutes } = await import("./authRoutes.js");
const { errorHandler } = await import("../middleware/errorHandler.js");

function buildRealAuthApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use(errorHandler);
  return app;
}

describe("authRoutes rate-limit wiring", () => {
  it("limits /login and /signup but leaves /refresh unaffected once exhausted", async () => {
    const app = buildRealAuthApp();

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "a@example.com", password: "password123" });
      expect(res.status).toBe(200);
    }

    const blockedLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "a@example.com", password: "password123" });
    expect(blockedLogin.status).toBe(429);

    // Same bucket also blocks signup, since both routes share one limiter instance.
    const blockedSignup = await request(app)
      .post("/api/auth/signup")
      .send({ email: "new@example.com", password: "password123" });
    expect(blockedSignup.status).toBe(429);

    // /refresh has no limiter applied, so it should fail for its own reason
    // (missing cookie -> 401), never 429.
    const refreshRes = await request(app).post("/api/auth/refresh");
    expect(refreshRes.status).toBe(401);
  });
});
