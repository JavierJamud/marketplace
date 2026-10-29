import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { sendCashCloseReminderEmail } from "../lib/email.js";
import { periodBounds } from "../controllers/vendorStaffSales.controller.js";
import { planAllows, getPlanConfig } from "../lib/planConfig.js";

const FREQUENCY_LABEL = { DAILY: "hoy", WEEKLY: "esta semana", MONTHLY: "este mes" };
const DEFAULT_TIMEZONE = "America/Havana";

// Día calendario de `date` en la zona horaria de la tienda. Todo el job razona con estos números y no con getDate() o
// getDay(), que dan el día del servidor: en un servidor en UTC, "hoy" en Cuba empezaba a las 19:00 o 20:00 del día anterior.
function localDay(date, timezone) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date).split("-").map(Number);
  return { y, m, d };
}

// Bloque 198 (pedido explícito — "se podrán enviar recordatorios a los
// usuarios en caso de que el vendedor asigne un día que sea el día para
// cuadrar la caja... se enviará un correo a los usuarios que ese día tienen
// que ir y reportar todas las ventas"): mismo criterio que isoWeekday en
// vendors.controller.js (1=lunes...7=domingo) — Vendor.cashCloseDayOfWeek
// se guarda en ese mismo formato.
function isoWeekday({ y, m, d }) {
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

// Bloque 198: un mes puede tener menos días que el configurado (ej. día 31
// en febrero) — se dispara el ÚLTIMO día real de ese mes en vez de nunca
// disparar ese mes.
function isConfiguredMonthDay({ y, m, d }, configuredDay) {
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d === Math.min(configuredDay, daysInMonth);
}

function matchesToday(vendor, today) {
  if (!vendor.cashCloseFrequency) return false;
  if (vendor.cashCloseFrequency === "DAILY") return true;
  if (vendor.cashCloseFrequency === "WEEKLY") return vendor.cashCloseDayOfWeek === isoWeekday(today);
  if (vendor.cashCloseFrequency === "MONTHLY") return vendor.cashCloseDayOfMonth != null && isConfiguredMonthDay(today, vendor.cashCloseDayOfMonth);
  return false;
}

function isSameLocalDay(a, b, timezone) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
  return fmt.format(a) === fmt.format(b);
}

// Personal que de verdad puede abrir "Productos Asignados" hoy, con la misma regla que assertStaffPlan
// (middleware/requireVendorAccess.js): sin usuarios del equipo en el plan nadie entra (403), y con un tope (maxStaffUsers)
// solo los N activos más antiguos. Antes el correo llegaba también a quien la pantalla le iba a cerrar.
async function reachableStaff(vendor) {
  if (!(await planAllows(vendor.planType, "allowStaffUsers"))) return [];
  const max = (await getPlanConfig(vendor.planType))?.maxStaffUsers ?? null;
  const active = await prisma.vendorStaff.findMany({
    where: { vendorId: vendor.id, isActive: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    ...(max === null ? {} : { take: max }),
    include: { user: { select: { email: true, fullName: true } } },
  });
  return active.filter((s) => s.allowedSections?.includes("ventas-manuales"));
}

export async function runCashCloseReminderJob(now = new Date()) {
  // Suspendida por impago: el personal no entra al panel (requireVendorAccess.js), así que tampoco se le recuerda el cuadre.
  const vendors = await prisma.vendor.findMany({
    where: { cashCloseFrequency: { not: null }, isBlocked: false, status: "ACTIVE", deletedAt: null, billingSuspendedAt: null },
  });

  let vendorsProcessed = 0;
  let emailsSent = 0;

  for (const vendor of vendors) {
    const timezone = vendor.timezone || DEFAULT_TIMEZONE;
    const today = localDay(now, timezone);
    if (!matchesToday(vendor, today)) continue;
    // Dedupe: ya se mandó hoy — mismo criterio que Vendor.lastInactivityEmailAt.
    if (vendor.cashCloseReminderSentAt && isSameLocalDay(vendor.cashCloseReminderSentAt, now, timezone)) continue;

    const staff = await reachableStaff(vendor);
    if (staff.length === 0) {
      await prisma.vendor.update({ where: { id: vendor.id }, data: { cashCloseReminderSentAt: now } });
      continue;
    }

    // El período sale de periodBounds, la misma función con la que la pantalla del cuadre suma las ventas (en la zona de
    // la tienda): así el correo y la pantalla no pueden separarse si uno de los dos cambia.
    const { start, end } = periodBounds(vendor.cashCloseFrequency, now, timezone);
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

    await prisma.vendor.update({ where: { id: vendor.id }, data: { cashCloseReminderSentAt: now } });
    vendorsProcessed++;
  }

  console.log(`[cashCloseReminderJob] tiendas procesadas=${vendorsProcessed} correos enviados=${emailsSent}`);
  return { vendorsProcessed, emailsSent };
}

// Bloque 198: mismo timezone que el resto de los cron de este proyecto ("America/Havana"). Sale a las 20:07 y no a las
// 8:30 como antes: el correo dice cuánto vendió cada quien en el período del cuadre, y a las 8:30 el día de hoy apenas
// tenía ventas, así que casi siempre decía 0. A las 20:07 ya entra casi toda la jornada, también buena parte de la noche
// de los restaurantes, pero la cifra sigue siendo lo vendido hasta ese momento: lo que se venda después lo verá en la
// pantalla del cuadre, que suma el mismo período en vivo. El minuto 7 es para no salir junto a los cron de cada hora
// (minuto 0), el de cada 5 minutos ni los de :15 y :17, y así no competir con ellos por conexiones a la base.
export function startCashCloseReminderJob() {
  cron.schedule(
    "7 20 * * *",
    () => { runCashCloseReminderJob().catch((err) => console.error("[cashCloseReminderJob] error:", err)); },
    { timezone: "America/Havana" }
  );
}
