import { Router } from "express";
import * as announcementsController from "../controllers/announcements.controller.js";

const router = Router();

// Público — sin auth, Home.jsx/Stores.jsx lo leen para pintar los banners.
router.get("/active", announcementsController.listActiveAnnouncements);

export default router;
