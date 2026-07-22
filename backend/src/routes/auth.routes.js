import { Router } from "express";
import * as authController from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.js";
import { loginRateLimit, passwordResetRateLimit } from "../middleware/rateLimit.js";

const router = Router();

router.post("/register", authController.register);
router.post("/login", loginRateLimit, authController.login);
router.post("/refresh", authController.refresh);
router.get("/me", authenticate, authController.me);

// Reset de contraseña — mismo flujo para los 3 roles (cliente/vendedor/admin
// comparten la tabla User).
router.post("/forgot-password", passwordResetRateLimit, authController.forgotPassword);
router.post("/verify-reset-code", passwordResetRateLimit, authController.verifyResetCode);
router.post("/reset-password", passwordResetRateLimit, authController.resetPassword);

// Bloque 47: segundo paso del login cuando el usuario activó 2FA — mismo
// rate limit que el resto de los endpoints de "código de 6 dígitos".
router.post("/2fa/verify", passwordResetRateLimit, authController.verifyTwoFactorLogin);

// Perfil propio — genéricos por rol (AdminProfile.jsx y VendorProfile.jsx
// pegan a los mismos dos endpoints, ver auth.controller.js).
router.patch("/me/email", authenticate, authController.updateMyEmail);
router.patch("/me/password", authenticate, authController.updateMyPassword);
router.patch("/me/2fa", authenticate, authController.updateMyTwoFactor);

export default router;
