import { app } from "./app.js";
import { env } from "./config/env.js";
import { startVendorLifecycleJob } from "./jobs/vendorLifecycle.job.js";
import { startVerificationPaymentJob } from "./jobs/verificationPayment.job.js";

app.listen(env.port, () => {
  console.log(`API escuchando en http://localhost:${env.port}`);
});

// Bloque 62: primer cron real del proyecto — recordatorio de inactividad,
// suspensión automática a los 90 días y re-enganche de clientes.
startVendorLifecycleJob();
// Bloque 64: segundo cron — recordatorio y vencimiento del cobro recurrente
// CUP de la verificación (Stripe se maneja solo, vía webhook).
startVerificationPaymentJob();
