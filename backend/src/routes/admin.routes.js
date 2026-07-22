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
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { siteUpload } from "../middleware/siteUpload.js";

const router = Router();

// Todo el módulo admin exige rol ADMIN (rechaza 403 a vendedor/cliente).
router.use(authenticate, requireRole("ADMIN"));

router.get("/dashboard", adminController.getDashboard);

router.get("/vendors", adminController.listVendors);
router.patch("/vendors/:id", adminController.updateVendor);
router.delete("/vendors/:id", adminController.deleteVendor);
router.get("/vendors/:id/stats", adminController.getVendorStats);

router.get("/verifications", adminController.listVerifications);
router.patch("/verifications/:id", adminController.updateVerification);
router.patch("/verifications/:id/confirm-payment", adminController.confirmCupPayment);

// Bloque 46: Suscripciones Business — solo lectura + revocar, nunca genera
// un link de pago nuevo (eso lo sigue haciendo únicamente el propio
// vendedor, ver retryMyStripeCheckout en verification.routes.js).
router.get("/subscriptions", adminController.listSubscriptions);
router.post("/vendors/:id/revoke-business", adminController.revokeBusinessPlan);

router.get("/customers", adminController.listCustomers);
router.patch("/customers/:id", adminController.updateCustomer);
router.delete("/customers/:id", adminController.deleteCustomer);

// Bloque 47: barra de búsqueda + campana del panel admin, y correo directo
// puntual (distinto del envío masivo de /campaigns).
router.get("/search", adminController.adminSearch);
router.get("/notifications", adminController.listAdminNotifications);
router.post("/emails", adminController.sendAdminEmail);

router.get("/suggestions", suggestionsController.listSuggestions);
router.patch("/suggestions/:id", suggestionsController.updateSuggestion);

router.get("/messages", adminController.listConversations);
router.get("/messages/:vendorId", adminController.getConversation);
router.post("/messages/:vendorId", adminController.sendConversationMessage);
router.patch("/messages/:vendorId/read", adminController.markConversationRead);

router.get("/campaigns", campaignsController.listCampaigns);
router.post("/campaigns", campaignsController.createCampaign);

router.get("/integrations", integrationsController.listIntegrations);
router.post("/integrations", integrationsController.upsertIntegration);
router.post("/integrations/stripe", integrationsController.upsertStripeIntegration);
// Bloque 44: modelos reales que la key guardada de este proveedor puede
// usar — lista seleccionable en AdminIntegrations.jsx en vez de texto
// libre (evita typos como el que tumbó Groq con 404 model_not_found).
router.get("/integrations/:name/models", integrationsController.listProviderModels);
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

router.post("/settings/hero-image", siteUpload.single("image"), settingsController.updateHeroImage);
router.patch("/settings/plan-limits", settingsController.updatePlanLimits);

// Bloque 46: anuncios programados (banners públicos) — mismo mecanismo de
// subida que hero-image arriba (siteUpload), imagen opcional.
router.get("/announcements", announcementsController.listAnnouncementsAdmin);
router.post("/announcements", siteUpload.single("image"), announcementsController.createAnnouncement);
router.patch("/announcements/:id", siteUpload.single("image"), announcementsController.updateAnnouncement);
router.delete("/announcements/:id", announcementsController.deleteAnnouncement);

// Bloque 43: modelo editable por proveedor de IA (AdminIntegrations.jsx).
router.get("/settings/ai-models", settingsController.getAiModelSettings);
router.patch("/settings/ai-models", settingsController.updateAiModels);

// Bloque 22: moderación de comentarios — el vendedor no tiene acceso a
// ninguna de estas tres (ver vendors.routes.js para lo que sí puede: listar
// los suyos y responder).
router.get("/reviews", reviewsController.listAllReviews);
router.patch("/reviews/:id/hidden", reviewsController.setReviewHidden);
router.delete("/reviews/:id", reviewsController.deleteReview);

// Bloque 33: rutas literales ANTES de ":id/resolve" no hacen falta acá (no
// hay colisión con "unresolved-count", que es un path fijo distinto).
router.get("/errors", errorLogsController.listErrorLogs);
router.get("/errors/unresolved-count", errorLogsController.getUnresolvedErrorCount);
router.patch("/errors/:id/resolve", errorLogsController.resolveErrorLog);

// Bloque 37: revisión de conversaciones reales + ejemplos curados de
// entrenamiento (ver chatTraining.controller.js).
router.get("/chat-review/conversations", chatTrainingController.listRecentConversations);
router.get("/chat-review/examples", chatTrainingController.listTrainingExamples);
router.post("/chat-review/examples", chatTrainingController.createTrainingExample);
router.patch("/chat-review/examples/:id", chatTrainingController.toggleTrainingExample);
router.delete("/chat-review/examples/:id", chatTrainingController.deleteTrainingExample);

export default router;
