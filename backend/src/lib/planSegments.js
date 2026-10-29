import { AppError } from "../utils/AppError.js";
import { getDefaultPlanKey, getPaidPlanKeys, planDisplayName, isValidPlanKey, PLAN_KEY_PATTERN } from "./planConfig.js";

// Públicos "por plan" de las campañas por correo (Campaign.segment) y de las ofertas dirigidas (TargetedOffer.audience).
// Antes eran dos valores atados a claves fijas: "regular_vendors" = planType "REGULAR" y "business_vendors" = la lista
// ["STANDARD", "BUSINESS", "ENTERPRISE"]. Con planes que el admin crea y archiva, esa lista dejaba fuera a las tiendas de
// cualquier plan nuevo. Ahora:
//  - "regular_vendors": tiendas del plan por defecto (isDefault, hoy el Básico). Se conserva el nombre del valor porque
//    está guardado en campañas y ofertas viejas y lo manda el panel del admin.
//  - "business_vendors": tiendas de cualquier plan de pago (getPaidPlanKeys: ni el por defecto, ni gratis, ni archivado).
//  - Una clave de plan concreta (ej. "STANDARD" o "PLAN_RESTAURANTE"): tiendas de ese plan.
// "default" y "paid" se aceptan al guardar como sinónimos de los dos primeros (los nombres del contrato de planes) y se
// guardan con el nombre de siempre, así una fila nunca tiene dos valores distintos para lo mismo.
export const DEFAULT_PLAN_SEGMENT = "regular_vendors";
export const PAID_PLANS_SEGMENT = "business_vendors";
const SEGMENT_ALIASES = { default: DEFAULT_PLAN_SEGMENT, paid: PAID_PLANS_SEGMENT };

// Una clave de plan siempre va en mayúsculas (PLAN_KEY_PATTERN) y los demás públicos en minúsculas: no se confunden.
export function isPlanKeySegment(value) {
  return typeof value === "string" && PLAN_KEY_PATTERN.test(value);
}

// Valida y normaliza el público que manda el admin. `fixedValues` son los demás públicos que acepta quien llama (todos los
// clientes, todas las tiendas, etc.); los dos públicos por plan (plan por defecto y planes de pago) se aceptan siempre.
// Una clave de plan tiene que existir y no estar archivada: un plan archivado ya no tiene tiendas (se movieron al
// archivarlo) y la campaña saldría vacía.
export async function parseAudienceSegment(value, fixedValues = []) {
  const raw = typeof value === "string" ? value.trim() : "";
  const segment = SEGMENT_ALIASES[raw] ?? raw;
  if (segment === DEFAULT_PLAN_SEGMENT || segment === PAID_PLANS_SEGMENT || fixedValues.includes(segment)) return segment;
  if (isPlanKeySegment(segment)) {
    if (!(await isValidPlanKey(segment))) throw new AppError("Ese plan no existe o está archivado. Elige otro público.", 400);
    return segment;
  }
  throw new AppError("Elige a quién va dirigido.", 400);
}

// Filtro de Vendor.planType para un público. undefined = el público no filtra por plan (todas las tiendas, sin verificar,
// etc.). Los públicos por plan devuelven SIEMPRE un filtro, aunque no haya planes de pago (`{ in: [] }`, cero tiendas):
// devolver undefined ahí mandaría la campaña a todas las tiendas.
// Una clave concreta se usa tal cual aunque el plan se haya archivado después de crear la campaña (reenviar una vieja
// solo encuentra cero tiendas y el envío avisa que no hay destinatarios).
export async function planFilterForSegment(segment) {
  if (segment === DEFAULT_PLAN_SEGMENT) return getDefaultPlanKey();
  if (segment === PAID_PLANS_SEGMENT) return { in: await getPaidPlanKeys() };
  if (isPlanKeySegment(segment)) return segment;
  return undefined;
}

// Públicos por plan a los que pertenece una tienda (para mostrarle las ofertas dirigidas que le tocan).
export async function planSegmentsOf(vendor) {
  if (!vendor?.planType) return [];
  const [defaultKey, paidKeys] = await Promise.all([getDefaultPlanKey(), getPaidPlanKeys()]);
  const segments = [vendor.planType];
  if (vendor.planType === defaultKey) segments.push(DEFAULT_PLAN_SEGMENT);
  if (paidKeys.includes(vendor.planType)) segments.push(PAID_PLANS_SEGMENT);
  return segments;
}

// Texto del público por plan para las listas del admin, con el nombre del plan de la base. null si no es un público por
// plan (los demás los traduce el panel como siempre).
export async function planSegmentLabel(segment) {
  if (segment === DEFAULT_PLAN_SEGMENT) return `Tiendas del plan ${await planDisplayName(await getDefaultPlanKey())}`;
  if (segment === PAID_PLANS_SEGMENT) return "Tiendas con plan de pago";
  if (isPlanKeySegment(segment)) return `Tiendas del plan ${await planDisplayName(segment)}`;
  return null;
}
