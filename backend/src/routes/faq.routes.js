import { Router } from "express";
import * as faqController from "../controllers/faq.controller.js";

const router = Router();

// Público — Faq.jsx pide su lista según la pestaña activa (?audience=CUSTOMER|VENDOR).
router.get("/", faqController.listPublicFaqs);

export default router;
