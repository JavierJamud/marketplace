import { Router } from "express";
import * as staticPagesController from "../controllers/staticPages.controller.js";

const router = Router();

// Público — Terminos.jsx/Privacy.jsx/Faq.jsx/Ayuda.jsx/Contacto.jsx piden
// su propio slug al montar.
router.get("/:slug", staticPagesController.getStaticPage);

export default router;
