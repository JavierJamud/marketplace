import { useSearchParams } from "react-router-dom";
import { useEffect, useRef, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { Input } from "../../components/ui/Input.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Tabs } from "../../components/ui/Tabs.jsx";
import { SecurityCard } from "./VendorProfile.jsx";
import { CashCloseSettingsPanel } from "./VendorUsers.jsx";
import { Mail, Users, X, Plus, Trash2, Globe2, MapPin, FileText, Settings2, CheckCircle2, Wallet, ShieldCheck, MessageCircle, LayoutDashboard, Layers, Lock, Globe, Copy, QrCode, Clock } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { QRCodeSVG } from "qrcode.react";
import { checkoutChoices, storePaymentMethods, currencyCodesFor, currencyOption } from "../../lib/catalog.js";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { useUnsavedGuard } from "../../lib/unsavedGuard.jsx";
import { AiGenerateButton } from "../../components/AiGenerateButton.jsx";
import { copyToClipboard } from "../../lib/clipboard.js";
import { StoreShippingCard } from "../../components/vendor/ShippingFields.jsx";
import { PlanUpsell } from "../../components/vendor/PlanUpsell.jsx";
import { EmailPreferencesCard } from "../../components/customer/EmailPreferencesCard.jsx";
import { ManageVendorMunicipalitiesModal, zoneUnit } from "../../components/ZoneMunicipalitiesModal.jsx";

// Vendor.orderDestination: todo pedido entra siempre a "Mis pedidos" (con aviso en vivo, push y correo). La tienda solo
// elige si al cliente, después de enviarlo, se le ofrece además mandárselo por WhatsApp. "Solo WhatsApp" se quitó porque
// daba a entender que el pedido no llegaba al panel y las tiendas no lo confirmaban ahí.
const ORDER_DESTINATIONS = [
  {
    id: "PANEL",
    icon: LayoutDashboard,
    label: "Solo en mi panel",
    description: "Recibes el pedido en Mis pedidos. Al cliente no le mostramos WhatsApp.",
  },
  {
    id: "BOTH",
    icon: Layers,
    label: "En mi panel y por WhatsApp",
    description: "Recibes el pedido en Mis pedidos y, si el cliente quiere, también te lo manda por WhatsApp con todos los datos.",
  },
];

const DAY_ROWS = [
  { dayOfWeek: 1, name: "Lunes" },
  { dayOfWeek: 2, name: "Martes" },
  { dayOfWeek: 3, name: "Miércoles" },
  { dayOfWeek: 4, name: "Jueves" },
  { dayOfWeek: 5, name: "Viernes" },
  { dayOfWeek: 6, name: "Sábado" },
  { dayOfWeek: 0, name: "Domingo" },
];

// Bloque 77 (pedido explícito): enlace copiable + QR real y escaneable
// (qrcode.react — antes el único "QR" del proyecto, en VendorTables.jsx, era
// decorativo, no un QR de verdad) hacia la propia tienda pública
// (/tienda/:slug, la misma ruta de siempre, no una URL secreta aparte).
function VendorShareLink({ slug, isPrivate }) {
  const url = `${window.location.origin}/tienda/${slug}`;

  function copyLink() {
    copyToClipboard(url)
      .then(() => toast.success("Enlace copiado."))
      .catch(() => toast.error("No se pudo copiar el enlace."));
  }

  return (
    <div className="flex flex-col items-start gap-4 rounded-xl border border-outline-variant bg-surface-container/40 p-4 sm:flex-row sm:items-center">
      <div className="flex-shrink-0 rounded-lg bg-white p-2">
        <QRCodeSVG value={url} size={104} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 text-[12px] font-bold text-on-surface-variant">
          Enlace de tu tienda {isPrivate ? "privada" : "pública"}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
            className="h-9 min-w-0 flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3 text-[12.5px] text-on-surface-variant outline-none"
          />
          <Button variant="outline" className="flex-shrink-0 rounded-lg px-3 py-2" onClick={copyLink}>
            <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar
          </Button>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-outline">
          <QrCode className="h-3 w-3 flex-shrink-0" /> Escaneable de verdad: imprímelo o compártelo tal cual.
        </p>
      </div>
    </div>
  );
}

// Bloque 115 (pedido explícito — "unir varias secciones en una sola ventana
// con pestañas"): las 8 tarjetas que antes se apilaban una debajo de la otra
// en una sola pantalla larga se agrupan en 3 pestañas — ninguna query,
// mutación ni el guardado en bloque (handleSaveAll) cambia, esto es
// puramente cómo se presenta el mismo formulario.
const SETTINGS_TABS = [
  { id: "general", label: "General", icon: Wallet },
  { id: "cobertura", label: "Cobertura y visibilidad", icon: Globe2 },
  { id: "facturacion", label: "Facturación y otros", icon: FileText },
  { id: "seguridad", label: "Seguridad", icon: ShieldCheck },
  { id: "equipo", label: "Equipo y caja", icon: Users },
];

export default function VendorSettings() {
  const { siteName, maxTablesByPlan } = usePlatformSettings();
  const queryClient = useQueryClient();
  // La pestaña viaja en la URL (?tab=seguridad): el asistente y los enlaces
  // pueden llevar directo a la sección exacta de Configuración.
  const [tabParams, setTabParams] = useSearchParams();
  const requestedTab = tabParams.get("tab");
  const activeTab = SETTINGS_TABS.some((t) => t.id === requestedTab) ? requestedTab : "general";
  const setActiveTab = (id) => setTabParams(id === "general" ? {} : { tab: id }, { replace: true });
  const [form, setForm] = useState({
    ownerIdNumber: "",
    companyAddress: "",
    orderDestination: "BOTH",
    notifyNewOrderEmail: true,
    // Bloque 77 (pedido explícito): tienda privada — no aparece en el
    // catálogo público/buscador, sigue funcionando 100% normal por su link
    // directo (mismo /tienda/:slug de siempre, ver el card de abajo).
    isPrivate: false,
    acceptedPaymentMethods: [],
    checkoutPaymentOptions: [],
    currency: "CUP",
    warrantyTerms: "",
    warrantyDefaultDays: "",
    isRestaurant: false,
    tableCount: "",
    menuPublic: true,
    // Envío de toda la tienda ("" = cada producto define el suyo), ver StoreShippingCard.
    storeShippingMode: "",
    storeShippingLocal: "",
    storeShippingOther: "",
    storeShippingCurrency: "CUP",
    shippingOriginProvinceId: "",
  });
  // Bloque 174 (bug real reportado en vivo — "no encuentro esa función,
  // verifica que esté y que funcione"): esta pantalla SÍ tenía el estado y
  // la mutación de guardado ya armados (ver saveSchedule más abajo), pero
  // nunca llegó a existir el formulario en el JSX — el vendedor no tenía
  // forma real de tocar esto desde ningún lado. De paso, termina Bloque 171
  // (varios tramos por día, ej. 9-12 y 14-18): cada día ahora guarda un
  // ARRAY de tramos, no uno solo.
  const [days, setDays] = useState(DAY_ROWS.map((d) => ({ ...d, isClosed: false, ranges: [{ opensAt: "09:00", closesAt: "18:00" }] })));
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
  // Interruptor "Horarios de atención" del plan (planFeatures, GET /vendors/me), que el admin puede apagar por plan.
  const allowSchedules = vendor?.planFeatures?.allowSchedules !== false;
  // Tienda sin ningún horario guardado (por ejemplo, se registró con un plan sin horarios y después pasó a uno que sí los
  // trae): el editor muestra 09:00-18:00 de ejemplo, pero en el servidor no hay nada y la tienda no sale como abierta ni
  // cerrada. scheduleSavedHere cubre el rato entre guardarlo y que la tienda vuelva a cargarse.
  const [scheduleSavedHere, setScheduleSavedHere] = useState(false);
  const hasSavedSchedule = scheduleSavedHere || (vendor?.schedules?.length ?? 0) > 0;

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

  // Foto de lo guardado (formulario y horarios) para saber si hay cambios sin guardar al cambiar de sección.
  const [baseline, setBaseline] = useState(null);
  const wantBaseline = useRef(false);
  useEffect(() => {
    if (!wantBaseline.current) return;
    wantBaseline.current = false;
    setBaseline(JSON.stringify({ form, days }));
  }, [form, days]);

  useEffect(() => {
    if (!vendor) return;
    wantBaseline.current = true;
    setForm({
      ownerIdNumber: vendor.ownerIdNumber ?? "",
      companyAddress: vendor.companyAddress ?? "",
      orderDestination: vendor.orderDestination === "PANEL" ? "PANEL" : "BOTH",
      notifyNewOrderEmail: vendor.notifyNewOrderEmail ?? true,
      isPrivate: vendor.isPrivate ?? false,
      acceptedPaymentMethods: vendor.acceptedPaymentMethods ?? [],
      checkoutPaymentOptions: vendor.checkoutPaymentOptions?.length ? vendor.checkoutPaymentOptions : checkoutChoices().map((o) => o.id),
      currency: vendor.currency ?? "CUP",
      warrantyTerms: vendor.warrantyTerms ?? "",
      warrantyDefaultDays: vendor.warrantyDefaultDays != null ? String(vendor.warrantyDefaultDays) : "",
      isRestaurant: vendor.isRestaurant ?? false,
      tableCount: vendor.tableCount != null ? String(vendor.tableCount) : "",
      menuPublic: vendor.menuPublic ?? true,
      storeShippingMode: vendor.storeShippingMode ?? "",
      storeShippingLocal: vendor.storeShippingLocal != null ? String(Number(vendor.storeShippingLocal)) : "",
      storeShippingOther: vendor.storeShippingOther != null ? String(Number(vendor.storeShippingOther)) : "",
      storeShippingCurrency: vendor.storeShippingCurrency ?? vendor.currency ?? "CUP",
      shippingOriginProvinceId: vendor.shippingOriginProvinceId ?? vendor.locations?.find((l) => l.provinceId)?.provinceId ?? "",
    });
    if (vendor.schedules?.length) {
      setDays(
        DAY_ROWS.map((d) => {
          const rows = vendor.schedules.filter((x) => x.dayOfWeek === d.dayOfWeek && !x.isClosed);
          if (rows.length === 0) {
            // Sin tramos reales para este día (o solo la fila isClosed:true
            // que lo marca como día de descanso) — arranca cerrado, con un
            // tramo por defecto ya cargado por si lo vuelven a abrir.
            return { ...d, isClosed: true, ranges: [{ opensAt: "09:00", closesAt: "18:00" }] };
          }
          return {
            ...d,
            isClosed: false,
            ranges: rows.map((r) => ({ opensAt: r.opensAt, closesAt: r.closesAt })).sort((a, b) => a.opensAt.localeCompare(b.opensAt)),
          };
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
          ownerIdNumber: form.ownerIdNumber.trim() || null,
          companyAddress: form.companyAddress.trim() || null,
          warrantyTerms: form.warrantyTerms.trim() || null,
          warrantyDefaultDays: form.warrantyDefaultDays === "" ? null : Number(form.warrantyDefaultDays),
          tableCount: form.tableCount === "" ? undefined : Number(form.tableCount),
          storeShippingMode: form.storeShippingMode || null,
          storeShippingLocal: form.storeShippingMode === "FIXED" && form.storeShippingLocal !== "" ? Number(form.storeShippingLocal) : null,
          storeShippingOther: form.storeShippingMode === "FIXED" && form.storeShippingOther !== "" ? Number(form.storeShippingOther) : null,
          storeShippingCurrency: form.storeShippingMode === "FIXED" ? form.storeShippingCurrency : null,
          shippingOriginProvinceId: form.shippingOriginProvinceId || null,
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
      (
        await api.patch("/vendors/me/schedule", {
          days: days.map(({ dayOfWeek, isClosed, ranges }) => ({
            dayOfWeek,
            isClosed,
            ranges: isClosed ? [] : ranges,
          })),
        })
      ).data,
  });

  function updateDayRange(dayOfWeek, rangeIndex, key, value) {
    setDays((prev) =>
      prev.map((d) =>
        d.dayOfWeek === dayOfWeek
          ? { ...d, ranges: d.ranges.map((r, i) => (i === rangeIndex ? { ...r, [key]: value } : r)) }
          : d
      )
    );
  }
  function addDayRange(dayOfWeek) {
    setDays((prev) =>
      prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ranges: [...d.ranges, { opensAt: "14:00", closesAt: "18:00" }] } : d))
    );
  }
  function removeDayRange(dayOfWeek, rangeIndex) {
    setDays((prev) =>
      prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ranges: d.ranges.filter((_, i) => i !== rangeIndex) } : d))
    );
  }
  function toggleDayClosed(dayOfWeek) {
    setDays((prev) => prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, isClosed: !d.isClosed } : d)));
  }
  // Bloque 176 (pedido explícito — "debajo de Cerrado debe haber una que
  // diga siempre abierto, eso deshabilita agregar horarios personalizados
  // y quiere decir que ese día el negocio trabaja 24 horas"): no hace
  // falta ningún campo nuevo en la base — "todo el día" se guarda como un
  // único tramo 00:00 a 24:00 (isVendorOpenNow ya compara con < closesAt en
  // minutos, así que 24:00 = 1440 cubre el día completo sin casos
  // especiales del lado del backend).
  function isAlwaysOpenDay(d) {
    return !d.isClosed && d.ranges.length === 1 && d.ranges[0].opensAt === "00:00" && d.ranges[0].closesAt === "24:00";
  }
  function toggleAlwaysOpen(dayOfWeek) {
    setDays((prev) =>
      prev.map((d) => {
        if (d.dayOfWeek !== dayOfWeek) return d;
        if (isAlwaysOpenDay(d)) return { ...d, ranges: [{ opensAt: "09:00", closesAt: "18:00" }] };
        return { ...d, isClosed: false, ranges: [{ opensAt: "00:00", closesAt: "24:00" }] };
      })
    );
  }
  function copyMondayToAll() {
    const monday = days.find((d) => d.dayOfWeek === 1);
    if (!monday) return;
    setDays((prev) => prev.map((d) => (d.dayOfWeek === 1 ? d : { ...d, isClosed: monday.isClosed, ranges: monday.ranges.map((r) => ({ ...r })) })));
    toast.success("Se copió el horario del lunes al resto de los días.");
  }

  // keepForm: no recarga "my-vendor-settings" (la que llena este formulario), para no pisar cambios aún sin guardar.
  const invalidateVendor = ({ keepForm = false } = {}) => {
    if (!keepForm) queryClient.invalidateQueries({ queryKey: ["my-vendor-settings"] });
    queryClient.invalidateQueries({ queryKey: ["my-vendor"] });
    queryClient.invalidateQueries({ queryKey: ["active-countries"] });
    queryClient.invalidateQueries({ queryKey: ["provinces"] });
    queryClient.invalidateQueries({ queryKey: ["provinces-for-country"] });
    queryClient.invalidateQueries({ queryKey: ["municipalities"] });
    // Bloque 235: cualquier guardado acá puede haber completado el
    // checklist del trial gratuito (descripción, logo, dirección legal,
    // etc.) — así el banner/popup de bienvenida se actualizan al toque,
    // sin esperar el staleTime.
    queryClient.invalidateQueries({ queryKey: ["vendor-trial"] });
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
    if (form.isRestaurant && !form.tableCount) {
      toast.error("Indica cuántas mesas tiene tu restaurante.");
      return false;
    }
    const tablesCap = maxTablesByPlan?.[vendor?.planType] ?? null;
    if (form.isRestaurant && tablesCap != null && Number(form.tableCount) > tablesCap) {
      toast.error(`Tu plan permite hasta ${tablesCap} mesas. Escribe ${tablesCap} o menos.`);
      return false;
    }
    // El horario va aparte (PATCH /me/schedule) y el servidor lo rechaza si el plan no trae allowSchedules. Antes se mandaba
    // siempre con Promise.all: con el interruptor apagado desde el admin, cada guardado salía en error aunque el resto sí se
    // guardara. Ahora solo se manda si el plan lo permite y si los días cambiaron respecto a lo guardado. Si la tienda nunca
    // guardó un horario, cuenta como cambio: lo que se ve es el ejemplo y, si no se manda, el horario no llega a existir.
    const saved = baseline ? JSON.parse(baseline) : null;
    const scheduleChanged = !saved || !hasSavedSchedule || JSON.stringify(days) !== JSON.stringify(saved.days);
    const sendSchedule = allowSchedules && scheduleChanged;
    // allSettled: cada parte se informa por separado, así un fallo del horario no oculta que el resto ya quedó guardado.
    const [profileResult, scheduleResult] = await Promise.allSettled([
      saveProfile.mutateAsync(),
      sendSchedule ? saveSchedule.mutateAsync() : Promise.resolve(null),
    ]);
    const profileOk = profileResult.status === "fulfilled";
    const scheduleOk = scheduleResult.status === "fulfilled";
    if (sendSchedule && scheduleOk) setScheduleSavedHere(true);

    if (profileOk && scheduleOk) {
      setBaseline(JSON.stringify({ form, days }));
      toast.success("Cambios guardados.");
      invalidateVendor();
      return true;
    }

    // Guardado a medias: la foto de lo guardado se mueve solo en la parte que sí se guardó, para que la otra siga marcada
    // como pendiente. No se recarga la tienda aquí: el efecto de carga pisaría lo que el vendedor todavía tiene que corregir.
    if (profileOk || (sendSchedule && scheduleOk)) {
      setBaseline(JSON.stringify({ form: profileOk ? form : saved?.form ?? form, days: scheduleOk ? days : saved?.days ?? days }));
      invalidateVendor({ keepForm: true });
    }
    if (!profileOk) {
      const err = profileResult.reason;
      const fieldErrors = err?.response?.data?.details?.fieldErrors ?? {};
      const prefix = sendSchedule && scheduleOk ? "El horario se guardó, pero el resto no. " : "";
      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors);
        toast.error(`${prefix}Revisa los campos marcados en rojo.`);
      } else {
        toast.error(`${prefix}${err?.response?.data?.error ?? "No se pudieron guardar los cambios."}`);
      }
    }
    if (!scheduleOk) {
      const err = scheduleResult.reason;
      const prefix = profileOk ? "El resto de los cambios se guardó, pero el horario no. " : "El horario tampoco se guardó. ";
      toast.error(`${prefix}${err?.response?.data?.error ?? "Inténtalo de nuevo."}`);
    }
    return false;
  }

  // Guarda solo el horario, desde el aviso de "todavía no guardaste tu horario". Hace falta porque "Guardar cambios" está
  // apagado mientras no haya cambios, y quien quiere quedarse con el horario de ejemplo tal cual no tendría cómo guardarlo.
  // Mueve solo los días en la foto de lo guardado: el resto del formulario, si tenía cambios, sigue pendiente.
  async function saveScheduleOnly() {
    try {
      await saveSchedule.mutateAsync();
      setScheduleSavedHere(true);
      const saved = baseline ? JSON.parse(baseline) : null;
      setBaseline(JSON.stringify({ form: saved?.form ?? form, days }));
      toast.success("Horario guardado.");
      invalidateVendor({ keepForm: true });
    } catch (err) {
      toast.error(err?.response?.data?.error ?? "No se pudo guardar el horario. Inténtalo de nuevo.");
    }
  }

  // Hay cambios sin guardar: activa los botones de guardar y muestra la barra fija de abajo.
  const isDirty = baseline !== null && JSON.stringify({ form, days }) !== baseline;
  const saving = saveProfile.isPending || saveSchedule.isPending;
  const savableTab = activeTab !== "seguridad" && activeTab !== "equipo";
  function discardChanges() {
    if (!baseline) return;
    const saved = JSON.parse(baseline);
    setForm(saved.form);
    setDays(saved.days);
    setErrors({});
  }

  useUnsavedGuard(isDirty, async () => {
    if (!(await handleSaveAll())) throw new Error("No se guardó");
  });

  // Bloque 52: los límites por plan ahora vienen de settings.plans
  // (PlanConfig del backend) — antes eran columnas pareadas sueltas
  // (maxProvincesRegular/Business) directo en settings.
  const currentPlanConfig = settings?.plans?.find((p) => p.planType === vendor?.planType);
  const maxProvinces = currentPlanConfig?.maxProvinces;
  const distinctProvinceCount = new Set((vendor?.locations ?? []).map((l) => l.provinceId)).size;

  const maxDeliveryCountries = currentPlanConfig?.maxDeliveryCountries;
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
        <div className="flex min-w-0 items-center gap-3">
          <IconCircle icon={Settings2} tone="teal" />
          <div className="min-w-0">
            <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Configuración de la tienda</h1>
            <p className="text-body-md text-on-surface-variant">
              Datos públicos, zonas de cobertura y métodos de entrega.
            </p>
          </div>
        </div>
        {/* Solo aparece cuando hay algo que guardar: el botón apagado "Sin cambios" ocupaba un renglón propio en el celular y
            parecía un error. */}
        {savableTab && (isDirty || saving) && (
          <Button onClick={handleSaveAll} disabled={saving} className="w-full rounded-xl font-bold sm:w-auto">
            {saving ? "Guardando..." : "Guardar cambios"}
          </Button>
        )}
      </div>

      <Tabs tabs={SETTINGS_TABS} value={activeTab} onChange={setActiveTab} className="mb-5" />

      {activeTab === "seguridad" && <SecurityCard />}
      {activeTab === "equipo" && (
        <div className="max-w-[640px]">
          <p className="mb-3 text-[12.5px] text-outline">Cuándo cuadran caja las personas de tu equipo. Los usuarios y sus ventas se manejan en Usuarios.</p>
          <CashCloseSettingsPanel />
        </div>
      )}

      {activeTab === "general" && (
        <>

      {/* Bloque 47: "Información de la marca" se mudó a Mi perfil
          (VendorProfile.jsx, tarjeta "Datos de la tienda") — Configuración
          ya no edita esos campos. */}

      {/* Bloque 65 (pedido explícito): moneda operativa ÚNICA de la tienda —
          distinta a propósito de "Monedas que aceptas" de la tarjeta de
          abajo (esa es informal/múltiple, "qué coordinás con el cliente";
          esta es la moneda real en la que están expresados TODOS los
          precios). Cambiarla NO convierte los precios ya cargados. */}
      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
          <Wallet className="h-5 w-5 text-tertiary-accent" /> Moneda oficial de tu tienda
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          En qué moneda están expresados los precios de tus productos. Una tienda opera en una sola.
        </p>
        <Select
          label="Moneda"
          value={form.currency}
          onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
          className="max-w-xs"
        >
          {currencyCodesFor(vendor?.currency).map((c) => (
            <option key={c} value={c}>{currencyOption(c)}</option>
          ))}
        </Select>
        {form.currency !== (vendor?.currency ?? "CUP") && (
          <p className="mt-2.5 text-label-sm font-semibold text-error">
            ⚠ Cambiar esto NO convierte los precios de tus productos ya cargados, solo cambia la etiqueta. Revísalos y
            ajústalos a mano después de guardar.
          </p>
        )}
      </div>

      {/* Bloque 206 (pedido explícito): antes solo se elegía una vez al
          registrar la tienda, sin forma de cambiarlo después. */}
      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
          <Wallet className="h-5 w-5 text-tertiary-accent" /> Tipo de tienda
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Activa esto si atiendes en el local con mesas: habilita Mesas/QR en tu panel.
        </p>
        <label className="flex items-center gap-2 text-body-md text-on-surface">
          <input
            type="checkbox"
            checked={form.isRestaurant}
            onChange={(e) => setForm((f) => ({ ...f, isRestaurant: e.target.checked }))}
          />
          Soy un restaurante / cafetería / bar
        </label>
        {form.isRestaurant && (
          <div className="mt-3 max-w-xs">
            <Input
              label="Número de mesas"
              type="number"
              min={1}
              max={maxTablesByPlan?.[vendor?.planType] ?? undefined}
              required
              value={form.tableCount}
              onChange={(e) => setForm((f) => ({ ...f, tableCount: e.target.value }))}
            />
            {maxTablesByPlan?.[vendor?.planType] != null && (
              <p className="mt-1 text-label-sm text-outline">Tu plan permite hasta {maxTablesByPlan[vendor.planType]} mesas.</p>
            )}
            {!vendor?.isRestaurant && (
              <p className="mt-1 text-label-sm text-outline">Generamos un código QR por cada mesa apenas guardes.</p>
            )}
          </div>
        )}
        {form.isRestaurant && (
          <div className="mt-4 border-t border-surface-container-high pt-4">
            <label className="flex items-center gap-2 text-body-md text-on-surface">
              <input
                type="checkbox"
                checked={form.menuPublic}
                onChange={(e) => setForm((f) => ({ ...f, menuPublic: e.target.checked }))}
              />
              Mostrar el menú digital en mi tienda pública
            </label>
            <p className="mt-1 text-label-sm text-outline">
              {form.menuPublic
                ? "Cualquiera que entre a tu tienda ve el menú, además de poder pedirlo escaneando el QR de la mesa."
                : "El menú queda oculto de tu tienda pública. Solo se ve escaneando el QR de la mesa."}
            </p>
          </div>
        )}
      </div>

      {/* Cómo coordina el pago el cliente al terminar su compra: vale para toda la tienda (no por producto). Por defecto están
          las tres; el cliente solo ve las que dejes marcadas. */}
      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
          <Wallet className="h-5 w-5 text-tertiary-accent" /> Cómo coordinas el pago
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Son las opciones que ve tu cliente al completar su pedido. Aplican a toda tu tienda. Deja marcadas solo las que aceptas.
        </p>
        <div className="flex flex-col gap-2">
          {/* Las activas en la plataforma y, si la tienda ya tenía una que el admin desactivó, esa también para poder quitarla. */}
          {checkoutChoices({ activeOnly: false }).filter((o) => o.active || form.checkoutPaymentOptions.includes(o.id)).map((o) => {
            const checked = form.checkoutPaymentOptions.includes(o.id);
            const onlyOne = checked && form.checkoutPaymentOptions.length === 1;
            return (
              <label key={o.id} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 ${checked ? "border-tertiary-accent bg-tertiary-accent/5" : "border-outline-variant"}`}>
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-tertiary-accent"
                  checked={checked}
                  disabled={onlyOne}
                  onChange={() =>
                    setForm((f) => ({
                      ...f,
                      checkoutPaymentOptions: checked ? f.checkoutPaymentOptions.filter((x) => x !== o.id) : [...f.checkoutPaymentOptions, o.id],
                    }))
                  }
                />
                <span>
                  <span className="block text-[13.5px] font-semibold text-on-surface">{o.title}</span>
                  <span className="block text-[12px] text-outline">{o.sub}</span>
                </span>
              </label>
            );
          })}
        </div>
        {form.checkoutPaymentOptions.length === 1 && <p className="mt-2 text-[12px] text-outline">Debe quedar al menos una opción.</p>}
      </div>

      <StoreShippingCard form={form} setForm={setForm} vendor={vendor} currencies={currencyCodesFor(form.storeShippingCurrency)} />

      {/* Bloque 47: Métodos de pago (chips — el selector nunca se había
          terminado de conectar: el estado/endpoint ya existían pero no
          había ninguna forma de tocarlo desde acá). */}
      {/* Bloque 66 (pedido explícito): se quitó "Monedas que aceptas" de
          acá — ya redundante con "Moneda oficial de tu tienda" de arriba
          (Bloque 65, moneda única real de los precios). El cliente sigue
          pudiendo coordinar otra moneda manualmente por WhatsApp si hace
          falta, no necesita configurarse acá. */}
      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
          <Wallet className="h-5 w-5 text-tertiary-accent" /> Métodos de pago
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Puramente informativo: se muestra en tu tienda pública para que el cliente sepa qué coordinar contigo.
          {siteName} no procesa nada de esto.
        </p>

        <div className="mb-5">
          <div className="mb-2 text-label-md font-semibold text-on-surface-variant">Métodos de pago que aceptas</div>
          <div className="flex flex-wrap gap-2">
            {storePaymentMethods({ activeOnly: false }).filter((m) => m.active || form.acceptedPaymentMethods.includes(m.id)).map((m) => {
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
              .filter((id) => !storePaymentMethods({ activeOnly: false }).some((m) => m.id === id))
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
      </div>

      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
          <MessageCircle className="h-5 w-5 text-tertiary-accent" /> Cómo quieres recibir tus pedidos
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Todos los pedidos llegan a Mis pedidos, con aviso en la pantalla, en el celular y por correo. Confírmalos o cancélalos ahí
          para que el cliente vea en qué va su pedido.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ORDER_DESTINATIONS.map((opt) => {
            const active = form.orderDestination === opt.id;
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                type="button"
                aria-pressed={active}
                onClick={() => setForm((f) => ({ ...f, orderDestination: opt.id }))}
                className={`flex flex-col items-start gap-1.5 rounded-lg border p-4 text-left transition ${
                  active ? "border-tertiary-accent bg-tertiary-accent/[0.06]" : "border-outline-variant hover:border-tertiary-accent/50"
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? "text-tertiary-accent" : "text-outline"}`} />
                <div className={`text-[13px] font-bold ${active ? "text-tertiary-accent" : "text-on-surface"}`}>{opt.label}</div>
                <p className="text-[11.5px] leading-4 text-outline">{opt.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bloque 302: aviso por correo de cada pedido nuevo. Se manda al correo de la tienda, nunca al administrador. */}
      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
          <Mail className="h-5 w-5 text-tertiary-accent" aria-hidden="true" /> Aviso de pedidos por correo
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Cuando entra un pedido nuevo, ya sea desde Baznova o desde el sitio de un socio, te lo enviamos al correo de tu tienda
          ({vendor?.email || vendor?.user?.email || "el de tu cuenta"}). El pedido siempre aparece en "Mis pedidos", sin importar lo que elijas aquí.
        </p>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[13.5px] font-semibold text-on-surface">
          <input
            type="checkbox"
            className="h-5 w-5 flex-shrink-0 accent-[#337475]"
            checked={!!form.notifyNewOrderEmail}
            onChange={(e) => setForm((f) => ({ ...f, notifyNewOrderEmail: e.target.checked }))}
          />
          Quiero un correo por cada pedido nuevo y cuando uno lleve 30 minutos sin confirmar
        </label>
      </div>

      {/* Bloque 174 (pedido explícito — "al crear una cuenta se debe
          ingresar los horarios de la tienda... esa configuración saldrá en
          la configuración de la cuenta por si el vendedor desea modificar
          sus horarios de apertura"): editor real de horario semanal, con
          varios tramos por día (ej. 9-12 y 14-18, cierre al mediodía) —
          viaja con el mismo "Guardar cambios" de arriba (handleSaveAll).
          Si el plan no trae horarios, en su lugar va el aviso del plan: el editor no podría guardarse. */}
      {!allowSchedules ? (
        <div className="mb-5">
          <PlanUpsell
            title="Los horarios de atención no están en tu plan"
            text="Con los horarios, tus clientes ven si estás abierto ahora mismo y, si vendes por mesa, no te llegan pedidos con el local cerrado."
          />
        </div>
      ) : (
      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
            <Clock className="h-5 w-5 text-tertiary-accent" /> Horario de atención
          </div>
          <button type="button" onClick={copyMondayToAll} className="whitespace-nowrap text-[12px] font-semibold text-tertiary-accent hover:underline">
            Copiar el lunes a todos los días
          </button>
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Se usa para avisarle al cliente si estás abierto ahora mismo. Si vendes por mesa (QR), también bloquea pedidos
          nuevos fuera de este horario. Puedes cargar más de un tramo el mismo día (ej. mañana y tarde, con cierre al mediodía).
        </p>
        {!hasSavedSchedule && (
          <div
            role="status"
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-tertiary-accent/30 bg-tertiary-accent/[0.06] p-4"
          >
            <p className="min-w-0 flex-1 basis-56 text-[12.5px] font-semibold text-on-surface">
              Todavía no guardaste tu horario. Lo que ves abajo es un ejemplo: tus clientes no lo ven hasta que lo guardes.
            </p>
            <Button variant="outline" disabled={saveSchedule.isPending} onClick={saveScheduleOnly}>
              {saveSchedule.isPending ? "Guardando..." : "Guardar este horario"}
            </Button>
          </div>
        )}
        <div className="flex flex-col divide-y divide-surface-container-high">
          {days.map((d) => (
            <div key={d.dayOfWeek} className="flex flex-col gap-2.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start">
              <div className="flex w-full flex-col gap-1 sm:w-40 sm:flex-shrink-0">
                <span className="text-[13.5px] font-bold text-on-surface">{d.name}</span>
                <label className="flex items-center gap-1.5 text-[12px] font-semibold text-on-surface-variant">
                  <input type="checkbox" checked={d.isClosed} onChange={() => toggleDayClosed(d.dayOfWeek)} className="h-3.5 w-3.5" />
                  Cerrado
                </label>
                <label className="flex items-center gap-1.5 text-[12px] font-semibold text-on-surface-variant">
                  <input
                    type="checkbox"
                    checked={isAlwaysOpenDay(d)}
                    disabled={d.isClosed}
                    onChange={() => toggleAlwaysOpen(d.dayOfWeek)}
                    className="h-3.5 w-3.5"
                  />
                  Siempre abierto
                </label>
              </div>
              {!d.isClosed && (
                <div className="flex flex-1 flex-col gap-2">
                  {isAlwaysOpenDay(d) ? (
                    <p className="text-[12.5px] font-semibold text-tertiary-accent">Abierto las 24 horas este día.</p>
                  ) : (
                    <>
                      {d.ranges.map((r, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="time"
                            value={r.opensAt}
                            onChange={(e) => updateDayRange(d.dayOfWeek, i, "opensAt", e.target.value)}
                            className="h-9 rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 text-[13px] outline-none focus:border-tertiary-accent"
                          />
                          <span className="text-[12px] text-outline">a</span>
                          <input
                            type="time"
                            value={r.closesAt}
                            onChange={(e) => updateDayRange(d.dayOfWeek, i, "closesAt", e.target.value)}
                            className="h-9 rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 text-[13px] outline-none focus:border-tertiary-accent"
                          />
                          {d.ranges.length > 1 && (
                            <button type="button" onClick={() => removeDayRange(d.dayOfWeek, i)} className="text-error hover:opacity-70">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addDayRange(d.dayOfWeek)}
                        className="flex w-fit items-center gap-1 text-[11.5px] font-semibold text-tertiary-accent hover:underline"
                      >
                        <Plus className="h-3 w-3" /> Agregar otro tramo
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      )}
        </>
      )}

      {activeTab === "cobertura" && (
        <>
      {/* Bloque 77 (pedido explícito): tienda privada — el toggle viaja con
          el resto del form (mismo "Guardar cambios" de arriba, igual que
          orderDestination). El link es SIEMPRE el mismo /tienda/:slug de
          siempre — lo único que cambia es si el sitio la ofrece sola en el
          catálogo/buscador o no; por eso el QR/link de acá sirven en los dos
          estados, solo cambia la explicación. */}
      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
          {form.isPrivate ? <Lock className="h-5 w-5 text-tertiary-accent" /> : <Globe className="h-5 w-5 text-tertiary-accent" />}
          Visibilidad de tu tienda
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Una tienda privada no aparece en el inicio, el catálogo, el buscador ni las recomendaciones del asistente. Solo la
          ve quien tenga tu enlace directo. Sigue funcionando exactamente igual: pedidos, reseñas, todo.
        </p>
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, isPrivate: false }))}
            className={`flex flex-col items-start gap-1.5 rounded-lg border p-4 text-left transition ${
              !form.isPrivate ? "border-tertiary-accent bg-tertiary-accent/[0.06]" : "border-outline-variant hover:border-tertiary-accent/50"
            }`}
          >
            <Globe className={`h-5 w-5 ${!form.isPrivate ? "text-tertiary-accent" : "text-outline"}`} />
            <div className={`text-[13px] font-bold ${!form.isPrivate ? "text-tertiary-accent" : "text-on-surface"}`}>Pública</div>
            <p className="text-[11.5px] leading-4 text-outline">Cualquiera puede encontrarte navegando el sitio.</p>
          </button>
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, isPrivate: true }))}
            className={`flex flex-col items-start gap-1.5 rounded-lg border p-4 text-left transition ${
              form.isPrivate ? "border-tertiary-accent bg-tertiary-accent/[0.06]" : "border-outline-variant hover:border-tertiary-accent/50"
            }`}
          >
            <Lock className={`h-5 w-5 ${form.isPrivate ? "text-tertiary-accent" : "text-outline"}`} />
            <div className={`text-[13px] font-bold ${form.isPrivate ? "text-tertiary-accent" : "text-on-surface"}`}>Privada</div>
            <p className="text-[11.5px] leading-4 text-outline">Solo entra quien reciba tu enlace o escanee tu QR.</p>
          </button>
        </div>

        {vendor?.slug && <VendorShareLink slug={vendor.slug} isPrivate={form.isPrivate} />}
      </div>

      {/* UNIFIED COBERTURA & ZONAS DE ENTREGA */}
      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-surface-container-high pb-4">
          <div>
            <div className="flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
              <Globe2 className="h-5 w-5 text-tertiary-accent" /> Cobertura y Países de Entrega
            </div>
            <p className="text-[12.5px] text-outline mt-0.5">
              Gestiona los países y estados/provincias donde tu tienda ofrece productos y servicio de entrega.
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
              <option value="">Elige un país activo</option>
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
                <option value="">Elige subdivisión activa</option>
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
                            {/* Bloque 195 (bug real encontrado en auditoría —
                                paleta inventada: bg-purple-100/blue-100 no son
                                tokens de este proyecto, es la paleta cruda de
                                Tailwind, distinta del resto del panel — se
                                reemplaza por los tokens ya establecidos). */}
                            <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider ${
                              province.type === "STATE" ? "bg-tertiary-accent/10 text-tertiary-accent" : "bg-surface-container-high text-on-surface-variant"
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

                        {/* Municipios (provincias de Cuba) o ciudades (estados) donde entrega. */}
                        {(
                          <div className="flex flex-wrap gap-1.5 my-2">
                            {isAllMun ? (
                              <span className="rounded-md bg-verified/15 text-verified-dark px-2.5 py-1 text-[11.5px] font-bold flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3" /> {zoneUnit(province).whole}
                              </span>
                            ) : (
                              locations.map((l) => (
                                <span
                                  key={l.id}
                                  className="rounded-md bg-surface-container-high px-2.5 py-1 text-[11.5px] font-semibold text-on-surface flex items-center gap-1.5"
                                >
                                  {l.municipality?.name ?? zoneUnit(province).one}
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
                        )}
                      </div>

                      <button
                        onClick={() => setManagingProvince(province)}
                        className="mt-2 flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container/40 py-1.5 text-[11.5px] font-bold text-on-surface-variant hover:bg-surface-container transition"
                      >
                        <Settings2 className="h-3.5 w-3.5" /> Elegir {zoneUnit(province).many}
                      </button>
                    </div>
                  );
                })}
                {countryProvs.length === 0 && (
                  <p className="col-span-2 text-[12.5px] text-outline italic py-2">
                    Aún no tienes estados o provincias agregados para este país. Usa el formulario de arriba para agregar.
                  </p>
                )}
              </div>
            </div>
          ))}

          {countryCoverageTree.length === 0 && (
            <div className="rounded-xl border border-dashed border-outline-variant p-6 text-center">
              <MapPin className="mx-auto h-8 w-8 text-outline/40 mb-2" />
              <p className="text-[13.5px] font-bold text-on-surface">Sin zonas de cobertura configuradas</p>
              <p className="text-[12px] text-outline">Agrega los países y provincias/estados donde vendes arriba.</p>
            </div>
          )}
        </div>
      </div>
        </>
      )}

      {activeTab === "facturacion" && (
        <>
      {/* Baja de las campañas a tiendas: el enlace de baja de esos correos manda aquí (EmailUnsubscribe.jsx). */}
      <EmailPreferencesCard audience="vendor" />
      {/* Bloque de auditoría (2026-08-06): estos 2 campos ya se mandaban en
          el payload de saveProfile pero nunca tuvieron un input visible en
          ningún panel — el vendedor no tenía forma de completarlos, y
          loadConfirmedOrderForVendor (invoices.controller.js) los exige
          antes de generar factura/garantía, señalando explícitamente "Puedes
          cargarlos en Configuración". */}
      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
          <FileText className="h-5 w-5 text-tertiary-accent" /> Datos de facturación
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Privados: nunca se muestran en tu tienda pública. Se usan para generar las facturas y certificados de garantía de
          tus pedidos.
        </p>
        {/* Bloque 153 (pedido explícito — "todos los datos de la tienda no
            se pueden modificar después de estar verificadas sin aprobación
            del admin... para prevenir fraudes"): estos 2 son datos de
            IDENTIDAD — igual que el nombre y el responsable en Perfil, se
            bloquean acá una vez verificada (el backend ya lo rechaza
            igual, esto solo evita el viaje al servidor para nada y explica
            por qué). Corregirlos de verdad se hace desde la nueva tarjeta
            "Solicitar cambio de datos" en Mi perfil. */}
        {/* Bloque 165 (bug real reportado en vivo, con captura — "Expected
            string, received null" en rojo sobre 2 campos vacíos y
            bloqueados): el candado (companion del backend, ver
            updateMyVendor) solo tiene sentido una vez que HAY algo real
            cargado que proteger — antes se aplicaba también con el campo
            vacío, dejando a una tienda vieja sin ID/dirección cargados (se
            registró antes de que esto fuera obligatorio) sin ninguna forma
            de completarlos ella misma. */}
        {vendor?.verificationStatus === "VERIFIED" && (vendor?.ownerIdNumber || vendor?.companyAddress) && (
          <p className="mb-3 rounded-md bg-tertiary-accent/[0.08] px-3 py-2 text-[12px] text-tertiary-accent">
            Tienda verificada: el dato ya cargado no se edita aquí. Para corregirlo, solicita un cambio desde "Mi perfil".
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Identificación del responsable (carné de identidad)"
            value={form.ownerIdNumber}
            onChange={(e) => setForm((f) => ({ ...f, ownerIdNumber: e.target.value }))}
            error={errors.ownerIdNumber?.[0]}
            placeholder="Ej.: 90010112345"
            disabled={vendor?.verificationStatus === "VERIFIED" && !!vendor?.ownerIdNumber}
          />
          <Input
            label="Dirección de la empresa"
            value={form.companyAddress}
            onChange={(e) => setForm((f) => ({ ...f, companyAddress: e.target.value }))}
            error={errors.companyAddress?.[0]}
            placeholder="Ej.: Calle 23 #456, Vedado, La Habana"
            disabled={vendor?.verificationStatus === "VERIFIED" && !!vendor?.companyAddress}
          />
        </div>
      </div>

      {/* Garantías */}
      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
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
        <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
          <FileText className="h-5 w-5 text-tertiary-accent" /> Documento de la tienda para la IA
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Carga un documento PDF o de texto con información detallada sobre tus servicios o políticas. El asistente IA usará esta información únicamente para responder a tus clientes.
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
        </>
      )}

      {/* Modals */}
      {/* Barra fija abajo: aparece en cuanto se cambia cualquier valor, para guardar sin volver arriba. Los botones van a la
          izquierda para que el botón flotante del asistente (abajo a la derecha) no los tape; en celular la barra va encima de ese botón. */}
      {savableTab && isDirty && (
        <div className="sticky bottom-[88px] z-30 mt-6 flex flex-wrap items-center gap-3 rounded-2xl sm:bottom-4 border border-secondary/40 bg-surface-container-lowest p-3 shadow-[0_20px_50px_-12px_rgba(14,26,40,0.35)] motion-safe:animate-fade-up" role="region" aria-label="Cambios sin guardar">
          <Button onClick={handleSaveAll} disabled={saving} className="rounded-xl font-bold">
            {saving ? "Guardando..." : "Guardar cambios"}
          </Button>
          <Button variant="ghost" onClick={discardChanges} disabled={saving} className="rounded-xl">
            Descartar
          </Button>
          <span className="text-[13px] font-semibold text-on-surface-variant">Tienes cambios sin guardar</span>
        </div>
      )}

      {managingProvince && (
        <ManageVendorMunicipalitiesModal
          province={managingProvince}
          vendorLocations={vendor?.locations}
          onClose={() => setManagingProvince(null)}
          isPending={syncProvince.isPending}
          onSave={({ provinceId, municipalityIds }) => {
            openConfirm({
              title: `¿Guardar ${zoneUnit(managingProvince).many} de ${managingProvince.name}?`,
              message: `Se actualizarán las zonas de entrega configuradas para ${managingProvince.name}.`,
              confirmLabel: "Sí, guardar",
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
