import { Router } from "express";
import * as authController from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.js";
import { loginRateLimit, passwordResetRateLimit, registerRateLimit } from "../middleware/rateLimit.js";

const router = Router();

router.post("/register", registerRateLimit, authController.register);
// Bloque 59: segundo paso del registro (código de 6 dígitos por correo) —
// mismo rate limit que el resto de los endpoints de "código de 6 dígitos"
// (nunca el de /register, ese está pensado para spam de creación de cuentas,
// no para adivinar un código).
router.post("/verify-registration", passwordResetRateLimit, authController.verifyRegistration);
router.post("/login", loginRateLimit, authController.login);
router.post("/refresh", authController.refresh);
// Bloque 60: mismo criterio que /refresh (el propio refresh token ES la
// credencial, no exige `authenticate`) — así funciona incluso si el access
// token ya venció al momento de cerrar sesión.
router.post("/logout", authController.logout);
// "Cerrar sesión en todos los dispositivos" (VendorProfile.jsx) — acción
// privilegiada de la propia cuenta, sí exige sesión activa.
router.post("/logout-all", authenticate, passwordResetRateLimit, authController.logoutAllDevices);
router.get("/me", authenticate, authController.me);

// Reset de contraseña — mismo flujo para los 3 roles (cliente/vendedor/admin
// comparten la tabla User).
router.post("/forgot-password", passwordResetRateLimit, authController.forgotPassword);
router.post("/verify-reset-code", passwordResetRateLimit, authController.verifyResetCode);
router.post("/reset-password", passwordResetRateLimit, authController.resetPassword);

// Bloque 47/60: segundo paso del login — código de 6 dígitos obligatorio
// salvo que el navegador ya sea un dispositivo de confianza vigente (ver
// login() en auth.controller.js) — mismo rate limit que el resto de los
// endpoints de "código de 6 dígitos".
router.post("/2fa/verify", passwordResetRateLimit, authController.verifyTwoFactorLogin);

// Perfil propio — genéricos por rol (AdminProfile.jsx, VendorProfile.jsx y
// CustomerPanel.jsx pegan a los mismos endpoints, ver auth.controller.js).
// Bloque 71 (pedido explícito): cambiar de correo pasa a 2 pasos — pide un
// código al correo VIEJO antes de aplicar el cambio; mismo rate limit que el
// resto de los endpoints de "código por correo" (evita fuerza bruta del código).
router.post("/me/email/request-code", authenticate, passwordResetRateLimit, authController.requestMyEmailChange);
router.post("/me/email/confirm", authenticate, passwordResetRateLimit, authController.confirmMyEmailChange);
router.patch("/me/password", authenticate, authController.updateMyPassword);

// Bloque 211 (pedido explícito — auto-eliminación de cuenta, cliente/
// vendedor/personal, 30 días de gracia): pedir la baja re-verifica la
// contraseña en el body, mismo rate limit que el resto de acciones
// sensibles de la propia cuenta; reactivar no pide contraseña de nuevo (ya
// alcanza con tener una sesión activa dentro del período de gracia).
router.post("/delete-account", authenticate, passwordResetRateLimit, authController.requestAccountDeletion);
router.post("/reactivate-account", authenticate, authController.cancelAccountDeletion);

export default router;
