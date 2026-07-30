// Bloque 55: precios por cantidad (mayoreo) — opcional por producto. Mismo
// criterio que backend/src/lib/pricing.js (única fuente de verdad real es
// el servidor, esto es solo para pintar el precio/ahorro en vivo mientras
// el cliente elige cantidad, antes de confirmar el pedido).
export function resolveUnitPrice(basePrice, priceTiers, quantity) {
  const applicable = [...(priceTiers ?? [])].filter((t) => quantity >= t.minQty).sort((a, b) => b.minQty - a.minQty)[0];
  return applicable ? Number(applicable.price) : Number(basePrice);
}

// Cuánto se ahorra en TOTAL (no por unidad) comprando `quantity` al precio
// resuelto en vez de pagar todas las unidades al precio de 1 sola.
export function calcSavings(basePrice, priceTiers, quantity) {
  const unitPrice = resolveUnitPrice(basePrice, priceTiers, quantity);
  const savings = (Number(basePrice) - unitPrice) * quantity;
  return Math.round(savings * 100) / 100;
}

// Arma los rangos legibles para mostrar la tabla de precios por cantidad,
// ej. a partir de [{minQty:3,price:90},{minQty:10,price:80}] con base 100:
// [{ range: "1-2", price: 100 }, { range: "3-9", price: 90 }, { range: "10+", price: 80 }]
export function buildPriceTierRanges(basePrice, priceTiers) {
  const sorted = [...(priceTiers ?? [])].sort((a, b) => a.minQty - b.minQty);
  if (sorted.length === 0) return [];
  const ranges = [{ range: `1-${sorted[0].minQty - 1}`, price: Number(basePrice) }];
  sorted.forEach((tier, i) => {
    const next = sorted[i + 1];
    ranges.push({ range: next ? `${tier.minQty}-${next.minQty - 1}` : `${tier.minQty}+`, price: Number(tier.price) });
  });
  return ranges;
}
