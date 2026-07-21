import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Globe2, MapPin, Plus, Pencil, SlidersHorizontal, Trash2 } from "lucide-react";
import { api } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";

// Bloque 19: límites por plan de cuántos países de entrega/provincias de
// Cuba puede cargar un vendedor — nunca una constante en el código, el
// admin los edita acá y el backend (vendors.controller.js) los lee de
// SiteSettings en cada alta.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div className="mb-8 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
      <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
        <SlidersHorizontal className="h-4 w-4 text-tertiary-accent" /> Límites por plan
      </div>
      <p className="mb-4 text-[12.5px] text-outline">
        Cuántos países de entrega y provincias de Cuba puede cargar cada tienda según su plan.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-label-md text-on-surface-variant">Países de entrega · Plan Regular</span>
          <input
            type="number"
            min={0}
            value={form.maxDeliveryCountriesRegular}
            onChange={(e) => setForm((f) => ({ ...f, maxDeliveryCountriesRegular: Number(e.target.value) }))}
            className="h-10 w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none"
          />
        </div>
        <div>
          <span className="mb-1 block text-label-md text-on-surface-variant">Países de entrega · Plan Business</span>
          <input
            type="number"
            min={0}
            value={form.maxDeliveryCountriesBusiness}
            onChange={(e) => setForm((f) => ({ ...f, maxDeliveryCountriesBusiness: Number(e.target.value) }))}
            className="h-10 w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none"
          />
        </div>
        <div>
          <span className="mb-1 block text-label-md text-on-surface-variant">Provincias de Cuba · Plan Regular</span>
          <input
            type="number"
            min={0}
            value={form.maxProvincesRegular}
            onChange={(e) => setForm((f) => ({ ...f, maxProvincesRegular: Number(e.target.value) }))}
            className="h-10 w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none"
          />
        </div>
        <div>
          <span className="mb-1 block text-label-md text-on-surface-variant">Provincias de Cuba · Plan Business</span>
          <div className="flex items-center gap-2.5">
            <input
              type="number"
              min={0}
              disabled={businessUnlimited}
              value={form.maxProvincesBusiness ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, maxProvincesBusiness: e.target.value === "" ? 0 : Number(e.target.value) }))}
              className="h-10 flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none disabled:opacity-50"
            />
            <label className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-on-surface-variant">
              <input
                type="checkbox"
                checked={businessUnlimited}
                onChange={(e) => setForm((f) => ({ ...f, maxProvincesBusiness: e.target.checked ? null : 1 }))}
              />
              Sin límite
            </label>
          </div>
        </div>
      </div>
      <Button className="mt-4" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? "Guardando..." : "Guardar límites"}
      </Button>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-surface-container-lowest p-6">
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
    <Modal title={country ? "Editar país" : "Agregar país"} onClose={onClose}>
      <div className="mb-3.5 flex flex-col gap-3.5">
        <Input label="Nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder="Cuba" />
        <Input label="Código (ISO corto)" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CU" maxLength={5} />
      </div>
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
        <Button className="flex-1" disabled={!name.trim() || !code.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando..." : "Guardar"}
        </Button>
      </div>
    </Modal>
  );
}

function ProvinceModal({ province, countries, onClose }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState(province?.code ?? "");
  const [name, setName] = useState(province?.name ?? "");
  const [countryId, setCountryId] = useState(province?.country?.id ?? countries?.[0]?.id ?? "");

  const save = useMutation({
    mutationFn: async () =>
      province
        ? (await api.patch(`/admin/locations/provinces/${province.id}`, { code, name, countryId })).data
        : (await api.post("/admin/locations/provinces", { code, name, countryId })).data,
    onSuccess: () => {
      toast.success(province ? "Provincia actualizada." : "Provincia agregada.");
      queryClient.invalidateQueries({ queryKey: ["admin-provinces"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar la provincia."),
  });

  return (
    <Modal title={province ? "Editar provincia" : "Agregar provincia"} onClose={onClose}>
      <div className="mb-3.5 flex flex-col gap-3.5">
        <Select label="País" value={countryId} onChange={(e) => setCountryId(e.target.value)}>
          {countries?.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <Input label="Nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder="La Habana" />
        <Input label="Código" value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} placeholder="hab" maxLength={10} />
      </div>
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
        <Button className="flex-1" disabled={!name.trim() || !code.trim() || !countryId || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando..." : "Guardar"}
        </Button>
      </div>
    </Modal>
  );
}

function MunicipalityModal({ province, onClose }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const save = useMutation({
    mutationFn: async () => (await api.post(`/admin/locations/provinces/${province.id}/municipalities`, { name })).data,
    onSuccess: () => {
      toast.success("Municipio agregado.");
      queryClient.invalidateQueries({ queryKey: ["admin-provinces"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo agregar el municipio."),
  });

  return (
    <Modal title={`Agregar municipio a ${province.name}`} onClose={onClose}>
      <div className="mb-3.5">
        <Input label="Nombre del municipio" value={name} onChange={(e) => setName(e.target.value)} placeholder="Plaza de la Revolución" />
      </div>
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
        <Button className="flex-1" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando..." : "Guardar"}
        </Button>
      </div>
    </Modal>
  );
}

export default function AdminLocations() {
  const queryClient = useQueryClient();
  const [countryModal, setCountryModal] = useState(null); // null | {} | country
  const [provinceModal, setProvinceModal] = useState(null);
  const [municipalityFor, setMunicipalityFor] = useState(null);
  const [selectedCountryIds, setSelectedCountryIds] = useState(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const { data: countries } = useQuery({
    queryKey: ["admin-countries"],
    queryFn: async () => (await api.get("/admin/locations/countries")).data.countries,
  });

  const { data: provinces } = useQuery({
    queryKey: ["admin-provinces"],
    queryFn: async () => (await api.get("/admin/locations/provinces")).data.provinces,
  });

  const toggleCountry = useMutation({
    mutationFn: async (c) => (await api.patch(`/admin/locations/countries/${c.id}`, { isActive: !c.isActive })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-countries"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar."),
  });

  const activateAll = useMutation({
    mutationFn: async () => (await api.patch("/admin/locations/countries/activate-all")).data,
    onSuccess: (data) => {
      toast.success(`${data.count} país(es) activados.`);
      queryClient.invalidateQueries({ queryKey: ["admin-countries"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo activar todos los países."),
  });

  const deactivateAll = useMutation({
    mutationFn: async () => (await api.patch("/admin/locations/countries/deactivate-all")).data,
    onSuccess: (data) => {
      toast.success(`${data.count} país(es) desactivados.`);
      queryClient.invalidateQueries({ queryKey: ["admin-countries"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo desactivar todos los países."),
  });

  const bulkDeleteCountries = useMutation({
    mutationFn: async () => (await api.delete("/admin/locations/countries/bulk", { data: { ids: [...selectedCountryIds] } })).data,
    onSuccess: (data) => {
      setSelectedCountryIds(new Set());
      setConfirmBulkDelete(false);
      queryClient.invalidateQueries({ queryKey: ["admin-countries"] });
      if (data.blocked.length === 0) {
        toast.success(`${data.deletedCount} país(es) eliminado(s).`);
      } else {
        const detail = data.blocked.map((b) => `${b.name} (${b.reason})`).join(" · ");
        toast.error(`${data.deletedCount} eliminado(s). ${data.blocked.length} no se pudo(eron) eliminar: ${detail}`, { duration: 7000 });
      }
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo eliminar la selección."),
  });

  function toggleSelectCountry(id) {
    setSelectedCountryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllCountries() {
    setSelectedCountryIds((prev) => (countries?.length && prev.size === countries.length ? new Set() : new Set(countries?.map((c) => c.id))));
  }

  return (
    <div className="max-w-[900px]">
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Países y provincias</h1>
      <p className="mb-2 text-[13.5px] text-outline">
        Catálogo de ubicaciones del sistema. La compra en el sitio hoy solo entrega dentro de Cuba — esto sirve para tener
        cargado de antemano cualquier país/provincia/municipio nuevo antes de habilitarlo.
      </p>
      <div className="mb-[22px] rounded-[10px] bg-tertiary-accent/[0.08] px-3.5 py-2.5 text-[12px] text-tertiary-accent">
        🌎 Agregar un país o provincia acá no cambia todavía a dónde se puede comprar — es solo el catálogo de datos.
      </div>

      <PlanLimitsPanel />

      {/* PAÍSES */}
      <div className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 text-[15px] font-bold text-on-surface">
            <Globe2 className="h-4 w-4 text-tertiary-accent" /> Países
          </div>
          {selectedCountryIds.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[12.5px] font-semibold text-on-surface-variant">{selectedCountryIds.size} seleccionado(s)</span>
              <button
                onClick={() => setConfirmBulkDelete(true)}
                className="flex items-center gap-1.5 rounded-md border border-error/30 bg-error/10 px-3.5 py-2 text-[12.5px] font-bold text-error"
              >
                <Trash2 className="h-3.5 w-3.5" /> Eliminar seleccionados
              </button>
              <button
                onClick={() => setSelectedCountryIds(new Set())}
                className="text-[12.5px] font-semibold text-on-surface-variant hover:text-on-surface"
              >
                Cancelar selección
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => activateAll.mutate()}
                disabled={activateAll.isPending}
                className="rounded-md border border-outline-variant px-3.5 py-2 text-[12.5px] font-semibold text-on-surface-variant disabled:opacity-50"
              >
                {activateAll.isPending ? "Activando..." : "Activar todos"}
              </button>
              <button
                onClick={() => deactivateAll.mutate()}
                disabled={deactivateAll.isPending}
                className="rounded-md border border-outline-variant px-3.5 py-2 text-[12.5px] font-semibold text-on-surface-variant disabled:opacity-50"
              >
                {deactivateAll.isPending ? "Desactivando..." : "Desactivar todos"}
              </button>
              <button
                onClick={() => setCountryModal({})}
                className="flex items-center gap-1.5 rounded-md bg-secondary-container px-3.5 py-2 text-[12.5px] font-bold text-on-secondary-container"
              >
                <Plus className="h-3.5 w-3.5" /> Agregar país
              </button>
            </div>
          )}
        </div>
        <div className="overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest">
          {countries?.length > 0 && (
            <div className="flex items-center gap-3 border-b border-surface-container bg-surface-container px-4 py-2">
              <input
                type="checkbox"
                checked={selectedCountryIds.size === countries.length}
                onChange={toggleSelectAllCountries}
                className="h-3.5 w-3.5 flex-shrink-0"
              />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-outline">Seleccionar todos</span>
            </div>
          )}
          {countries?.map((c) => (
            <div key={c.id} className="flex items-center gap-3 border-b border-surface-container px-4 py-3 last:border-b-0">
              <input
                type="checkbox"
                checked={selectedCountryIds.has(c.id)}
                onChange={() => toggleSelectCountry(c.id)}
                className="h-3.5 w-3.5 flex-shrink-0"
              />
              <span className="w-14 flex-shrink-0 font-mono text-[12.5px] font-bold text-outline">{c.code}</span>
              <span className="flex-1 text-[13.5px] font-semibold text-on-surface">{c.name}</span>
              <span className="text-[11.5px] text-outline">{c._count?.provinces ?? 0} provincias</span>
              <button
                onClick={() => toggleCountry.mutate(c)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${c.isActive ? "bg-verified/10 text-verified-dark" : "bg-surface-container text-outline"}`}
              >
                {c.isActive ? "Activo" : "Inactivo"}
              </button>
              <button onClick={() => setCountryModal(c)} className="text-tertiary-accent">
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          ))}
          {!countries?.length && <p className="p-4 text-body-md text-on-surface-variant">Todavía no hay países cargados.</p>}
        </div>
      </div>

      {/* PROVINCIAS */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[15px] font-bold text-on-surface">
            <MapPin className="h-4 w-4 text-tertiary-accent" /> Provincias
          </div>
          <button
            onClick={() => setProvinceModal({})}
            disabled={!countries?.length}
            className="flex items-center gap-1.5 rounded-md bg-secondary-container px-3.5 py-2 text-[12.5px] font-bold text-on-secondary-container disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Agregar provincia
          </button>
        </div>
        <div className="overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest">
          {provinces?.map((p) => (
            <div key={p.id} className="flex items-center gap-3 border-b border-surface-container px-4 py-3 last:border-b-0">
              <span className="w-14 flex-shrink-0 font-mono text-[12.5px] font-bold text-outline">{p.code}</span>
              <div className="flex-1">
                <div className="text-[13.5px] font-semibold text-on-surface">{p.name}</div>
                <div className="text-[11.5px] text-outline">
                  {p.country?.name ?? "Sin país"} · {p._count?.municipalities ?? 0} municipios
                </div>
              </div>
              <button
                onClick={() => setMunicipalityFor(p)}
                className="rounded-md border border-outline-variant px-3 py-1.5 text-[12px] font-semibold text-on-surface-variant"
              >
                + Municipio
              </button>
              <button onClick={() => setProvinceModal(p)} className="text-tertiary-accent">
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          ))}
          {!provinces?.length && <p className="p-4 text-body-md text-on-surface-variant">Todavía no hay provincias cargadas.</p>}
        </div>
      </div>

      {countryModal && <CountryModal country={countryModal.id ? countryModal : null} onClose={() => setCountryModal(null)} />}
      {provinceModal && (
        <ProvinceModal province={provinceModal.id ? provinceModal : null} countries={countries} onClose={() => setProvinceModal(null)} />
      )}
      {municipalityFor && <MunicipalityModal province={municipalityFor} onClose={() => setMunicipalityFor(null)} />}
      {confirmBulkDelete && (
        <ConfirmDeleteModal
          title={`¿Eliminar ${selectedCountryIds.size} país(es)?`}
          description="Los que tengan provincias cargadas o algún vendedor entregando ahí no se van a poder eliminar — se avisa cuáles quedaron afuera."
          pending={bulkDeleteCountries.isPending}
          onConfirm={() => bulkDeleteCountries.mutate()}
          onCancel={() => setConfirmBulkDelete(false)}
        />
      )}
    </div>
  );
}
