import { currencyLabel } from "../lib/catalog.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { getPlanConfig } from "../lib/planConfig.js";

// Programa de fidelidad (puntos) de cada tienda (ver LoyaltyProgram en schema.prisma). Todo cálculo de puntos pasa por aquí: el checkout,
// el cambio de estado del pedido, el panel de la tienda y el del cliente usan las mismas reglas.
//
// Reglas que no se negocian:
//  - el navegador solo pide "quiero usar N puntos"; cuánto vale, si alcanza y si respeta los topes lo decide el servidor;
//  - el saldo se descuenta con un UPDATE condicionado (balance >= N) dentro de la misma transacción que crea el pedido;
//  - cada pedido da, canjea, revierte o devuelve puntos una sola vez (índice único orderId + tipo);
//  - solo cuenta lo que está en la moneda de la tienda: un pedido con productos en otra moneda no da ni canjea puntos.

export const PROGRAM_DEFAULTS = {
  enabled: false,
  earnPerAmount: 100,
  earnPoints: 1,
  bonusTiers: [],
  valuePoints: 1,
  valueAmount: 1,
  valueOrder: "AMOUNT_FIRST",
  minRedeemPoints: 10,
  maxRedeemPercent: 50,
};

const round2 = (n) => Math.round(n * 100) / 100;

export function serializeProgram(row) {
  const p = row ?? PROGRAM_DEFAULTS;
  const valuePoints = p.valuePoints;
  const valueAmount = Number(p.valueAmount);
  return {
    enabled: !!p.enabled,
    earnPerAmount: Number(p.earnPerAmount),
    earnPoints: p.earnPoints,
    bonusTiers: normalizeTiers(p.bonusTiers),
    valuePoints,
    valueAmount,
    valueOrder: p.valueOrder,
    pointValue: valueAmount / valuePoints,
    minRedeemPoints: p.minRedeemPoints,
    maxRedeemPercent: p.maxRedeemPercent,
  };
}

// Lo que valen `points` puntos en la moneda de la tienda. Se calcula con el par que escribió la tienda (no con el valor de un
// punto ya redondeado): con "1000 puntos = 10 USD", 350 puntos son exactamente 3,50 USD.
export function pointsWorth(program, points) {
  return round2((points * program.valueAmount) / program.valuePoints);
}

function normalizeTiers(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => ({ minTotal: Number(t?.minTotal), bonusPoints: Math.trunc(Number(t?.bonusPoints)) }))
    .filter((t) => Number.isFinite(t.minTotal) && t.minTotal > 0 && Number.isFinite(t.bonusPoints) && t.bonusPoints > 0)
    .sort((a, b) => a.minTotal - b.minTotal);
}

// El plan de la tienda tiene que permitirlo (PlanConfig.allowLoyalty) y la tienda tiene que haberlo encendido.
export async function activeProgramFor(vendor) {
  if (!vendor) return null;
  const row = await prisma.loyaltyProgram.findUnique({ where: { vendorId: vendor.id } });
  if (!row?.enabled) return null;
  const plan = await getPlanConfig(vendor.planType);
  if (plan && plan.allowLoyalty === false) return null;
  return serializeProgram(row);
}

export function pointsForAmount(program, amount) {
  if (!program || !(amount > 0)) return 0;
  const base = Math.floor(amount / program.earnPerAmount) * program.earnPoints;
  const tier = [...program.bonusTiers].reverse().find((t) => amount >= t.minTotal);
  return Math.max(0, base + (tier?.bonusPoints ?? 0));
}

// Cuántos puntos se pueden usar como máximo en un pedido de `payable` (lo que queda por pagar después del código de descuento).
export function maxRedeemablePoints(program, balance, payable) {
  if (!program || balance < program.minRedeemPoints || !(payable > 0)) return 0;
  // El 1e-9 evita que 49,999999 por redondeo de coma flotante pierda un punto.
  const byPercent = Math.floor((payable * program.maxRedeemPercent * program.valuePoints) / (100 * program.valueAmount) + 1e-9);
  const max = Math.min(balance, byPercent);
  return max >= program.minRedeemPoints ? max : 0;
}

export function allInStoreCurrency(items, vendorCurrency) {
  return items.length > 0 && items.every((i) => (i.currency ?? "CUP") === (vendorCurrency ?? "CUP"));
}

// Dentro de la transacción de placeOrder. Devuelve { points, discount } o null si no se pidió canjear.
export async function redeemForOrder(tx, { vendor, customerId, requestedPoints, payable, items }) {
  if (!requestedPoints) return null;
  if (!customerId) throw new AppError("Inicia sesión para usar tus puntos.", 401);
  const program = await activeProgramFor(vendor);
  if (!program) throw new AppError("Esta tienda ya no tiene programa de puntos. Quita los puntos e intenta de nuevo.", 409);
  if (!allInStoreCurrency(items, vendor.currency)) {
    throw new AppError(`Los puntos solo se pueden usar en pedidos con precios en ${currencyLabel(vendor.currency ?? "CUP")}.`, 400);
  }
  const account = await tx.loyaltyAccount.findUnique({ where: { vendorId_userId: { vendorId: vendor.id, userId: customerId } } });
  const max = maxRedeemablePoints(program, account?.balance ?? 0, payable);
  if (requestedPoints < program.minRedeemPoints) throw new AppError(`Se usan como mínimo ${program.minRedeemPoints} puntos.`, 400);
  if (requestedPoints > max) {
    throw new AppError(max > 0 ? `En este pedido puedes usar hasta ${max} puntos.` : "No tienes puntos suficientes para usar en este pedido.", 409);
  }
  const claimed = await tx.loyaltyAccount.updateMany({
    where: { id: account.id, balance: { gte: requestedPoints } },
    data: { balance: { decrement: requestedPoints }, lifetimeRedeemed: { increment: requestedPoints } },
  });
  if (claimed.count === 0) throw new AppError("Tu saldo de puntos cambió. Revisa y vuelve a intentarlo.", 409);
  const discount = Math.min(payable, pointsWorth(program, requestedPoints));
  return { points: requestedPoints, discount, accountId: account.id, balanceAfter: account.balance - requestedPoints };
}

// Se llama después de crear el pedido (ya hay orderId) para dejar el movimiento en el historial.
export async function recordRedemption(tx, redemption, order) {
  if (!redemption) return;
  await tx.loyaltyTransaction.create({
    data: { accountId: redemption.accountId, type: "REDEEM", points: -redemption.points, balanceAfter: redemption.balanceAfter, orderId: order.id, orderCode: order.code },
  });
}

async function moveBalance(tx, accountId, delta, extra = {}) {
  const updated = await tx.loyaltyAccount.update({
    where: { id: accountId },
    data: { balance: { increment: delta }, ...extra },
    select: { balance: true },
  });
  return updated.balance;
}

// Pedido entregado: suma los puntos que corresponden. Idempotente (un EARN por pedido).
export async function awardOrderPoints(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, code: true, total: true, customerId: true, vendorId: true, status: true, items: { select: { currency: true } } },
  });
  if (!order?.customerId || order.status !== "DELIVERED") return 0;
  const vendor = await prisma.vendor.findUnique({ where: { id: order.vendorId }, select: { id: true, userId: true, planType: true, currency: true } });
  // El dueño comprando en su propia tienda no suma puntos.
  if (vendor.userId === order.customerId) return 0;
  const program = await activeProgramFor(vendor);
  if (!program || !allInStoreCurrency(order.items, vendor.currency)) return 0;
  const points = pointsForAmount(program, Number(order.total));
  if (points <= 0) return 0;

  try {
    await prisma.$transaction(async (tx) => {
      const account = await tx.loyaltyAccount.upsert({
        where: { vendorId_userId: { vendorId: vendor.id, userId: order.customerId } },
        create: { vendorId: vendor.id, userId: order.customerId },
        update: {},
        select: { id: true },
      });
      // Primero el movimiento: si ya existía (índice único), la transacción se cancela y el saldo no se toca.
      const txRow = await tx.loyaltyTransaction.create({ data: { accountId: account.id, type: "EARN", points, balanceAfter: 0, orderId: order.id, orderCode: order.code } });
      const balanceAfter = await moveBalance(tx, account.id, points, { lifetimeEarned: { increment: points } });
      await tx.loyaltyTransaction.update({ where: { id: txRow.id }, data: { balanceAfter } });
      await tx.order.update({ where: { id: order.id }, data: { loyaltyPointsEarned: points } });
    });
    return points;
  } catch (err) {
    if (err?.code === "P2002") return 0; // ya se habían dado
    throw err;
  }
}

// Pedido anulado (o borrado estando pendiente): devuelve los puntos que se usaron y quita los que había dado.
// Si el cliente ya gastó los puntos ganados, se quita solo lo que queda en el saldo (nunca queda negativo).
export async function reverseOrderLoyalty(orderId, client = prisma) {
  const rows = await client.loyaltyTransaction.findMany({ where: { orderId, type: { in: ["EARN", "REDEEM"] } } });
  for (const row of rows) {
    const reverseType = row.type === "REDEEM" ? "REDEEM_REFUNDED" : "EARN_REVERSED";
    const already = await client.loyaltyTransaction.findUnique({ where: { orderId_type: { orderId, type: reverseType } } });
    if (already) continue;
    const run = async (tx) => {
      const account = await tx.loyaltyAccount.findUnique({ where: { id: row.accountId }, select: { balance: true } });
      if (!account) return;
      const delta = row.type === "REDEEM" ? -row.points : -Math.min(row.points, Math.max(0, account.balance));
      const extra = row.type === "REDEEM" ? { lifetimeRedeemed: { decrement: -row.points } } : { lifetimeEarned: { decrement: -delta } };
      const balanceAfter = await moveBalance(tx, row.accountId, delta, extra);
      await tx.loyaltyTransaction.create({ data: { accountId: row.accountId, type: reverseType, points: delta, balanceAfter, orderId, orderCode: row.orderCode } });
    };
    if (client === prisma) await prisma.$transaction(run);
    else await run(client);
  }
}

// Ajuste manual de la tienda (siempre con nota). Nunca deja el saldo en negativo.
export async function adjustPoints({ vendorId, userId, points, note }) {
  return prisma.$transaction(async (tx) => {
    const account = await tx.loyaltyAccount.upsert({
      where: { vendorId_userId: { vendorId, userId } },
      create: { vendorId, userId },
      update: {},
    });
    if (account.balance + points < 0) throw new AppError(`El cliente tiene ${account.balance} puntos: no se le pueden quitar ${-points}.`, 400);
    const balanceAfter = await moveBalance(tx, account.id, points, points > 0 ? { lifetimeEarned: { increment: points } } : {});
    await tx.loyaltyTransaction.create({ data: { accountId: account.id, type: "ADJUST", points, balanceAfter, note } });
    return balanceAfter;
  });
}

// Visita de un cliente con sesión a una tienda (su página, un producto suyo o al agregar al carrito). Alimenta el recordatorio
// "volviste a mirar esta tienda". Las visitas seguidas en menos de 30 minutos cuentan como una.
const VISIT_GAP_MS = 30 * 60 * 1000;
export async function touchStoreVisit(userId, vendorId) {
  const key = { userId_vendorId: { userId, vendorId } };
  const existing = await prisma.storeVisit.findUnique({ where: key });
  if (!existing) {
    await prisma.storeVisit.create({ data: { userId, vendorId } }).catch(() => {}); // dos pestañas a la vez: basta una
  } else if (Date.now() - existing.lastAt.getTime() > VISIT_GAP_MS) {
    await prisma.storeVisit.update({ where: key, data: { lastAt: new Date(), visits: { increment: 1 } } });
  }
}

// Sugerencias para configurar el programa, calculadas con los pedidos reales de la tienda (últimos 90 días). Sin pedidos se
// usan valores prudentes. La idea: devolver entre 2 % y 5 % de lo que se compra, que es lo habitual en programas de tiendas.
export async function suggestionsFor(vendor) {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const [agg, repeat] = await Promise.all([
    prisma.order.aggregate({ where: { vendorId: vendor.id, status: { not: "CANCELLED" }, createdAt: { gte: since } }, _avg: { total: true }, _count: { _all: true } }),
    prisma.order.groupBy({ by: ["customerId"], where: { vendorId: vendor.id, customerId: { not: null }, status: { not: "CANCELLED" }, createdAt: { gte: since } }, _count: { _all: true } }),
  ]);
  const orders = agg._count._all;
  const avg = Number(agg._avg.total ?? 0);
  const buyers = repeat.length;
  const repeatBuyers = repeat.filter((r) => r._count._all > 1).length;
  const currency = vendor.currency ?? "CUP";

  // Un paso redondo cercano al 5 % del ticket medio: así casi cada pedido da puntos y el cálculo se entiende de un vistazo.
  const niceStep = (n) => {
    if (!(n > 0)) return 100;
    const mag = 10 ** Math.floor(Math.log10(n));
    const r = n / mag;
    return (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * mag;
  };
  const earnPerAmount = orders >= 5 ? niceStep(avg * 0.25) : 100;
  // 1 punto por cada `earnPerAmount` y cada punto vale el 3 % de ese monto: el cliente recupera el 3 % de lo que compra. Se
  // escribe como "100 puntos = N" para que el número se entienda sin decimales.
  const valueAmount = round2(earnPerAmount * 3) || 1;
  const pointValue = valueAmount / 100;
  const bonusTier = orders >= 5 ? { minTotal: niceStep(avg * 2), bonusPoints: 5 } : null;

  const tips = [
    orders >= 5
      ? `Tu pedido medio de los últimos 90 días es de ${Math.round(avg).toLocaleString("es-CU")} ${currency}. Con 1 punto por cada ${earnPerAmount.toLocaleString("es-CU")} ${currency}, un pedido normal da unos ${Math.max(1, Math.floor(avg / earnPerAmount))} puntos.`
      : "Todavía tienes pocos pedidos para calcular tu pedido medio. Empieza con valores sencillos y ajústalos en un mes.",
    `Que 100 puntos valgan ${valueAmount.toLocaleString("es-CU")} ${currency} (cada punto, ${pointValue.toLocaleString("es-CU", { maximumFractionDigits: 4 })} ${currency}) devuelve el 3 % de lo comprado: se nota para el cliente y no se come tu margen.`,
    "Un tope de canje del 30 % al 50 % del pedido evita que alguien pague casi todo con puntos.",
    buyers > 0
      ? `En 90 días te compraron ${buyers} ${buyers === 1 ? "cliente" : "clientes"} con cuenta y ${repeatBuyers === 0 ? "ninguno repitió" : repeatBuyers === 1 ? "1 repitió" : `${repeatBuyers} repitieron`}. Los puntos dan un motivo para volver, y un bono por pedidos grandes ayuda a que suban su compra.`
      : "Avisa a tus clientes del programa en tu WhatsApp y en tus ofertas: los puntos solo los ganan clientes con cuenta.",
    "Los puntos se ganan cuando marcas el pedido como Entregado. Si lo anulas después, se quitan solos.",
  ];

  return {
    stats: { orders, avgTicket: Math.round(avg * 100) / 100, buyers, repeatBuyers, currency },
    suggested: { earnPerAmount, earnPoints: 1, valuePoints: 100, valueAmount, valueOrder: "POINTS_FIRST", minRedeemPoints: 10, maxRedeemPercent: 40, bonusTiers: bonusTier ? [bonusTier] : [] },
    tips,
  };
}
