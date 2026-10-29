import { Router } from "express";
import * as vendorStaffController from "../controllers/vendorStaff.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { requireVendorWrite } from "../middleware/requireVendorAccess.js";
import { staffPhotoUpload } from "../middleware/staffPhotoUpload.js";

const router = Router();

// Bloque 183 (pedido explícito — "vamos a crear una nueva sección para
// crear usuarios de sistema... también se podrán administrar los usuarios
// y ver el historial de qué ha hecho cada usuario"): SIEMPRE
// requireRole("VENDOR") a secas, nunca requireVendorAccess — gestionar
// usuarios no es una sección delegable, ni siquiera a otro usuario de
// sistema (evita que alguien con acceso se dé a sí mismo más permisos o
// cree una puerta trasera).
// Además, requireVendorWrite() sin sección (va después de requireRole, así que sigue siendo solo del dueño) comprueba el
// estado de la tienda: una tienda eliminada, bloqueada o pausada no puede crear, editar ni reactivar personal. La
// suspendida por impago sí pasa, igual que en el resto del panel.
const ownerOnly = [requireRole("VENDOR"), requireVendorWrite()];
router.get("/", authenticate, ownerOnly, vendorStaffController.listMyStaff);
router.post("/", authenticate, ownerOnly, staffPhotoUpload.single("photo"), vendorStaffController.createMyStaff);
router.patch("/:id", authenticate, ownerOnly, vendorStaffController.updateMyStaff);
router.post("/:id/photo", authenticate, ownerOnly, staffPhotoUpload.single("photo"), vendorStaffController.uploadMyStaffPhoto);
router.post("/:id/reset-password", authenticate, ownerOnly, vendorStaffController.resetMyStaffPassword);
router.get("/:id/activity", authenticate, ownerOnly, vendorStaffController.getMyStaffActivity);
router.get("/:id/sessions", authenticate, ownerOnly, vendorStaffController.getMyStaffSessions);

// Bloque 183 (pedido explícito — "podrá ver su foto con su nombre, su
// correo, el nombre del negocio... y la sección a la que tiene acceso"):
// el propio usuario de sistema viendo SU perfil — nunca el del dueño.
router.get("/me/profile", authenticate, requireRole("VENDOR_STAFF"), vendorStaffController.getMyStaffProfile);

export default router;
