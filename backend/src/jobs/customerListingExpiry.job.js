import cron from "node-cron";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import { prisma } from "../lib/prisma.js";
import { CUSTOMER_LISTING_UPLOAD_DIR } from "../controllers/customerListings.controller.js";

// Primer cron de este proyecto que BORRA filas de verdad (los otros dos,
// vendorLifecycle.job.js/verificationPayment.job.js, solo cambian estados).
// Pedido explícito: un anuncio de venta rápida sin vender a los 30 días
// "desaparece automáticamente y queda eliminado de la base de datos" — no
// alcanza con marcarlo inactivo (patrón de expiración perezosa que sí usa
// offers.controller.js), acá hay que borrar la fila y sus archivos.
//
// A diferencia de deleteProduct (products.controller.js), que hoy NO borra
// los archivos físicos al eliminar un producto entero — un gap real del
// código existente — este job SÍ borra cada imagen del disco antes de
// borrar la fila. Decisión deliberada, no un intento de igualar ese gap:
// este flujo va a churnear constantemente (anuncios naciendo/muriendo cada
// 30 días), así que dejar huérfanos en disco sería un problema real.

async function deleteExpiredListings() {
  const expired = await prisma.customerListing.findMany({
    where: { expiresAt: { lt: new Date() } },
  });

  let deleted = 0;
  for (const listing of expired) {
    await Promise.all(
      listing.images.map((url) =>
        unlink(join(CUSTOMER_LISTING_UPLOAD_DIR, listing.ownerId, url.split("/").pop())).catch(() => {})
      )
    );
    await prisma.customerListing.delete({ where: { id: listing.id } });
    deleted++;
  }
  return deleted;
}

// Exportado por separado (no solo el scheduler) para poder correrlo a mano
// en un smoke test — es la única forma real de probar "vencimiento a 30
// días" sin esperar 30 días.
export async function runCustomerListingExpiryJob() {
  const deleted = await deleteExpiredListings();
  console.log(`[customerListingExpiryJob] eliminados=${deleted}`);
  return { deleted };
}

// 7:00am hora Cuba — antes que vendorLifecycleJob (8:00) y
// verificationPaymentJob (8:30), para no competir por conexión de DB con
// los otros dos crons diarios.
export function startCustomerListingExpiryJob() {
  cron.schedule(
    "0 7 * * *",
    () => {
      runCustomerListingExpiryJob().catch((err) => console.error("[customerListingExpiryJob] error:", err));
    },
    { timezone: "America/Havana" }
  );
}
