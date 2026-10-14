import { Router } from "express";
import * as settingsController from "../controllers/settings.controller.js";

const router = Router();

// Público — sin auth, Home.jsx lo lee para pintar el hero.
router.get("/", settingsController.getSettings);

// Público: estado del modo mantenimiento (siempre disponible, también durante el mantenimiento).
router.get("/maintenance", settingsController.getMaintenance);

export default router;
