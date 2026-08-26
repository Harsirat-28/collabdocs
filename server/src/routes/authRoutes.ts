import { Router } from "express";
import * as authController from "../controllers/authController.js";
import { requireAuth } from "../middleware/auth.js";
import { authRateLimiter } from "../middleware/authRateLimit.js";

const router = Router();

router.post("/signup", authRateLimiter, authController.signup);
router.post("/login", authRateLimiter, authController.login);
router.post("/refresh", authController.refresh);
router.post("/logout", authController.logout);
router.get("/me", requireAuth, authController.me);

export default router;
