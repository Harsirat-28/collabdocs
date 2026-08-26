// Minimal env so `env.ts`'s zod parse succeeds when tests import
// server modules directly, bypassing `index.ts`'s `dotenv/config`.
process.env.DATABASE_URL ??= "postgresql://user:password@localhost:5432/test";
process.env.CLIENT_ORIGIN ??= "http://localhost:5173";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-0123456789";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-0123456789";
process.env.AUTH_RATE_LIMIT_WINDOW_MINUTES ??= "15";
process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS ??= "3";
// Small on purpose so the upload size-limit test doesn't need a multi-MB buffer.
process.env.MAX_UPLOAD_MB ??= "1";
