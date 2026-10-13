import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../lib/api.js";

// Dónde quiere comprar el visitante: país > provincia o estado > municipio. Lo elige él (en la portada o al entrar al catálogo
// o a las tiendas) y vale para todo el sitio: productos, tiendas y anuncios solo muestran lo que aplica a esa zona, hasta que
// la cambie. Las opciones salen de /locations/served, que solo trae lugares donde de verdad hay tiendas. Si no elige nada, se
// ve todo. Se guarda en localStorage para recordarlo entre visitas.
// NOTA: el hook se llama `useZone` (no `useLocation`) para no chocar con el hook de react-router-dom del mismo nombre.
const LocationContext = createContext(null);
const STORAGE_KEY = "zeudin_loc";

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function LocationProvider({ children }) {
  // served: { countries, provinces, municipalities } con "count" de tiendas. null mientras carga.
  const [served, setServed] = useState(null);
  const [zone, setZone] = useState({ countryId: null, provinceId: null, municipalityId: null });

  useEffect(() => {
    let alive = true;
    api
      .get("/locations/served")
      .then(({ data }) => {
        if (!alive) return;
        setServed(data);
        // Lo guardado solo vale si ese lugar sigue teniendo tiendas.
        const saved = readSaved();
        const province = data.provinces.find((p) => p.id === saved?.provinceId) ?? null;
        const municipality = province ? data.municipalities.find((m) => m.id === saved?.municipalityId && m.provinceId === province.id) ?? null : null;
        const country = province ? data.countries.find((c) => c.id === province.countryId) ?? null : data.countries.find((c) => c.id === saved?.countryId) ?? null;
        // Un enlace que ya trae la provincia (por ejemplo desde el chat) tiene prioridad sobre lo guardado.
        setZone((z) => (z.provinceId || z.countryId ? z : { countryId: country?.id ?? null, provinceId: province?.id ?? null, municipalityId: municipality?.id ?? null }));
      })
      .catch(() => alive && setServed({ countries: [], provinces: [], municipalities: [] }));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!served) return;
    try {
      if (!zone.countryId && !zone.provinceId) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(zone));
    } catch {
      /* sin almacenamiento: la elección vale solo en esta visita */
    }
  }, [zone, served]);

  const setCountry = useCallback((id) => setZone({ countryId: id || null, provinceId: null, municipalityId: null }), []);
  // Elegir una provincia fija también su país; sin id, vuelve a "todo el país" (o a todo si no había país).
  const setProvince = useCallback(
    (id) =>
      setZone((z) => {
        if (!id) return { countryId: z.countryId, provinceId: null, municipalityId: null };
        const p = served?.provinces.find((x) => x.id === id);
        return { countryId: p?.countryId ?? z.countryId, provinceId: id, municipalityId: null };
      }),
    [served]
  );
  const setMunicipality = useCallback((id) => setZone((z) => ({ ...z, municipalityId: id || null })), []);
  const clearFilter = useCallback(() => setZone({ countryId: null, provinceId: null, municipalityId: null }), []);

  const value = useMemo(() => {
    const countries = served?.countries ?? [];
    // Solo las provincias o estados del país elegido (o de todos, si aún no eligió país).
    const provinces = (served?.provinces ?? []).filter((p) => !zone.countryId || p.countryId === zone.countryId);
    const municipalities = (served?.municipalities ?? []).filter((m) => m.provinceId === zone.provinceId);
    const country = countries.find((c) => c.id === zone.countryId) ?? null;
    const province = provinces.find((p) => p.id === zone.provinceId) ?? null;
    const municipality = municipalities.find((m) => m.id === zone.municipalityId) ?? null;
    // Nombre del lugar más específico elegido; "Cuba"-style fallback lo decide quien lo muestra (zoneName vacío = sin filtro).
    const zoneName = municipality?.name ?? province?.name ?? country?.name ?? "";
    const zoneLabel = [municipality?.name, province?.name, country?.name].filter(Boolean).join(", ");
    const params = {};
    if (zone.countryId) params.countryId = zone.countryId;
    if (zone.provinceId) params.provinceId = zone.provinceId;
    if (zone.municipalityId) params.municipalityId = zone.municipalityId;
    return {
      countries,
      provinces,
      municipalities,
      countryId: zone.countryId,
      provinceId: zone.provinceId,
      municipalityId: zone.municipalityId,
      hasZoneFilter: !!(zone.countryId || zone.provinceId),
      hasProvinceFilter: !!zone.provinceId,
      zoneName,
      zoneLabel,
      provinceName: province?.name ?? "",
      municipalityName: municipality?.name ?? "",
      // Parámetros listos para mandar al servidor en cualquier consulta de productos, tiendas o anuncios.
      zoneParams: params,
      zoneKey: `${zone.countryId ?? ""}|${zone.provinceId ?? ""}|${zone.municipalityId ?? ""}`,
      setCountry,
      setProvince,
      setMunicipality,
      clearFilter,
      loading: served === null,
    };
  }, [served, zone, setCountry, setProvince, setMunicipality, clearFilter]);

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useZone() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error("useZone debe usarse dentro de <LocationProvider>");
  return ctx;
}
