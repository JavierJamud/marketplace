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

export default router;
