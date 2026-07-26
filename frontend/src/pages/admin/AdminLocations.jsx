import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Globe2, MapPin, Plus, Pencil, SlidersHorizontal, Trash2, ChevronRight, Search, Image as ImageIcon } from "lucide-react";
import { api } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";

function PlanLimitsPanel() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (settings && !form) {
      setForm({
        maxDeliveryCountriesRegular: settings.maxDeliveryCountriesRegular,
        maxDeliveryCountriesBusiness: settings.maxDeliveryCountriesBusiness,
        maxProvincesRegular: settings.maxProvincesRegular,
        maxProvincesBusiness: settings.maxProvincesBusiness,
      });
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: async () => (await api.patch("/admin/settings/plan-limits", form)).data,
    onSuccess: () => {
      toast.success("Límites actualizados.");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  if (!form) return null;
  const businessUnlimited = form.maxProvincesBusiness === null;

  return (
    <div className="mb-8 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
        <SlidersHorizontal className="h-4 w-4 text-tertiary-accent" /> Límites de entrega por plan
      </div>
      <p className="mb-5 text-[12.5px] text-outline">
        Define la cantidad de países y subdivisiones que cada tienda puede configurar según su nivel de suscripción.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-surface-container-high bg-surface-container/30 p-3.5">
          <span className="mb-1.5 block text-label-md font-semibold text-on-surface-variant">Países de entrega · Plan Regular</span>
          <input
            type="number"
            min={0}
            value={form.maxDeliveryCountriesRegular}
            onChange={(e) => setForm((f) => ({ ...f, maxDeliveryCountriesRegular: Number(e.target.value) }))}
            className="h-10 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-tertiary-accent"
          />
        </div>
        <div className="rounded-xl border border-surface-container-high bg-surface-container/30 p-3.5">
          <span className="mb-1.5 block text-label-md font-semibold text-on-surface-variant">Países de entrega · Plan Business</span>
          <input
            type="number"
            min={0}
            value={form.maxDeliveryCountriesBusiness}
            onChange={(e) => setForm((f) => ({ ...f, maxDeliveryCountriesBusiness: Number(e.target.value) }))}
            className="h-10 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-tertiary-accent"
          />
        </div>
        <div className="rounded-xl border border-surface-container-high bg-surface-container/30 p-3.5">
          <span className="mb-1.5 block text-label-md font-semibold text-on-surface-variant">Provincias/Estados · Plan Regular</span>
          <input
            type="number"
            min={0}
            value={form.maxProvincesRegular}
            onChange={(e) => setForm((f) => ({ ...f, maxProvincesRegular: Number(e.target.value) }))}
            className="h-10 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-tertiary-accent"
          />
        </div>
        <div className="rounded-xl border border-surface-container-high bg-surface-container/30 p-3.5">
          <span className="mb-1.5 block text-label-md font-semibold text-on-surface-variant">Provincias/Estados · Plan Business</span>
          <div className="flex items-center gap-2.5">
            <input
              type="number"
              min={0}
              disabled={businessUnlimited}
              value={form.maxProvincesBusiness ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, maxProvincesBusiness: e.target.value === "" ? 0 : Number(e.target.value) }))}
              className="h-10 flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none disabled:opacity-50 focus:border-tertiary-accent"
            />
            <label className="flex items-center gap-1.5 whitespace-nowrap text-[12px] font-semibold text-on-surface-variant">
              <input
                type="checkbox"
                checked={businessUnlimited}
                onChange={(e) => setForm((f) => ({ ...f, maxProvincesBusiness: e.target.checked ? null : 1 }))}
                className="h-4 w-4 rounded accent-tertiary-accent"
              />
              Sin límite
            </label>
          </div>
        </div>
      </div>
      <Button className="mt-5 rounded-xl px-5" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? "Guardando..." : "Guardar cambios de límites"}
      </Button>
    </div>
  );
}

function ProductImageLinksPanel() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });

  const toggle = useMutation({
    mutationFn: async (allowProductImageLinks) => (await api.patch("/admin/settings/product-settings", { allowProductImageLinks })).data,
    onSuccess: () => {
      toast.success("Configuración actualizada.");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  if (!settings) return null;

  return (
    <div className="mb-8 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
        <ImageIcon className="h-4 w-4 text-tertiary-accent" /> Imágenes de producto por link
      </div>
      <p className="mb-4 text-[12.5px] text-outline">
        Permite que los vendedores agreguen fotos de producto pegando un link externo, además de subir el archivo. Desactivalo
        si prefieres que todas las imágenes pasen únicamente por la subida de archivos del servidor.
      </p>
      <label className="flex w-fit cursor-pointer items-center gap-2.5 rounded-xl border border-surface-container-high bg-surface-container/30 p-3.5 text-[13.5px] font-semibold text-on-surface">
        <input
          type="checkbox"
          checked={settings.allowProductImageLinks}
          onChange={(e) => toggle.mutate(e.target.checked)}
          disabled={toggle.isPending}
          className="h-4 w-4 rounded accent-tertiary-accent"
        />
        Permitir agregar imágenes por link externo
      </label>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <h2 className="mb-4 text-title-lg font-bold text-on-surface">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function CountryModal({ country, onClose }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState(country?.code ?? "");
  const [name, setName] = useState(country?.name ?? "");

  const save = useMutation({
    mutationFn: async () =>
      country
        ? (await api.patch(`/admin/locations/countries/${country.id}`, { code, name })).data
        : (await api.post("/admin/locations/countries", { code, name })).data,
    onSuccess: () => {
      toast.success(country ? "País actualizado." : "País agregado.");
      queryClient.invalidateQueries({ queryKey: ["admin-countries"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el país."),
  });

  return (
    <Modal title={country ? "Editar país" : "Agregar país disponible"} onClose={onClose}>
      <div className="mb-4 flex flex-col gap-4">
        <Input label="Nombre del País" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Estados Unidos, Cuba, España" />
        <Input label="Código ISO corto" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Ej: US, CU, ES" maxLength={5} />
      </div>
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancelar</Button>
        <Button className="flex-1 rounded-xl" disabled={!name.trim() || !code.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando..." : "Guardar País"}
        </Button>
      </div>
    </Modal>
  );
}

function ProvinceModal({ province, countries, preselectedCountryId, onClose }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState(province?.code ?? "");
  const [name, setName] = useState(province?.name ?? "");
  const [countryId, setCountryId] = useState(province?.country?.id ?? preselectedCountryId ?? countries?.[0]?.id ?? "");
  const [type, setType] = useState(province?.type ?? "PROVINCE");
  const [isActive, setIsActive] = useState(province?.isActive ?? true);

  const save = useMutation({
    mutationFn: async () =>
      province?.id
        ? (await api.patch(`/admin/locations/provinces/${province.id}`, { code, name, countryId, type, isActive })).data
        : (await api.post("/admin/locations/provinces", { code, name, countryId, type, isActive })).data,
    onSuccess: () => {
      toast.success(province?.id ? "Subdivisión actualizada." : "Subdivisión agregada.");
      queryClient.invalidateQueries({ queryKey: ["admin-provinces"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  return (
    <Modal title={province?.id ? "Editar Estado / Provincia" : "Agregar Estado o Provincia"} onClose={onClose}>
      <div className="mb-4 flex flex-col gap-4">
        <Select label="País Vinculado" value={countryId} onChange={(e) => setCountryId(e.target.value)}>
          {countries?.map((c) => (
            <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
          ))}
        </Select>
        <Select label="Tipo de Subdivisión" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="PROVINCE">Provincia (Requiere o admite Municipios)</option>
          <option value="STATE">Estado (Sin división en municipios)</option>
        </Select>
        <Input label="Nombre de la Subdivisión" value={name} onChange={(e) => setName(e.target.value)} placeholder={type === "STATE" ? "Ej: Florida, Texas" : "Ej: La Habana, Santiago"} />
        <Input label="Código corto / Abreviatura" value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} placeholder={type === "STATE" ? "fl" : "hab"} maxLength={10} />
        {province?.id && (
          <label className="flex items-center gap-2.5 rounded-xl border border-surface-container-high bg-surface-container/30 p-3 text-[13.5px] font-semibold text-on-surface cursor-pointer">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4 rounded accent-tertiary-accent" />
            Subdivisión activa para tiendas y clientes
          </label>
        )}
      </div>
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancelar</Button>
        <Button className="flex-1 rounded-xl" disabled={!name.trim() || !code.trim() || !countryId || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando..." : "Guardar Subdivisión"}
        </Button>
      </div>
    </Modal>
  );
}

function MunicipalityModal({ province, municipality, onClose }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(municipality?.name ?? "");
  const [isActive, setIsActive] = useState(municipality?.isActive ?? true);

  const save = useMutation({
    mutationFn: async () =>
      municipality?.id
        ? (await api.patch(`/admin/locations/municipalities/${municipality.id}`, { name, isActive })).data
        : (await api.post(`/admin/locations/provinces/${province.id}/municipalities`, { name })).data,
    onSuccess: () => {
      toast.success(municipality?.id ? "Municipio actualizado." : "Municipio agregado.");
      queryClient.invalidateQueries({ queryKey: ["admin-provinces"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el municipio."),
  });

  return (
    <Modal title={municipality?.id ? "Editar Municipio" : `Agregar Municipio a ${province.name}`} onClose={onClose}>
      <div className="mb-4 flex flex-col gap-4">
        <Input label="Nombre del Municipio" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Plaza de la Revolución, Centro Habana" />
        {municipality?.id && (
          <label className="flex items-center gap-2.5 rounded-xl border border-surface-container-high bg-surface-container/30 p-3 text-[13.5px] font-semibold text-on-surface cursor-pointer">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4 rounded accent-tertiary-accent" />
            Municipio activo
          </label>
        )}
      </div>
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancelar</Button>
        <Button className="flex-1 rounded-xl" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando..." : "Guardar Municipio"}
        </Button>
      </div>
    </Modal>
  );
}

export default function AdminLocations() {
  const queryClient = useQueryClient();
  const [selectedCountryId, setSelectedCountryId] = useState(null);
  const [countrySearch, setCountrySearch] = useState("");
  const [countryModal, setCountryModal] = useState(null);
  const [provinceModal, setProvinceModal] = useState(null);
  const [municipalityFor, setMunicipalityFor] = useState(null);
  const [municipalityModal, setMunicipalityModal] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [expandedProvinceIds, setExpandedProvinceIds] = useState(new Set());

  const { data: countries = [] } = useQuery({
    queryKey: ["admin-countries"],
    queryFn: async () => (await api.get("/admin/locations/countries")).data.countries,
  });

  const { data: provinces = [] } = useQuery({
    queryKey: ["admin-provinces"],
    queryFn: async () => (await api.get("/admin/locations/provinces")).data.provinces,
  });

  // Auto-select first country if none selected
  useEffect(() => {
    if (countries.length > 0 && !selectedCountryId) {
      setSelectedCountryId(countries[0].id);
    }
  }, [countries, selectedCountryId]);

  const selectedCountry = useMemo(() => countries.find((c) => c.id === selectedCountryId), [countries, selectedCountryId]);

  const filteredCountries = useMemo(() => {
    if (!countrySearch.trim()) return countries;
    return countries.filter(
      (c) => c.name.toLowerCase().includes(countrySearch.toLowerCase()) || c.code.toLowerCase().includes(countrySearch.toLowerCase())
    );
  }, [countries, countrySearch]);

  const countryProvinces = useMemo(() => {
    if (!selectedCountryId) return [];
    return provinces.filter((p) => p.country?.id === selectedCountryId);
  }, [provinces, selectedCountryId]);

  const toggleCountry = useMutation({
    mutationFn: async (c) => (await api.patch(`/admin/locations/countries/${c.id}`, { isActive: !c.isActive })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-countries"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar."),
  });

  const toggleSubdivision = useMutation({
    mutationFn: async ({ id, type, isActive }) =>
      type === "PROVINCE"
        ? (await api.patch(`/admin/locations/provinces/${id}`, { isActive })).data
        : (await api.patch(`/admin/locations/municipalities/${id}`, { isActive })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-provinces"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar el estado."),
  });

  const deleteCountry = useMutation({
    mutationFn: async (id) => (await api.delete(`/admin/locations/countries/${id}`)).data,
    onSuccess: () => {
      toast.success("País eliminado correctamente.");
      setItemToDelete(null);
      setSelectedCountryId(null);
      queryClient.invalidateQueries({ queryKey: ["admin-countries"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo eliminar el país."),
  });

  const deleteSubdivision = useMutation({
    mutationFn: async ({ id, type }) =>
      type === "PROVINCE"
        ? (await api.delete(`/admin/locations/provinces/${id}`)).data
        : (await api.delete(`/admin/locations/municipalities/${id}`)).data,
    onSuccess: () => {
      toast.success("Eliminado correctamente.");
      setItemToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["admin-provinces"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo eliminar porque tiene dependencias activas."),
  });

  function toggleExpandProvince(id) {
    setExpandedProvinceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-surface-container-high pb-6">
        <div>
          <h1 className="text-display-sm font-extrabold text-on-surface">Ubicaciones y Territorios</h1>
          <p className="text-body-md text-outline">
            Configuración global de países, estados, provincias y municipios disponibles para venta y entregas.
          </p>
        </div>
        <Button className="rounded-xl font-bold shadow-sm" onClick={() => setCountryModal({})}>
          <Plus className="h-4 w-4 mr-1" /> Nuevo País
        </Button>
      </div>

      {/* Plan Limits Card */}
      <PlanLimitsPanel />
      <ProductImageLinksPanel />

      {/* Modern Master-Detail Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Pane: Countries Master List (4 Cols) */}
        <div className="lg:col-span-4">
          <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[14px] font-bold text-on-surface">
                <Globe2 className="h-4.5 w-4.5 text-tertiary-accent" /> Países Disponibles ({countries.length})
              </div>
            </div>

            {/* Country Search */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-outline" />
              <input
                type="text"
                placeholder="Buscar país..."
                value={countrySearch}
                onChange={(e) => setCountrySearch(e.target.value)}
                className="h-9 w-full rounded-xl border border-outline-variant bg-surface-container/40 pl-9 pr-3 text-[12.5px] outline-none focus:border-tertiary-accent focus:bg-surface-container-lowest"
              />
            </div>

            {/* Country Cards List */}
            <div className="flex flex-col gap-2 max-h-[600px] overflow-y-auto pr-1">
              {filteredCountries.map((c) => {
                const isSelected = c.id === selectedCountryId;
                const provCount = provinces.filter((p) => p.country?.id === c.id).length;
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedCountryId(c.id)}
                    className={`group flex cursor-pointer items-center justify-between rounded-xl border p-3.5 transition-all ${
                      isSelected
                        ? "border-tertiary-accent bg-tertiary-accent/5 shadow-sm"
                        : "border-surface-container-high bg-surface-container-lowest hover:border-outline-variant hover:bg-surface-container/20"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`font-mono text-[12px] font-bold px-2 py-0.5 rounded-md ${
                        isSelected ? "bg-tertiary-accent text-on-tertiary" : "bg-surface-container-high text-on-surface-variant"
                      }`}>
                        {c.code}
                      </span>
                      <div>
                        <div className="text-[13.5px] font-bold text-on-surface">{c.name}</div>
                        <div className="text-[11.5px] text-outline">{provCount} subdivisión(es)</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleCountry.mutate(c); }}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold transition ${
                          c.isActive ? "bg-verified/15 text-verified-dark" : "bg-surface-container-high text-outline"
                        }`}
                      >
                        {c.isActive ? "Activo" : "Inactivo"}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setCountryModal(c); }}
                        className="text-outline opacity-0 group-hover:opacity-100 hover:text-tertiary-accent transition"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <ChevronRight className={`h-4 w-4 transition-transform ${isSelected ? "text-tertiary-accent translate-x-0.5" : "text-outline/40"}`} />
                    </div>
                  </div>
                );
              })}
              {filteredCountries.length === 0 && (
                <p className="p-4 text-center text-[12.5px] text-outline">No se encontraron países.</p>
              )}
            </div>
          </div>
        </div>

        {/* Right Pane: Selected Country Detail & Subdivisions (8 Cols) */}
        <div className="lg:col-span-8">
          {selectedCountry ? (
            <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
              {/* Selected Country Header */}
              <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-surface-container-high pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-title-md font-black text-tertiary-accent">{selectedCountry.code}</span>
                    <h2 className="text-title-xl font-black text-on-surface">{selectedCountry.name}</h2>
                    <span className={`ml-2 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                      selectedCountry.isActive ? "bg-verified/15 text-verified-dark" : "bg-surface-container-high text-outline"
                    }`}>
                      {selectedCountry.isActive ? "Estado Global Activo" : "Inactivo Globalmente"}
                    </span>
                  </div>
                  <p className="text-[12.5px] text-outline mt-0.5">
                    Estados, Provincias y Municipios vinculados a {selectedCountry.name}.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="rounded-xl text-[12.5px] border-error text-error hover:bg-error/10 hover:text-error"
                    onClick={() => setItemToDelete({ id: selectedCountry.id, type: "COUNTRY", name: selectedCountry.name })}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Eliminar País
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-xl text-[12.5px]"
                    onClick={() => setCountryModal(selectedCountry)}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Editar País
                  </Button>
                  <Button
                    className="rounded-xl text-[12.5px] font-bold"
                    onClick={() => setProvinceModal({ countryId: selectedCountry.id })}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Agregar Estado / Provincia
                  </Button>
                </div>
              </div>

              {/* Subdivisions List */}
              <div className="flex flex-col gap-3">
                {countryProvinces.map((p) => {
                  const isExpanded = expandedProvinceIds.has(p.id);
                  return (
                    <div
                      key={p.id}
                      className="rounded-xl border border-surface-container-high bg-surface-container-lowest overflow-hidden transition-all hover:border-outline-variant"
                    >
                      {/* Main Subdivision Row */}
                      <div className="flex items-center justify-between p-4 bg-surface-container/20">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-[12px] font-bold text-outline bg-surface-container-high px-2 py-0.5 rounded">
                            {p.code}
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-[14px] font-bold text-on-surface">{p.name}</span>
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                p.type === "STATE" ? "bg-purple-100 text-purple-700 border border-purple-200" : "bg-blue-100 text-blue-700 border border-blue-200"
                              }`}>
                                {p.type === "STATE" ? "Estado" : "Provincia"}
                              </span>
                            </div>
                            {p.type !== "STATE" && (
                              <button
                                onClick={() => toggleExpandProvince(p.id)}
                                className="text-[11.5px] font-semibold text-tertiary-accent hover:underline flex items-center gap-1 mt-0.5"
                              >
                                {p.municipalities?.length ?? 0} municipio(s) vinculados
                                <span className={`inline-block transition-transform ${isExpanded ? "rotate-90" : ""}`}>▶</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Controls */}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleSubdivision.mutate({ id: p.id, type: "PROVINCE", isActive: !p.isActive })}
                            className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                              p.isActive ? "bg-verified/15 text-verified-dark" : "bg-surface-container-high text-outline"
                            }`}
                          >
                            {p.isActive ? "Activa" : "Inactiva"}
                          </button>

                          {p.type !== "STATE" && (
                            <button
                              onClick={() => setMunicipalityFor(p)}
                              className="rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 py-1 text-[11.5px] font-semibold text-on-surface hover:bg-surface-container"
                            >
                              + Municipio
                            </button>
                          )}

                          <button
                            onClick={() => setProvinceModal(p)}
                            className="rounded-lg p-1.5 text-outline hover:bg-surface-container hover:text-tertiary-accent transition"
                            title="Editar"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setItemToDelete({ id: p.id, type: "PROVINCE", name: p.name })}
                            className="rounded-lg p-1.5 text-outline hover:bg-error/10 hover:text-error transition"
                            title="Eliminar"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      {/* Municipalities Drawer (Only if PROVINCE and expanded) */}
                      {p.type !== "STATE" && isExpanded && (
                        <div className="border-t border-surface-container-high bg-surface-container/10 p-4">
                          <div className="mb-2 flex items-center justify-between text-[12px] font-bold text-outline uppercase tracking-wider">
                            <span>Municipios en {p.name}</span>
                            <button
                              onClick={() => setMunicipalityFor(p)}
                              className="text-tertiary-accent hover:underline font-semibold text-[11.5px]"
                            >
                              + Agregar Municipio
                            </button>
                          </div>
                          {p.municipalities && p.municipalities.length > 0 ? (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {p.municipalities.map((m) => (
                                <div
                                  key={m.id}
                                  className="flex items-center justify-between rounded-lg border border-surface-container-high bg-surface-container-lowest px-3 py-2"
                                >
                                  <span className="text-[12.5px] font-semibold text-on-surface">{m.name}</span>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      onClick={() => toggleSubdivision.mutate({ id: m.id, type: "MUNICIPALITY", isActive: !m.isActive })}
                                      className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold ${
                                        m.isActive ? "bg-verified/15 text-verified-dark" : "bg-surface-container-high text-outline"
                                      }`}
                                    >
                                      {m.isActive ? "Activo" : "Inactivo"}
                                    </button>
                                    <button
                                      onClick={() => { setMunicipalityFor(p); setMunicipalityModal(m); }}
                                      className="text-outline hover:text-tertiary-accent p-1"
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </button>
                                    <button
                                      onClick={() => setItemToDelete({ id: m.id, type: "MUNICIPALITY", name: m.name })}
                                      className="text-outline hover:text-error p-1"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="py-2 text-[12px] text-outline italic">No hay municipios cargados aún.</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {countryProvinces.length === 0 && (
                  <div className="rounded-xl border border-dashed border-outline-variant p-8 text-center">
                    <MapPin className="mx-auto h-8 w-8 text-outline/50 mb-2" />
                    <p className="text-[13.5px] font-semibold text-on-surface">Sin subdivisiones para {selectedCountry.name}</p>
                    <p className="text-[12px] text-outline mb-4">Agrega los estados o provincias donde operarán los vendedores en este país.</p>
                    <Button
                      className="rounded-xl text-[12.5px]"
                      onClick={() => setProvinceModal({ countryId: selectedCountry.id })}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> Agregar primera subdivisión
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-outline-variant p-12 text-center bg-surface-container-lowest">
              <Globe2 className="mx-auto h-10 w-10 text-outline/40 mb-3" />
              <p className="text-[14px] font-bold text-on-surface">Selecciona un país de la lista</p>
              <p className="text-[12.5px] text-outline">Verás y podrás gestionar sus estados, provincias y municipios.</p>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {countryModal && <CountryModal country={countryModal.id ? countryModal : null} onClose={() => setCountryModal(null)} />}
      {provinceModal && (
        <ProvinceModal
          province={provinceModal.id ? provinceModal : null}
          countries={countries}
          preselectedCountryId={provinceModal.countryId || selectedCountryId}
          onClose={() => setProvinceModal(null)}
        />
      )}
      {municipalityFor && (
        <MunicipalityModal
          province={municipalityFor}
          municipality={municipalityModal}
          onClose={() => { setMunicipalityFor(null); setMunicipalityModal(null); }}
        />
      )}
      {itemToDelete && (
        <ConfirmDeleteModal
          title={`¿Eliminar ${itemToDelete.name}?`}
          description="Si está en uso por alguna tienda no se va a poder eliminar. Para esos casos, puedes marcarlo como inactivo en su lugar."
          pending={itemToDelete.type === "COUNTRY" ? deleteCountry.isPending : deleteSubdivision.isPending}
          onConfirm={() => {
            if (itemToDelete.type === "COUNTRY") {
              deleteCountry.mutate(itemToDelete.id);
            } else {
              deleteSubdivision.mutate(itemToDelete);
            }
          }}
          onCancel={() => setItemToDelete(null)}
        />
      )}
    </div>
  );
}
