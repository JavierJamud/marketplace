import { app } from "./app.js";
import { env } from "./config/env.js";
import { logError } from "./lib/errorLog.js";
import { startVendorLifecycleJob } from "./jobs/vendorLifecycle.job.js";
import { startVerificationPaymentJob, startVerificationApprovalExpiryJob } from "./jobs/verificationPayment.job.js";
import { startCustomerListingExpiryJob } from "./jobs/customerListingExpiry.job.js";
import { startContentCleanupJob } from "./jobs/contentCleanup.job.js";
import { startFraudReportsJob } from "./jobs/fraudReports.job.js";
import { startAiHealthCheckJob } from "./jobs/aiHealthCheck.job.js";
import { startAiChatbotAvailabilityJob } from "./jobs/aiChatbotAvailability.job.js";
import { startLowStockJob } from "./jobs/lowStock.job.js";
import { startOrderOverdueJob } from "./jobs/orderOverdue.job.js";
import { startCustomerRemindersJob } from "./jobs/customerReminders.job.js";
import { startCashCloseReminderJob } from "./jobs/cashCloseReminder.job.js";
import { startAccountDeletionJob } from "./jobs/accountDeletion.job.js";
import { startVendorDeletionJob } from "./jobs/vendorDeletion.job.js";
import { startReviewAnomalyJob } from "./jobs/reviewAnomaly.job.js";
import { startClickAnomalyJob } from "./jobs/clickAnomaly.job.js";
import { startTrialExpiryJob } from "./jobs/trialExpiry.job.js";
import { startChatRetentionJob } from "./jobs/chatRetention.job.js";
import { startSupportTicketRetentionJob } from "./jobs/supportTicketRetention.job.js";
import { installNotifyHooks } from "./lib/notify.js";
import { startPartnerUsageFlusher } from "./lib/partnerUsage.js";

// En producción la API solo escucha dentro del servidor (Nginx la publica en /api); en desarrollo, en toda la red local.
const host = process.env.NODE_ENV === "production" ? "127.0.0.1" : undefined;
const server = app.listen(env.port, host, () => {
  console.log(`API escuchando en el puerto ${env.port}`);
});

// Nginx reutiliza conexiones con la API durante un rato: si Node las cierra antes (su valor por defecto es 5 s), a veces
// Nginx escribe en una conexión ya cerrada y la persona recibe un 502 suelto. Con un tiempo mayor eso no ocurre.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

// Apagado ordenado: al reiniciar (despliegue o reinicio del servidor) deja de aceptar conexiones nuevas, termina las
// peticiones que ya estaban en curso y recién entonces sale. Sin esto, PM2 cortaba de golpe y esas peticiones fallaban.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[servidor] ${signal}: cerrando de forma ordenada`);
  server.close(() => process.exit(0));
  server.closeIdleConnections?.();
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Red de seguridad: una promesa que falla sin que nadie la atienda (un envío de correo, un aviso que se lanza sin esperar) hacía caer
// el proceso entero de Node y la API quedaba unos segundos sin responder. Ahora se anota y el servicio sigue. Una excepción sin
// atrapar sí deja el proceso en un estado dudoso: se anota y se reinicia de forma ordenada.
process.on("unhandledRejection", (reason) => {
  console.error("[servidor] promesa rechazada sin atender:", reason instanceof Error ? reason.stack ?? reason.message : reason);
  logError({ origin: "OTRO", message: `Promesa rechazada sin atender: ${String(reason?.message ?? reason).slice(0, 300)}`, context: { stack: String(reason?.stack ?? "").slice(0, 1500) } }).catch(() => {});
});
process.on("uncaughtException", (err) => {
  console.error("[servidor] excepción sin atrapar:", err?.stack ?? err);
  logError({ origin: "OTRO", message: `Excepción sin atrapar: ${String(err?.message ?? err).slice(0, 300)}`, context: { stack: String(err?.stack ?? "").slice(0, 1500) } }).catch(() => {});
  shutdown("uncaughtException");
});

// Venta rápida de clientes: borra los anuncios vencidos a los 30 días (y sus
// archivos) — corre primero (7:00am) para no competir por conexión de DB con
// los otros dos crons diarios.
startCustomerListingExpiryJob();
startContentCleanupJob();
// Bloque 62: primer cron real del proyecto — recordatorio de inactividad,
// suspensión automática a los 90 días y re-enganche de clientes.
startVendorLifecycleJob();
// Bloque 64: segundo cron — recordatorio y vencimiento del cobro recurrente
// CUP de la verificación (Stripe se maneja solo, vía webhook).
startVerificationPaymentJob();
// Bloque 145: aparte del anterior (corre cada hora, no una vez al día) —
// vence la APROBACIÓN inicial de documentos si pasan 24h sin elegir método
// de pago ni completar el pago.
startVerificationApprovalExpiryJob();
// Feature B: recordatorio y vencimiento del plazo de evidencia de un
// reporte de fraude — 9:00am, después de los otros 3 crons diarios.
startFraudReportsJob();
// Bloque 85: tercer cron — verificación diaria de los proveedores de IA
// activos, a las 3:00am de la zona horaria configurada en Admin → Marca de
// la plataforma (corre cada hora y se autochequea por dentro, ver el
// archivo — nunca una hora fija capturada al arrancar el servidor).
startAiHealthCheckJob();
// Bloque 238 (pedido explícito — "verificar en segundo plano antes de
// mostrar el chatbot, cada vez que se accede al sitio"): a diferencia del
// anterior (profundo, una vez al día), este corre cada 2 minutos y es
// liviano — decide casi en tiempo real si el chat se muestra o no, sin que
// un cliente dispare nunca una prueba de IA con solo visitar la página.
startAiChatbotAvailabilityJob();
// Bloque 194 (pedido explícito — "notificación por correo... sobre bajo
// stock en productos antes que se agoten"): 7:30am, entre el recordatorio
// de inactividad (7:00) y el de pago (8:00).
startLowStockJob();
startOrderOverdueJob();
// Recordatorios a clientes: carrito sin terminar y tiendas que miraron (puntos u ofertas). 10:00 y 17:00 en Cuba.
startCustomerRemindersJob();
// Bloque 198 (pedido explícito — "se enviará un correo a los usuarios que
// ese día tienen que ir y reportar todas las ventas"): 8:30am, entre el
// recordatorio de pago (8:00) y el de reportes de fraude (9:00).
startCashCloseReminderJob();
// Bloque 211 (pedido explícito — auto-eliminación de cuenta, 30 días de
// gracia): 9:30am, entre el de reportes de fraude (9:00) y ningún otro.
startAccountDeletionJob();
startVendorDeletionJob();
// Bloque 229 (Fase 2 del blindaje del ranking — pedido explícito): marca
// ráfagas de reseñas de 5★ desde cuentas nuevas. 10:00am, después del de
// auto-eliminación (9:30) — solo levanta bandera en RankingAnomaly, nunca
// decide nada por sí solo.
startReviewAnomalyJob();
// Bloque 229: mismo patrón que el anterior pero para picos de clics —
// confirma lo que la deduplicación por ip de la Fase 1 (trackProductClick)
// ya viene filtrando. Corre cada 3h, no una vez al día, porque un pico de
// tráfico pierde valor de detección si se espera hasta el día siguiente.
startClickAnomalyJob();
// Bloque 235 (pedido explícito — trial gratuito de 30 días del Plan
// Premium): recordatorios de vencimiento + vencimiento real. 10:30am, el
// siguiente cron diario fijo libre después de reviewAnomaly (10:00) —
// clickAnomaly no cuenta, corre cada 3h, no una vez al día.
startTrialExpiryJob();
// Conversaciones de los chatbots: se borran a las 24 h sin actividad; el registro del admin dura 90 días.
startChatRetentionJob();
// Tickets de errores visuales: se borran (con su captura) a los 90 días.
startSupportTicketRetentionJob();
// Avisos en vivo y push ante los cambios de la base de datos.
installNotifyHooks();
// API de socios: vuelca cada pocos segundos los movimientos y totales de uso a la base.
startPartnerUsageFlusher();
