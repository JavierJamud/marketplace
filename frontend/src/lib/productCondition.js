// Estado de un producto o de una venta rápida: misma lista que backend/src/constants/productCondition.js (el servidor valida
// contra esa). "De uso" es como se dice en Cuba; el buscador y el chatbot también lo encuentran por "usado".
export const PRODUCT_CONDITIONS = [
  { id: "NEW", label: "Nuevo", schema: "https://schema.org/NewCondition", hint: "Sin estrenar." },
  { id: "OPEN_BOX", label: "Caja abierta", schema: "https://schema.org/NewCondition", hint: "Nuevo, solo se abrió la caja." },
  { id: "LIKE_NEW", label: "Como nuevo", schema: "https://schema.org/UsedCondition", hint: "Se usó poco y no tiene marcas." },
  { id: "USED", label: "De uso", schema: "https://schema.org/UsedCondition", hint: "Ya se usó y funciona bien." },
  { id: "REFURBISHED", label: "Reacondicionado", schema: "https://schema.org/RefurbishedCondition", hint: "Reparado o revisado para venderse otra vez." },
];
export const conditionLabel = (id) => PRODUCT_CONDITIONS.find((c) => c.id === id)?.label ?? null;
export const conditionSchemaUrl = (id) => PRODUCT_CONDITIONS.find((c) => c.id === id)?.schema ?? "https://schema.org/NewCondition";
// La etiqueta del estado solo se muestra cuando NO es nuevo: "Nuevo" ya tiene su propia etiqueta (recién publicado).
export const isNotNew = (id) => !!id && id !== "NEW";
