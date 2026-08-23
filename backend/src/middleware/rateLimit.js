import rateLimit from "express-rate-limit";

// Límites generosos: pensados para que el entorno de prueba local no se caiga
// con scripts o refrescos rápidos, NO son límites de producción (eso se
// ajusta recién cuando haya plan real de deploy al VPS).
export const loginRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos de inicio de sesión. Prueba de nuevo en unos minutos." },
});

// Auditoría de seguridad: /auth/register era el único endpoint de auth sin
// límite — sin esto, un script podía scriptear altas masivas de cuentas
// (spam de la tabla User, abuso del correo de bienvenida, etc.). Mismo
// criterio que loginRateLimit: generoso para no entorpecer pruebas manuales.
export const registerRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados registros desde este origen. Prueba de nuevo en unos minutos." },
});

export const ordersRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados pedidos en poco tiempo. Prueba de nuevo en unos minutos." },
});

// Cubre forgot-password / verify-reset-code / reset-password — generoso para
// no entorpecer pruebas manuales (varios intentos de código típico), pero
// evita que un script fuerce bruto los 6 dígitos del código.
export const passwordResetRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Prueba de nuevo en unos minutos." },
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
  message: { error: "Demasiados mensajes seguidos. Espera un minuto y prueba de nuevo." },
});

// Bloque 48: /contacto es público sin login y manda un correo real por
// cada envío (cuota de Resend + bandeja del admin) — evita que un script
// la sature, sin entorpecer a alguien escribiendo el formulario a mano.
export const contactRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados mensajes seguidos. Prueba de nuevo en unos minutos." },
});

// Feature B (pedido explícito): reportar fraude sube un archivo real y crea
// una fila que el admin tiene que revisar — mismo criterio que
// contactRateLimit (generoso para uso real, evita que un script sature la
// cola de reportes).
export const reportRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados reportes seguidos. Prueba de nuevo en unos minutos." },
});
