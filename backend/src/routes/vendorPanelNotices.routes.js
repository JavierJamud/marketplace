import { Router } from "express";
import * as notices from "../controllers/vendorPanelNotices.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// Avisos del admin en el panel de la tienda: el que toca ahora, y marcar que se mostró o que ya lo atendió.
router.get("/active", authenticate, notices.activeNotice);
router.post("/:id/shown", authenticate, notices.markShown);
router.post("/:id/done", authenticate, notices.markDone);

export default router;
