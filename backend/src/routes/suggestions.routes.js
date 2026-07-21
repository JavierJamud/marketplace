import { Router } from "express";
import * as suggestionsController from "../controllers/suggestions.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";

const router = Router();

router.post("/", authenticate, requireRole("VENDOR", "CUSTOMER"), suggestionsController.createSuggestion);

export default router;
