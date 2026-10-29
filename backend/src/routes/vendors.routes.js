import { publicCache } from "../middleware/publicCache.js";
import { Router } from "express";
import { streamable } from "../lib/ndjsonStream.js";
import * as vendorsController from "../controllers/vendors.controller.js";
import * as reviewsController from "../controllers/reviews.controller.js";
import * as chatController from "../controllers/chat.controller.js";
import * as businessAssistantController from "../controllers/businessAssistant.controller.js";
import { authenticate, optionalAuth } from "../middleware/auth.js";
import * as usageController from "../controllers/usage.controller.js";
import { requireRole } from "../middleware/requireRole.js";
import { requireVendorAccess, requireVendorWrite } from "../middleware/requireVendorAccess.js";
import * as vendorCustomersController from "../controllers/vendorCustomers.controller.js";
import { vendorAiDocUpload } from "../middleware/vendorAiDocUpload.js";
import { vendorBrandingUpload } from "../middleware/vendorBrandingUpload.js";
import { chatRateLimit, assistantRateLimit, registerRateLimit, usernameCheckRateLimit } from "../middleware/rateLimit.js";
import { kycUpload } from "../middleware/kycUpload.js";

const router = Router();

// Rutas solo del dueño (auditoría de roles 2026-10-28): antes usaban requireRole("VENDOR") a secas y no miraban el estado
// de la tienda, así que una tienda bloqueada, pausada o eliminada seguía cambiando su perfil, sus zonas o gastando el
// asistente llamando a la API (solo la pantalla de VendorLayout.jsx lo impedía). requireRole va primero para que el
// personal y el admin sigan fuera igual que antes; para un VENDOR, requireVendorWrite() sin sección solo comprueba el
// estado (eliminada, bloqueada o pausada da 403 con vendorState) y requireVendorAccess() sin sección solo cierra la
// eliminada. La suspendida por impago pasa en los dos casos: tiene que poder entrar a pagar.
const ownerWrite = [requireRole("VENDOR"), requireVendorWrite()];
// Lo que no cambia la tienda (leer la prueba gratis, cerrar sus avisos) o lo revisa el admin antes de aplicarse (solicitud
// de cambio de datos): queda abierto a la tienda bloqueada, que lo puede necesitar para resolver su situación.
const ownerAny = [requireRole("VENDOR"), requireVendorAccess()];

router.get("/", publicCache(20_000, { skip: (req) => !!req.query.q }), vendorsController.listVendors);
router.post("/check-availability", registerRateLimit, vendorsController.checkVendorAvailability);
// Nombre de usuario en vivo (se consulta mientras se escribe, por eso su propio límite).
router.get("/username-check", usernameCheckRateLimit, optionalAuth, vendorsController.checkUsername);
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
router.patch("/me", authenticate, ownerWrite, vendorsController.updateMyVendor);
// Bloque 133: logo como archivo — alternativa al link externo que ya
// aceptaba PATCH /me (logoUrl como string plano).
router.post("/me/logo", authenticate, ownerWrite, vendorBrandingUpload.single("logo"), vendorsController.uploadVendorLogo);
// Bloque 235 (pedido explícito — trial gratuito de 30 días del Plan
// Premium): mismo criterio de auth que /me/logo arriba — solo el dueño,
// nunca un usuario de sistema.
router.get("/me/trial", authenticate, ownerAny, vendorsController.getMyTrial);
// Uso del panel (entradas a cada sección y tiempo activo). Dueño o usuario del equipo.
router.post("/me/usage", authenticate, usageController.recordMyUsage);
// Aceptar la prueba cambia el plan de la tienda: no con la tienda bloqueada. Rechazarla o marcar la bienvenida como vista
// solo apaga avisos.
router.post("/me/trial/accept", authenticate, ownerWrite, vendorsController.acceptTrialOffer);
router.post("/me/trial/decline", authenticate, ownerAny, vendorsController.declineTrialOffer);
router.post("/me/trial/welcome-seen", authenticate, ownerAny, vendorsController.markTrialWelcomeSeen);
// Bloque 153 (pedido explícito — "los datos de la tienda no se pueden
// modificar después de estar verificadas sin aprobación del admin... en
// caso dado subir fotos del nuevo responsable y foto del ID"): fotos
// opcionales, mismo storage/middleware que ya usa el KYC de verificación.
router.post(
  "/me/change-request",
  authenticate,
  ownerAny,
  kycUpload.fields([{ name: "newOwnerSelfie", maxCount: 1 }, { name: "newOwnerIdPhoto", maxCount: 1 }]),
  vendorsController.requestVendorChange
);
router.get("/me/change-request", authenticate, ownerAny, vendorsController.getMyChangeRequest);
router.get("/change-request/:id/file/:type", authenticate, vendorsController.getVendorChangeRequestFile);
// Bloque 183: sección "resumen" (dashboard).
router.get("/me/dashboard", authenticate, requireVendorAccess("resumen"), vendorsController.getDashboard);
// Calificación de la tienda y las reseñas que la bajan (inicio del panel).
router.get("/me/rating", authenticate, requireVendorAccess("resumen"), vendorsController.getMyRating);
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
router.get("/me/dashboard/insights", authenticate, requireVendorAccess("resumen"), vendorsController.getDashboardInsights);
// Bloque 246: asistente de negocio (solo lectura). Solo el dueño (nunca un usuario de sistema), de cualquier tienda: desde
// los Bloques 259 y 276 ya no pide verificación ni plan de pago. Una tienda sin plan de pago activo tiene un tope diario de
// mensajes (freeAssistantDailyLimit, configurable en el admin; ver freeQuota en businessAssistant.controller.js). Con la
// tienda bloqueada no se abre: lee los datos del negocio y gasta IA.
router.get("/me/assistant", authenticate, ownerWrite, businessAssistantController.getVendorAssistant);
router.post("/me/assistant", authenticate, ownerWrite, assistantRateLimit, businessAssistantController.askVendorAssistant);
router.get("/me/assistant/conversations/:id", authenticate, ownerWrite, businessAssistantController.openVendorConversation);
router.delete("/me/assistant/conversations/:id", authenticate, ownerWrite, businessAssistantController.deleteVendorConversation);
router.delete("/me/assistant", authenticate, ownerWrite, businessAssistantController.clearVendorAssistant);
// Horarios/cobertura/entrega — datos de identidad del negocio, nunca
// delegables a un usuario de sistema (quedan owner/admin-only a propósito).
router.patch("/me/schedule", authenticate, ownerWrite, vendorsController.updateSchedule);
// Bloque 183: sección "mensajes".
router.get("/me/messages", authenticate, requireVendorAccess("mensajes"), vendorsController.getMyMessages);
router.post("/me/messages", authenticate, requireVendorWrite("mensajes"), vendorsController.sendMyMessage);
router.patch("/me/messages/read", authenticate, requireVendorWrite("mensajes"), vendorsController.markMyMessagesRead);
// Bloque 183: sin sección — la campanita de notificaciones es global.
router.get("/me/notifications", authenticate, requireVendorAccess(), vendorsController.listMyNotifications);
router.patch("/me/notifications/read", authenticate, requireVendorAccess(), vendorsController.markMyNotificationsRead);
router.patch("/me/notifications/resolve-all", authenticate, requireVendorAccess(), vendorsController.resolveAllMyNotifications);
router.patch("/me/notifications/:id/resolve", authenticate, requireVendorAccess(), vendorsController.resolveMyNotification);
// Clientes de la tienda (registro creado con cada pedido).
router.get("/me/customers", authenticate, requireVendorAccess("clientes"), vendorCustomersController.listMyCustomers);
router.get("/me/customers/:id", authenticate, requireVendorAccess("clientes"), vendorCustomersController.getMyCustomer);
router.patch("/me/customers/:id", authenticate, requireVendorWrite("clientes"), vendorCustomersController.updateMyCustomer);
router.post("/me/delivery-countries", authenticate, ownerWrite, vendorsController.addMyDeliveryCountry);
router.delete("/me/delivery-countries/:countryId", authenticate, ownerWrite, vendorsController.removeMyDeliveryCountry);
router.post("/me/locations", authenticate, ownerWrite, vendorsController.addMyLocation);
router.post("/me/locations/sync-province", authenticate, ownerWrite, vendorsController.syncProvinceLocations);
router.delete("/me/locations/:id", authenticate, ownerWrite, vendorsController.removeMyLocation);
// Bloque 183: sección "resenas".
router.get("/me/reviews", authenticate, requireVendorAccess("resenas"), reviewsController.listMyReviews);
router.patch("/me/reviews/:id/reply", authenticate, requireVendorWrite("resenas"), reviewsController.replyToReview);
router.post("/me/ai-document", authenticate, ownerWrite, vendorAiDocUpload.single("document"), vendorsController.uploadAiDocument);
router.delete("/me/ai-document", authenticate, ownerWrite, vendorsController.removeAiDocument);
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
router.post("/:vendorId/chat", chatRateLimit, streamable(chatController.postChatMessage));
// "Ver más" de la tienda pública: páginas siguientes de productos. Va antes de "/:slug" y con la caché corta del resto
// del catálogo (la clave es la URL completa, así que page y rankSeed dan entradas distintas).
router.get("/:slug/products", publicCache(20_000), vendorsController.listVendorProducts);
router.post("/:id/track-view", vendorsController.trackStoreView);
router.get("/:slug", vendorsController.getVendorBySlug);

export default router;
