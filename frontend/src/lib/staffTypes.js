// Bloque 200 (pedido explícito — "al crear un usuario, este usuario se
// puede crear como agente de ventas o mesero... cuando se crea un usuario
// con agente de ventas, automáticamente se debe habilitar una sección en
// el perfil del usuario"): mismas claves EXACTAS y mismo mapa que
// backend/src/constants/vendorSections.js (STAFF_TYPE_DEFAULT_SECTIONS) —
// elegir un tipo es solo un ATAJO que precarga la(s) sección(es) que ese
// rol normalmente necesita, el dueño puede agregar/quitar secciones a mano
// después sin que el tipo se lo impida.
export const STAFF_TYPES = [
  { key: "", label: "Sin tipo específico" },
  { key: "SALES_AGENT", label: "Agente de ventas" },
  { key: "WAITER", label: "Mesero" },
];

export const STAFF_TYPE_DEFAULT_SECTIONS = {
  SALES_AGENT: ["ventas-manuales"],
  WAITER: ["mesas", "pedidos"],
};

export function staffTypeLabel(key) {
  return STAFF_TYPES.find((t) => t.key === (key ?? ""))?.label ?? key;
}
