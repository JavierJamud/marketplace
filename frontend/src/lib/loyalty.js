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

// Cuánto le cuesta el programa a la tienda (% de la compra que devuelve en puntos), igual que programCost en
// backend/src/services/loyalty.service.js. Cada bono se mide en su monto mínimo, que es donde más regala.
export function programCost(p) {
  if (!(p?.earnPerAmount > 0) || !(p?.valuePoints >= 1) || !(p?.valueAmount > 0)) return null;
  const pointValue = p.valueAmount / p.valuePoints;
  const base = (p.earnPoints / p.earnPerAmount) * pointValue * 100;
  const tiers = (p.bonusTiers ?? [])
    .filter((t) => t.minTotal > 0 && t.bonusPoints >= 1)
    .map((t) => ({ minTotal: t.minTotal, percent: (((Math.floor(t.minTotal / p.earnPerAmount) * p.earnPoints + t.bonusPoints) * pointValue) / t.minTotal) * 100 }));
  return { base, tiers, max: Math.max(base, ...tiers.map((t) => t.percent)) };
}

// Cómo leer ese costo, con los mismos nombres que los niveles de la página (2 %, 3 % y 5 %): hasta 2,5 % prudente, hasta 4 %
// recomendado, hasta 6 % generoso y más, muy generoso (pasado el tope de la plataforma no se puede guardar).
export function costLevel(percent, max = 15) {
  if (percent > max) return { key: "blocked", label: "No se puede guardar", tone: "text-error", bar: "bg-error" };
  if (percent > 6) return { key: "high", label: "Muy generoso", tone: "text-error", bar: "bg-error" };
  if (percent > 4) return { key: "generous", label: "Generoso", tone: "text-secondary", bar: "bg-secondary-container" };
  if (percent > 2.5) return { key: "recommended", label: "Recomendado", tone: "text-verified-dark", bar: "bg-verified" };
  return { key: "prudent", label: "Prudente", tone: "text-verified-dark", bar: "bg-verified" };
}

export const fmtPercent = (n) => `${Number(n).toLocaleString("es-CU", { maximumFractionDigits: 1 })} %`;

export const TX_LABEL = {
  EARN: "Ganados por pedido",
  REDEEM: "Usados en pedido",
  EARN_REVERSED: "Quitados: pedido anulado",
  REDEEM_REFUNDED: "Devueltos: pedido cancelado",
  ADJUST: "Ajuste de la tienda",
};

// Para el cliente, un ajuste positivo es un regalo de la tienda.
export const txLabel = (t) => (t.type === "ADJUST" && t.points > 0 ? "Regalo de la tienda" : TX_LABEL[t.type] ?? t.type);

// Color de la tarjeta de puntos: el de la tienda, si el texto blanco se lee bien encima (contraste 4,5 o más, WCAG AA); si
// el admin le puso un color claro, el verde azulado de la marca.
export function cardColor(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex ?? "")) return "#337475";
  const lin = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return 1.05 / (lum + 0.05) >= 4.5 ? hex : "#337475";
}
