import { Router } from "express";
import * as settingsController from "../controllers/settings.controller.js";

const router = Router();

// Público — sin auth, Home.jsx lo lee para pintar el hero.
router.get("/", settingsController.getSettings);

export default router;
