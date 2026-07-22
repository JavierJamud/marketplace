import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { X, Plus, Trash2, Globe2, MapPin, FileText, Settings2, CheckCircle2, Wallet, ShieldCheck } from "lucide-react";
import { PAYMENT_METHODS } from "../../lib/paymentMethods.js";
import { CURRENCIES } from "../../lib/currencies.js";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { AiGenerateButton } from "../../components/AiGenerateButton.jsx";

const DAY_ROWS = [
  { dayOfWeek: 1, name: "Lunes" },
  { dayOfWeek: 2, name: "Martes" },
  { dayOfWeek: 3, name: "Miércoles" },
  { dayOfWeek: 4, name: "Jueves" },
  { dayOfWeek: 5, name: "Viernes" },
  { dayOfWeek: 6, name: "Sábado" },
  { dayOfWeek: 0, name: "Domingo" },
];

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

function ManageVendorMunicipalitiesModal({ province, vendorLocations, onClose, onSave, isPending }) {
  const { data: municipalities = [] } = useQuery({
    queryKey: ["admin-municipalities", province.id],
    queryFn: async () => (await api.get(`/locations/provinces/${province.id}/municipalities`)).data.municipalities,
  });

  const currentProvLocs = useMemo(
    () => (vendorLocations ?? []).filter((l) => l.provinceId === province.id),
    [vendorLocations, province.id]
  );
  const isAllSelected = useMemo(
    () => currentProvLocs.some((l) => l.municipalityId === null),
    [currentProvLocs]
  );

  const [selectedIds, setSelectedIds] = useState(() => {
    if (isAllSelected) return null;
    return currentProvLocs.map((l) => l.municipalityId).filter(Boolean);
  });

  function toggleAll() {
    if (selectedIds === null) {
      setSelectedIds([]);
    } else {
      setSelectedIds(null);
    }
  }

  function toggleMunicipality(id) {
    if (selectedIds === null) {
      const allIds = municipalities.map((m) => m.id).filter((mId) => mId !== id);
      setSelectedIds(allIds);
    } else {
      if (selectedIds.includes(id)) {
        setSelectedIds(selectedIds.filter((mId) => mId !== id));
      } else {
        const next = [...selectedIds, id];
        if (next.length === municipalities.length) {
          setSelectedIds(null);
        } else {
          setSelectedIds(next);
        }
      }
    }
  }

  return (
    <Modal title={`Gestionar Municipios en ${province.name}`} onClose={onClose}>
      <div className="mb-4 flex flex-col gap-3">
        <label className="flex items-center gap-2.5 rounded-xl border border-surface-container-high bg-surface-container/30 p-3 text-[13px] font-bold text-on-surface cursor-pointer">
          <input
            type="checkbox"
            checked={selectedIds === null}
            onChange={toggleAll}
            className="h-4 w-4 rounded accent-tertiary-accent"
          />
          Toda la provincia (todos los municipios)
        </label>

        <div className="text-[12px] font-bold text-outline uppercase tracking-wider mt-2">
          Municipios disponibles ({municipalities.length})
        </div>

        <div className="grid grid-cols-1 gap-2 max-h-[250px] overflow-y-auto pr-1">
          {municipalities.map((m) => {
            const isChecked = selectedIds === null || selectedIds.includes(m.id);
            return (
              <label
                key={m.id}
                className={`flex items-center justify-between rounded-xl border p-3 text-[12.5px] cursor-pointer transition ${
                  isChecked
                    ? "border-tertiary-accent bg-tertiary-accent/5 font-semibold text-on-surface"
                    : "border-surface-container-high bg-surface-container-lowest text-outline"
                }`}
              >
                <span>{m.name}</span>
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleMunicipality(m.id)}
                  className="h-4 w-4 rounded accent-tertiary-accent"
                />
              </label>
            );
          })}
          {municipalities.length === 0 && (
            <p className="py-2 text-[12px] text-outline italic">Esta provincia no tiene municipios activos registrados en el catálogo.</p>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancelar</Button>
        <Button
          className="flex-1 rounded-xl"
          disabled={isPending}
          onClick={() => onSave({ provinceId: province.id, municipalityIds: selectedIds })}
        >
          {isPending ? "Guardando..." : "Guardar Municipios"}
        </Button>
      </div>
    </Modal>
  );
}

export default function VendorSettings() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    ownerIdNumber: "",
    companyAddress: "",
    orderDestination: "WHATSAPP",
    acceptedPaymentMethods: [],
    acceptedCurrencies: ["CUP"],
    warrantyTerms: "",
    warrantyDefaultDays: "",
  });
  const [days, setDays] = useState(DAY_ROWS.map((d) => ({ ...d, opensAt: "09:00", closesAt: "18:00", isClosed: false })));
  const [customMethod, setCustomMethod] = useState("");
  const [newCountryForProvince, setNewCountryForProvince] = useState("");
  const [newProvinceId, setNewProvinceId] = useState("");
  const [selectedMunicipalityIds, setSelectedMunicipalityIds] = useState(null); // null = all
  const [managingProvince, setManagingProvince] = useState(null);
  const [errors, setErrors] = useState({});
  const [confirmModal, setConfirmModal] = useState(null);

  function openConfirm({ title, message, confirmLabel = "Confirmar", danger = false, onConfirm }) {
    setConfirmModal({ title, message, confirmLabel, danger, onConfirm });
  }
  function closeConfirm() {
    setConfirmModal(null);
  }

  const { data: vendor } = useQuery({
    queryKey: ["my-vendor-settings"],
    queryFn: async () => (await api.get("/vendors/me")).data.vendor,
  });

  const { data: provinces } = useQuery({
    queryKey: ["provinces"],
    queryFn: async () => (await api.get("/locations/provinces")).data.provinces,
  });

  const { data: provincesForSelectedCountry } = useQuery({
    queryKey: ["provinces-for-country", newCountryForProvince],
    queryFn: async () => (await api.get(`/locations/countries/${newCountryForProvince}/provinces`)).data.provinces,
    enabled: !!newCountryForProvince,
  });

  const { data: countries = [] } = useQuery({
    queryKey: ["active-countries"],
    queryFn: async () => (await api.get("/locations/countries")).data.countries,
  });

  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });

  useEffect(() => {
    if (!vendor) return;
    setForm({
      ownerIdNumber: vendor.ownerIdNumber ?? "",
      companyAddress: vendor.companyAddress ?? "",
      orderDestination: vendor.orderDestination ?? "WHATSAPP",
      acceptedPaymentMethods: vendor.acceptedPaymentMethods ?? [],
      acceptedCurrencies: vendor.acceptedCurrencies ?? ["CUP"],
      warrantyTerms: vendor.warrantyTerms ?? "",
      warrantyDefaultDays: vendor.warrantyDefaultDays != null ? String(vendor.warrantyDefaultDays) : "",
    });
    if (vendor.schedules?.length) {
      setDays(
        DAY_ROWS.map((d) => {
          const s = vendor.schedules.find((x) => x.dayOfWeek === d.dayOfWeek);
          return s ? { ...d, opensAt: s.opensAt, closesAt: s.closesAt, isClosed: s.isClosed } : { ...d, opensAt: "09:00", closesAt: "18:00", isClosed: false };
        })
      );
    }
  }, [vendor]);

  const saveProfile = useMutation({
    mutationFn: async () =>
      (
        await api.patch("/vendors/me", {
          ...form,
          // "" es el estado inicial de un input controlado sin valor todavía
          // — mandarlo tal cual rompe el zod .min(1) del backend (a
          // diferencia de no mandar la clave). null sí es válido (.nullable()).
          warrantyTerms: form.warrantyTerms.trim() || null,
          warrantyDefaultDays: form.warrantyDefaultDays === "" ? null : Number(form.warrantyDefaultDays),
        })
      ).data,
  });

  const uploadAiDocument = useMutation({
    mutationFn: async (file) => {
      const formData = new FormData();
      formData.append("document", file);
      return (await api.post("/vendors/me/ai-document", formData, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      toast.success("Documento cargado correctamente.");
      queryClient.invalidateQueries({ queryKey: ["my-vendor-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo subir el documento."),
  });

  const removeAiDocument = useMutation({
    mutationFn: async () => api.delete("/vendors/me/ai-document"),
    onSuccess: () => {
      toast.success("Documento eliminado.");
      queryClient.invalidateQueries({ queryKey: ["my-vendor-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo eliminar el documento."),
  });

  const saveSchedule = useMutation({
    mutationFn: async () =>
      (await api.patch("/vendors/me/schedule", { days: days.map(({ dayOfWeek, opensAt, closesAt, isClosed }) => ({ dayOfWeek, opensAt, closesAt, isClosed })) })).data,
  });

  const invalidateVendor = () => {
    queryClient.invalidateQueries({ queryKey: ["my-vendor-settings"] });
    queryClient.invalidateQueries({ queryKey: ["my-vendor"] });
    queryClient.invalidateQueries({ queryKey: ["active-countries"] });
    queryClient.invalidateQueries({ queryKey: ["provinces"] });
    queryClient.invalidateQueries({ queryKey: ["provinces-for-country"] });
    queryClient.invalidateQueries({ queryKey: ["municipalities"] });
  };

  const syncProvince = useMutation({
    mutationFn: async ({ provinceId, municipalityIds }) =>
      (await api.post("/vendors/me/locations/sync-province", { provinceId, municipalityIds })).data,
    onSuccess: () => {
      toast.success("Zonas de cobertura actualizadas.");
      setManagingProvince(null);
      setNewProvinceId("");
      setSelectedMunicipalityIds(null);
      invalidateVendor();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudieron actualizar las zonas."),
  });

  const removeLocation = useMutation({
    mutationFn: async (id) => api.delete(`/vendors/me/locations/${id}`),
    onSuccess: () => {
      setNewProvinceId("");
      invalidateVendor();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo quitar la ubicación."),
  });

  const addDeliveryCountry = useMutation({
    mutationFn: async (countryId) => (await api.post("/vendors/me/delivery-countries", { countryId })).data,
    onSuccess: () => {
      toast.success("País de entrega agregado.");
      invalidateVendor();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo agregar el país."),
  });

  const removeDeliveryCountry = useMutation({
    mutationFn: async (countryId) => api.delete(`/vendors/me/delivery-countries/${countryId}`),
    onSuccess: () => {
      setNewCountryForProvince("");
      setNewProvinceId("");
      invalidateVendor();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo quitar el país."),
  });

  async function handleSaveAll() {
    setErrors({});
    try {
      await Promise.all([saveProfile.mutateAsync(), saveSchedule.mutateAsync()]);
      toast.success("Cambios guardados.");
      invalidateVendor();
    } catch (err) {
      const fieldErrors = err.response?.data?.details?.fieldErrors ?? {};
      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors);
        toast.error("Revisá los campos marcados en rojo.");
      } else {
        toast.error(err.response?.data?.error ?? "No se pudieron guardar los cambios.");
      }
    }
  }

  function updateDay(dayOfWeek, field, value) {
    setDays((d) => d.map((row) => (row.dayOfWeek === dayOfWeek ? { ...row, [field]: value } : row)));
  }

  const isBusiness = vendor?.planType === "BUSINESS";
  const maxProvinces = isBusiness ? settings?.maxProvincesBusiness : settings?.maxProvincesRegular;
  const distinctProvinceCount = new Set((vendor?.locations ?? []).map((l) => l.provinceId)).size;

  const maxDeliveryCountries = isBusiness ? settings?.maxDeliveryCountriesBusiness : settings?.maxDeliveryCountriesRegular;
  const deliveryCountryCount = vendor?.deliveryCountries?.length ?? 0;

  // Group vendor locations by Province
  const provinceGroups = useMemo(() => {
    if (!vendor?.locations) return [];
    const map = new Map();
    vendor.locations.forEach((loc) => {
      const pId = loc.provinceId;
      if (!map.has(pId)) {
        map.set(pId, {
          province: loc.province,
          country: loc.province?.country,
          locations: [],
        });
      }
      map.get(pId).locations.push(loc);
    });
    return Array.from(map.values());
  }, [vendor?.locations]);

  // Group provinces by Country for unified display
  const countryCoverageTree = useMemo(() => {
    const map = new Map();
    // Include delivery countries
    (vendor?.deliveryCountries ?? []).forEach((dc) => {
      if (dc.country) {
        map.set(dc.country.id, { country: dc.country, provinces: [] });
      }
    });

    // Add province groups
    provinceGroups.forEach((group) => {
      const cId = group.country?.id;
      if (cId) {
        if (!map.has(cId)) {
          map.set(cId, { country: group.country, provinces: [] });
        }
        map.get(cId).provinces.push(group);
      }
    });

    return Array.from(map.values());
  }, [vendor?.deliveryCountries, provinceGroups]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-display-sm font-extrabold text-on-surface">Configuración de la tienda</h1>
          <p className="text-body-md text-on-surface-variant">
            Datos públicos, zonas de cobertura y métodos de entrega.
          </p>
        </div>
        <Button onClick={handleSaveAll} disabled={saveProfile.isPending || saveSchedule.isPending} className="rounded-xl font-bold">
          {saveProfile.isPending || saveSchedule.isPending ? "Guardando..." : "Guardar cambios"}
        </Button>
      </div>

      {/* Bloque 47: "Información de la marca" se mudó a Mi perfil
          (VendorProfile.jsx, tarjeta "Datos de la tienda") — Configuración
          ya no edita esos campos. */}

      {/* Bloque 47: Métodos de pago (chips — el selector nunca se había
          terminado de conectar: el estado/endpoint ya existían pero no
          había ninguna forma de tocarlo desde acá) + Monedas (nuevo). */}
      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-title-lg font-bold text-on-surface">
          <Wallet className="h-5 w-5 text-tertiary-accent" /> Métodos de pago y monedas
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Puramente informativo — se muestra en tu tienda pública para que el cliente sepa qué coordinar con vos.
          ZeuDin no procesa ni convierte nada de esto.
        </p>

        <div className="mb-5">
          <div className="mb-2 text-label-md font-semibold text-on-surface-variant">Métodos de pago que aceptás</div>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((m) => {
              const active = form.acceptedPaymentMethods.includes(m.id);
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      acceptedPaymentMethods: active
                        ? f.acceptedPaymentMethods.filter((x) => x !== m.id)
                        : [...f.acceptedPaymentMethods, m.id],
                    }))
                  }
                  className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[12.5px] font-semibold transition ${
                    active ? "border-tertiary-accent bg-tertiary-accent/10 text-tertiary-accent" : "border-outline-variant text-on-surface-variant hover:bg-surface-container"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" /> {m.label}
                </button>
              );
            })}
            {form.acceptedPaymentMethods
              .filter((id) => !PAYMENT_METHODS.some((m) => m.id === id))
              .map((custom) => (
                <button
                  key={custom}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, acceptedPaymentMethods: f.acceptedPaymentMethods.filter((x) => x !== custom) }))}
                  className="flex items-center gap-1.5 rounded-full border border-tertiary-accent bg-tertiary-accent/10 px-3.5 py-2 text-[12.5px] font-semibold text-tertiary-accent"
                >
                  {custom} <X className="h-3 w-3" />
                </button>
              ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={customMethod}
              onChange={(e) => setCustomMethod(e.target.value)}
              placeholder="Otro método (texto libre)..."
              className="h-10 flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-tertiary-accent"
            />
            <Button
              variant="outline"
              className="rounded-lg"
              size="sm"
              disabled={!customMethod.trim()}
              onClick={() => {
                const value = customMethod.trim();
                if (!value || form.acceptedPaymentMethods.includes(value)) return;
                setForm((f) => ({ ...f, acceptedPaymentMethods: [...f.acceptedPaymentMethods, value] }));
                setCustomMethod("");
              }}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div>
          <div className="mb-2 text-label-md font-semibold text-on-surface-variant">Monedas que aceptás</div>
          <div className="flex flex-wrap gap-2">
            {CURRENCIES.map((c) => {
              const active = form.acceptedCurrencies.includes(c.id);
              const Icon = c.icon;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      acceptedCurrencies: active ? f.acceptedCurrencies.filter((x) => x !== c.id) : [...f.acceptedCurrencies, c.id],
                    }))
                  }
                  className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[12.5px] font-semibold transition ${
                    active ? "border-tertiary-accent bg-tertiary-accent/10 text-tertiary-accent" : "border-outline-variant text-on-surface-variant hover:bg-surface-container"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" /> {c.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* UNIFIED COBERTURA & ZONAS DE ENTREGA */}
      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-surface-container-high pb-4">
          <div>
            <div className="flex items-center gap-2 text-title-lg font-bold text-on-surface">
              <Globe2 className="h-5 w-5 text-tertiary-accent" /> Cobertura y Países de Entrega
            </div>
            <p className="text-[12.5px] text-outline mt-0.5">
              Gestioná los países y estados/provincias donde tu tienda ofrece productos y servicio de entrega.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11.5px]">
            <span className="rounded-full bg-surface-container px-3 py-1 font-bold text-on-surface-variant">
              Países: {deliveryCountryCount}/{maxDeliveryCountries ?? "∞"}
            </span>
            <span className="rounded-full bg-surface-container px-3 py-1 font-bold text-on-surface-variant">
              Provincias: {distinctProvinceCount}/{maxProvinces ?? "∞"}
            </span>
          </div>
        </div>

        {/* Compact Add Coverage Bar (Moved to top) */}
        <div className="mb-6 rounded-xl border border-surface-container-high bg-surface-container/30 p-4">
          <div className="mb-3 text-[13px] font-bold text-on-surface">Agregar nueva zona de cobertura</div>
          <div className="flex flex-wrap items-end gap-3">
            {/* 1. Country Select */}
            <Select
              label="País"
              value={newCountryForProvince}
              onChange={(e) => {
                setNewCountryForProvince(e.target.value);
                setNewProvinceId("");
                setSelectedMunicipalityIds(null);
              }}
              className="min-w-[160px] flex-1"
            >
              <option value="">Elegí un país activo</option>
              {countries.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>

            {/* 2. Province Select */}
            {newCountryForProvince && (
              <Select
                label="Provincia / Estado"
                value={newProvinceId}
                onChange={(e) => {
                  setNewProvinceId(e.target.value);
                  setSelectedMunicipalityIds(null);
                }}
                className="min-w-[160px] flex-1"
              >
                <option value="">Elegí subdivisión activa</option>
                {provincesForSelectedCountry?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.type === "STATE" ? "Estado" : "Provincia"})</option>
                ))}
              </Select>
            )}

            <Button
              disabled={!newProvinceId || syncProvince.isPending}
              onClick={async () => {
                if (newCountryForProvince) {
                  const hasCountry = vendor?.deliveryCountries?.some((dc) => dc.countryId === newCountryForProvince);
                  if (!hasCountry) {
                    await addDeliveryCountry.mutateAsync(newCountryForProvince);
                  }
                }
                syncProvince.mutate({
                  provinceId: newProvinceId,
                  municipalityIds: selectedMunicipalityIds,
                });
              }}
              className="rounded-xl font-bold h-11 px-5"
            >
              <Plus className="h-4 w-4 mr-1" /> Guardar Cobertura
            </Button>
          </div>
        </div>

        {/* Existing Coverage Matrix grouped by Country */}
        <div className="flex flex-col gap-4">
          {countryCoverageTree.map(({ country, provinces: countryProvs }) => (
            <div key={country.id} className="rounded-xl border border-surface-container-high bg-surface-container/20 p-4">
              <div className="mb-3 flex items-center justify-between border-b border-surface-container-high pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] font-bold bg-tertiary-accent text-on-tertiary px-2 py-0.5 rounded">
                    {country.code}
                  </span>
                  <span className="text-[14px] font-bold text-on-surface">{country.name}</span>
                  <span className="text-[11.5px] text-outline">({countryProvs.length} subdivisiones)</span>
                </div>
                <button
                  onClick={() => {
                    openConfirm({
                      title: `¿Quitar ${country.name}?`,
                      message: `¿Estás seguro de quitar ${country.name} de tus países de entrega?`,
                      confirmLabel: "Sí, quitar país",
                      danger: true,
                      onConfirm: () => {
                        closeConfirm();
                        removeDeliveryCountry.mutate(country.id);
                      },
                    });
                  }}
                  className="text-[12px] font-semibold text-error hover:underline flex items-center gap-1"
                >
                  <X className="h-3.5 w-3.5" /> Quitar País
                </button>
              </div>

              {/* Provinces Grid */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {countryProvs.map(({ province, locations }) => {
                  const isAllMun = locations.some((l) => l.municipalityId === null);
                  return (
                    <div
                      key={province.id}
                      className="rounded-xl border border-surface-container-high bg-surface-container-lowest p-3.5 flex flex-col justify-between shadow-2xs"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[13.5px] font-bold text-on-surface">{province.name}</span>
                            <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider ${
                              province.type === "STATE" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                            }`}>
                              {province.type === "STATE" ? "Estado" : "Provincia"}
                            </span>
                          </div>
                          <button
                            onClick={() => {
                              openConfirm({
                                title: `¿Quitar ${province.name}?`,
                                message: `¿Estás seguro de quitar ${province.name} de tus zonas de servicio?`,
                                confirmLabel: "Sí, quitar",
                                danger: true,
                                onConfirm: () => {
                                  closeConfirm();
                                  syncProvince.mutate({ provinceId: province.id, municipalityIds: [] });
                                },
                              });
                            }}
                            className="text-outline hover:text-error transition"
                            title="Quitar subdivisión"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Municipality Pills for PROVINCE */}
                        {province.type !== "STATE" ? (
                          <div className="flex flex-wrap gap-1.5 my-2">
                            {isAllMun ? (
                              <span className="rounded-md bg-verified/15 text-verified-dark px-2.5 py-1 text-[11.5px] font-bold flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3" /> Toda la provincia
                              </span>
                            ) : (
                              locations.map((l) => (
                                <span
                                  key={l.id}
                                  className="rounded-md bg-surface-container-high px-2.5 py-1 text-[11.5px] font-semibold text-on-surface flex items-center gap-1.5"
                                >
                                  {l.municipality?.name ?? "Municipio"}
                                  <button
                                    onClick={() => {
                                      openConfirm({
                                        title: `¿Quitar ${l.municipality?.name}?`,
                                        message: `¿Quitar ${l.municipality?.name} de tus zonas de entrega?`,
                                        confirmLabel: "Sí, quitar",
                                        danger: true,
                                        onConfirm: () => {
                                          closeConfirm();
                                          removeLocation.mutate(l.id);
                                        },
                                      });
                                    }}
                                    className="text-outline hover:text-error"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </span>
                              ))
                            )}
                          </div>
                        ) : (
                          <p className="text-[11.5px] text-outline my-2 italic">Toda la extensión del estado</p>
                        )}
                      </div>

                      {/* Manage Municipalities Button for PROVINCE */}
                      {province.type !== "STATE" && (
                        <button
                          onClick={() => setManagingProvince(province)}
                          className="mt-2 flex items-center justify-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container/40 py-1.5 text-[11.5px] font-bold text-on-surface-variant hover:bg-surface-container transition"
                        >
                          <Settings2 className="h-3.5 w-3.5" /> Gestionar municipios
                        </button>
                      )}
                    </div>
                  );
                })}
                {countryProvs.length === 0 && (
                  <p className="col-span-2 text-[12.5px] text-outline italic py-2">
                    Aún no tenés estados o provincias agregados para este país. Usa el formulario de arriba para agregar.
                  </p>
                )}
              </div>
            </div>
          ))}

          {countryCoverageTree.length === 0 && (
            <div className="rounded-xl border border-dashed border-outline-variant p-6 text-center">
              <MapPin className="mx-auto h-8 w-8 text-outline/40 mb-2" />
              <p className="text-[13.5px] font-bold text-on-surface">Sin zonas de cobertura configuradas</p>
              <p className="text-[12px] text-outline">Agregá los países y provincias/estados donde vendés arriba.</p>
            </div>
          )}
        </div>
      </div>

      {/* Garantías */}
      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-title-lg font-bold text-on-surface">
          <ShieldCheck className="h-5 w-5 text-tertiary-accent" /> Garantías
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Se muestran a tus clientes en cada certificado de garantía que generes desde Pedidos. Mientras esta sección no
          esté completa, no vas a poder generar ni enviar garantías.
        </p>
        <div className="flex flex-col gap-3">
          <Input
            label="Días de garantía por defecto"
            type="number"
            min={1}
            value={form.warrantyDefaultDays}
            onChange={(e) => setForm({ ...form, warrantyDefaultDays: e.target.value })}
            placeholder="90"
          />
          <div>
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Términos y condiciones de garantía</span>
            <AiGenerateButton
              kind="warranty"
              currentText={form.warrantyTerms}
              onGenerated={(text) => setForm((f) => ({ ...f, warrantyTerms: text }))}
            />
            <textarea
              value={form.warrantyTerms}
              onChange={(e) => setForm({ ...form, warrantyTerms: e.target.value })}
              rows={5}
              placeholder="Ej.: la garantía cubre defectos de fabricación bajo uso normal. No cubre daños por mal uso, modificaciones no autorizadas ni desgaste natural. Para hacerla válida, presentar este certificado junto con el producto..."
              className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-3.5 text-[13px] outline-none focus:border-tertiary-accent"
            />
          </div>
        </div>
      </div>

      {/* Documento AI / KYC */}
      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-title-lg font-bold text-on-surface">
          <FileText className="h-5 w-5 text-tertiary-accent" /> Documento de la tienda para la IA
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Cargá un documento PDF o de texto con información detallada sobre tus servicios o políticas. El asistente IA usará esta información únicamente para responder a tus clientes.
        </p>

        {vendor?.aiDocumentUrl ? (
          <div className="flex items-center justify-between rounded-xl border border-surface-container-high bg-surface-container/30 p-4">
            <div className="flex items-center gap-3">
              <FileText className="h-6 w-6 text-tertiary-accent" />
              <div>
                <div className="text-[13.5px] font-bold text-on-surface">Documento cargado</div>
                <div className="text-[11.5px] text-outline">Disponible para el Asistente IA de tu tienda</div>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                openConfirm({
                  title: "¿Eliminar documento para la IA?",
                  message: "El documento ya no estará disponible para las respuestas automáticas a tus clientes.",
                  confirmLabel: "Sí, eliminar",
                  danger: true,
                  onConfirm: () => {
                    closeConfirm();
                    removeAiDocument.mutate();
                  },
                });
              }}
              disabled={removeAiDocument.isPending}
              className="rounded-xl text-error border-error/30 hover:bg-error/10"
            >
              <Trash2 className="h-4 w-4 mr-1" /> Eliminar
            </Button>
          </div>
        ) : (
          <div>
            <input
              type="file"
              accept=".pdf,.txt,.doc,.docx"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadAiDocument.mutate(file);
              }}
              className="block w-full text-[13px] text-outline file:mr-4 file:rounded-xl file:border-0 file:bg-tertiary-accent/10 file:px-4 file:py-2.5 file:text-[12.5px] file:font-bold file:text-tertiary-accent hover:file:bg-tertiary-accent/20 cursor-pointer"
            />
          </div>
        )}
      </div>

      {/* Modals */}
      {managingProvince && (
        <ManageVendorMunicipalitiesModal
          province={managingProvince}
          vendorLocations={vendor?.locations}
          onClose={() => setManagingProvince(null)}
          isPending={syncProvince.isPending}
          onSave={({ provinceId, municipalityIds }) => {
            openConfirm({
              title: `¿Guardar municipios en ${managingProvince.name}?`,
              message: `Se actualizarán las zonas de entrega configuradas para ${managingProvince.name}.`,
              confirmLabel: "Sí, guardar municipios",
              onConfirm: () => {
                closeConfirm();
                syncProvince.mutate({ provinceId, municipalityIds });
              },
            });
          }}
        />
      )}

      {confirmModal && (
        <ConfirmModal
          open={!!confirmModal}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          danger={confirmModal.danger}
          onConfirm={confirmModal.onConfirm}
          onCancel={closeConfirm}
        />
      )}
    </div>
  );
}
