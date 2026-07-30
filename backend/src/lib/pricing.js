// Bloque 55: precios por cantidad (mayoreo) — opcional por producto (ver
// ProductPriceTier en schema.prisma). Cada tier dice "a partir de esta
// cantidad, el precio POR UNIDAD baja a este" — se aplica el de mayor
// minQty que la cantidad alcance; si ninguno alcanza, rige Product.price
// tal cual (equivalente a un tier minQty=1 implícito que nunca se guarda).
// Único punto de verdad, usado tanto para mostrarle el precio al cliente
// (getProductBySlug/getSharedCart) como para resolver el precio REAL al
// confirmar un pedido (createOrder) — nunca se confía en un precio que
// mande el cliente.
export function resolveUnitPrice(basePrice, priceTiers, quantity) {
  const applicable = (priceTiers ?? [])
    .filter((t) => quantity >= t.minQty)
    .sort((a, b) => b.minQty - a.minQty)[0];
  return applicable ? Number(applicable.price) : Number(basePrice);
}
