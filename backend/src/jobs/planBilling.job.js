import cron from "node-cron";
import { runPlanBilling } from "../services/planBilling.service.js";

// Cobro de los planes sin insignia (planBilling.service.js). Cada hora, para que un pago confirmado reactive una tienda
// suspendida sin esperar al día siguiente y los avisos salgan el mismo día de la fecha de cobro.
export function startPlanBillingJob() {
  cron.schedule(
    "15 * * * *",
    () => {
      runPlanBilling().catch((err) => console.error("[planBillingJob] error:", err));
    },
    { timezone: "America/Havana" }
  );
}
