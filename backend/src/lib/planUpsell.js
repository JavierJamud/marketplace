import { AppError } from "../utils/AppError.js";
import { getAllPlanConfigs, planAllows, featureRequiresBadge } from "./planConfig.js";

// Avisos de "esta función no está en tu plan" con los planes que SÍ la tienen, leídos de la base en el momento. Antes los
// mensajes decían "es del Plan Premium" escrito a mano: con planes que el admin crea, renombra o archiva ese texto mentía
// (la función podía estar en Estándar, o Premium podía llamarse de otra forma). El bloqueo sigue siendo el mismo
// interruptor del plan (planAllows / assertPlanAllows); esto solo arma el texto.

// "A", "A y B", "A, B y C".
function joinNames(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

// Planes públicos y vigentes (no archivados) que tienen encendido `flag` (columna booleana de PlanConfig, ej. "allowPos").
// `flag` null = cualquier plan (para topes sueltos, como maxProvinces, que no dependen de un interruptor).
// Con `limitKey`, además, que su tope sea mayor que `above` o no tenga tope (null): sirve para "tu plan llegó al límite".
// Una función que exige insignia (requiresBadge) solo cuenta en planes que la dan: en otro plan el servidor no la deja usar.
// En el orden de la página de planes.
export async function plansOffering(flag, { limitKey = null, above = null } = {}) {
  const needsBadge = !!flag && featureRequiresBadge(flag);
  const plans = (await getAllPlanConfigs()).filter((p) => p.isPublic && (!flag || p[flag]) && (!needsBadge || p.grantsBadge));
  if (!limitKey) return plans;
  return plans.filter((p) => p[limitKey] == null || p[limitKey] > above);
}

// "Está en el plan X." / "Está en los planes X y Y." o "" si ningún plan público la tiene (no se inventa un plan).
export function plansSentence(plans, { one = "Está en el plan", many = "Está en los planes" } = {}) {
  const names = plans.map((p) => p.displayName).filter(Boolean);
  if (names.length === 0) return "";
  return `${names.length === 1 ? one : many} ${joinNames(names)}.`;
}

// Igual que assertPlanAllows (mismo 403 y mismo `planRequired`, que es lo que mira PlanUpsell.jsx en el panel), pero el
// mensaje dice en qué planes está la función. `lead` es la primera frase ("Enviar la factura por correo no está en tu
// plan.") y `action` lo que puede hacer después de cambiar de plan; `fallback` se agrega si ningún plan público la tiene.
// Solo arma el texto cuando de verdad bloquea: la consulta de planes sale de la caché y no se hace en cada uso permitido.
export async function assertPlanAllowsWithUpsell(vendor, flag, { lead, action = "", fallback = "" }) {
  if (await planAllows(vendor, flag)) return;
  // El plan la trae pero la función exige insignia y la tienda no está verificada: lo que falta es verificarse, no cambiar
  // de plan (mismo 403 que assertPlanAllows).
  if (await planAllows(vendor.planType, flag)) throw new AppError("Disponible solo para tiendas verificadas.", 403, { badgeRequired: flag });
  const where = plansSentence(await plansOffering(flag));
  const message = [lead, where, where ? action : fallback].filter(Boolean).join(" ");
  throw new AppError(message, 403, { planRequired: flag });
}
