import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { sendCashCloseReminderEmail } from "../lib/email.js";
import { periodBounds } from "../controllers/vendorStaffSales.controller.js";

const FREQUENCY_LABEL = { DAILY: "hoy", WEEKLY: "esta semana", MONTHLY: "este mes" };

// Bloque 198 (pedido explícito — "se podrán enviar recordatorios a los
// usuarios en caso de que el vendedor asigne un día que sea el día para
// cuadrar la caja... se enviará un correo a los usuarios que ese día tienen
// que ir y reportar todas las ventas"): mismo criterio que isoWeekday en
// vendors.controller.js (1=lunes...7=domingo) — Vendor.cashCloseDayOfWeek
// se guarda en ese mismo formato.
function isoWeekday(date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

// Bloque 198: un mes puede tener menos días que el configurado (ej. día 31
// en febrero) — se dispara el ÚLTIMO día real de ese mes en vez de nunca
// disparar ese mes.
function isConfiguredMonthDay(date, configuredDay) {
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const effectiveDay = Math.min(configuredDay, daysInMonth);
  return date.getDate() === effectiveDay;
}

function matchesToday(vendor, today) {
  if (!vendor.cashCloseFrequency) return false;
  if (vendor.cashCloseFrequency === "DAILY") return true;
  if (vendor.cashCloseFrequency === "WEEKLY") return vendor.cashCloseDayOfWeek === isoWeekday(today);
  if (vendor.cashCloseFrequency === "MONTHLY") return vendor.cashCloseDayOfMonth != null && isConfiguredMonthDay(today, vendor.cashCloseDayOfMonth);
  return false;
}

function isSameCalendarDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export async function runCashCloseReminderJob() {
  const today = new Date();
  const vendors = await prisma.vendor.findMany({
    where: { cashCloseFrequency: { not: null }, isBlocked: false, status: "ACTIVE" },
  });

  let vendorsProcessed = 0;
  let emailsSent = 0;

  for (const vendor of vendors) {
    if (!matchesToday(vendor, today)) continue;
    // Dedupe: ya se mandó hoy — mismo criterio que Vendor.lastInactivityEmailAt.
    if (vendor.cashCloseReminderSentAt && isSameCalendarDay(vendor.cashCloseReminderSentAt, today)) continue;

    const staff = await prisma.vendorStaff.findMany({
      where: { vendorId: vendor.id, isActive: true, allowedSections: { has: "ventas-manuales" } },
      include: { user: { select: { email: true, fullName: true } } },
    });
    if (staff.length === 0) {
      await prisma.vendor.update({ where: { id: vendor.id }, data: { cashCloseReminderSentAt: today } });
      continue;
    }

    const { start, end } = periodBounds(vendor.cashCloseFrequency, today);
    const salesAgg = await prisma.vendorStaffSale.groupBy({
      by: ["vendorStaffId"],
      where: { vendorId: vendor.id, createdAt: { gte: start, lt: end } },
      _sum: { total: true },
    });
    const salesByStaff = new Map(salesAgg.map((s) => [s.vendorStaffId, Number(s._sum.total ?? 0)]));

    for (const s of staff) {
      await sendCashCloseReminderEmail({
        vendor,
        staffUser: s.user,
        totalSales: salesByStaff.get(s.id) ?? 0,
        currency: vendor.currency,
        frequencyLabel: FREQUENCY_LABEL[vendor.cashCloseFrequency],
      });
      emailsSent++;
    }

    await prisma.vendor.update({ where: { id: vendor.id }, data: { cashCloseReminderSentAt: today } });
    vendorsProcessed++;
  }

  console.log(`[cashCloseReminderJob] tiendas procesadas=${vendorsProcessed} correos enviados=${emailsSent}`);
  return { vendorsProcessed, emailsSent };
}

// Bloque 198: mismo horario/timezone que el resto de los cron de este
// proyecto ("America/Havana") — 8:30am, entre el recordatorio de pago
// (8:00, verificationPayment.job.js) y el de reportes de fraude (9:00),
// para no competir por conexiones a la DB al mismo minuto que ningún otro.
export function startCashCloseReminderJob() {
  cron.schedule(
    "30 8 * * *",
    () => { runCashCloseReminderJob().catch((err) => console.error("[cashCloseReminderJob] error:", err)); },
    { timezone: "America/Havana" }
  );
}
