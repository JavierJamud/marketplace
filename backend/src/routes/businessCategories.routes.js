import { publicCache } from "../middleware/publicCache.js";
import { Router } from "express";
import * as businessCategoriesController from "../controllers/businessCategories.controller.js";

const router = Router();

router.get("/", publicCache(60_000), businessCategoriesController.listBusinessCategories);

export default router;
