// Envío de un pedido. Un solo lugar decide qué se cobra, para que nunca se cobre dos veces:
// - Si la tienda tiene envío propio (Vendor.storeShippingMode: FIXED o COORDINATE), manda ese y los envíos de cada
//   producto quedan suspendidos (no se borran: si la tienda vuelve a "por producto", cada uno recupera el suyo).
//   El fijo de tienda se cobra una vez por pedido.
// - Si no, cada producto aporta el suyo: FREE (gratis, lo normal), FIXED (por pedido o por unidad) o COORDINATE.
// El precio fijo depende de la provincia de entrega: "LOCAL" si es la provincia desde donde envía la tienda
// (Vendor.shippingOriginProvinceId), "OTHER" cualquier otra provincia o país. Sin provincia todavía (checkout a medio llenar) la zona es null y el monto queda pendiente.
// El envío nunca se suma a `total` en otra moneda: se agrupa por moneda (no hay tipo de cambio en el sistema).
// Copia exacta de backend/src/lib/shipping.js (el servidor es el que cobra; esta es para mostrarlo antes de pedir). Si
// cambias una, cambia la otra.

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

// --- Solo en la web: textos para mostrar el envío --------------------------------------------------------------------

const money = (amount, currency) => `${Number(amount).toLocaleString("es-CU")} ${currency}`;

// Provincia desde donde envía la tienda (la que eligió, o la de su primera ubicación): igual que el servidor.
export function originProvinceId(vendor) {
  return vendor?.shippingOriginProvinceId ?? vendor?.locations?.find((l) => l.provinceId)?.provinceId ?? null;
}

// Texto corto del envío de un producto, para su tarjeta y su ficha. kind: "free" | "fixed" | "coordinate".
export function shippingLabel(product, vendor) {
  const s = effectiveShipping(product, vendor);
  if (s.mode === "COORDINATE") return { kind: "coordinate", short: "Envío a coordinar", text: "Envío a coordinar con la tienda según dónde lo recibas" };
  if (s.mode === "FIXED") {
    const same = s.local === s.other;
    const each = s.perUnit ? " por unidad" : "";
    const scope = s.source === "STORE" ? " por pedido" : each;
    return {
      kind: "fixed",
      short: same ? `Envío ${money(s.local, s.currency)}` : `Envío desde ${money(Math.min(s.local, s.other), s.currency)}`,
      text: same
        ? `Envío ${money(s.local, s.currency)}${scope}`
        : `Envío ${money(s.local, s.currency)} en la provincia de la tienda, ${money(s.other, s.currency)} fuera de ella${scope}`,
    };
  }
  return { kind: "free", short: "Envío gratis", text: "Envío gratis" };
}

export const formatFees = (fees) => fees.map((f) => money(f.amount, f.currency)).join(" + ");

// Suma de productos por moneda: { USD: 70, CUP: 500 }.
export function itemsTotalsByCurrency(items, unitPriceOf) {
  const totals = {};
  for (const i of items) totals[i.currency ?? "CUP"] = (totals[i.currency ?? "CUP"] ?? 0) + unitPriceOf(i) * i.quantity;
  return totals;
}

// Total final por moneda: productos + envío, sin mezclar monedas ("70 USD + 100 CUP").
export function combineTotalsLabel(productTotals, fees = []) {
  const totals = { ...productTotals };
  for (const f of fees ?? []) totals[f.currency] = (totals[f.currency] ?? 0) + Number(f.amount);
  return Object.entries(totals)
    .map(([currency, amount]) => money(Math.round(amount * 100) / 100, currency))
    .join(" + ");
}

// Qué decir en la fila "Envío" del resumen. `quote` es la respuesta del servidor (POST /orders/shipping-quote o el pedido
// ya creado: { shippingFees, shippingCoordinate }).
export function shippingRowText({ fees = [], coordinate = false, pending = false }) {
  if (pending) return "Elige la provincia para calcularlo";
  if (fees.length && coordinate) return `${formatFees(fees)} + parte a coordinar`;
  if (fees.length) return formatFees(fees);
  if (coordinate) return "A coordinar con la tienda";
  return "Gratis";
}

// Texto del envío de UNA línea del pedido (solo con envío por producto).
export function lineShippingText(line) {
  if (!line || !line.mode) return null;
  if (line.mode === "FREE") return "Envío gratis";
  if (line.mode === "COORDINATE") return "Envío a coordinar";
  if (line.amount === null || line.amount === undefined) return "Envío según tu provincia";
  // Por unidad con más de una: se aclara el precio de cada una (el monto ya es el de toda la línea).
  const perUnitNote = line.perUnit && line.unit != null && Number(line.unit) !== Number(line.amount) ? ` (${money(line.unit, line.currency)} por unidad)` : "";
  return `Envío ${money(line.amount, line.currency)}${perUnitNote}`;
}

// Pedido ya creado: total a pagar (productos + envío por moneda) y texto de la fila "Envío".
export function orderTotalLabel(order) {
  const currency = order.items?.find((i) => i.currency)?.currency ?? "CUP";
  return combineTotalsLabel({ [currency]: Number(order.total ?? 0) }, order.shippingFees ?? []);
}
export const orderShippingText = (order) => shippingRowText({ fees: order.shippingFees ?? [], coordinate: !!order.shippingCoordinate });

// Envío de una línea de un pedido ya creado (OrderItem.shippingMode/shippingAmount/shippingCurrency).
export const orderLineShippingText = (it) => lineShippingText(it.shippingMode ? { mode: it.shippingMode, amount: it.shippingAmount != null ? Number(it.shippingAmount) : null, currency: it.shippingCurrency } : null);
