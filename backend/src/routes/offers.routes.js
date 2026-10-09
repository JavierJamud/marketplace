import { Router } from "express";
import * as offersController from "../controllers/offers.controller.js";

const router = Router();

// Pública — Home.jsx. Bloque 297: las ofertas de la página principal solo las crea el administrador
// (Admin > Ofertas); los vendedores ya no publican ofertas aquí, solo ofertas dentro de su tienda.
router.get("/active", offersController.listActiveOffers);

export default router;
