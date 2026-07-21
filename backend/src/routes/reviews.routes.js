import { Router } from "express";
import * as reviewsController from "../controllers/reviews.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.post("/", authenticate, reviewsController.createReview);

export default router;

