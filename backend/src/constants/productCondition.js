// Estado de un producto o de una venta rápida. Misma lista en las tiendas y en los anuncios de clientes, para que el filtro
// "Estado" funcione igual en el catálogo, en las ventas rápidas y en el chatbot. Copia en frontend/src/lib/productCondition.js.
// "De uso" es como se dice en Cuba; quien busca "usado" o "segunda mano" también lo encuentra (ver detectConditionsInText).
export const PRODUCT_CONDITIONS = [
  { id: "NEW", label: "Nuevo", schema: "https://schema.org/NewCondition" },
  { id: "OPEN_BOX", label: "Caja abierta", schema: "https://schema.org/NewCondition" },
  { id: "LIKE_NEW", label: "Como nuevo", schema: "https://schema.org/UsedCondition" },
  { id: "USED", label: "De uso", schema: "https://schema.org/UsedCondition" },
  { id: "REFURBISHED", label: "Reacondicionado", schema: "https://schema.org/RefurbishedCondition" },
];
export const CONDITION_IDS = PRODUCT_CONDITIONS.map((c) => c.id);
export const conditionLabel = (id) => PRODUCT_CONDITIONS.find((c) => c.id === id)?.label ?? null;
export const conditionSchemaUrl = (id) => PRODUCT_CONDITIONS.find((c) => c.id === id)?.schema ?? "https://schema.org/NewCondition";

// Lista de la URL (?condition=USED,LIKE_NEW): solo ids válidos, sin repetidos.
export function parseConditionList(raw) {
  if (!raw) return [];
  return [...new Set(String(raw).split(",").map((s) => s.trim().toUpperCase()))].filter((id) => CONDITION_IDS.includes(id));
}

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Palabras del estado dentro de un texto libre (buscador o mensaje del chatbot). Devuelve los estados pedidos y el texto sin
// esas palabras, para que "laptop de uso" busque laptops de uso y no productos que se llamen "uso". "Nuevo" solo cuenta con
// `includeNew` (el chatbot): en el buscador "nuevo" puede ser parte del nombre ("Año Nuevo").
const CONDITION_PATTERNS = [
  { re: /\bcomo\s+nuev[oa]s?\b/g, ids: ["LIKE_NEW"] },
  { re: /\b(?:en\s+)?caja\s+abierta\b|\bopen\s*box\b/g, ids: ["OPEN_BOX"] },
  { re: /\breacondicionad[oa]s?\b|\brefurbished\b/g, ids: ["REFURBISHED"] },
  { re: /\bde\s+uso\b|\busad[oa]s?\b|\bde\s+segunda(?:\s+mano)?\b|\bsegunda\s+mano\b/g, ids: ["USED", "LIKE_NEW", "REFURBISHED"] },
];
const NEW_PATTERN = /\b(?:nuev[oa]s?|sin\s+usar|sellad[oa]s?)\b/g;

export function detectConditionsInText(text, { includeNew = false } = {}) {
  let rest = fold(text);
  const found = new Set();
  for (const { re, ids } of CONDITION_PATTERNS) {
    if (re.test(rest)) ids.forEach((id) => found.add(id));
    re.lastIndex = 0;
    rest = rest.replace(re, " ");
  }
  if (includeNew && NEW_PATTERN.test(rest)) found.add("NEW");
  NEW_PATTERN.lastIndex = 0;
  if (includeNew) rest = rest.replace(NEW_PATTERN, " ");
  return { conditions: [...found], rest: rest.replace(/\s+/g, " ").trim() };
}
