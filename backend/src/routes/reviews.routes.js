import { Router } from "express";
import * as reviewsController from "../controllers/reviews.controller.js";
import { authenticate } from "../middleware/auth.js";
import { reviewImageUpload } from "../middleware/reviewImageUpload.js";

const router = Router();

// Bloque 52: .array("images", 4) va siempre (aunque no traiga archivos) —
// tiendas no verificadas simplemente no mandan ninguno, mismo endpoint sirve
// a las dos situaciones.
router.post("/", authenticate, reviewImageUpload.array("images", 4), reviewsController.createReview);

export default router;

