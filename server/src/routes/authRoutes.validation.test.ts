import express, { type Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signup = vi.fn(async (email: string) => ({
  user: { id: "u1", email, name: null },
  tokens: {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(Date.now() + 60_000),
  },
}));
const login = vi.fn(async (email: string) => ({
  user: { id: "u1", email, name: null },
  tokens: {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(Date.now() + 60_000),
  },
}));

vi.mock("../services/authService.js", () => ({
  signup: (...args: Parameters<typeof signup>) => signup(...args),
  login: (...args: Parameters<typeof login>) => login(...args),
  logout: vi.fn(),
  refreshSession: vi.fn(),
  getCurrentUser: vi.fn(),
}));

// This file is about zod validation, not rate limiting (see
// authRoutes.rateLimit.test.ts for that) - neutralize the limiter so the
// several sequential requests below don't trip its shared per-IP bucket.
vi.mock("../middleware/authRateLimit.js", () => ({
  authRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const { default: authRoutes } = await import("./authRoutes.js");
const { errorHandler } = await import("../middleware/errorHandler.js");

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use(errorHandler);
  return app;
}

describe("zod boundary validation - /api/auth/signup", () => {
  beforeEach(() => {
    signup.mockClear();
  });

  it("rejects a password shorter than 8 characters", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email: "a@example.com", password: "short1" });

    expect(res.status).toBe(400);
    expect(signup).not.toHaveBeenCalled();
  });

  it("rejects a malformed email", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email: "not-an-email", password: "password123" });

    expect(res.status).toBe(400);
    expect(signup).not.toHaveBeenCalled();
  });

  it("rejects a name over 100 characters", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email: "a@example.com", password: "password123", name: "x".repeat(101) });

    expect(res.status).toBe(400);
    expect(signup).not.toHaveBeenCalled();
  });

  it("accepts a valid payload", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email: "a@example.com", password: "password123" });

    expect(res.status).toBe(201);
    expect(signup).toHaveBeenCalledWith("a@example.com", "password123", undefined);
  });
});

describe("zod boundary validation - /api/auth/login", () => {
  beforeEach(() => {
    login.mockClear();
  });

  it("rejects a missing password", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/auth/login").send({ email: "a@example.com" });

    expect(res.status).toBe(400);
    expect(login).not.toHaveBeenCalled();
  });

  it("rejects a non-string email", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: 12345, password: "password123" });

    expect(res.status).toBe(400);
    expect(login).not.toHaveBeenCalled();
  });
});
