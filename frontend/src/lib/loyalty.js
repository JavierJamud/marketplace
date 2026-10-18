// Mismas cuentas que backend/src/services/loyalty.service.js. Aquí solo sirven para mostrar ("ganarás N puntos", "puedes usar
// hasta N"): el servidor las vuelve a hacer al confirmar el pedido y es el que decide.

export function pointsForAmount(program, amount) {
  if (!program || !(amount > 0)) return 0;
  const base = Math.floor(amount / program.earnPerAmount) * program.earnPoints;
  const tier = [...(program.bonusTiers ?? [])].reverse().find((t) => amount >= t.minTotal);
  return Math.max(0, base + (tier?.bonusPoints ?? 0));
}

export function maxRedeemablePoints(program, balance, payable) {
  if (!program || balance < program.minRedeemPoints || !(payable > 0)) return 0;
  const byPercent = Math.floor((payable * program.maxRedeemPercent * program.valuePoints) / (100 * program.valueAmount) + 1e-9);
  const max = Math.min(balance, byPercent);
  return max >= program.minRedeemPoints ? max : 0;
}

export const pointsValue = (program, points) =>
  program?.valuePoints > 0 ? Math.round(((points * program.valueAmount) / program.valuePoints) * 100) / 100 : 0;

export const fmtAmount = (n, currency) => `${Number(n).toLocaleString("es-CU", { maximumFractionDigits: 2 })} ${currency ?? "CUP"}`;

export const fmtPoints = (n) => `${Number(n).toLocaleString("es-CU")} ${Math.abs(n) === 1 ? "punto" : "puntos"}`;

// El valor del punto como lo escribió la tienda: "10 USD = 1 punto" o "1000 puntos = 10 USD".
export function valueRuleText(program, currency) {
  if (!program?.valuePoints) return "";
  const pts = fmtPoints(program.valuePoints);
  const amount = fmtAmount(program.valueAmount, currency);
  return program.valueOrder === "POINTS_FIRST" ? `${pts} = ${amount}` : `${amount} = ${pts}`;
}

// Una línea que explica cómo se ganan los puntos, para la tienda y el checkout.
export function earnRuleText(program, currency) {
  if (!program) return "";
  return `${fmtPoints(program.earnPoints)} por cada ${fmtAmount(program.earnPerAmount, currency)} de compra`;
}

export const TX_LABEL = {
  EARN: "Ganados por pedido",
  REDEEM: "Usados en pedido",
  EARN_REVERSED: "Quitados: pedido anulado",
  REDEEM_REFUNDED: "Devueltos: pedido cancelado",
  ADJUST: "Ajuste de la tienda",
};
