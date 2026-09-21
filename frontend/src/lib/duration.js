// Bloque 164 (pedido explícito — "debe mostrar todos los detalles como qué
// tiempo lleva el cliente en mesa desde que se realizó el pedido"): un solo
// formateador compartido entre VendorTables.jsx, VendorOrders.jsx y
// NewOrderPopup.jsx — "desde" siempre es createdAt del pedido; "hasta" es
// `now` (mesa todavía activa, sigue corriendo) o un timestamp fijo
// (clearedAt/deliveredAt, ya terminado — deja de correr, muestra cuánto
// duró en total).
export function formatElapsed(fromIso, toIso = null) {
  const from = new Date(fromIso).getTime();
  const to = toIso ? new Date(toIso).getTime() : Date.now();
  const ms = Math.max(0, to - from);
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}
