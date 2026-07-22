import rateLimit from "express-rate-limit";

// Límites generosos: pensados para que el entorno de prueba local no se caiga
// con scripts o refrescos rápidos, NO son límites de producción (eso se
// ajusta recién cuando haya plan real de deploy al VPS).
export const loginRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos de inicio de sesión. Probá de nuevo en unos minutos." },
});

export const ordersRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados pedidos en poco tiempo. Probá de nuevo en unos minutos." },
});

// Cubre forgot-password / verify-reset-code / reset-password — generoso para
// no entorpecer pruebas manuales (varios intentos de código típico), pero
// evita que un script fuerce bruto los 6 dígitos del código.
export const passwordResetRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Probá de nuevo en unos minutos." },
});

// Bloque 21: el chat pega contra la API de Gemini (paga, key del admin) en
// un endpoint sin login — sin este límite, cualquiera podría hacer un
// script que la vacíe de crédito. Generoso para probar una charla real, no
// para un bucle automático.
export const chatRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados mensajes seguidos. Esperá un minuto y probá de nuevo." },
});

// Bloque 48: /contacto es público sin login y manda un correo real por
// cada envío (cuota de Resend + bandeja del admin) — evita que un script
// la sature, sin entorpecer a alguien escribiendo el formulario a mano.
export const contactRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados mensajes seguidos. Probá de nuevo en unos minutos." },
});
