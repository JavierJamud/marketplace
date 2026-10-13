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
