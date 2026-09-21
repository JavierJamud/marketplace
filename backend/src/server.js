import { app } from "./app.js";
import { env } from "./config/env.js";
import { startVendorLifecycleJob } from "./jobs/vendorLifecycle.job.js";
import { startVerificationPaymentJob, startVerificationApprovalExpiryJob } from "./jobs/verificationPayment.job.js";
import { startCustomerListingExpiryJob } from "./jobs/customerListingExpiry.job.js";
import { startFraudReportsJob } from "./jobs/fraudReports.job.js";
import { startAiHealthCheckJob } from "./jobs/aiHealthCheck.job.js";
import { startLowStockJob } from "./jobs/lowStock.job.js";
import { startCashCloseReminderJob } from "./jobs/cashCloseReminder.job.js";
import { startAccountDeletionJob } from "./jobs/accountDeletion.job.js";
import { startReviewAnomalyJob } from "./jobs/reviewAnomaly.job.js";
import { startClickAnomalyJob } from "./jobs/clickAnomaly.job.js";

app.listen(env.port, () => {
  console.log(`API escuchando en http://localhost:${env.port} y http://192.168.1.79:${env.port}`);
});

// Venta rápida de clientes: borra los anuncios vencidos a los 30 días (y sus
// archivos) — corre primero (7:00am) para no competir por conexión de DB con
// los otros dos crons diarios.
startCustomerListingExpiryJob();
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
// Bloque 194 (pedido explícito — "notificación por correo... sobre bajo
// stock en productos antes que se agoten"): 7:30am, entre el recordatorio
// de inactividad (7:00) y el de pago (8:00).
startLowStockJob();
// Bloque 198 (pedido explícito — "se enviará un correo a los usuarios que
// ese día tienen que ir y reportar todas las ventas"): 8:30am, entre el
// recordatorio de pago (8:00) y el de reportes de fraude (9:00).
startCashCloseReminderJob();
// Bloque 211 (pedido explícito — auto-eliminación de cuenta, 30 días de
// gracia): 9:30am, entre el de reportes de fraude (9:00) y ningún otro.
startAccountDeletionJob();
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
