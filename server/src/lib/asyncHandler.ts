import type { NextFunction, Request, Response } from "express";

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

/** Forwards rejected promises from async route handlers to Express's error middleware. */
export function asyncHandler(handler: Handler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}
