import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { reportRateLimit } from "../middleware/rateLimit.js";
import { ticketUpload } from "../middleware/ticketUpload.js";
import * as tickets from "../controllers/supportTickets.controller.js";

// Tickets de errores visuales desde el panel de la tienda (dueño o usuario del sistema).
const router = Router();
router.post("/", authenticate, reportRateLimit, ticketUpload.single("screenshot"), tickets.createTicket);
router.get("/mine", authenticate, tickets.listMyTickets);

export default router;
