import { createImageUpload } from "../lib/imageOptimizer.js";
import { TICKET_UPLOAD_DIR } from "../controllers/supportTickets.controller.js";

// Captura de pantalla de un ticket de error visual. Se guarda en uploads/tickets, que no es pública (solo el admin la abre por
// su ruta). Calidad alta y 2000 px: el admin tiene que poder leer texto chico de la pantalla de la tienda.
export const ticketUpload = createImageUpload({
  dir: TICKET_UPLOAD_DIR,
  allowedExt: new Set([".png", ".jpg", ".jpeg", ".webp"]),
  fileSize: 8 * 1024 * 1024,
  maxFiles: 1,
  maxWidth: 2000,
  quality: 88,
});
