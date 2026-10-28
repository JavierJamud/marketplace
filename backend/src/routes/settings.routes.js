import { Router } from "express";
import * as settingsController from "../controllers/settings.controller.js";
import { publicCache } from "../middleware/publicCache.js";

const router = Router();

// Público — sin auth, Home.jsx lo lee para pintar el hero.
router.get("/", settingsController.getSettings);

// Público: estado del modo mantenimiento (siempre disponible, también durante el mantenimiento).
router.get("/maintenance", settingsController.getMaintenance);

// Público: los planes de las tiendas, tal como los configura el admin (página /planes y comparación en el panel). Sin caché
// en memoria: un cambio del admin se ve al instante.
router.get("/plans", settingsController.getPublicPlans);

// Público: países activos y categorías disponibles (pantalla de ingreso). Cambia poco: 5 minutos en memoria.
router.get("/stats", publicCache(5 * 60 * 1000), settingsController.getPublicStats);

export default router;
