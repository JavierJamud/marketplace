import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { X, Plus, Trash2, Globe2, MapPin } from "lucide-react";
import { PhoneInput } from "../../components/ui/PhoneInput.jsx";
import { SuggestionBox } from "../../components/SuggestionBox.jsx";
import { AiGenerateButton } from "../../components/AiGenerateButton.jsx";
import { PAYMENT_METHODS } from "../../lib/paymentMethods.js";
import { CategoryIcon } from "../../components/ui/CategoryIcon.jsx";

const DAY_ROWS = [
  { dayOfWeek: 1, name: "Lunes" },
  { dayOfWeek: 2, name: "Martes" },
  { dayOfWeek: 3, name: "Miércoles" },
  { dayOfWeek: 4, name: "Jueves" },
  { dayOfWeek: 5, name: "Viernes" },
  { dayOfWeek: 6, name: "Sábado" },
  { dayOfWeek: 0, name: "Domingo" },
];

export default function VendorSettings() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    companyName: "",
    ownerName: "",
    ownerIdNumber: "",
    companyAddress: "",
    description: "",
    whatsapp: "",
    businessCategoryId: "",
    orderDestination: "WHATSAPP",
    acceptedPaymentMethods: [],
  });
  const [days, setDays] = useState(DAY_ROWS.map((d) => ({ ...d, opensAt: "09:00", closesAt: "18:00", isClosed: false })));
  const [customMethod, setCustomMethod] = useState("");
  const [newProvinceId, setNewProvinceId] = useState("");
  const [newMunicipalityId, setNewMunicipalityId] = useState("");
  const [newCountryId, setNewCountryId] = useState("");

  const { data: vendor, isLoading } = useQuery({
    queryKey: ["my-vendor-settings"],
    queryFn: async () => (await api.get("/vendors/me")).data.vendor,
  });

  const { data: provinces } = useQuery({
    queryKey: ["provinces"],
    queryFn: async () => (await api.get("/locations/provinces")).data.provinces,
  });

  // Bloque 19: municipios de la provincia elegida en el mini-form de "+
  // Agregar provincia" — dependiente, mismo patrón que LocationContext.jsx.
  const { data: newProvinceMunicipalities } = useQuery({
    queryKey: ["municipalities", newProvinceId],
    queryFn: async () => (await api.get(`/locations/provinces/${newProvinceId}/municipalities`)).data.municipalities,
    enabled: !!newProvinceId,
  });

  const { data: countries } = useQuery({
    queryKey: ["active-countries"],
    queryFn: async () => (await api.get("/locations/countries")).data.countries,
  });

  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });

  // Bloque 18: el vendedor puede cambiar su tipo de negocio después del
  // registro. Trae TODAS las activas + la actual aunque esté desactivada
  // (para no perderla del selector si el admin la desactivó mientras tanto).
  const { data: businessCategories } = useQuery({
    queryKey: ["business-categories"],
    queryFn: async () => (await api.get("/business-categories")).data.categories,
  });
  const currentBusinessCategoryMissing =
    businessCategories && vendor?.businessCategory && !businessCategories.some((c) => c.id === vendor.businessCategory.id);
  const businessCategoryOptions = currentBusinessCategoryMissing
    ? [...businessCategories, vendor.businessCategory]
    : businessCategories;
  const selectedBusinessCategory = businessCategoryOptions?.find((c) => c.id === form.businessCategoryId);

  useEffect(() => {
    if (!vendor) return;
    setForm({
      companyName: vendor.companyName,
      ownerName: vendor.ownerName ?? "",
      ownerIdNumber: vendor.ownerIdNumber ?? "",
      companyAddress: vendor.companyAddress ?? "",
      description: vendor.description ?? "",
      whatsapp: vendor.whatsapp,
      businessCategoryId: vendor.businessCategory?.id ?? "",
      orderDestination: vendor.orderDestination ?? "WHATSAPP",
      acceptedPaymentMethods: vendor.acceptedPaymentMethods ?? [],
    });
    if (vendor.schedules?.length) {
      setDays(DAY_ROWS.map((d) => {
        const s = vendor.schedules.find((x) => x.dayOfWeek === d.dayOfWeek);
        return s ? { ...d, opensAt: s.opensAt, closesAt: s.closesAt, isClosed: s.isClosed } : { ...d, opensAt: "09:00", closesAt: "18:00", isClosed: false };
      }));
    }
  }, [vendor]);

  const saveProfile = useMutation({
    mutationFn: async () => (await api.patch("/vendors/me", form)).data,
  });

  // Bloque 21: antes esto solo guardaba aiFile.name como texto plano en el
  // PATCH general de arriba — el archivo nunca viajaba, y ese campo ni
  // siquiera existía en el schema de zod del backend (se descartaba
  // solo). Ahora es un upload real e inmediato (no espera a "Guardar
  // cambios") a su propio endpoint multipart.
  const uploadAiDocument = useMutation({
    mutationFn: async (file) => {
      const formData = new FormData();
      formData.append("document", file);
      return (await api.post("/vendors/me/ai-document", formData, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      toast.success("Documento cargado — ya lo puede usar el chat de tu tienda.");
      queryClient.invalidateQueries({ queryKey: ["my-vendor-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo subir el documento."),
  });
  const saveSchedule = useMutation({
    mutationFn: async () => (await api.patch("/vendors/me/schedule", { days: days.map(({ dayOfWeek, opensAt, closesAt, isClosed }) => ({ dayOfWeek, opensAt, closesAt, isClosed })) })).data,
  });

  // Bloque 19: provincias de Cuba donde vende (multi, según plan) y países
  // de entrega — ambas se guardan al toque (no esperan a "Guardar cambios"),
  // ya que cada agregado/quitado ya es una llamada propia al backend.
  const invalidateVendor = () => {
    queryClient.invalidateQueries({ queryKey: ["my-vendor-settings"] });
    queryClient.invalidateQueries({ queryKey: ["my-vendor"] });
  };

  const addLocation = useMutation({
    mutationFn: async () => (await api.post("/vendors/me/locations", { provinceId: newProvinceId, municipalityId: newMunicipalityId || undefined })).data,
    onSuccess: () => {
      toast.success("Provincia agregada.");
      setNewProvinceId("");
      setNewMunicipalityId("");
      invalidateVendor();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo agregar la provincia."),
  });

  const removeLocation = useMutation({
    mutationFn: async (id) => api.delete(`/vendors/me/locations/${id}`),
    onSuccess: invalidateVendor,
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo quitar la provincia."),
  });

  const addDeliveryCountry = useMutation({
    mutationFn: async () => (await api.post("/vendors/me/delivery-countries", { countryId: newCountryId })).data,
    onSuccess: () => {
      toast.success("País de entrega agregado.");
      setNewCountryId("");
      invalidateVendor();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo agregar el país."),
  });

  const removeDeliveryCountry = useMutation({
    mutationFn: async (countryId) => api.delete(`/vendors/me/delivery-countries/${countryId}`),
    onSuccess: invalidateVendor,
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo quitar el país."),
  });
  const cancelPlan = useMutation({
    mutationFn: async () => (await api.patch("/vendors/me", { planType: "REGULAR" })).data,
    onSuccess: () => {
      toast.success("Volviste al Plan Regular.");
      queryClient.invalidateQueries({ queryKey: ["my-vendor-settings"] });
      queryClient.invalidateQueries({ queryKey: ["my-vendor"] });
    },
  });

  async function handleSaveAll() {
    try {
      await Promise.all([saveProfile.mutateAsync(), saveSchedule.mutateAsync()]);
      toast.success("Cambios guardados.");
      queryClient.invalidateQueries({ queryKey: ["my-vendor-settings"] });
      queryClient.invalidateQueries({ queryKey: ["my-vendor"] });
    } catch (err) {
      toast.error(err.response?.data?.error ?? "No se pudieron guardar los cambios.");
    }
  }

  function updateDay(dayOfWeek, field, value) {
    setDays((d) => d.map((row) => (row.dayOfWeek === dayOfWeek ? { ...row, [field]: value } : row)));
  }

  function togglePaymentMethod(id) {
    setForm((f) => ({
      ...f,
      acceptedPaymentMethods: f.acceptedPaymentMethods.includes(id)
        ? f.acceptedPaymentMethods.filter((m) => m !== id)
        : [...f.acceptedPaymentMethods, id],
    }));
  }

  function addCustomMethod() {
    const value = customMethod.trim();
    if (!value || form.acceptedPaymentMethods.includes(value)) return;
    setForm((f) => ({ ...f, acceptedPaymentMethods: [...f.acceptedPaymentMethods, value] }));
    setCustomMethod("");
  }

  const knownIds = new Set(PAYMENT_METHODS.map((m) => m.id));
  const customMethods = form.acceptedPaymentMethods.filter((m) => !knownIds.has(m));

  if (isLoading) return <p className="text-body-md text-on-surface-variant">Cargando...</p>;

  const isBusiness = vendor?.planType === "BUSINESS";

  // Bloque 19: límites por plan, admin-configurables (SiteSettings) — nunca
  // hardcodeados acá.
  const distinctProvinceCount = new Set((vendor?.locations ?? []).map((l) => l.provinceId)).size;
  const maxProvinces = isBusiness ? settings?.maxProvincesBusiness : settings?.maxProvincesRegular;
  const atProvinceLimit = maxProvinces !== null && maxProvinces !== undefined && distinctProvinceCount >= maxProvinces;

  const deliveryCountryCount = vendor?.deliveryCountries?.length ?? 0;
  const maxDeliveryCountries = isBusiness ? settings?.maxDeliveryCountriesBusiness : settings?.maxDeliveryCountriesRegular;
  const atCountryLimit = maxDeliveryCountries !== undefined && deliveryCountryCount >= maxDeliveryCountries;
  const selectedCountryIds = new Set((vendor?.deliveryCountries ?? []).map((dc) => dc.countryId));
  const availableCountries = countries?.filter((c) => !selectedCountryIds.has(c.id));

  return (
    <div className="max-w-[760px]">
      <h1 className="mb-[22px] font-display text-[25px] font-bold text-on-surface">Configuración de la tienda</h1>

      <div className="mb-5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
        <div className="mb-4 text-[15px] font-bold text-on-surface">Datos públicos</div>
        <div className="flex flex-col gap-3.5">
          <Input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
          <div>
            <AiGenerateButton kind="store" currentText={form.description} onGenerated={(text) => setForm((f) => ({ ...f, description: text }))} />
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Escribí unas palabras clave de tu tienda (ej: ropa urbana en La Habana desde 2020) y usá 'Mejorar con IA' arriba."
              className="min-h-[70px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest px-3.5 py-3 text-body-md outline-none"
            />
          </div>
          <PhoneInput label="WhatsApp" value={form.whatsapp} onChange={(whatsapp) => setForm({ ...form, whatsapp })} />
          <div className="flex items-center gap-2.5">
            <Select
              label="Tipo de negocio"
              value={form.businessCategoryId}
              onChange={(e) => setForm({ ...form, businessCategoryId: e.target.value })}
              className="flex-1"
            >
              {businessCategoryOptions?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            {selectedBusinessCategory && (
              <div className="mt-6 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md bg-tertiary-accent/10">
                <CategoryIcon name={selectedBusinessCategory.icon} className="h-5 w-5 text-tertiary-accent" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* PROVINCIAS DE CUBA (Bloque 19) — Regular sigue en 1, Business hasta
          el límite que fije el admin (o ilimitado). Reemplaza el viejo
          selector único de "Provincia". */}
      <div className="mb-5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
        <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
          <MapPin className="h-4 w-4 text-tertiary-accent" /> Provincias donde vendés
        </div>
        <p className="mb-3.5 text-[12.5px] text-outline">
          {maxProvinces === null || maxProvinces === undefined
            ? `${distinctProvinceCount} provincia(s) · Plan ${isBusiness ? "Business" : "Regular"} sin límite`
            : `${distinctProvinceCount}/${maxProvinces} provincia(s) de tu Plan ${isBusiness ? "Business" : "Regular"}`}
          {!isBusiness && atProvinceLimit && " · verificate para agregar más"}
        </p>

        <div className="mb-3.5 flex flex-col gap-2">
          {vendor?.locations?.map((l) => (
            <div key={l.id} className="flex items-center justify-between rounded-md border border-surface-container-high px-3.5 py-2.5">
              <span className="text-[13px] font-semibold text-on-surface">
                {l.province?.name}
                {l.municipality && <span className="text-outline"> · {l.municipality.name}</span>}
              </span>
              <button
                onClick={() => removeLocation.mutate(l.id)}
                disabled={removeLocation.isPending || vendor.locations.length <= 1}
                title={vendor.locations.length <= 1 ? "Necesitás al menos una provincia" : "Quitar"}
                className="text-error disabled:opacity-30"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        {atProvinceLimit ? (
          <p className="text-[12.5px] text-outline">
            {isBusiness
              ? "Alcanzaste el límite de provincias configurado para tu plan."
              : "El Plan Regular permite vender en 1 provincia. Verificate para vender en más."}
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-2.5">
            <Select label="Provincia" value={newProvinceId} onChange={(e) => { setNewProvinceId(e.target.value); setNewMunicipalityId(""); }} className="min-w-[160px] flex-1">
              <option value="">Elegí una provincia</option>
              {provinces?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            {newProvinceId && newProvinceMunicipalities?.length > 0 && (
              <Select label="Municipio (opcional)" value={newMunicipalityId} onChange={(e) => setNewMunicipalityId(e.target.value)} className="min-w-[160px] flex-1">
                <option value="">Todos los municipios</option>
                {newProvinceMunicipalities.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            )}
            <button
              onClick={() => addLocation.mutate()}
              disabled={!newProvinceId || addLocation.isPending}
              className="flex h-11 items-center gap-1.5 rounded-md bg-secondary-container px-4 text-[13px] font-bold text-on-secondary-container disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Agregar
            </button>
          </div>
        )}
      </div>

      {/* PAÍSES DE ENTREGA (Bloque 19) — además de Cuba, a qué otros países
          declara que entrega esta tienda. Solo países activos por el admin. */}
      <div className="mb-5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
        <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
          <Globe2 className="h-4 w-4 text-tertiary-accent" /> Países de entrega
        </div>
        <p className="mb-3.5 text-[12.5px] text-outline">
          {deliveryCountryCount}/{maxDeliveryCountries ?? "—"} país(es) de tu Plan {isBusiness ? "Business" : "Regular"}
          {!isBusiness && atCountryLimit && " · verificate para agregar más"}
        </p>

        {vendor?.deliveryCountries?.length > 0 && (
          <div className="mb-3.5 flex flex-wrap gap-2">
            {vendor.deliveryCountries.map((dc) => (
              <span
                key={dc.id}
                className="flex items-center gap-1.5 rounded-full border border-tertiary-accent bg-tertiary-accent/10 px-3.5 py-2 text-[12.5px] font-semibold text-tertiary-accent"
              >
                {dc.country?.name}
                <button
                  onClick={() => removeDeliveryCountry.mutate(dc.countryId)}
                  disabled={removeDeliveryCountry.isPending}
                  className="hover:text-error"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {atCountryLimit ? (
          <p className="text-[12.5px] text-outline">
            {isBusiness
              ? "Alcanzaste el límite de países configurado para tu plan."
              : "El Plan Regular permite un país de entrega. Verificate para agregar más."}
          </p>
        ) : (
          <div className="flex items-end gap-2.5">
            <Select label="País" value={newCountryId} onChange={(e) => setNewCountryId(e.target.value)} className="flex-1">
              <option value="">Elegí un país</option>
              {availableCountries?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <button
              onClick={() => addDeliveryCountry.mutate()}
              disabled={!newCountryId || addDeliveryCountry.isPending}
              className="flex h-11 items-center gap-1.5 rounded-md bg-secondary-container px-4 text-[13px] font-bold text-on-secondary-container disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Agregar
            </button>
          </div>
        )}
      </div>

      <div className="mb-5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
        <div className="mb-1 text-[15px] font-bold text-on-surface">Responsable del negocio</div>
        <p className="mb-3.5 text-[12.5px] text-outline">Privado — solo lo ven admin y vos. Nunca se muestra en tu tienda pública.</p>
        <Input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
      </div>

      {/* Bloque 29: datos de facturación — privados, se autocompletan en
          cualquier factura/garantía que generés desde Pedidos. Sin esto
          completo, la generación de esos documentos se bloquea con un aviso
          claro (ver invoices.controller.js). */}
      <div className="mb-5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
        <div className="mb-1 text-[15px] font-bold text-on-surface">Datos de facturación</div>
        <p className="mb-3.5 text-[12.5px] text-outline">
          Privado — se usa para autocompletar las facturas y certificados de garantía que generés desde Pedidos. Necesario para poder
          generar esos documentos.
        </p>
        <div className="flex flex-col gap-3.5">
          <Input
            label="Identificación del responsable"
            placeholder="Carnet de identidad / RIF / NIT"
            value={form.ownerIdNumber}
            onChange={(e) => setForm({ ...form, ownerIdNumber: e.target.value })}
          />
          <Input
            label="Dirección de la empresa"
            placeholder="Calle, número, municipio, provincia"
            value={form.companyAddress}
            onChange={(e) => setForm({ ...form, companyAddress: e.target.value })}
          />
        </div>
      </div>

      <div className="mb-5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
        <div className="mb-1 text-[15px] font-bold text-on-surface">¿Dónde querés recibir tus pedidos?</div>
        <p className="mb-4 text-[12.5px] text-outline">Elegí un solo destino: así sabés siempre dónde mirar cuando un cliente pide.</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          {[
            { id: "WHATSAPP", title: "WhatsApp directo", sub: "El catálogo muestra el botón de WhatsApp; coordinás ahí mismo." },
            { id: "PANEL", title: "Panel de vendedor", sub: "El cliente completa sus datos y el pedido cae en Pedidos para gestionar." },
          ].map((opt) => (
            <label
              key={opt.id}
              onClick={() => setForm({ ...form, orderDestination: opt.id })}
              className={`flex flex-1 cursor-pointer items-start gap-3 rounded-md p-4 ${
                form.orderDestination === opt.id ? "border-2 border-tertiary-accent" : "border border-surface-container-high"
              }`}
            >
              <span
                className={`mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full border-2 ${
                  form.orderDestination === opt.id ? "border-tertiary-accent" : "border-outline-variant"
                }`}
              >
                {form.orderDestination === opt.id && <span className="h-2 w-2 rounded-full bg-tertiary-accent" />}
              </span>
              <div>
                <div className="text-[13.5px] font-bold text-on-surface">{opt.title}</div>
                <div className="text-[12px] text-outline">{opt.sub}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="mb-5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
        <div className="mb-1 text-[15px] font-bold text-on-surface">Métodos de pago que aceptás</div>
        <p className="mb-4 text-[12.5px] text-outline">
          Informativo — se muestra en tu perfil público para que el cliente sepa qué opciones tenés. ZeuDin nunca procesa ni cobra
          nada acá, el pago siempre se coordina directo con vos.
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          {PAYMENT_METHODS.map((m) => {
            const active = form.acceptedPaymentMethods.includes(m.id);
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => togglePaymentMethod(m.id)}
                className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[12.5px] font-semibold ${
                  active ? "border-tertiary-accent bg-tertiary-accent/10 text-tertiary-accent" : "border-outline-variant text-on-surface-variant"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {m.label}
              </button>
            );
          })}
        </div>

        {customMethods.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {customMethods.map((m) => (
              <span key={m} className="flex items-center gap-1.5 rounded-full border border-tertiary-accent bg-tertiary-accent/10 px-3.5 py-2 text-[12.5px] font-semibold text-tertiary-accent">
                {m}
                <button type="button" onClick={() => togglePaymentMethod(m)} className="hover:text-error">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={customMethod}
            onChange={(e) => setCustomMethod(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomMethod())}
            placeholder="¿Otro método? Escribilo acá..."
            className="h-10 flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3.5 text-[13px] outline-none focus:border-primary-container"
          />
          <button
            type="button"
            onClick={addCustomMethod}
            disabled={!customMethod.trim()}
            className="rounded-md border border-outline-variant px-3.5 text-[12.5px] font-semibold text-on-surface-variant disabled:opacity-50"
          >
            Agregar
          </button>
        </div>
      </div>

      <div className="mb-5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
        <div className="mb-1 text-[15px] font-bold text-on-surface">Horarios de atención</div>
        <p className="mb-4 text-[12.5px] text-outline">Zona horaria America/Havana. Se muestra "Abierto/Cerrado ahora" según esto.</p>
        <div className="flex flex-col gap-2.5">
          {days.map((d) => (
            <div key={d.dayOfWeek} className="flex items-center gap-3.5">
              <span className="w-[90px] text-[13px] text-on-surface-variant">{d.name}</span>
              <label className="flex items-center gap-1.5 text-[12px] text-outline">
                <input type="checkbox" checked={!d.isClosed} onChange={(e) => updateDay(d.dayOfWeek, "isClosed", !e.target.checked)} />
                Abierto
              </label>
              {!d.isClosed && (
                <>
                  <input
                    type="time"
                    value={d.opensAt}
                    onChange={(e) => updateDay(d.dayOfWeek, "opensAt", e.target.value)}
                    className="h-[38px] w-[110px] rounded border border-outline-variant px-2.5 text-center text-[13px] outline-none"
                  />
                  <span className="text-outline">—</span>
                  <input
                    type="time"
                    value={d.closesAt}
                    onChange={(e) => updateDay(d.dayOfWeek, "closesAt", e.target.value)}
                    className="h-[38px] w-[110px] rounded border border-outline-variant px-2.5 text-center text-[13px] outline-none"
                  />
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {isBusiness && (
        <div className="mb-5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
          <div className="mb-1 text-[15px] font-bold text-on-surface">Documento de IA (chatbot de tu tienda)</div>
          <p className="mb-3.5 text-[12.5px] text-outline">
            Función Business. Subí un documento privado (horarios, políticas de cambio, preguntas frecuentes, lo que quieras) — es lo que usa
            el chatbot con IA de tu tienda pública para responder a tus clientes, además de tu catálogo de productos en vivo. El chatbot
            aparece solo si tu tienda está verificada. Nunca se muestra el documento tal cual, solo lo usa como contexto.
          </p>
          <label className={`block rounded-md border-2 border-dashed border-outline-variant p-[22px] text-center ${uploadAiDocument.isPending ? "cursor-wait opacity-70" : "cursor-pointer"}`}>
            <span className="text-[13px] text-outline">
              {uploadAiDocument.isPending
                ? "Subiendo..."
                : vendor?.aiDocumentName
                  ? `Documento actual: ${vendor.aiDocumentName} · `
                  : "Arrastrá un .pdf o .txt · o "}
              {!uploadAiDocument.isPending && <span className="font-semibold text-tertiary-accent">{vendor?.aiDocumentName ? "reemplazar archivo" : "elegí un archivo"}</span>}
            </span>
            <input
              type="file"
              accept=".pdf,.txt"
              className="hidden"
              disabled={uploadAiDocument.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) uploadAiDocument.mutate(file);
              }}
            />
          </label>
        </div>
      )}

      <div className="mb-5 flex items-center justify-between rounded-lg border border-error/30 bg-surface-container-lowest px-6 py-5">
        <div>
          <div className="text-[14px] font-bold text-on-surface">Plan {isBusiness ? "Business" : "Regular"}</div>
          <div className="text-[12.5px] text-outline">
            {isBusiness ? "2 500 CUP/mes · si vence, baja a Regular automáticamente" : "Gratis · hasta 20 productos, solo WhatsApp"}
          </div>
        </div>
        {isBusiness && (
          <button
            onClick={() => window.confirm("¿Cancelar el Plan Business? Volverás al Plan Regular (máx. 20 productos, solo WhatsApp).") && cancelPlan.mutate()}
            className="rounded-md border border-error px-4 py-2.5 text-[13px] font-semibold text-error"
          >
            Cancelar plan
          </button>
        )}
      </div>

      <div className="mb-5 flex justify-end">
        <Button size="lg" onClick={handleSaveAll} disabled={saveProfile.isPending || saveSchedule.isPending}>
          {saveProfile.isPending || saveSchedule.isPending ? "Guardando..." : "Guardar cambios"}
        </Button>
      </div>

      <SuggestionBox />
    </div>
  );
}
