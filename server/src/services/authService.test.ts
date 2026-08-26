import { beforeEach, describe, expect, it, vi } from "vitest";

// Dynamic import inside the factory (rather than a module-scope `const`)
// sidesteps ESM's import-hoisting order: vi.mock's registration is hoisted
// above all imports, but the factory body itself only runs later, when
// authService's own `import { prisma } from "../lib/prisma.js"` resolves.
vi.mock("../lib/prisma.js", async () => {
  const { createFakePrisma } = await import("../test/fakePrisma.js");
  return { prisma: createFakePrisma() };
});

import { prisma } from "../lib/prisma.js";
import type { FakePrisma } from "../test/fakePrisma.js";
import * as authService from "./authService.js";
import { sha256 } from "../lib/hash.js";
import { signRefreshToken } from "../lib/jwt.js";
import { ConflictError, UnauthorizedError } from "../lib/errors.js";

// The mocked `prisma` above is actually our in-memory FakePrisma (see the
// vi.mock factory); this cast gives typed access to its test-only reset().
const fakePrisma = prisma as unknown as FakePrisma;

beforeEach(() => {
  fakePrisma.__reset();
});

async function signupUser(email = "alice@example.com", password = "correct-password") {
  return authService.signup(email, password, "Alice");
}

describe("authService.signup", () => {
  it("hashes the password rather than storing it in plaintext", async () => {
    const { user } = await signupUser("alice@example.com", "super-secret-1");
    const stored = await fakePrisma.user.findUnique({ where: { id: user.id } });
    expect(stored?.passwordHash).toBeDefined();
    expect(stored?.passwordHash).not.toBe("super-secret-1");
  });

  it("issues an access token and a refresh token recorded only as a hash", async () => {
    const { tokens } = await signupUser();
    expect(tokens.accessToken).toEqual(expect.any(String));
    expect(tokens.refreshToken).toEqual(expect.any(String));

    const stored = await fakePrisma.refreshToken.findUnique({
      where: { tokenHash: sha256(tokens.refreshToken) },
    });
    expect(stored).not.toBeNull();
    expect(stored?.revokedAt).toBeNull();
  });

  it("rejects a duplicate email with ConflictError", async () => {
    await signupUser("dupe@example.com");
    await expect(signupUser("dupe@example.com")).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("authService.login", () => {
  it("succeeds with correct credentials", async () => {
    await signupUser("bob@example.com", "correct-password");
    const { user } = await authService.login("bob@example.com", "correct-password");
    expect(user.email).toBe("bob@example.com");
  });

  it("rejects a wrong password and a nonexistent email with the same generic message", async () => {
    await signupUser("carol@example.com", "correct-password");

    let wrongPasswordMessage = "";
    let noSuchUserMessage = "";
    try {
      await authService.login("carol@example.com", "wrong-password");
    } catch (err) {
      wrongPasswordMessage = (err as UnauthorizedError).message;
    }
    try {
      await authService.login("nobody@example.com", "whatever");
    } catch (err) {
      noSuchUserMessage = (err as UnauthorizedError).message;
    }

    expect(wrongPasswordMessage).toBe(noSuchUserMessage);
    expect(wrongPasswordMessage).toMatch(/invalid email or password/i);
  });
});

describe("authService.refreshSession - rotation and reuse detection", () => {
  it("rotates: the old token is revoked and linked to its replacement, and a new pair is issued", async () => {
    const { user, tokens } = await signupUser();
    const oldHash = sha256(tokens.refreshToken);

    const { tokens: rotated } = await authService.refreshSession(tokens.refreshToken);

    // Not asserting the access token differs: it's a JWT of just { sub },
    // signed with second-granularity `iat`, so two issued within the same
    // second are legitimately byte-identical - that's not a bug.
    expect(rotated.refreshToken).not.toBe(tokens.refreshToken);

    const oldRecord = await fakePrisma.refreshToken.findUnique({ where: { tokenHash: oldHash } });
    expect(oldRecord?.revokedAt).not.toBeNull();
    expect(oldRecord?.replacedByTokenHash).toBe(sha256(rotated.refreshToken));

    const newRecord = await fakePrisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rotated.refreshToken) },
    });
    expect(newRecord?.userId).toBe(user.id);
    expect(newRecord?.revokedAt).toBeNull();
  });

  it("detects reuse of an already-rotated token and revokes every active session for that user", async () => {
    const { tokens } = await signupUser();

    // First use: legitimate rotation.
    const { tokens: rotated } = await authService.refreshSession(tokens.refreshToken);

    // Second use of the SAME original token: this is what a stolen/replayed
    // token looks like, since a legitimate client would only ever use the
    // rotated replacement from here on.
    await expect(authService.refreshSession(tokens.refreshToken)).rejects.toThrow(
      /reuse detected/i,
    );

    // The whole session is killed, not just the reused token: the
    // replacement issued by the first (legitimate) rotation must also now
    // be unusable, even though it was never itself reused.
    const replacementRecord = await fakePrisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rotated.refreshToken) },
    });
    expect(replacementRecord?.revokedAt).not.toBeNull();

    await expect(authService.refreshSession(rotated.refreshToken)).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("treats an expired-but-not-yet-reused token as reuse too (mass revoke)", async () => {
    const { tokens: firstSession } = await signupUser();
    // A second, still-valid session for the same user (e.g. another
    // device), to prove the mass-revoke really does hit every active
    // token for the user, not just the expired one.
    const { tokens: secondSession } = await authService.login(
      "alice@example.com",
      "correct-password",
    );

    const stored = await fakePrisma.refreshToken.findUnique({
      where: { tokenHash: sha256(firstSession.refreshToken) },
    });
    // Force expiry directly, bypassing the real 7-day TTL, to exercise the
    // `expiresAt < now` branch without waiting.
    await fakePrisma.refreshToken.update({
      where: { id: stored!.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(authService.refreshSession(firstSession.refreshToken)).rejects.toThrow(
      /reuse detected/i,
    );

    const secondRecord = await fakePrisma.refreshToken.findUnique({
      where: { tokenHash: sha256(secondSession.refreshToken) },
    });
    expect(secondRecord?.revokedAt).not.toBeNull();
  });

  it("rejects a token with an invalid signature", async () => {
    await expect(authService.refreshSession("not-a-real-jwt")).rejects.toThrow(
      /invalid refresh token/i,
    );
  });

  it("rejects a well-formed but never-issued (forged) token", async () => {
    const forged = signRefreshToken("some-unknown-user-id", "made-up-jti");
    await expect(authService.refreshSession(forged)).rejects.toThrow(/invalid refresh token/i);
  });
});

describe("authService.logout", () => {
  it("revokes the token so a later refresh attempt is treated as reuse", async () => {
    const { tokens } = await signupUser();

    await authService.logout(tokens.refreshToken);

    const stored = await fakePrisma.refreshToken.findUnique({
      where: { tokenHash: sha256(tokens.refreshToken) },
    });
    expect(stored?.revokedAt).not.toBeNull();

    await expect(authService.refreshSession(tokens.refreshToken)).rejects.toThrow(
      /reuse detected/i,
    );
  });
});

describe("authService.getCurrentUser", () => {
  it("returns the public user shape for an existing id", async () => {
    const { user } = await signupUser("dana@example.com");
    const fetched = await authService.getCurrentUser(user.id);
    expect(fetched).toEqual({ id: user.id, email: "dana@example.com", name: "Alice" });
  });

  it("rejects an id that doesn't exist", async () => {
    await expect(authService.getCurrentUser("no-such-id")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});
