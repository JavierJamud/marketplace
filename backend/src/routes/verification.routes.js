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
  kycUpload.fields([{ name: "selfie", maxCount: 1 }, { name: "idDocument", maxCount: 1 }]),
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

export default router;
