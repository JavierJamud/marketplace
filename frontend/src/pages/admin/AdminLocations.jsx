import { Flag } from "../../components/ui/Flag.jsx";
import { SearchBox, matchesQuery } from "../../components/ui/SearchBox.jsx";
import { useEffect, useRef, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Globe2, MapPin, MapPinned, Plus, Pencil, Trash2, ChevronRight, Search, Image as ImageIcon } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { Tabs } from "../../components/ui/Tabs.jsx";
import { LocationSuggestionsPanel } from "../../components/admin/LocationSuggestionsPanel.jsx";
import { api } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { UnsavedChangesModal } from "../../components/UnsavedChangesModal.jsx";
import { useDirtyModal } from "../../lib/useDirtyModal.js";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";

// Bloque 52: el panel de "Límites de entrega por plan" que vivía acá se
// movió a Suscripciones → "Configuración de planes" — ahí quedó junto con
// el resto de los límites del plan (productos, provincias, etc.), en vez de
// repartido en dos pantallas distintas.

export function ProductImageLinksPanel() {
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
        Permite que los vendedores agreguen fotos de producto pegando un link externo, además de subir el archivo. Desactívalo
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

// Bloque 196 (pedido explícito — "si se hace clic fuera de un contenedor
// mostrado como ventana o popup en el panel debe cerrarse automáticamente,
// y si necesita que guarden datos debe preguntar si desea guardar o
// descartar antes de cerrar"): `onBackdropClick` es opcional — lo pasan los
// 3 formularios (CountryModal/ProvinceModal/MunicipalityModal) como
// `dirtyModal.handleBackdropClick`; `onClose` se deja tal cual estaba (sin
// uso directo acá — cada formulario ya maneja su propio botón Cancelar).
function Modal({ title, onClose, onBackdropClick, dirtyModal, children }) {
  // Escape cierra igual que tocar fuera: si hay cambios, dirtyModal.requestClose pregunta antes. Con el diálogo "Tienes
  // cambios sin guardar" ya abierto, Escape vuelve a "Seguir editando" (antes volvía a pedir el mismo diálogo y no hacía
  // nada); mientras guarda no hace nada, para no esconder el diálogo a mitad del guardado. dirtyModal es un objeto nuevo
  // en cada render: el último se guarda en un ref y el listener se pone una sola vez, en vez de quitarlo y ponerlo con
  // cada tecla del formulario.
  const dirtyRef = useRef(dirtyModal);
  useEffect(() => {
    dirtyRef.current = dirtyModal;
  });
  useEffect(() => {
    function onKey(e) {
      const dirty = dirtyRef.current;
      if (e.key !== "Escape" || !dirty) return;
      if (!dirty.confirming) dirty.requestClose();
      else if (!dirty.saving) dirty.handleKeepEditing();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onBackdropClick}>
      {/* A 390px el modal de provincia (cuatro campos más el interruptor) pasaba del alto útil con el teclado abierto:
          se desplaza por dentro en vez de cortarse. */}
      <div role="dialog" aria-modal="true" aria-label={title} className="modal-panel-5 w-full max-w-md rounded-2xl bg-surface-container-lowest p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-200 sm:p-6">
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
  const [isActive, setIsActive] = useState(country?.isActive ?? true);

  const initialSnapshot = useRef(JSON.stringify({ code, name, isActive }));
  const isDirty = JSON.stringify({ code, name, isActive }) !== initialSnapshot.current;

  const save = useMutation({
    mutationFn: async () =>
      country
        ? (await api.patch(`/admin/locations/countries/${country.id}`, { code, name, isActive })).data
        : (await api.post("/admin/locations/countries", { code, name })).data,
    onSuccess: () => {
      toast.success(country ? "País actualizado." : "País agregado.");
      queryClient.invalidateQueries({ queryKey: ["admin-countries"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el país."),
  });

  const canSaveNow = !!name.trim() && !!code.trim();
  const dirtyModal = useDirtyModal({ isDirty, onClose, onSave: canSaveNow ? () => save.mutateAsync() : undefined });

  return (
    <Modal title={country ? "Editar país" : "Agregar país disponible"} onClose={onClose} onBackdropClick={dirtyModal.handleBackdropClick} dirtyModal={dirtyModal}>
      <div className="mb-4 flex flex-col gap-4">
        <Input label="Nombre del país" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Estados Unidos, Cuba, España" />
        <Input label="Código ISO corto" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Ej: US, CU, ES" maxLength={5} />
        {/* La bandera y el código de marcado salen del código ISO: no se escriben a mano. */}
        <div className="flex items-center gap-3 rounded-xl bg-surface-container/60 px-3.5 py-3">
          <Flag code={code} className="!h-6 !w-9" />
          <div className="text-[12.5px] text-on-surface-variant">
            {country?.callingCode ? <>Código de marcado: <strong className="text-on-surface">+{country.callingCode}</strong>. </> : null}
            La bandera y el código se toman del código ISO.
          </div>
        </div>
        {country && (
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-tertiary-accent" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span>
              <span className="block text-[13.5px] font-semibold text-on-surface">Habilitado</span>
              <span className="block text-[12px] text-on-surface-variant">Solo los países habilitados aparecen para registrarse y en los teléfonos.</span>
            </span>
          </label>
        )}
      </div>
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancelar</Button>
        <Button className="flex-1 rounded-xl" disabled={!name.trim() || !code.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando..." : "Guardar país"}
        </Button>
      </div>

      <UnsavedChangesModal
        open={dirtyModal.confirming}
        saving={dirtyModal.saving}
        onSave={canSaveNow ? dirtyModal.handleSaveAndClose : undefined}
        onDiscard={dirtyModal.handleDiscard}
        onCancel={dirtyModal.handleKeepEditing}
      />
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

  const initialSnapshot = useRef(JSON.stringify({ code, name, countryId, type, isActive }));
  const isDirty = JSON.stringify({ code, name, countryId, type, isActive }) !== initialSnapshot.current;

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

  const canSaveNow = !!name.trim() && !!code.trim() && !!countryId;
  const dirtyModal = useDirtyModal({ isDirty, onClose, onSave: canSaveNow ? () => save.mutateAsync() : undefined });

  return (
    <Modal
      title={province?.id ? "Editar provincia o estado" : "Agregar provincia o estado"}
      onClose={onClose}
      onBackdropClick={dirtyModal.handleBackdropClick}
      dirtyModal={dirtyModal}
    >
      <div className="mb-4 flex flex-col gap-4">
        <Select label="País" value={countryId} onChange={(e) => setCountryId(e.target.value)}>
          {countries?.map((c) => (
            <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
          ))}
        </Select>
        <Select label="Tipo de subdivisión" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="PROVINCE">Provincia (se divide en municipios)</option>
          <option value="STATE">Estado (se divide en ciudades)</option>
        </Select>
        <Input label="Nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder={type === "STATE" ? "Ej: Florida, Texas" : "Ej: La Habana, Santiago"} />
        <Input label="Código corto o abreviatura" value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} placeholder={type === "STATE" ? "fl" : "hab"} maxLength={10} />
        {province?.id && (
          <label className="flex min-h-11 items-center gap-2.5 rounded-xl border border-surface-container-high bg-surface-container/30 p-3 text-[13.5px] font-semibold text-on-surface cursor-pointer">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-5 w-5 rounded accent-tertiary-accent" />
            Subdivisión activa para tiendas y clientes
          </label>
        )}
      </div>
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancelar</Button>
        <Button className="flex-1 rounded-xl" disabled={!name.trim() || !code.trim() || !countryId || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando..." : "Guardar subdivisión"}
        </Button>
      </div>

      <UnsavedChangesModal
        open={dirtyModal.confirming}
        saving={dirtyModal.saving}
        onSave={canSaveNow ? dirtyModal.handleSaveAndClose : undefined}
        onDiscard={dirtyModal.handleDiscard}
        onCancel={dirtyModal.handleKeepEditing}
      />
    </Modal>
  );
}

// Las provincias (Cuba) se dividen en municipios y los estados de los demás países, en ciudades. `g` es la terminación
// de género ("Ciudad agregada", "Municipio agregado"): antes salía "Ciudad agregado".
function unitOf(province) {
  return province?.type === "STATE"
    ? { one: "ciudad", many: "ciudades", One: "Ciudad", Many: "Ciudades", g: "a", example: "Ej: Miami, Houston" }
    : { one: "municipio", many: "municipios", One: "Municipio", Many: "Municipios", g: "o", example: "Ej: Plaza de la Revolución, Centro Habana" };
}

// Mismo plural en toda la pantalla: "1 tienda", "3 tiendas" (antes "tienda(s)").
function plural(n, one, many) {
  return `${Number(n).toLocaleString("es-CU")} ${n === 1 ? one : many}`;
}

const CITIES_PAGE_SIZE = 60;

// Municipios o ciudades de una provincia o estado: se piden al abrirla, con buscador y por páginas (un estado puede tener más
// de mil ciudades; traerlas todas con la lista de provincias dejaba la pantalla lenta).
function CitiesDrawer({ province, onAdd, onEdit, onDelete }) {
  const queryClient = useQueryClient();
  const unit = unitOf(province);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-cities", province.id, query, page],
    queryFn: async () => (await api.get(`/admin/locations/provinces/${province.id}/municipalities`, { params: { q: query || undefined, page, pageSize: CITIES_PAGE_SIZE } })).data,
    placeholderData: (prev) => prev,
  });
  const toggle = useMutation({
    mutationFn: async (m) => (await api.patch(`/admin/locations/municipalities/${m.id}`, { isActive: !m.isActive })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-cities", province.id] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar."),
  });
  const items = data?.municipalities ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / CITIES_PAGE_SIZE));

  return (
    <div className="border-t border-surface-container-high bg-surface-container/10 p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-on-surface-variant">
          {unit.Many} en {province.name}
        </span>
        <button type="button" onClick={onAdd} className="min-h-11 px-1 text-[12.5px] font-semibold text-tertiary-accent hover:underline">
          + Agregar {unit.one}
        </button>
      </div>
      <div className="relative mb-3">
        <Search className="absolute left-3 top-3.5 h-4 w-4 text-outline" aria-hidden="true" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Buscar ${unit.one}...`}
          aria-label={`Buscar ${unit.one} en ${province.name}`}
          className="h-11 w-full rounded-xl border border-outline-variant bg-surface-container-lowest pl-9 pr-3 text-[13px] outline-none focus:border-tertiary-accent"
        />
      </div>
      {isLoading && !data ? (
        <ListSkeleton rows={3} avatar={false} />
      ) : isError ? (
        <p className="py-2 text-[12.5px] text-error">
          No se pudieron cargar.{" "}
          <button type="button" onClick={() => refetch()} className="min-h-11 font-semibold underline">
            Reintentar
          </button>
        </p>
      ) : items.length === 0 ? (
        <p className="py-2 text-[12.5px] text-on-surface-variant">{query ? `Ningún resultado para “${query}”.` : `Todavía no hay ${unit.many} en ${province.name}.`}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {items.map((m) => (
            <div key={m.id} className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-surface-container-high bg-surface-container-lowest py-0.5 pl-3 pr-0.5">
              <span className="min-w-0 break-words text-[12.5px] font-semibold text-on-surface">
                {m.name}
                {m._count?.vendorLocations > 0 && <span className="ml-1.5 text-[11.5px] font-normal text-on-surface-variant">· {plural(m._count.vendorLocations, "tienda", "tiendas")}</span>}
              </span>
              <div className="flex flex-shrink-0 items-center">
                {/* El interruptor dice su estado y qué hace al tocarlo (aria-label): a 390px solo se ve la palabra. */}
                <button
                  type="button"
                  onClick={() => toggle.mutate(m)}
                  aria-pressed={m.isActive}
                  aria-label={`${m.name}: ${m.isActive ? `activ${unit.g}. Toca para desactivar` : `inactiv${unit.g}. Toca para activar`}`}
                  className="flex min-h-11 items-center px-1"
                >
                  <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${m.isActive ? "bg-verified/15 text-verified-dark" : "bg-surface-container-high text-on-surface-variant"}`}>
                    {m.isActive ? `Activ${unit.g}` : `Inactiv${unit.g}`}
                  </span>
                </button>
                <button type="button" onClick={() => onEdit(m)} aria-label={`Editar ${m.name}`} className="flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant hover:text-tertiary-accent">
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => onDelete(m)} aria-label={`Eliminar ${m.name}`} className="flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant hover:text-error">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between gap-2 text-[12px] text-on-surface-variant">
          <button type="button" disabled={page <= 1} onClick={() => setPage((n) => n - 1)} className="min-h-11 rounded-lg border border-outline-variant px-3 font-semibold disabled:opacity-40">
            Anterior
          </button>
          <span className="text-center">
            Página {page} de {pages} · {total.toLocaleString("es-CU")} {unit.many}
          </span>
          <button type="button" disabled={page >= pages} onClick={() => setPage((n) => n + 1)} className="min-h-11 rounded-lg border border-outline-variant px-3 font-semibold disabled:opacity-40">
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}

function MunicipalityModal({ province, municipality, onClose }) {
  const unit = unitOf(province);
  const queryClient = useQueryClient();
  const [name, setName] = useState(municipality?.name ?? "");
  const [isActive, setIsActive] = useState(municipality?.isActive ?? true);

  const initialSnapshot = useRef(JSON.stringify({ name, isActive }));
  const isDirty = JSON.stringify({ name, isActive }) !== initialSnapshot.current;

  const save = useMutation({
    mutationFn: async () =>
      municipality?.id
        ? (await api.patch(`/admin/locations/municipalities/${municipality.id}`, { name, isActive })).data
        : (await api.post(`/admin/locations/provinces/${province.id}/municipalities`, { name })).data,
    onSuccess: () => {
      toast.success(municipality?.id ? `${unit.One} actualizad${unit.g}.` : `${unit.One} agregad${unit.g}.`);
      queryClient.invalidateQueries({ queryKey: ["admin-provinces"] });
      queryClient.invalidateQueries({ queryKey: ["admin-cities", province.id] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? `No se pudo guardar el ${unit.one}.`),
  });

  const canSaveNow = !!name.trim();
  const dirtyModal = useDirtyModal({ isDirty, onClose, onSave: canSaveNow ? () => save.mutateAsync() : undefined });

  return (
    <Modal
      title={municipality?.id ? `Editar ${unit.one}` : `Agregar ${unit.one} a ${province.name}`}
      onClose={onClose}
      onBackdropClick={dirtyModal.handleBackdropClick}
      dirtyModal={dirtyModal}
    >
      <div className="mb-4 flex flex-col gap-4">
        <Input label={unit.one === "ciudad" ? "Nombre de la ciudad" : "Nombre del municipio"} value={name} onChange={(e) => setName(e.target.value)} placeholder={unit.example} />
        {municipality?.id && (
          <label className="flex min-h-11 items-center gap-2.5 rounded-xl border border-surface-container-high bg-surface-container/30 p-3 text-[13.5px] font-semibold text-on-surface cursor-pointer">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-5 w-5 rounded accent-tertiary-accent" />
            {unit.One} activ{unit.g}
          </label>
        )}
      </div>
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancelar</Button>
        <Button className="flex-1 rounded-xl" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando..." : `Guardar ${unit.one}`}
        </Button>
      </div>

      <UnsavedChangesModal
        open={dirtyModal.confirming}
        saving={dirtyModal.saving}
        onSave={canSaveNow ? dirtyModal.handleSaveAndClose : undefined}
        onDiscard={dirtyModal.handleDiscard}
        onCancel={dirtyModal.handleKeepEditing}
      />
    </Modal>
  );
}

export default function AdminLocations() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [section, setSection] = useState(searchParams.get("tab") === "solicitudes" ? "solicitudes" : "territorios");
  // Mismo contador que muestra el menú lateral (AdminLayout).
  const { data: pendingData } = useQuery({
    queryKey: ["admin-location-suggestions-count"],
    queryFn: async () => (await api.get("/admin/location-suggestions/pending-count")).data,
    refetchInterval: 60_000,
  });
  const pendingSuggestions = pendingData?.count ?? 0;
  const [selectedCountryId, setSelectedCountryId] = useState(null);
  const [countrySearch, setCountrySearch] = useState("");
  const [provinceSearch, setProvinceSearch] = useState("");
  const [countryModal, setCountryModal] = useState(null);
  const [provinceModal, setProvinceModal] = useState(null);
  const [municipalityFor, setMunicipalityFor] = useState(null);
  const [municipalityModal, setMunicipalityModal] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [expandedProvinceIds, setExpandedProvinceIds] = useState(new Set());

  // Sin estos estados, mientras cargaba (o si fallaba) se veía "No se encontraron países" y "Selecciona un país",
  // como si no hubiera datos.
  const countriesQuery = useQuery({
    queryKey: ["admin-countries"],
    queryFn: async () => (await api.get("/admin/locations/countries")).data.countries,
  });
  const countries = useMemo(() => countriesQuery.data ?? [], [countriesQuery.data]);

  const provincesQuery = useQuery({
    queryKey: ["admin-provinces"],
    queryFn: async () => (await api.get("/admin/locations/provinces")).data.provinces,
  });
  const provinces = useMemo(() => provincesQuery.data ?? [], [provincesQuery.data]);

  // En el celular la lista de países y el detalle van uno debajo del otro: al elegir un país no cambiaba nada a la
  // vista. Ahora se baja al detalle (solo por debajo de lg, donde están en columnas no hace falta).
  const detailRef = useRef(null);
  function selectCountry(id) {
    setSelectedCountryId(id);
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  // Auto-select first country if none selected
  useEffect(() => {
    if (countries.length > 0 && !selectedCountryId) {
      setSelectedCountryId(countries[0].id);
    }
  }, [countries, selectedCountryId]);

  const selectedCountry = useMemo(() => countries.find((c) => c.id === selectedCountryId), [countries, selectedCountryId]);

  const [countryFilter, setCountryFilter] = useState("all");
  const activeCountries = countries.filter((c) => c.isActive).length;
  const filteredCountries = useMemo(() => {
    const byStatus = countries.filter((c) => countryFilter === "all" || (countryFilter === "active" ? c.isActive : !c.isActive));
    if (!countrySearch.trim()) return byStatus;
    return byStatus.filter((c) => matchesQuery(c.name, countrySearch) || c.code.toLowerCase().includes(countrySearch.toLowerCase().trim()));
  }, [countries, countrySearch, countryFilter]);

  const seedWorld = useMutation({
    mutationFn: async () => (await api.post("/admin/locations/countries/seed-world")).data,
    onSuccess: (r) => {
      toast.success(r.created ? `Se agregaron ${r.created} países (apagados). Enciende los que quieras recibir.` : "Ya están todos los países del mundo.");
      queryClient.invalidateQueries({ queryKey: ["admin-countries"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo cargar la lista de países."),
  });

  const countryProvinces = useMemo(() => {
    if (!selectedCountryId) return [];
    return provinces.filter((p) => p.country?.id === selectedCountryId);
  }, [provinces, selectedCountryId]);
  const visibleProvinces = useMemo(() => countryProvinces.filter((p) => matchesQuery(p.name, provinceSearch) || matchesQuery(p.code, provinceSearch)), [countryProvinces, provinceSearch]);

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
      queryClient.invalidateQueries({ queryKey: ["admin-cities"] });
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
    // Sin padding propio: el layout del admin ya pone px-4 (antes se sumaba otro px-4 py-8 y a 390px quedaban ~278px útiles).
    <div className="mx-auto max-w-7xl">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-surface-container-high pb-5">
        <div className="flex min-w-0 items-center gap-3">
          <IconCircle icon={Globe2} tone="teal" />
          <div className="min-w-0">
            <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Ubicaciones y territorios</h1>
            <p className="text-[13.5px] text-on-surface-variant">
              Países, sus provincias o estados, y sus municipios o ciudades, disponibles para vender y entregar.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="rounded-xl font-bold" disabled={seedWorld.isPending} onClick={() => seedWorld.mutate()}>
            <Globe2 className="mr-1 h-4 w-4" aria-hidden="true" /> {seedWorld.isPending ? "Cargando..." : "Cargar países del mundo"}
          </Button>
          <Button className="rounded-xl font-bold shadow-sm" onClick={() => setCountryModal({})}>
            <Plus className="h-4 w-4 mr-1" aria-hidden="true" /> Nuevo país
          </Button>
        </div>
      </div>

      {/* Bloque 244: "Territorios" es lo de siempre (países, provincias,
          municipios); "Solicitudes" son los países y provincias que la gente
          escribió a mano al registrarse y esperan que los revises. */}
      <Tabs
        className="mb-6"
        tabs={[
          { id: "territorios", label: "Territorios", icon: Globe2 },
          { id: "solicitudes", label: pendingSuggestions > 0 ? `Solicitudes (${pendingSuggestions})` : "Solicitudes", icon: MapPinned },
        ]}
        value={section}
        onChange={setSection}
      />

      {section === "solicitudes" ? (
        <LocationSuggestionsPanel />
      ) : (
      <>

      {/* Solo sin datos: con la caché guardada del navegador, un fallo al refrescar no debe tapar la lista que ya hay. */}
      {countriesQuery.isError && !countriesQuery.data ? (
        <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 text-center">
          <p className="mb-3 text-[13.5px] text-error">No se pudieron cargar los países.</p>
          <Button variant="outline" className="rounded-xl" disabled={countriesQuery.isFetching} onClick={() => countriesQuery.refetch()}>
            {countriesQuery.isFetching ? "Reintentando..." : "Reintentar"}
          </Button>
        </div>
      ) : (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* La lista toma 5/12 hasta 2xl: con el interruptor y el lápiz de 44px por fila, en 4/12 a 1366px al nombre le
            quedaban 49px y "Estados Unidos" se partía letra a letra. */}
        <div className="min-w-0 lg:col-span-5 2xl:col-span-4">
          <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-3 shadow-sm sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <div className="flex items-center gap-2 text-[14px] font-bold text-on-surface">
                <Globe2 className="h-[18px] w-[18px] text-tertiary-accent" aria-hidden="true" /> Países ({countries.length})
              </div>
              <span className="text-[12px] font-semibold text-verified-dark">{plural(activeCountries, "habilitado", "habilitados")}</span>
            </div>
            <p className="mb-3 text-[12px] leading-[17px] text-on-surface-variant">Solo los países habilitados aparecen para que los clientes se registren y en los teléfonos.</p>
            <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar países">
              {[["all", "Todos"], ["active", "Habilitados"], ["inactive", "Apagados"]].map(([id, text]) => (
                <button key={id} type="button" onClick={() => setCountryFilter(id)} aria-pressed={countryFilter === id} className={`min-h-11 rounded-full border px-3.5 text-[12.5px] font-semibold ${countryFilter === id ? "border-primary-container bg-primary-container text-white" : "border-outline-variant text-on-surface-variant"}`}>
                  {text}
                </button>
              ))}
            </div>

            <div className="relative mb-3">
              <Search className="absolute left-3 top-3.5 h-4 w-4 text-outline" aria-hidden="true" />
              <input
                type="search"
                placeholder="Buscar país..."
                aria-label="Buscar país"
                value={countrySearch}
                onChange={(e) => setCountrySearch(e.target.value)}
                className="h-11 w-full rounded-xl border border-outline-variant bg-surface-container/40 pl-9 pr-3 text-[13px] outline-none focus:border-tertiary-accent focus:bg-surface-container-lowest"
              />
            </div>

            {/* Cada país es una fila con tres botones hermanos (elegir, encender/apagar, editar): antes la fila entera era
                un div con onClick, que no se podía alcanzar con el teclado, y un botón no puede ir dentro de otro. */}
            <div className="flex max-h-[600px] flex-col gap-2 overflow-y-auto pr-1">
              {countriesQuery.isLoading && <ListSkeleton rows={6} avatar={false} label="Cargando países" />}
              {filteredCountries.map((c) => {
                const isSelected = c.id === selectedCountryId;
                const provCount = provinces.filter((p) => p.country?.id === c.id).length;
                return (
                  <div
                    key={c.id}
                    className={`group flex items-center gap-1 rounded-xl border p-1 transition-colors ${
                      isSelected
                        ? "border-tertiary-accent bg-tertiary-accent/5 shadow-sm"
                        : "border-surface-container-high bg-surface-container-lowest hover:border-outline-variant hover:bg-surface-container/20"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => selectCountry(c.id)}
                      aria-current={isSelected ? "true" : undefined}
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left"
                    >
                      <Flag code={c.code} className="!h-5 !w-7 flex-shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-[13.5px] font-bold leading-5 text-on-surface">{c.name}</span>
                        <span className="block text-[12px] text-on-surface-variant">
                          {c.code}{c.callingCode ? ` · +${c.callingCode}` : ""} · {provincesQuery.isLoading ? "..." : plural(provCount, "subdivisión", "subdivisiones")}
                        </span>
                      </span>
                      {/* La flecha solo en el celular, donde elegir baja al detalle; en escritorio el detalle ya está al lado. */}
                      <ChevronRight className={`h-4 w-4 flex-shrink-0 transition-transform lg:hidden ${isSelected ? "translate-x-0.5 text-tertiary-accent" : "text-outline"}`} aria-hidden="true" />
                    </button>
                    {/* Mismas palabras que el filtro de arriba (Habilitado / Apagado). */}
                    <button
                      type="button"
                      onClick={() => toggleCountry.mutate(c)}
                      aria-pressed={c.isActive}
                      aria-label={`${c.name}: ${c.isActive ? "habilitado. Toca para apagarlo" : "apagado. Toca para habilitarlo"}`}
                      className="flex min-h-11 flex-shrink-0 items-center px-1"
                    >
                      <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${c.isActive ? "bg-verified/15 text-verified-dark" : "bg-surface-container-high text-on-surface-variant"}`}>
                        {c.isActive ? "Habilitado" : "Apagado"}
                      </span>
                    </button>
                    {/* En escritorio el lápiz aparece al pasar el ratón, y también al llegar con Tab (antes quedaba invisible). */}
                    <button
                      type="button"
                      onClick={() => setCountryModal(c)}
                      aria-label={`Editar ${c.name}`}
                      className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition hover:text-tertiary-accent lg:opacity-0 lg:focus-visible:opacity-100 lg:group-hover:opacity-100"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
              {!countriesQuery.isLoading && filteredCountries.length === 0 && (
                <p className="p-4 text-center text-[12.5px] text-on-surface-variant">
                  {countries.length === 0 ? "Todavía no hay países. Carga los del mundo o agrega uno con Nuevo país." : "Ningún país coincide con la búsqueda o el filtro."}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Detalle del país elegido y sus subdivisiones (8 columnas en escritorio). scroll-mt deja libre la barra fija
            de búsqueda al bajar hasta aquí en el celular. */}
        <div ref={detailRef} className="min-w-0 scroll-mt-24 lg:col-span-7 2xl:col-span-8">
          {countriesQuery.isLoading ? (
            <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 sm:p-6">
              <ListSkeleton rows={4} avatar={false} label="Cargando provincias y estados" />
            </div>
          ) : selectedCountry ? (
            <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 shadow-sm sm:p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-surface-container-high pb-4">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-mono text-[15px] font-black text-tertiary-accent">{selectedCountry.code}</span>
                    <h2 className="min-w-0 break-words text-title-lg font-extrabold text-on-surface">{selectedCountry.name}</h2>
                    <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${
                      selectedCountry.isActive ? "bg-verified/15 text-verified-dark" : "bg-surface-container-high text-on-surface-variant"
                    }`}>
                      {selectedCountry.isActive ? "Habilitado" : "Apagado"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-on-surface-variant">
                    Provincias o estados de {selectedCountry.name} y sus municipios o ciudades.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    className="rounded-xl text-[12.5px] border-error text-error hover:bg-error/10 hover:text-error"
                    onClick={() => setItemToDelete({ id: selectedCountry.id, type: "COUNTRY", name: selectedCountry.name })}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" aria-hidden="true" /> Eliminar país
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-xl text-[12.5px]"
                    onClick={() => setCountryModal(selectedCountry)}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" aria-hidden="true" /> Editar país
                  </Button>
                  <Button
                    className="rounded-xl text-[12.5px] font-bold"
                    onClick={() => setProvinceModal({ countryId: selectedCountry.id })}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" aria-hidden="true" /> Agregar provincia o estado
                  </Button>
                </div>
              </div>

              {countryProvinces.length > 8 && (
                <SearchBox
                  className="mb-3"
                  value={provinceSearch}
                  onChange={setProvinceSearch}
                  placeholder={`Buscar en ${selectedCountry.name}`}
                  resultText={provinceSearch.trim() ? `${visibleProvinces.length} de ${countryProvinces.length} subdivisiones` : undefined}
                />
              )}

              {/* Subdivisions List */}
              <div className="flex flex-col gap-3">
                {provincesQuery.isLoading && <ListSkeleton rows={4} avatar={false} label="Cargando provincias y estados" />}
                {provincesQuery.isError && !provincesQuery.data && (
                  <p className="text-[13px] text-error">
                    No se pudieron cargar las provincias y estados.{" "}
                    <button type="button" onClick={() => provincesQuery.refetch()} className="min-h-11 font-semibold underline">
                      Reintentar
                    </button>
                  </p>
                )}
                {provinceSearch.trim() && visibleProvinces.length === 0 && <p className="text-[13px] text-on-surface-variant">No hay subdivisiones que coincidan con “{provinceSearch.trim()}”.</p>}
                {visibleProvinces.map((p) => {
                  const isExpanded = expandedProvinceIds.has(p.id);
                  return (
                    <div
                      key={p.id}
                      className="rounded-xl border border-surface-container-high bg-surface-container-lowest overflow-hidden transition-colors hover:border-outline-variant"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-surface-container/20 p-3 sm:p-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex-shrink-0 rounded bg-surface-container-high px-2 py-0.5 font-mono text-[12px] font-bold text-on-surface-variant">
                            {p.code}
                          </span>
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="min-w-0 break-words text-[14px] font-bold text-on-surface">{p.name}</span>
                              <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${
                                p.type === "STATE" ? "bg-tertiary-accent/10 text-tertiary-accent" : "bg-surface-container-high text-on-surface-variant"
                              }`}>
                                {p.type === "STATE" ? "Estado" : "Provincia"}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleExpandProvince(p.id)}
                              aria-expanded={isExpanded}
                              className="flex min-h-11 items-center gap-1 text-[12px] font-semibold text-tertiary-accent hover:underline"
                            >
                              {(p._count?.municipalities ?? 0).toLocaleString("es-CU")} {unitOf(p).many}
                              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`} aria-hidden="true" />
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1">
                          <button
                            type="button"
                            onClick={() => toggleSubdivision.mutate({ id: p.id, type: "PROVINCE", isActive: !p.isActive })}
                            aria-pressed={p.isActive}
                            aria-label={`${p.name}: ${p.isActive ? "activa. Toca para desactivarla" : "inactiva. Toca para activarla"}`}
                            className="flex min-h-11 items-center px-1"
                          >
                            <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${p.isActive ? "bg-verified/15 text-verified-dark" : "bg-surface-container-high text-on-surface-variant"}`}>
                              {p.isActive ? "Activa" : "Inactiva"}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => { setMunicipalityModal(null); setMunicipalityFor(p); }}
                            aria-label={`Agregar ${unitOf(p).one} a ${p.name}`}
                            className="min-h-11 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[12px] font-semibold text-on-surface hover:bg-surface-container"
                          >
                            + {unitOf(p).One}
                          </button>

                          <button
                            type="button"
                            onClick={() => setProvinceModal(p)}
                            aria-label={`Editar ${p.name}`}
                            title="Editar"
                            className="flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant transition hover:bg-surface-container hover:text-tertiary-accent"
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setItemToDelete({ id: p.id, type: "PROVINCE", name: p.name })}
                            aria-label={`Eliminar ${p.name}`}
                            title="Eliminar"
                            className="flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant transition hover:bg-error/10 hover:text-error"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <CitiesDrawer
                          province={p}
                          onAdd={() => { setMunicipalityModal(null); setMunicipalityFor(p); }}
                          onEdit={(m) => { setMunicipalityFor(p); setMunicipalityModal(m); }}
                          onDelete={(m) => setItemToDelete({ id: m.id, type: "MUNICIPALITY", name: m.name })}
                        />
                      )}
                    </div>
                  );
                })}

                {!provincesQuery.isLoading && !(provincesQuery.isError && !provincesQuery.data) && countryProvinces.length === 0 && (
                  <div className="rounded-xl border border-dashed border-outline-variant p-6 text-center sm:p-8">
                    <MapPin className="mx-auto mb-2 h-8 w-8 text-outline" aria-hidden="true" />
                    <p className="text-[13.5px] font-semibold text-on-surface">Sin subdivisiones para {selectedCountry.name}</p>
                    <p className="mb-4 text-[12.5px] text-on-surface-variant">Agrega los estados o provincias donde operarán los vendedores en este país.</p>
                    <Button
                      className="rounded-xl text-[12.5px]"
                      onClick={() => setProvinceModal({ countryId: selectedCountry.id })}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" aria-hidden="true" /> Agregar primera subdivisión
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-outline-variant bg-surface-container-lowest p-8 text-center sm:p-12">
              <Globe2 className="mx-auto mb-3 h-10 w-10 text-outline" aria-hidden="true" />
              {countries.length === 0 ? (
                <p className="text-[14px] font-bold text-on-surface">Agrega un país para cargar sus provincias o estados</p>
              ) : (
                <>
                  <p className="text-[14px] font-bold text-on-surface">Elige un país de la lista</p>
                  <p className="text-[12.5px] text-on-surface-variant">Verás y podrás gestionar sus provincias o estados, y sus municipios o ciudades.</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      )}
      </>
      )}

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
