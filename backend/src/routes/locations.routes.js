import { publicCache } from "../middleware/publicCache.js";
import { Router } from "express";
import * as locationsController from "../controllers/locations.controller.js";

const router = Router();

router.get("/served", publicCache(60_000), locationsController.listServedLocations);
router.get("/provinces", locationsController.listProvinces);
router.get("/countries", locationsController.listActiveCountries);
router.get("/countries/:countryId/provinces", locationsController.listProvincesByCountry);
router.get("/provinces/:provinceId/municipalities", locationsController.listMunicipalities);
router.get("/provinces/:provinceId/adjacent", locationsController.listAdjacentProvinces);

export default router;
