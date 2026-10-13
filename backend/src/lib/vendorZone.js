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
  // Con municipio elegido también salen los anuncios de quien tiene su provincia pero nunca indicó el municipio (cuentas antiguas):
  // exigirlo dejaría fuera casi todos los anuncios.
  if (provinceId) {
    return municipalityId
      ? { provinceId: String(provinceId), OR: [{ municipalityId: String(municipalityId) }, { municipalityId: null }] }
      : { provinceId: String(provinceId) };
  }
  if (countryId) return { OR: [{ registrationCountryId: String(countryId) }, { province: { countryId: String(countryId) } }] };
  return undefined;
}
