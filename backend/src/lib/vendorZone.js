// Zona donde el comprador quiere comprar (país > provincia o estado > municipio). Una tienda "pertenece" a una zona por sus
// ubicaciones (VendorLocation). Elegir solo el país trae las tiendas de todo el país; elegir la provincia, las de todos sus
// municipios; elegir también el municipio, solo ese. Las ubicaciones antiguas guardaban solo la provincia, por eso el país también
// se reconoce a través de ella.
export function vendorZoneWhere({ countryId, provinceId, municipalityId } = {}) {
  if (provinceId) {
    // Con municipio elegido salen las tiendas de ese municipio y también las que cubren "todos los municipios" de la provincia (zona sin
    // municipio concreto): una tienda que atiende toda la provincia atiende también ese municipio.
    return municipalityId
      ? { some: { provinceId: String(provinceId), OR: [{ municipalityId: String(municipalityId) }, { municipalityId: null }] } }
      : { some: { provinceId: String(provinceId) } };
  }
  if (countryId) {
    return { some: { OR: [{ countryId: String(countryId) }, { province: { countryId: String(countryId) } }] } };
  }
  return undefined;
}

// Lugar propio de un anuncio de venta rápida (país, provincia o estado y municipio que eligió el dueño al publicarlo). Con municipio
// elegido por el comprador salen solo los anuncios de ese municipio; con "todos" (solo provincia), los de toda la provincia; con
// solo país, los de todo el país.
export function listingZoneWhere({ countryId, provinceId, municipalityId } = {}) {
  if (provinceId) return municipalityId ? { provinceId: String(provinceId), municipalityId: String(municipalityId) } : { provinceId: String(provinceId) };
  if (countryId) return { countryId: String(countryId) };
  return {};
}

// Zona de servicio de una tienda en texto, una entrada por provincia o estado: "Segundo Frente (Santiago de Cuba)",
// "Segundo Frente, Songo-La Maya (Santiago de Cuba)" o "Santiago de Cuba (toda la provincia)". Un municipio escrito a mano
// por la tienda (todavía sin aprobar en el catálogo) se muestra con su nombre; si se pasa `pendingMark`, se agrega al final de
// esa provincia (ej. " · municipio por aprobar").
// Espera ubicaciones con `province` y `municipality` incluidos (y `country` para las de un país sin provincia).
export function describeVendorZones(locations = [], { pendingMark = "" } = {}) {
  const groups = new Map();
  for (const l of locations) {
    const place = l.province?.name ?? l.stateOther ?? l.country?.name ?? l.countryOther ?? null;
    if (!place) continue;
    const key = l.provinceId ?? `otro:${place}`;
    if (!groups.has(key)) groups.set(key, { place, isState: l.province?.type === "STATE", whole: false, towns: [], pending: false });
    const g = groups.get(key);
    const town = l.municipality?.name ?? l.municipalityOther ?? null;
    if (!l.municipality && l.municipalityOther) g.pending = true;
    if (town) g.towns.push(town);
    else g.whole = true;
  }
  return [...groups.values()].map((g) =>
    g.whole || !g.towns.length
      ? `${g.place} (${g.isState ? "todo el estado" : "toda la provincia"})`
      : `${[...new Set(g.towns)].sort((a, b) => a.localeCompare(b, "es")).join(", ")} (${g.place})${g.pending ? pendingMark : ""}`
  );
}
