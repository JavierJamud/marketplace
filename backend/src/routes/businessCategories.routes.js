import { Router } from "express";
import * as businessCategoriesController from "../controllers/businessCategories.controller.js";

const router = Router();

router.get("/", businessCategoriesController.listBusinessCategories);

export default router;
