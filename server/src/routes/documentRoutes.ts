import { Router } from "express";
import * as documentController from "../controllers/documentController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth);

router.get("/", documentController.list);
router.post("/", documentController.create);
router.get("/:id", documentController.get);
router.patch("/:id", documentController.rename);
router.put("/:id/content", documentController.updateContent);
router.delete("/:id", documentController.remove);
router.post("/:id/access", documentController.share);
router.delete("/:id/access/:email", documentController.revokeAccess);

export default router;
