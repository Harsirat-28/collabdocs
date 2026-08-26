import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "./env.js";

export interface AccessTokenPayload {
  sub: string;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}

export function signAccessToken(userId: string): string {
  const options: SignOptions = { expiresIn: env.ACCESS_TOKEN_TTL as SignOptions["expiresIn"] };
  return jwt.sign({ sub: userId } satisfies AccessTokenPayload, env.JWT_ACCESS_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function signRefreshToken(userId: string, jti: string): string {
  const options: SignOptions = {
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d` as SignOptions["expiresIn"],
  };
  return jwt.sign(
    { sub: userId, jti } satisfies RefreshTokenPayload,
    env.JWT_REFRESH_SECRET,
    options,
  );
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
}
