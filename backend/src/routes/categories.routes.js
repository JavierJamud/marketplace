import { publicCache } from "../middleware/publicCache.js";
import { Router } from "express";
import * as categoriesController from "../controllers/categories.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";

const router = Router();

router.get("/", publicCache(60_000), categoriesController.listCategories);
// Un vendedor (o el admin) puede crear una categorÃ­a nueva al cargar un producto cuando no existe la suya.
router.post("/", authenticate, requireRole("VENDOR", "VENDOR_STAFF", "ADMIN"), categoriesController.createCategory);

export default router;
