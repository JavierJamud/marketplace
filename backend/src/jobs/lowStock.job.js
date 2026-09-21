import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { sendLowStockAlertEmail } from "../lib/email.js";
// Bloque 228 (pedido explícito — Fase 1 del blindaje del ranking): antes
// este umbral vivía duplicado a mano acá y en otros 2 archivos ("no vale la
// pena una importación cruzada solo por esto" — juicio que quedó revertido
// explícitamente). Un solo lugar de verdad, ver constants/inventory.js.
import { LOW_STOCK_THRESHOLD } from "../constants/inventory.js";

// Bloque 194: un producto entra a la lista de "hay que avisar" si está
// activo, le lleva seguimiento de stock (unlimitedStock:false — "disponible
// siempre" nunca entra, igual que en todo el resto del proyecto), tiene
// entre 1 y el umbral de unidades (0 ya es "agotado", otro aviso — este
// cron es específicamente "antes de que se agote"), y TODAVÍA no se le
// avisó por esta baja puntual (lowStockNotifiedAt null — ver el comentario
// largo en schema.prisma). Se agrupan por tienda para mandar UN solo
// correo con todos sus productos bajos, no uno por producto.
export async function runLowStockJob() {
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      unlimitedStock: false,
      stock: { gt: 0, lte: LOW_STOCK_THRESHOLD },
      lowStockNotifiedAt: null,
    },
    select: { id: true, name: true, stock: true, vendorId: true },
  });

  // Bloque 194: si un producto YA notificado vuelve a subir por encima del
  // umbral (reposición, o el vendedor sube la cantidad a mano), se limpia
  // la marca — así la PRÓXIMA vez que vuelva a bajar dispara un aviso
  // nuevo. Se hace en cada corrida del cron, no en el momento en que el
  // vendedor edita el stock (más simple, sin tocar productsController solo
  // por esto, y el cron ya corre a diario).
  const restockedCount = await prisma.product.updateMany({
    where: { lowStockNotifiedAt: { not: null }, OR: [{ stock: { gt: LOW_STOCK_THRESHOLD } }, { unlimitedStock: true }] },
    data: { lowStockNotifiedAt: null },
  });

  if (products.length === 0) {
    console.log(`[lowStockJob] productos bajos nuevos=0 marcas limpiadas=${restockedCount.count}`);
    return { vendorsNotified: 0, productsNotified: 0, restockedCleared: restockedCount.count };
  }

  const byVendor = new Map();
  for (const p of products) {
    if (!byVendor.has(p.vendorId)) byVendor.set(p.vendorId, []);
    byVendor.get(p.vendorId).push(p);
  }

  let vendorsNotified = 0;
  for (const [vendorId, vendorProducts] of byVendor) {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, include: { user: true } });
    if (!vendor || vendor.isBlocked || vendor.status !== "ACTIVE") continue; // mismo criterio que el resto de los jobs — no molestar a una tienda inactiva/bloqueada.

    const sorted = [...vendorProducts].sort((a, b) => a.stock - b.stock);
    await sendLowStockAlertEmail(vendor, sorted);
    await prisma.product.updateMany({ where: { id: { in: sorted.map((p) => p.id) } }, data: { lowStockNotifiedAt: new Date() } });
    vendorsNotified++;
  }

  console.log(`[lowStockJob] tiendas avisadas=${vendorsNotified} productos avisados=${products.length} marcas limpiadas=${restockedCount.count}`);
  return { vendorsNotified, productsNotified: products.length, restockedCleared: restockedCount.count };
}

// 7:30am hora Cuba — entre el recordatorio de inactividad (7:00) y el de
// pago (8:00), antes del cron de reportes de fraude (9:00).
export function startLowStockJob() {
  cron.schedule(
    "30 7 * * *",
    () => {
      runLowStockJob().catch((err) => console.error("[lowStockJob] error:", err));
    },
    { timezone: "America/Havana" }
  );
}
