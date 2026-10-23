// Zona de servicio de una tienda en texto, igual que describeVendorZones del backend (lib/vendorZone.js): una parte por
// provincia o estado. "Segundo Frente, Santiago de Cuba" si es un solo municipio; "Segundo Frente, Songo-La Maya (Santiago de
// Cuba)" si son varios; "Toda la provincia de Santiago de Cuba" si atiende la provincia entera. Varias provincias van con " · ".
export function vendorZoneLabel(locations = []) {
  const groups = new Map();
  for (const l of locations) {
    const place = l.province?.name ?? l.stateOther ?? l.country?.name ?? l.countryOther ?? null;
    if (!place) continue;
    const key = l.provinceId ?? `otro:${place}`;
    if (!groups.has(key)) groups.set(key, { place, isState: l.province?.type === "STATE", whole: false, towns: new Set() });
    const g = groups.get(key);
    const town = l.municipality?.name ?? l.municipalityOther ?? null;
    if (town) g.towns.add(town);
    else g.whole = true;
  }
  return [...groups.values()]
    .map((g) => {
      if (g.whole || !g.towns.size) return `${g.isState ? "Todo el estado de" : "Toda la provincia de"} ${g.place}`;
      const towns = [...g.towns].sort((a, b) => a.localeCompare(b, "es"));
      return towns.length === 1 ? `${towns[0]}, ${g.place}` : `${towns.join(", ")} (${g.place})`;
    })
    .join(" · ");
}
