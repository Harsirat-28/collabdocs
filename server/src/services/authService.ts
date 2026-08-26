import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { sha256 } from "../lib/hash.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/jwt.js";
import { ConflictError, UnauthorizedError } from "../lib/errors.js";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
}

function toPublicUser(user: { id: string; email: string; name: string | null }): PublicUser {
  return { id: user.id, email: user.email, name: user.name };
}

async function issueTokens(userId: string): Promise<AuthTokens> {
  const jti = randomUUID();
  const refreshToken = signRefreshToken(userId, jti);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(refreshToken),
      expiresAt,
    },
  });

  return {
    accessToken: signAccessToken(userId),
    refreshToken,
    refreshTokenExpiresAt: expiresAt,
  };
}

export async function signup(email: string, password: string, name?: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new ConflictError("An account with this email already exists");
  }

  const passwordHash = await argon2.hash(password);
  const user = await prisma.user.create({
    data: { email, passwordHash, name: name ?? null },
  });

  const tokens = await issueTokens(user.id);
  return { user: toPublicUser(user), tokens };
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const valid = await argon2.verify(user.passwordHash, password);
  if (!valid) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const tokens = await issueTokens(user.id);
  return { user: toPublicUser(user), tokens };
}

/**
 * Rotates a refresh token: validates it, revokes it, and issues a new pair.
 * If a token is presented that's already revoked, every other active token
 * for that user is revoked too (reuse of a rotated-out token implies theft).
 */
export async function refreshSession(rawToken: string) {
  let payload;
  try {
    payload = verifyRefreshToken(rawToken);
  } catch {
    throw new UnauthorizedError("Invalid refresh token");
  }

  const tokenHash = sha256(rawToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!stored || stored.userId !== payload.sub) {
    throw new UnauthorizedError("Invalid refresh token");
  }

  if (stored.revokedAt || stored.expiresAt < new Date()) {
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new UnauthorizedError("Refresh token reuse detected, please log in again");
  }

  const user = await prisma.user.findUnique({ where: { id: stored.userId } });
  if (!user) {
    throw new UnauthorizedError("Invalid refresh token");
  }

  const tokens = await issueTokens(user.id);

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date(), replacedByTokenHash: sha256(tokens.refreshToken) },
  });

  return { user: toPublicUser(user), tokens };
}

export async function logout(rawToken: string): Promise<void> {
  const tokenHash = sha256(rawToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getCurrentUser(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UnauthorizedError("User no longer exists");
  }
  return toPublicUser(user);
}
