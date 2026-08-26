import type { Request, Response } from "express";
import { z } from "zod";
import * as authService from "../services/authService.js";
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from "../lib/cookies.js";
import { UnauthorizedError } from "../lib/errors.js";
import { asyncHandler } from "../lib/asyncHandler.js";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const signup = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, name } = signupSchema.parse(req.body);
  const { user, tokens } = await authService.signup(email, password, name);
  setRefreshCookie(res, tokens.refreshToken, tokens.refreshTokenExpiresAt);
  res.status(201).json({ data: { user, accessToken: tokens.accessToken } });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = loginSchema.parse(req.body);
  const { user, tokens } = await authService.login(email, password);
  setRefreshCookie(res, tokens.refreshToken, tokens.refreshTokenExpiresAt);
  res.status(200).json({ data: { user, accessToken: tokens.accessToken } });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (!rawToken) {
    throw new UnauthorizedError("Missing refresh token");
  }

  const { user, tokens } = await authService.refreshSession(rawToken);
  setRefreshCookie(res, tokens.refreshToken, tokens.refreshTokenExpiresAt);
  res.status(200).json({ data: { user, accessToken: tokens.accessToken } });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (rawToken) {
    await authService.logout(rawToken);
  }
  clearRefreshCookie(res);
  res.status(204).send();
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.getCurrentUser(req.userId!);
  res.status(200).json({ data: { user } });
});
