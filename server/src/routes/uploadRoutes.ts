import { Router } from "express";
import * as uploadController from "../controllers/uploadController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/image", requireAuth, uploadController.uploadMiddleware, uploadController.uploadImage);

export default router;
