import { app } from "./app.js";
import { env } from "./config/env.js";
import { startVendorLifecycleJob } from "./jobs/vendorLifecycle.job.js";
import { startVerificationPaymentJob } from "./jobs/verificationPayment.job.js";
import { startCustomerListingExpiryJob } from "./jobs/customerListingExpiry.job.js";
import { startFraudReportsJob } from "./jobs/fraudReports.job.js";

app.listen(env.port, () => {
  console.log(`API escuchando en http://localhost:${env.port}`);
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
// Feature B: recordatorio y vencimiento del plazo de evidencia de un
// reporte de fraude — 9:00am, después de los otros 3 crons diarios.
startFraudReportsJob();
