import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  UPLOAD_DIR: z.string().default("uploads"),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(5),
  AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  AUTH_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
