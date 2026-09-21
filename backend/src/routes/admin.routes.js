import { Router } from "express";
import * as adminController from "../controllers/admin.controller.js";
import * as announcementsController from "../controllers/announcements.controller.js";
import * as campaignsController from "../controllers/campaigns.controller.js";
import * as integrationsController from "../controllers/integrations.controller.js";
import * as settingsController from "../controllers/settings.controller.js";
import * as suggestionsController from "../controllers/suggestions.controller.js";
import * as locationsController from "../controllers/locations.controller.js";
import * as businessCategoriesController from "../controllers/businessCategories.controller.js";
import * as reviewsController from "../controllers/reviews.controller.js";
import * as errorLogsController from "../controllers/errorLogs.controller.js";
import * as chatTrainingController from "../controllers/chatTraining.controller.js";
import * as staticPagesController from "../controllers/staticPages.controller.js";
import * as faqController from "../controllers/faq.controller.js";
import * as discountCodesController from "../controllers/discountCodes.controller.js";
import * as storeOffersController from "../controllers/storeOffers.controller.js";
import * as adminOffersController from "../controllers/adminOffers.controller.js";
import * as adminProductsController from "../controllers/adminProducts.controller.js";
import * as adminCustomerListingsController from "../controllers/adminCustomerListings.controller.js";
import * as adminReportsController from "../controllers/adminReports.controller.js";
import * as verificationArchiveController from "../controllers/verificationArchive.controller.js";
import * as targetedOffersController from "../controllers/targetedOffers.controller.js";
import * as adminVendorStaffSalesController from "../controllers/adminVendorStaffSales.controller.js";
import * as adminRankingAnomaliesController from "../controllers/adminRankingAnomalies.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { siteUpload } from "../middleware/siteUpload.js";
import { offerUpload } from "../middleware/offerUpload.js";

const router = Router();

// Todo el módulo admin exige rol ADMIN (rechaza 403 a vendedor/cliente).
router.use(authenticate, requireRole("ADMIN"));

router.get("/dashboard", adminController.getDashboard);

router.get("/vendors", adminController.listVendors);
router.patch("/vendors/:id", adminController.updateVendor);
// Bloque 165: acciones de cuenta directas desde el admin — contraseña y
// correo de LOGIN del vendedor (distinto de Vendor.email, ya cubierto por
// updateVendor de arriba).
router.post("/vendors/:id/reset-password", adminController.resetVendorPassword);
router.patch("/vendors/:id/login-email", adminController.updateVendorLoginEmail);
router.delete("/vendors/:id", adminController.deleteVendor);
router.get("/vendors/:id/stats", adminController.getVendorStats);
router.get("/vendors/:id/table-orders", adminController.getVendorTableOrders);

// Bloque 183 (pedido explícito — "el administrador general del sistema
// también puede controlar y verificar lo mismo que pueda hacer el
// vendedor... poder verificar cuáles son los usuarios que ha creado ese
// vendedor"): mismas capacidades de vendorStaff.routes.js, tomando el
// vendorId/staffId de la URL en vez de resolverlo del propio dueño.
router.get("/vendors/:id/staff", adminController.listVendorStaff);
router.patch("/vendor-staff/:id", adminController.updateVendorStaffByAdmin);
router.post("/vendor-staff/:id/reset-password", adminController.resetVendorStaffPasswordByAdmin);
router.get("/vendor-staff/:id/activity", adminController.getVendorStaffActivityByAdmin);
router.get("/vendor-staff/:id/sessions", adminController.getVendorStaffSessionsByAdmin);

// Bloque 62: suspensión automática por inactividad (vendorLifecycle.job.js)
// + reactivación manual con motivo obligatorio.
router.get("/vendors/suspended", adminController.listSuspendedVendors);
router.post("/vendors/:id/reactivate", adminController.reactivateVendor);

// Venta rápida: qué clientes SIN tienda tienen anuncios activos, agrupado
// por dueño (pedido explícito).
router.get("/customer-listings", adminCustomerListingsController.listCustomerListingsByOwner);
router.patch("/customer-listings/:id", adminCustomerListingsController.updateAdminCustomerListing);
router.delete("/customer-listings/:id", adminCustomerListingsController.deleteAdminCustomerListing);

// Feature B: reportes de fraude sobre producto/tienda/venta rápida. Rutas
// literales ("pending-count") ANTES de ":id/..." — mismo criterio que
// locations/countries/activate-all de arriba.
router.get("/reports/pending-count", adminReportsController.getFraudReportsPendingCount);
router.get("/reports", adminReportsController.listFraudReports);
router.post("/reports/:id/request-evidence", adminReportsController.requestEvidence);
router.post("/reports/:id/dismiss", adminReportsController.dismissFraudReport);
router.post("/reports/:id/resolve", adminReportsController.resolveFraudReport);

// Bloque 229 (Fase 2 del blindaje del ranking — pedido explícito): cola de
// anomalías detectadas por reviewAnomaly.job.js/clickAnomaly.job.js. Mismo
// patrón de rutas que /reports de arriba (pending-count literal primero).
router.get("/ranking-anomalies/pending-count", adminRankingAnomaliesController.getRankingAnomaliesPendingCount);
router.get("/ranking-anomalies", adminRankingAnomaliesController.listRankingAnomalies);
router.post("/ranking-anomalies/:id/dismiss", adminRankingAnomaliesController.dismissRankingAnomaly);
router.post("/ranking-anomalies/:id/action", adminRankingAnomaliesController.actionRankingAnomaly);

// Bloque 52: supervisión/edición de productos de cualquier vendedor.
router.get("/products", adminProductsController.listAllProducts);
router.patch("/products/:id", adminProductsController.updateAdminProduct);
router.delete("/products/:id", adminProductsController.deleteAdminProduct);

// Bloque 198: supervisión/edición de ventas manuales (usuarios de sistema)
// de cualquier vendedor.
router.get("/vendor-staff-sales", adminVendorStaffSalesController.listAllStaffSales);
router.get("/vendor-staff-sales/vendors", adminVendorStaffSalesController.listVendorsWithStaffSales);
router.patch("/vendor-staff-sales/:id", adminVendorStaffSalesController.updateStaffSale);
router.delete("/vendor-staff-sales/:id", adminVendorStaffSalesController.deleteStaffSale);

router.get("/verifications", adminController.listVerifications);
router.patch("/verifications/:id", adminController.updateVerification);
router.patch("/verifications/:id/confirm-payment", adminController.confirmSubscriptionPayment);
// Bloque 151 (pedido explícito): "restablecerlo para que él pueda
// seleccionar otro diferente" — limpia el método elegido, el vendedor
// vuelve a ver el selector desde su panel.
router.patch("/verifications/:id/reset-payment-method", adminController.resetVerificationPaymentMethod);
// Bloque 64: "abrir para revisar" — PENDING_DOCS -> IN_REVIEW.
router.post("/verifications/:id/start-review", adminController.startVerificationReview);

// Bloque 72 (pedido explícito): archivo permanente de la documentación de
// verificación por tienda — las ramas las crea sola
// transitionVendorVerification() al llegar a VERIFIED, acá solo viven
// consulta/edición/borrado (gateado — ver deleteVerificationArchive).
router.get("/vendors/:vendorId/verification-archive", verificationArchiveController.listVerificationArchive);
router.patch("/verification-archive/:id", verificationArchiveController.updateVerificationArchive);
router.delete("/verification-archive/:id", verificationArchiveController.deleteVerificationArchive);
router.get("/verification-archive/:id/file/:type", verificationArchiveController.getVerificationArchiveFile);

// Bloque 46: Suscripciones Business — solo lectura + revocar, nunca genera
// un link de pago nuevo (eso lo sigue haciendo únicamente el propio
// vendedor, ver retryMyStripeCheckout en verification.routes.js).
router.get("/subscriptions", adminController.listSubscriptions);
router.post("/vendors/:id/revoke-business", adminController.revokeBusinessPlan);

// Bloque 153 (pedido explícito — "el admin debe aprobar los demás meses
// pagos"): renovaciones de suscripción mientras la tienda ya está VERIFIED.
router.get("/subscription-payments/pending", adminController.listPendingSubscriptionPayments);
router.patch("/subscription-payments/:id/confirm", adminController.confirmSubscriptionRenewal);

// Bloque 153 (pedido explícito — "si se desea cambiar el nombre o algo o
// responsable se debe enviar la solicitud al admin para prevenir fraudes").
router.get("/change-requests", adminController.listVendorChangeRequests);
router.patch("/change-requests/:id", adminController.decideVendorChangeRequest);

router.get("/customers", adminController.listCustomers);
router.patch("/customers/:id", adminController.updateCustomer);
router.delete("/customers/:id", adminController.deleteCustomer);

// Bloque 47: barra de búsqueda + campana del panel admin, y correo directo
// puntual (distinto del envío masivo de /campaigns).
router.get("/search", adminController.adminSearch);
router.get("/notifications", adminController.listAdminNotifications);
router.post("/emails", adminController.sendAdminEmail);

// Bloque 70 (pedido explícito): historial de acciones de vendedores/clientes
// + estadísticas de uso (top vendedores/clientes por día/semana/mes).
router.get("/activity-log", adminController.listActivityLog);
router.get("/activity-log/stats", adminController.getActivityStats);

router.get("/suggestions", suggestionsController.listSuggestions);
router.patch("/suggestions/:id", suggestionsController.updateSuggestion);

router.get("/messages", adminController.listConversations);
router.get("/messages/:vendorId", adminController.getConversation);
router.post("/messages/:vendorId", adminController.sendConversationMessage);
router.patch("/messages/:vendorId/read", adminController.markConversationRead);

router.get("/campaigns", campaignsController.listCampaigns);
router.post("/campaigns", siteUpload.single("image"), campaignsController.createCampaign);
router.patch("/campaigns/:id", siteUpload.single("image"), campaignsController.updateCampaign);
router.post("/campaigns/:id/resend", campaignsController.resendCampaign);
router.delete("/campaigns/:id", campaignsController.deleteCampaign);

router.get("/integrations", integrationsController.listIntegrations);
router.post("/integrations", integrationsController.upsertIntegration);
router.post("/integrations/stripe", integrationsController.upsertStripeIntegration);
// Bloque 44: modelos reales que la key guardada de este proveedor puede
// usar — lista seleccionable en AdminIntegrations.jsx en vez de texto
// libre (evita typos como el que tumbó Groq con 404 model_not_found).
router.get("/integrations/:name/models", integrationsController.listProviderModels);
// Bloque 86: manda un correo de prueba real (a la cuenta del propio admin)
// con la clave de Resend ya guardada — mismo criterio de "probar contra la
// API real" que /integrations/:name/models de arriba usa para los
// proveedores de IA.
router.post("/integrations/resend/test", integrationsController.testResendIntegration);
// Bloque 90: mismo botón "Probar" pero para Gemini/Groq/NVIDIA — llama al
// modelo real configurado con un prompt trivial. Ruta literal de Resend
// arriba SIEMPRE se declara primero: Express prueba las rutas en el orden
// en que se registran, así que "/integrations/resend/test" nunca cae en
// este :name genérico aunque calce con el patrón.
router.post("/integrations/:name/test-ai", integrationsController.testAiProviderIntegration);
router.patch("/integrations/:id", integrationsController.toggleIntegration);

router.get("/locations/countries", locationsController.listCountries);
router.post("/locations/countries", locationsController.createCountry);
// Rutas literales ANTES de la de :id — si no, Express matchea "activate-all"
// como si fuera un id y nunca llega a esta acción.
router.patch("/locations/countries/activate-all", locationsController.activateAllCountries);
router.patch("/locations/countries/deactivate-all", locationsController.deactivateAllCountries);
router.delete("/locations/countries/bulk", locationsController.bulkDeleteCountries);
router.patch("/locations/countries/:id", locationsController.updateCountry);
router.delete("/locations/countries/:id", locationsController.deleteCountry);
router.get("/locations/provinces", locationsController.listProvincesForAdmin);
router.post("/locations/provinces", locationsController.createProvince);
router.patch("/locations/provinces/:id", locationsController.updateProvince);
router.delete("/locations/provinces/:id", locationsController.deleteProvince);
router.get("/locations/provinces/:provinceId/municipalities", locationsController.listMunicipalitiesForAdmin);
router.post("/locations/provinces/:provinceId/municipalities", locationsController.createMunicipality);
router.patch("/locations/municipalities/:id", locationsController.updateMunicipality);
router.delete("/locations/municipalities/:id", locationsController.deleteMunicipality);
router.get("/business-categories", businessCategoriesController.listBusinessCategoriesAdmin);
router.post("/business-categories", businessCategoriesController.createBusinessCategory);
router.patch("/business-categories/:id", businessCategoriesController.updateBusinessCategory);
router.delete("/business-categories/:id", businessCategoriesController.deleteBusinessCategory);

// Bloque 96: slider de varias imágenes en el hero — agregar (una o varias
// juntas) y quitar una puntual, mismo patrón que /products/:id/images.
router.post("/settings/hero-images", siteUpload.array("images", 6), settingsController.addHeroImages);
router.delete("/settings/hero-images", settingsController.removeHeroImage);
router.patch("/settings/plan-limits", settingsController.updatePlanLimits);
router.patch("/settings/plan-features", settingsController.updatePlanFeatures);
router.patch("/settings/product-settings", settingsController.updateProductSettings);
router.patch("/settings/offer-policy", settingsController.updateOfferPolicy);
router.patch("/settings/store-offer-policy", settingsController.updateStoreOfferPolicy);
router.patch("/settings/review-policy", settingsController.updateReviewPolicy);
router.patch("/settings/chat-widget", settingsController.updateChatWidgetSettings);
router.patch("/settings/product-payment-methods", settingsController.updateProductPaymentMethods);
router.patch("/settings/branding", settingsController.updateBranding);
router.post("/settings/branding/logo", siteUpload.single("logo"), settingsController.updateBrandingLogo);
router.patch("/settings/cup-payment", settingsController.updateCupPaymentSettings);
router.patch("/settings/available-currencies", settingsController.updateAvailableCurrencies);
router.patch("/settings/product-badges", settingsController.updateProductBadgeSettings);

// Bloque 46: anuncios programados (banners públicos) — mismo mecanismo de
// subida que hero-image arriba (siteUpload), imagen opcional.
router.get("/announcements", announcementsController.listAnnouncementsAdmin);
router.post("/announcements", siteUpload.single("image"), announcementsController.createAnnouncement);
router.patch("/announcements/:id", siteUpload.single("image"), announcementsController.updateAnnouncement);
router.delete("/announcements/:id", announcementsController.deleteAnnouncement);

// Bloque 43: modelo editable por proveedor de IA (AdminIntegrations.jsx).
router.get("/settings/ai-models", settingsController.getAiModelSettings);
router.patch("/settings/ai-models", settingsController.updateAiModels);

// Bloque 48: páginas legales/ayuda editables (AdminPages.jsx, AdminContacto.jsx, AdminAyuda.jsx).
router.get("/static-pages", staticPagesController.listStaticPagesAdmin);
router.put("/static-pages/:slug", staticPagesController.updateStaticPage);

// Bloque 53: preguntas frecuentes — sección propia, separada de "Páginas".
router.get("/faq", faqController.listAdminFaqs);
router.post("/faq", faqController.createFaq);
router.patch("/faq/:id", faqController.updateFaq);
router.delete("/faq/:id", faqController.deleteFaq);

// Auditoría de seguridad: el admin no tenía ninguna supervisión sobre
// códigos de descuento ni ofertas de tienda de los vendedores (Bloque 52) —
// mismas reglas que ya aplica el propio vendedor (activar/desactivar
// siempre permitido; eliminar un código solo si nunca se usó), solo que
// sobre CUALQUIER vendedor, sin tener que entrar a Prisma Studio.
router.get("/discount-codes", discountCodesController.listAllDiscountCodesAdmin);
router.patch("/discount-codes/:id/active", discountCodesController.setDiscountCodeActiveAdmin);
router.delete("/discount-codes/:id", discountCodesController.deleteDiscountCodeAdmin);
router.get("/store-offers", storeOffersController.listAllStoreOffersAdmin);
router.patch("/store-offers/:id/active", storeOffersController.setStoreOfferActiveAdmin);

// Bloque 22: moderación de comentarios — el vendedor no tiene acceso a
// ninguna de estas tres (ver vendors.routes.js para lo que sí puede: listar
// los suyos y responder).
router.get("/reviews", reviewsController.listAllReviews);
router.patch("/reviews/:id/hidden", reviewsController.setReviewHidden);
router.patch("/reviews/:id/resolve-report", reviewsController.resolveReviewReport);
router.delete("/reviews/:id", reviewsController.deleteReview);

// Bloque 33: rutas literales ANTES de ":id/resolve" no hacen falta acá (no
// hay colisión con "unresolved-count", que es un path fijo distinto).
router.get("/errors", errorLogsController.listErrorLogs);
router.get("/errors/unresolved-count", errorLogsController.getUnresolvedErrorCount);
router.patch("/errors/:id/resolve", errorLogsController.resolveErrorLog);

// Bloque 51: sección "Ofertas" del panel admin — a diferencia de
// offers.routes.js (vendedor), acá se permite contentType HTML y moderar
// cualquier oferta (propia o de un vendedor).
router.get("/offers", adminOffersController.listAllOffers);
router.post("/offers", offerUpload.single("image"), adminOffersController.createAdminOffer);
router.patch("/offers/:id", offerUpload.single("image"), adminOffersController.updateAdminOffer);
router.delete("/offers/:id", adminOffersController.deleteAdminOffer);

// Bloque 194 (pedido explícito — "ofertas autodirigidas... para clientes o
// para vendedores... por email o... popup, o ambas... a vendedores en
// específico"): montadas acá mismo, junto a /offers y /campaigns de
// arriba (mismo criterio — sin router propio para el lado admin), con
// siteUpload para la imagen opcional (mismo middleware que /campaigns).
router.get("/targeted-offers", targetedOffersController.listAdminTargetedOffers);
router.post("/targeted-offers", siteUpload.single("image"), targetedOffersController.createTargetedOffer);
router.patch("/targeted-offers/:id", siteUpload.single("image"), targetedOffersController.updateTargetedOffer);
router.post("/targeted-offers/:id/resend-email", targetedOffersController.resendTargetedOfferEmail);
router.delete("/targeted-offers/:id", targetedOffersController.deleteTargetedOffer);

// Bloque 37: revisión de conversaciones reales + ejemplos curados de
// entrenamiento (ver chatTraining.controller.js).
router.get("/chat-review/conversations", chatTrainingController.listRecentConversations);
router.get("/chat-review/examples", chatTrainingController.listTrainingExamples);
router.post("/chat-review/examples", chatTrainingController.createTrainingExample);
router.patch("/chat-review/examples/:id", chatTrainingController.toggleTrainingExample);
router.delete("/chat-review/examples/:id", chatTrainingController.deleteTrainingExample);

export default router;
