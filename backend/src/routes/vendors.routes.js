import { Router } from "express";
import * as vendorsController from "../controllers/vendors.controller.js";
import * as reviewsController from "../controllers/reviews.controller.js";
import * as chatController from "../controllers/chat.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { vendorAiDocUpload } from "../middleware/vendorAiDocUpload.js";
import { chatRateLimit } from "../middleware/rateLimit.js";

const router = Router();

router.get("/", vendorsController.listVendors);
router.get("/me", authenticate, vendorsController.getMyVendor);
router.patch("/me", authenticate, vendorsController.updateMyVendor);
router.get("/me/dashboard", authenticate, vendorsController.getDashboard);
router.patch("/me/schedule", authenticate, vendorsController.updateSchedule);
router.get("/me/messages", authenticate, requireRole("VENDOR"), vendorsController.getMyMessages);
router.post("/me/messages", authenticate, requireRole("VENDOR"), vendorsController.sendMyMessage);
router.patch("/me/messages/read", authenticate, requireRole("VENDOR"), vendorsController.markMyMessagesRead);
router.get("/me/notifications", authenticate, requireRole("VENDOR"), vendorsController.listMyNotifications);
router.patch("/me/notifications/read", authenticate, requireRole("VENDOR"), vendorsController.markMyNotificationsRead);
router.post("/me/delivery-countries", authenticate, requireRole("VENDOR"), vendorsController.addMyDeliveryCountry);
router.delete("/me/delivery-countries/:countryId", authenticate, requireRole("VENDOR"), vendorsController.removeMyDeliveryCountry);
router.post("/me/locations", authenticate, requireRole("VENDOR"), vendorsController.addMyLocation);
router.post("/me/locations/sync-province", authenticate, requireRole("VENDOR"), vendorsController.syncProvinceLocations);
router.delete("/me/locations/:id", authenticate, requireRole("VENDOR"), vendorsController.removeMyLocation);
router.get("/me/reviews", authenticate, requireRole("VENDOR"), reviewsController.listMyReviews);
router.patch("/me/reviews/:id/reply", authenticate, requireRole("VENDOR"), reviewsController.replyToReview);
router.post("/me/ai-document", authenticate, requireRole("VENDOR"), vendorAiDocUpload.single("document"), vendorsController.uploadAiDocument);
router.delete("/me/ai-document", authenticate, requireRole("VENDOR"), vendorsController.removeAiDocument);
router.post("/", authenticate, vendorsController.createVendor);
router.post("/:id/engagement", authenticate, requireRole("CUSTOMER"), vendorsController.trackEngagement);
// Bloque 21: sin login (el widget de chat es público) — rutas literales
// antes de "/:slug" para que Express no matchee ":vendorId" como si fuera
// un slug de tienda.
router.get("/:vendorId/chat", chatController.getChatHistory);
router.post("/:vendorId/chat", chatRateLimit, chatController.postChatMessage);
router.get("/:slug", vendorsController.getVendorBySlug);

export default router;
