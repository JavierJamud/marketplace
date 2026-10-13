// Zona donde el comprador quiere comprar (país > provincia o estado > municipio). Una tienda "pertenece" a una zona por sus
// ubicaciones (VendorLocation). Elegir solo el país trae las tiendas de todo el país; elegir la provincia, las de todos sus
// municipios; elegir también el municipio, solo ese. Las ubicaciones antiguas guardaban solo la provincia, por eso el país también
// se reconoce a través de ella.
export function vendorZoneWhere({ countryId, provinceId, municipalityId } = {}) {
  if (provinceId) {
    return { some: { provinceId: String(provinceId), municipalityId: municipalityId ? String(municipalityId) : undefined } };
  }
  if (countryId) {
    return { some: { OR: [{ countryId: String(countryId) }, { province: { countryId: String(countryId) } }] } };
  }
  return undefined;
}

// Dueño de un anuncio de venta rápida en esa zona (el cliente no tiene tienda: se usa su ubicación de perfil).
export function ownerZoneWhere({ countryId, provinceId, municipalityId } = {}) {
  // Los anuncios son de personas, no de tiendas con sede fija: aunque el comprador haya afinado hasta un municipio, se le muestran los de
  // toda la provincia (un anuncio de Segundo Frente le sirve a quien compra en Santiago de Cuba). El municipio solo afina las tiendas.
  if (provinceId) return { provinceId: String(provinceId) };
  if (countryId) return { OR: [{ registrationCountryId: String(countryId) }, { province: { countryId: String(countryId) } }] };
  return undefined;
}
