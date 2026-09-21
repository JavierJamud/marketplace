import { Router } from "express";
import * as vendorsController from "../controllers/vendors.controller.js";
import * as reviewsController from "../controllers/reviews.controller.js";
import * as chatController from "../controllers/chat.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { requireVendorAccess, requireVendorWrite } from "../middleware/requireVendorAccess.js";
import { vendorAiDocUpload } from "../middleware/vendorAiDocUpload.js";
import { vendorBrandingUpload } from "../middleware/vendorBrandingUpload.js";
import { chatRateLimit } from "../middleware/rateLimit.js";
import { kycUpload } from "../middleware/kycUpload.js";

const router = Router();

router.get("/", vendorsController.listVendors);
// Auditoría de seguridad: estas 4 eran las únicas rutas "/me/*" de este
// archivo sin requireRole("VENDOR") explícito — hoy no eran explotables
// porque resolveMyVendor() ya devuelve 404 a quien no tenga fila en Vendor,
// pero quedaban inconsistentes con el resto del archivo y frágiles ante un
// controller nuevo que no use resolveMyVendor. Se agrega el guard acá
// también, sin cambiar el comportamiento actual.
// Bloque 183: sin sección — TODO usuario de sistema (VENDOR_STAFF) necesita
// esto para que cargue el layout del panel, sin importar qué sección
// tenga asignada.
router.get("/me", authenticate, requireVendorAccess(), vendorsController.getMyVendor);
// Bloque 175: barra de búsqueda global del panel — pedidos (código/mesa),
// cliente que los hizo, y productos por nombre. Bloque 183: sin sección,
// mismo criterio que /me de arriba.
router.get("/me/search", authenticate, requireVendorAccess(), vendorsController.searchMyVendor);
router.patch("/me", authenticate, requireRole("VENDOR"), vendorsController.updateMyVendor);
// Bloque 133: logo como archivo — alternativa al link externo que ya
// aceptaba PATCH /me (logoUrl como string plano).
router.post("/me/logo", authenticate, requireRole("VENDOR"), vendorBrandingUpload.single("logo"), vendorsController.uploadVendorLogo);
// Bloque 153 (pedido explícito — "los datos de la tienda no se pueden
// modificar después de estar verificadas sin aprobación del admin... en
// caso dado subir fotos del nuevo responsable y foto del ID"): fotos
// opcionales, mismo storage/middleware que ya usa el KYC de verificación.
router.post(
  "/me/change-request",
  authenticate,
  requireRole("VENDOR"),
  kycUpload.fields([{ name: "newOwnerSelfie", maxCount: 1 }, { name: "newOwnerIdPhoto", maxCount: 1 }]),
  vendorsController.requestVendorChange
);
router.get("/me/change-request", authenticate, requireRole("VENDOR"), vendorsController.getMyChangeRequest);
router.get("/change-request/:id/file/:type", authenticate, vendorsController.getVendorChangeRequestFile);
// Bloque 183: sección "resumen" (dashboard).
router.get("/me/dashboard", authenticate, requireVendorAccess("resumen"), vendorsController.getDashboard);
// Bloque 194: gráficas/analíticas ampliadas del Dashboard — endpoint
// separado del de arriba a propósito (ver el comentario largo en
// getDashboardAnalytics, vendors.controller.js).
router.get("/me/dashboard/analytics", authenticate, requireVendorAccess("resumen"), vendorsController.getDashboardAnalytics);
// Bloque 225: gráfica única de ventas con selector de día/semana/mes/año y
// rango de fechas propio — ver el comentario largo en getVendorSalesSeries.
router.get("/me/dashboard/sales-series", authenticate, requireVendorAccess("resumen"), vendorsController.getVendorSalesSeries);
// Bloque 194: consejos diarios de IA — ver el comentario largo en
// getVendorDailyTips/vendorDailyTips.service.js.
router.get("/me/dashboard/tips", authenticate, requireVendorAccess("resumen"), vendorsController.getVendorDailyTips);
// Horarios/cobertura/entrega — datos de identidad del negocio, nunca
// delegables a un usuario de sistema (quedan owner/admin-only a propósito).
router.patch("/me/schedule", authenticate, requireRole("VENDOR"), vendorsController.updateSchedule);
// Bloque 183: sección "mensajes".
router.get("/me/messages", authenticate, requireVendorAccess("mensajes"), vendorsController.getMyMessages);
router.post("/me/messages", authenticate, requireVendorWrite("mensajes"), vendorsController.sendMyMessage);
router.patch("/me/messages/read", authenticate, requireVendorWrite("mensajes"), vendorsController.markMyMessagesRead);
// Bloque 183: sin sección — la campanita de notificaciones es global.
router.get("/me/notifications", authenticate, requireVendorAccess(), vendorsController.listMyNotifications);
router.patch("/me/notifications/read", authenticate, requireVendorAccess(), vendorsController.markMyNotificationsRead);
router.post("/me/delivery-countries", authenticate, requireRole("VENDOR"), vendorsController.addMyDeliveryCountry);
router.delete("/me/delivery-countries/:countryId", authenticate, requireRole("VENDOR"), vendorsController.removeMyDeliveryCountry);
router.post("/me/locations", authenticate, requireRole("VENDOR"), vendorsController.addMyLocation);
router.post("/me/locations/sync-province", authenticate, requireRole("VENDOR"), vendorsController.syncProvinceLocations);
router.delete("/me/locations/:id", authenticate, requireRole("VENDOR"), vendorsController.removeMyLocation);
// Bloque 183: sección "resenas".
router.get("/me/reviews", authenticate, requireVendorAccess("resenas"), reviewsController.listMyReviews);
router.patch("/me/reviews/:id/reply", authenticate, requireVendorWrite("resenas"), reviewsController.replyToReview);
router.post("/me/ai-document", authenticate, requireRole("VENDOR"), vendorAiDocUpload.single("document"), vendorsController.uploadAiDocument);
router.delete("/me/ai-document", authenticate, requireRole("VENDOR"), vendorsController.removeAiDocument);
// Bloque 184 (auditoría de seguridad): ÚNICO endpoint del sistema donde un
// usuario escribe su propio `role` (createVendor termina con
// `user.update({ data: { role: "VENDOR" } })`). Es el alta de tienda del
// flujo de registro, así que el que llama siempre es un CUSTOMER recién
// verificado — Account.jsx y VendorOnboarding.jsx. Sin este requireRole, un
// usuario de sistema (VENDOR_STAFF) podía llamarlo y ascenderse solo a
// VENDOR: el 409 de "ya tenés una tienda" no lo frena porque un staff nunca
// tiene fila propia en Vendor (ver resolveVendor.js). Se escapaba así del
// modelo de permisos por secciones y del botón de desactivar del dueño.
router.post("/", authenticate, requireRole("CUSTOMER"), vendorsController.createVendor);
router.post("/:id/engagement", authenticate, requireRole("CUSTOMER"), vendorsController.trackEngagement);
// Bloque 21: sin login (el widget de chat es público) — rutas literales
// antes de "/:slug" para que Express no matchee ":vendorId" como si fuera
// un slug de tienda.
router.get("/:vendorId/chat", chatController.getChatHistory);
router.post("/:vendorId/chat", chatRateLimit, chatController.postChatMessage);
router.get("/:slug", vendorsController.getVendorBySlug);

export default router;
