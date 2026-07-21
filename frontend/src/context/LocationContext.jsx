import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api } from "../lib/api.js";

// Ubicación global del comprador (provincia + municipio), usada por el
// selector del Header y para personalizar Home/Catálogo ("Destacados en
// {provincia}"). Persistida en localStorage para no perderla entre sesiones.
// NOTA: el hook se llama `useZone` (no `useLocation`) para no chocar con el
// hook de react-router-dom del mismo nombre.
// Bloque 12: el filtro de provincia arranca SIN selección — antes forzaba
// "La Habana" por defecto, lo que ocultaba el resto del catálogo sin que el
// visitante hubiera elegido nada. Ahora solo se aplica un filtro si el
// usuario (o una sesión previa vía localStorage) lo eligió explícitamente.
const LocationContext = createContext(null);
const STORAGE_KEY = "zeudin_loc";

export function LocationProvider({ children }) {
  const [provinces, setProvinces] = useState([]);
  const [municipalities, setMunicipalities] = useState([]);
  const [provinceId, setProvinceId] = useState(null);
  const [municipalityId, setMunicipalityId] = useState(null);
  const [loading, setLoading] = useState(true);

  function readSaved() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    } catch {
      return null;
    }
  }

  useEffect(() => {
    api.get("/locations/provinces").then(({ data }) => {
      setProvinces(data.provinces);
      const saved = readSaved();
      const initial = data.provinces.find((p) => p.id === saved?.provinceId) ?? null;
      setProvinceId(initial?.id ?? null);
      if (!initial) setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!provinceId) return;
    setLoading(true);
    api.get(`/locations/provinces/${provinceId}/municipalities`).then(({ data }) => {
      setMunicipalities(data.municipalities);
      const saved = readSaved();
      // Sin municipio guardado, arrancamos SIN filtro de municipio (no el
      // primero alfabético) — de lo contrario el catálogo puede verse vacío
      // por defecto si ese municipio puntual no tiene vendedores.
      const stillValid = saved?.provinceId === provinceId && data.municipalities.some((m) => m.id === saved?.municipalityId);
      setMunicipalityId(stillValid ? saved.municipalityId : null);
      setLoading(false);
    });
  }, [provinceId]);

  useEffect(() => {
    if (!provinceId) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ provinceId, municipalityId }));
  }, [provinceId, municipalityId]);

  // id vacío ("" del <option> "Todas las provincias", o null desde el botón
  // "Limpiar filtro") vuelve a mostrar todo el catálogo sin importar provincia.
  const setProvince = useCallback((id) => {
    if (!id) {
      setProvinceId(null);
      setMunicipalityId(null);
      setMunicipalities([]);
      setLoading(false);
      return;
    }
    setProvinceId(id);
  }, []);
  const setMunicipality = useCallback((id) => setMunicipalityId(id), []);
  const clearFilter = useCallback(() => setProvince(null), [setProvince]);

  const province = provinces.find((p) => p.id === provinceId) ?? null;
  const municipality = municipalities.find((m) => m.id === municipalityId) ?? null;

  return (
    <LocationContext.Provider
      value={{
        provinces,
        municipalities,
        provinceId,
        municipalityId,
        hasProvinceFilter: !!provinceId,
        provinceName: province?.name ?? "Cuba",
        municipalityName: municipality?.name ?? "",
        setProvince,
        setMunicipality,
        clearFilter,
        loading,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useZone() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error("useZone debe usarse dentro de <LocationProvider>");
  return ctx;
}
