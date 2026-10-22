// Envío de un pedido. Un solo lugar decide qué se cobra, para que nunca se cobre dos veces:
// - Si la tienda tiene envío propio (Vendor.storeShippingMode: FIXED o COORDINATE), manda ese y los envíos de cada
//   producto quedan suspendidos (no se borran: si la tienda vuelve a "por producto", cada uno recupera el suyo).
//   El fijo de tienda se cobra una vez por pedido.
// - Si no, cada producto aporta el suyo: FREE (gratis, lo normal), FIXED (por pedido o por unidad) o COORDINATE.
// El precio fijo depende de la provincia de entrega: "LOCAL" si es la provincia desde donde envía la tienda
// (Vendor.shippingOriginProvinceId), "OTHER" cualquier otra provincia o país. Sin provincia todavía (checkout a medio llenar) la zona es null y el monto queda pendiente.
// El envío nunca se suma a `total` en otra moneda: se agrupa por moneda (no hay tipo de cambio en el sistema).
// Copia exacta en frontend/src/lib/shipping.js: si cambias una, cambia la otra.

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

export function shippingZone(originProvinceId, provinceId) {
  if (!provinceId) return null;
  return originProvinceId && provinceId === originProvinceId ? "LOCAL" : "OTHER";
}

// Envío vigente de UN producto (lo que se muestra en su tarjeta y su ficha), ya con la regla de la tienda aplicada.
export function effectiveShipping(product, vendor) {
  if (vendor?.storeShippingMode) {
    return {
      source: "STORE",
      mode: vendor.storeShippingMode,
      local: num(vendor.storeShippingLocal),
      other: num(vendor.storeShippingOther),
      currency: vendor.storeShippingCurrency ?? vendor.currency ?? "CUP",
      perUnit: false,
    };
  }
  const mode = product?.shippingMode ?? "FREE";
  return {
    source: "PRODUCT",
    mode,
    local: num(product?.shippingLocal),
    other: num(product?.shippingOther),
    currency: product?.shippingCurrency ?? product?.currency ?? "CUP",
    perUnit: !!product?.shippingPerUnit,
  };
}

const feeFor = (s, zone) => (zone === "LOCAL" ? s.local : zone === "OTHER" ? s.other : null);

// items: [{ productId, name, quantity, product }] (product con los campos shipping*). Devuelve:
// { source, zone, lines: [{ productId, mode, amount, currency }], fees: [{ currency, amount }], coordinate, pending }
// pending = hay un fijo pero todavía no se sabe la provincia (no hay monto que mostrar).
export function computeShipping({ vendor, items, zone }) {
  const fees = {};
  const add = (currency, amount) => {
    if (amount > 0) fees[currency] = (fees[currency] ?? 0) + amount;
  };
  let coordinate = false;
  let pending = false;

  if (vendor?.storeShippingMode) {
    const s = effectiveShipping(null, vendor);
    if (s.mode === "COORDINATE") coordinate = true;
    if (s.mode === "FIXED") {
      const fee = feeFor(s, zone);
      if (fee === null) pending = true;
      else add(s.currency, fee);
    }
    return {
      source: "STORE",
      zone,
      mode: s.mode,
      storeFee: s.mode === "FIXED" ? { local: s.local, other: s.other, currency: s.currency } : null,
      lines: items.map((i) => ({ productId: i.productId, mode: null, amount: null, currency: null })),
      fees: Object.entries(fees).map(([currency, amount]) => ({ currency, amount })),
      coordinate,
      pending,
    };
  }

  const lines = items.map((i) => {
    const s = effectiveShipping(i.product, vendor);
    if (s.mode === "COORDINATE") {
      coordinate = true;
      return { productId: i.productId, mode: "COORDINATE", amount: null, currency: null };
    }
    if (s.mode === "FIXED") {
      const unit = feeFor(s, zone);
      if (unit === null) {
        pending = true;
        return { productId: i.productId, mode: "FIXED", amount: null, currency: s.currency, local: s.local, other: s.other, perUnit: s.perUnit };
      }
      const amount = Math.round(unit * (s.perUnit ? i.quantity : 1) * 100) / 100;
      add(s.currency, amount);
      return { productId: i.productId, mode: "FIXED", amount, unit, currency: s.currency, perUnit: s.perUnit };
    }
    return { productId: i.productId, mode: "FREE", amount: 0, currency: null };
  });
  return {
    source: "PRODUCT",
    zone,
    mode: null,
    storeFee: null,
    lines,
    fees: Object.entries(fees).map(([currency, amount]) => ({ currency, amount })),
    coordinate,
    pending,
  };
}

// Valida un envío fijo antes de guardarlo (tienda o producto): los dos precios y la moneda son obligatorios.
export function fixedShippingError({ mode, local, other, currency }) {
  if (mode !== "FIXED") return null;
  if (num(local) === null || num(other) === null) return "Indica el precio del envío dentro y fuera de tu provincia.";
  if (num(local) < 0 || num(other) < 0) return "El precio del envío no puede ser negativo.";
  if (!currency) return "Elige la moneda del envío.";
  return null;
}
