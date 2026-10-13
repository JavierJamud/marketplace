import { publicCache } from "../middleware/publicCache.js";
import { Router } from "express";
import * as searchController from "../controllers/search.controller.js";

const router = Router();

// Sin texto de búsqueda (portada y catálogo) es igual para todos: se cachea unos segundos. Con texto se calcula siempre.
router.get("/", publicCache(20_000, { skip: (req) => !!req.query.q }), searchController.structuredSearch);
router.get("/trending", searchController.trendingSearches);
router.get("/autocomplete", searchController.autocompleteSearch);

export default router;
