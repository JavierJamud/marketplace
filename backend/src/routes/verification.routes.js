import { Router } from "express";
import * as verificationController from "../controllers/verification.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { kycUpload } from "../middleware/kycUpload.js";

const router = Router();

router.get("/me", authenticate, requireRole("VENDOR", "ADMIN"), verificationController.getMyVerification);
router.post(
  "/me",
  authenticate,
  requireRole("VENDOR", "ADMIN"),
  // Bloque 146: selfieVideo es opcional (maxCount 1, no falla si no llega
  // — ver submitVerification) — video corto de liveness capturado junto
  // con la selfie cuando el navegador soporta detección de rostro.
  kycUpload.fields([{ name: "selfie", maxCount: 1 }, { name: "idDocument", maxCount: 1 }, { name: "selfieVideo", maxCount: 1 }]),
  verificationController.submitVerification
);
router.patch("/me/payment-method", authenticate, requireRole("VENDOR"), verificationController.chooseMyPaymentMethod);
// Bloque 25: "reintentar" — el link de Stripe anterior venció o el
// vendedor abandonó el pago, genera un Checkout Session nuevo.
router.post("/me/stripe-checkout/retry", authenticate, requireRole("VENDOR"), verificationController.retryMyStripeCheckout);
router.post(
  "/me/payment-proof",
  authenticate,
  requireRole("VENDOR"),
  kycUpload.single("proof"),
  verificationController.uploadMyPaymentProof
);
// Documento privado — solo dueño de la tienda o admin (nunca URL pública).
router.get("/:vendorId/file/:type", authenticate, verificationController.getVerificationFile);

// Bloque 153 (pedido explícito — "una vez verificado, en la sección de
// suscripción podrá... activar un nuevo mes o varios"): renovación mientras
// la tienda YA está VERIFIED — mismo patrón que el ciclo inicial de arriba,
// sobre SubscriptionPayment en vez de VerificationRequest.
router.get("/me/subscription", authenticate, requireRole("VENDOR", "ADMIN"), verificationController.getMySubscription);
router.patch("/me/subscription/payment-method", authenticate, requireRole("VENDOR"), verificationController.chooseMyRenewalPayment);
router.post("/me/subscription/stripe-checkout/retry", authenticate, requireRole("VENDOR"), verificationController.retryRenewalStripeCheckout);
router.post(
  "/me/subscription/payment-proof",
  authenticate,
  requireRole("VENDOR"),
  kycUpload.single("proof"),
  verificationController.claimRenewalPayment
);
router.get("/subscription-payment/:id/file", authenticate, verificationController.getSubscriptionPaymentFile);

export default router;
