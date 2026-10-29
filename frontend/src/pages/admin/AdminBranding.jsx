import { useEffect, useState } from "react";
import { useUnsavedGuard } from "../../lib/unsavedGuard.jsx";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Sparkles, X, MessageCircle, Share2, Plus, Tag, LifeBuoy, Clock } from "lucide-react";
import { api } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.jsx";
import { HeroImagesCard } from "../../components/admin/HeroImagesCard.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { CatalogOptionsManager } from "../../components/admin/CatalogOptionsManager.jsx";
// Bloque 46 (pedido explícito): el logo de la plataforma ya no se sube ni
// se pega por link desde acá — ver el comentario largo en
// usePlatformSettings.js sobre por qué. Esta página deja de tener ningún
// control de logo; solo el nombre sigue siendo editable.
import logo from "../../assets/images/logo.png";

// Bloque 85 (pedido explícito): lista curada, no las ~400 zonas IANA
// completas — Cuba primero (default del negocio), después las más
// relevantes para Latinoamérica/España (mercado real de esta plataforma),
// más UTC como referencia neutral. El backend valida igual con
// Intl.DateTimeFormat, así que un valor fuera de esta lista (cargado antes
// por otro medio) no rompe nada, solo no aparecería preseleccionado.
const TIMEZONE_OPTIONS = [
  { value: "America/Havana", label: "La Habana, Cuba (GMT-5/-4)" },
  { value: "America/New_York", label: "Nueva York, EE.UU. (GMT-5/-4)" },
  { value: "America/Mexico_City", label: "Ciudad de México (GMT-6)" },
  { value: "America/Bogota", label: "Bogotá, Colombia (GMT-5)" },
  { value: "America/Lima", label: "Lima, Perú (GMT-5)" },
  { value: "America/Santiago", label: "Santiago, Chile (GMT-4/-3)" },
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires, Argentina (GMT-3)" },
  { value: "America/Sao_Paulo", label: "São Paulo, Brasil (GMT-3)" },
  { value: "Europe/Madrid", label: "Madrid, España (GMT+1/+2)" },
  { value: "UTC", label: "UTC (sin ajuste horario)" },
];

// Vuelve a calcular la hora/fecha en vivo cada segundo — confirmación visual
// de que la zona elegida es la correcta antes de guardarla.
function useLiveClock(timezone) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  try {
    return new Intl.DateTimeFormat("es-CU", {
      timeZone: timezone,
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(now);
  } catch {
    return null;
  }
}

function resolveLogoUrl(logoUrl) {
  if (!logoUrl) return null;
  return /^https?:\/\//.test(logoUrl) ? logoUrl : `${api.defaults.baseURL}${logoUrl}`;
}

// Bloque 49 (pedido explícito): "Marca de la plataforma" — nombre y logo
// configurables sin redeploy, reflejados sitewide vía usePlatformSettings().
// Mismo patrón de fetch/local-state/save que PlanLimitsPanel en
// AdminLocations.jsx, en su propia página (no un panel más ahí) porque el
// pedido fue explícito por una sección nueva.
export default function AdminBranding({ mode = "brand" }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  // Bloque 61: usadas por la fila de íconos del footer de los correos — ver
  // emailShell() en backend/src/templates/_shared.js. "Sitio web" no
  // necesita un campo acá, siempre es la URL del propio sitio.
  const [social, setSocial] = useState({ whatsappUrl: "", instagramUrl: "", facebookUrl: "" });
  // Bloque 75 (pedido explícito): número crudo (no un link) para el botón
  // "Contactar soporte" que ve un vendedor con la tienda bloqueada/suspendida.
  const [supportWhatsapp, setSupportWhatsapp] = useState("");
  // Bloque 85 (pedido explícito): zona horaria del negocio — hoy la usa
  // aiHealthCheck.job.js para saber cuándo son las 3:00am de verdad.
  const [timezone, setTimezone] = useState("America/Havana");

  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });

  useEffect(() => {
    if (settings) setName(settings.siteName ?? "");
  }, [settings]);

  useEffect(() => {
    if (settings) {
      setSocial({
        whatsappUrl: settings.whatsappUrl ?? "",
        instagramUrl: settings.instagramUrl ?? "",
        facebookUrl: settings.facebookUrl ?? "",
      });
      setSupportWhatsapp(settings.supportWhatsapp ?? "");
      setTimezone(settings.timezone ?? "America/Havana");
    }
  }, [settings]);

  const saveName = useMutation({
    mutationFn: async () => (await api.patch("/admin/settings/branding", { siteName: name.trim() })).data,
    onSuccess: () => {
      toast.success("Nombre de la plataforma actualizado.");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el nombre."),
  });

  const saveSocial = useMutation({
    mutationFn: async () =>
      (
        await api.patch("/admin/settings/branding", {
          whatsappUrl: social.whatsappUrl.trim(),
          instagramUrl: social.instagramUrl.trim(),
          facebookUrl: social.facebookUrl.trim(),
        })
      ).data,
    onSuccess: () => {
      toast.success("Redes sociales actualizadas.");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudieron guardar las redes."),
  });

  const saveSupportWhatsapp = useMutation({
    mutationFn: async () => (await api.patch("/admin/settings/branding", { supportWhatsapp: supportWhatsapp.trim() })).data,
    onSuccess: () => {
      toast.success("Número de soporte actualizado.");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el número."),
  });

  const saveTimezone = useMutation({
    mutationFn: async () => (await api.patch("/admin/settings/branding", { timezone })).data,
    onSuccess: () => {
      toast.success("Zona horaria actualizada.");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar la zona horaria."),
  });


  // Bloque 52: mostrar/ocultar el botón flotante del chatbot general del
  // Home (MarketplaceChatWidget) — antes montado sin ninguna condición.
  const toggleChatWidget = useMutation({
    mutationFn: async (next) => (await api.patch("/admin/settings/chat-widget", { showChatWidget: next })).data,
    onSuccess: () => {
      toast.success("Preferencia del chatbot guardada.");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  // Bloque 66 (pedido explícito): catálogo de etiquetas de producto — "Nuevo"
  // es fijo del sistema (no vive acá, ver assertBadgeAllowed en
  // products.controller.js). Estado local + useEffect de sincronización,
  // mismo patrón que FeatureChipList/PlanFeaturesCard en AdminSubscriptions.jsx.
  const [productBadges, setProductBadges] = useState([]);
  const [badgeDraft, setBadgeDraft] = useState("");
  const [newBadgeDurationDays, setNewBadgeDurationDays] = useState(14);

  useEffect(() => {
    if (!settings) return;
    setProductBadges(settings.availableProductBadges ?? []);
    setNewBadgeDurationDays(settings.newBadgeDurationDays ?? 14);
  }, [settings]);

  const saveProductBadges = useMutation({
    mutationFn: async () =>
      (
        await api.patch("/admin/settings/product-badges", {
          availableProductBadges: productBadges,
          newBadgeDurationDays: Number(newBadgeDurationDays),
        })
      ).data,
    onSuccess: () => {
      toast.success("Etiquetas de producto actualizadas.");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  // Aviso al salir con cambios sin guardar: se comparan los campos con lo guardado y, si la persona elige "Guardar y salir",
  // se guardan solo las tarjetas modificadas, de a una. En paralelo, dos tarjetas que piden el mismo código de
  // confirmación abrían dos pedidos de código a la vez y el primero quedaba colgado; en serie, la segunda ya entra en
  // los 30 minutos que abre la primera confirmación.
  const dirtyName = !!settings && name.trim() !== (settings.siteName ?? "").trim();
  const dirtySocial = !!settings && ["whatsappUrl", "instagramUrl", "facebookUrl"].some((k) => social[k].trim() !== (settings[k] ?? "").trim());
  const dirtySupport = !!settings && supportWhatsapp.trim() !== (settings.supportWhatsapp ?? "").trim();
  const dirtyTimezone = !!settings && timezone !== (settings.timezone ?? "America/Havana");
  const dirtyBadges = !!settings && (JSON.stringify(productBadges) !== JSON.stringify(settings.availableProductBadges ?? []) || Number(newBadgeDurationDays) !== (settings.newBadgeDurationDays ?? 14));
  useUnsavedGuard(dirtyName || dirtySocial || dirtySupport || dirtyTimezone || dirtyBadges, async () => {
    const jobs = [];
    if (dirtyName) jobs.push(() => saveName.mutateAsync());
    if (dirtySocial) jobs.push(() => saveSocial.mutateAsync());
    if (dirtySupport) jobs.push(() => saveSupportWhatsapp.mutateAsync());
    if (dirtyTimezone) jobs.push(() => saveTimezone.mutateAsync());
    if (dirtyBadges) jobs.push(() => saveProductBadges.mutateAsync());
    for (const run of jobs) await run();
  });

  function addProductBadge() {
    const value = badgeDraft.trim();
    if (!value || value === "Nuevo" || productBadges.includes(value)) return;
    setProductBadges([...productBadges, value]);
    setBadgeDraft("");
  }

  const previewName = name.trim() || "Nombre de la plataforma";
  const liveClock = useLiveClock(timezone);

  return (
    <div className={mode === "brand" ? "max-w-[720px]" : undefined}>
      {mode === "brand" && (
        <>
      <h1 className="mb-1 font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Marca de la plataforma</h1>
      <p className="mb-[22px] text-[13.5px] text-outline">
        El nombre se usa en todo el sitio — header, footer, títulos de página, correos, PDFs y mensajes de WhatsApp —
        sin necesidad de un redespliegue. El logo es fijo, parte del código de la plataforma.
      </p>

      <HeroImagesCard />

      {/* Vista previa en vivo, mismo tratamiento visual que el header real */}
      <div className="mb-6 flex items-center gap-2.5 rounded-2xl bg-primary px-5 py-4 shadow-sm">
        <img src={logo} alt={previewName} className="h-9 w-9 flex-shrink-0 rounded object-cover" />
        <span className="font-display text-xl font-bold tracking-tight text-white">{previewName}</span>
      </div>

      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
          <Sparkles className="h-4 w-4 text-tertiary-accent" /> Nombre
        </div>
        <p className="mb-4 text-[12.5px] text-outline">Este nombre se usa en toda la interfaz, los correos y los documentos generados.</p>
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Baznova" className="flex-1" />
          <Button
            className="rounded-xl px-5"
            disabled={saveName.isPending || !name.trim() || name.trim() === settings?.siteName}
            onClick={() => saveName.mutate()}
          >
            {saveName.isPending ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </div>

      {/* Bloque 61: usadas por la fila de íconos del footer de los correos
          (emailShell) — "Sitio web" no necesita campo, siempre es el sitio
          propio. Vacío = ese ícono no se muestra, nunca un link inventado. */}
      <div className="mt-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
          <Share2 className="h-4 w-4 text-tertiary-accent" /> Redes sociales
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Se muestran como íconos en el pie de los correos que manda la plataforma. Deja vacío el que no uses — no se
          muestra su ícono.
        </p>
        <div className="flex flex-col gap-3">
          <Input
            label="WhatsApp"
            placeholder="https://wa.me/53..."
            value={social.whatsappUrl}
            onChange={(e) => setSocial((s) => ({ ...s, whatsappUrl: e.target.value }))}
          />
          <Input
            label="Instagram"
            placeholder="https://instagram.com/..."
            value={social.instagramUrl}
            onChange={(e) => setSocial((s) => ({ ...s, instagramUrl: e.target.value }))}
          />
          <Input
            label="Facebook"
            placeholder="https://facebook.com/..."
            value={social.facebookUrl}
            onChange={(e) => setSocial((s) => ({ ...s, facebookUrl: e.target.value }))}
          />
        </div>
        <Button className="mt-4 rounded-xl px-5" disabled={saveSocial.isPending} onClick={() => saveSocial.mutate()}>
          {saveSocial.isPending ? "Guardando..." : "Guardar redes sociales"}
        </Button>
      </div>

        </>
      )}

      {mode === "general" && (
        <>
      {/* Bloque 75 (pedido explícito): número crudo, no un link — lo usa el
          botón "Contactar soporte" que ve un vendedor con la tienda
          bloqueada/suspendida (VendorLayout.jsx) para armar un mensaje de
          WhatsApp prellenado. Cambiarlo aquí actualiza el botón en todos
          lados de una, sin tocar código. */}
      <div className="mt-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
          <LifeBuoy className="h-4 w-4 text-tertiary-accent" /> Número de soporte
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          A dónde llega el botón "Contactar soporte" que ve un vendedor con la tienda bloqueada o suspendida — abre
          WhatsApp con un mensaje ya armado (nombre de la tienda + motivo).
        </p>
        <Input
          label="WhatsApp de soporte"
          placeholder="+5355512345"
          value={supportWhatsapp}
          onChange={(e) => setSupportWhatsapp(e.target.value)}
        />
        <Button className="mt-4 rounded-xl px-5" disabled={saveSupportWhatsapp.isPending} onClick={() => saveSupportWhatsapp.mutate()}>
          {saveSupportWhatsapp.isPending ? "Guardando..." : "Guardar número de soporte"}
        </Button>
      </div>

      {/* Bloque 85 (pedido explícito): la usan aiHealthCheck.job.js (las 3:00 de
          esta zona), los rangos de días del panel (getSiteTimezone en
          admin/adminOrders/adminPlans) y el tope diario de venta rápida. Las
          demás tareas programadas tienen la hora de La Habana fija en su
          cron, por eso el texto no promete más que eso. El reloj en vivo de
          abajo confirma que la zona elegida es la correcta antes de guardarla. */}
      <div className="mt-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
          <Clock className="h-4 w-4 text-tertiary-accent" /> Zona horaria
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Marca cuándo empieza cada día en los informes del panel (pedidos, ventas del mes y estadísticas de planes), el
          tope diario de anuncios de venta rápida y la revisión diaria de los proveedores de IA (a las 3:00 de esta zona).
          Las demás tareas automáticas diarias siguen la hora de Cuba.
        </p>
        <div className="flex gap-2">
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="h-10 flex-1 rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 text-[13px] outline-none focus:border-tertiary-accent"
          >
            {TIMEZONE_OPTIONS.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
          <Button
            className="rounded-xl px-5"
            disabled={saveTimezone.isPending || timezone === (settings?.timezone ?? "America/Havana")}
            onClick={() => saveTimezone.mutate()}
          >
            {saveTimezone.isPending ? "Guardando..." : "Guardar"}
          </Button>
        </div>
        {liveClock && (
          <p className="mt-3 rounded-xl bg-surface-container px-3.5 py-2.5 text-[12.5px] font-semibold text-on-surface-variant">
            Hora y fecha actual en esta zona: <span className="text-on-surface">{liveClock}</span>
          </p>
        )}
      </div>

      <div className="mt-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
          <MessageCircle className="h-4 w-4 text-tertiary-accent" /> Chatbot del Home
        </div>
        <p className="mb-4 text-[12.5px] text-outline">Botón flotante de asistente general en la página principal, visible a cualquier visitante.</p>
        <label className="flex w-fit items-center gap-2.5 text-body-md font-semibold text-on-surface">
          <input
            type="checkbox"
            checked={settings?.showChatWidget ?? true}
            disabled={toggleChatWidget.isPending}
            onChange={(e) => toggleChatWidget.mutate(e.target.checked)}
          />
          Mostrar el botón del chatbot en el Home
        </label>
      </div>

        </>
      )}

      {mode === "catalog" && (
        <>
      <CatalogOptionsManager />

      <div className="mt-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
          <Tag className="h-4 w-4 text-tertiary-accent" /> Etiquetas de producto
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Cuáles puede elegir un vendedor para un producto (además de "Nuevo", que es automático — todo producto sale con
          ella y se le quita sola pasados los días que pongas abajo).
        </p>

        <div className="mb-3 flex flex-wrap gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container px-3.5 py-2 text-[12.5px] font-semibold text-on-surface-variant">
            Nuevo <span className="text-[10.5px] font-normal text-outline">(automática, fija)</span>
          </span>
          {productBadges.map((b) => (
            <span
              key={b}
              className="flex items-center gap-1.5 rounded-full border border-tertiary-accent bg-tertiary-accent/10 px-3.5 py-2 text-[12.5px] font-semibold text-tertiary-accent"
            >
              {b}
              <button type="button" onClick={() => setProductBadges(productBadges.filter((x) => x !== b))}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="mb-4 flex gap-2">
          <input
            value={badgeDraft}
            onChange={(e) => setBadgeDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addProductBadge();
              }
            }}
            placeholder="Ej.: Popular, Solicitado..."
            className="h-10 flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-tertiary-accent"
          />
          <Button variant="outline" className="rounded-lg" size="sm" disabled={!badgeDraft.trim()} onClick={addProductBadge}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        <label className="mb-4 block">
          <span className="mb-1 block text-label-md text-on-surface-variant">Días que dura "Nuevo" antes de quitarse sola</span>
          <input
            type="number"
            min={1}
            max={365}
            value={newBadgeDurationDays}
            onChange={(e) => setNewBadgeDurationDays(e.target.value)}
            className="h-10 w-28 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-tertiary-accent"
          />
        </label>

        <Button className="rounded-xl font-bold" disabled={saveProductBadges.isPending} onClick={() => saveProductBadges.mutate()}>
          {saveProductBadges.isPending ? "Guardando..." : "Guardar etiquetas"}
        </Button>
      </div>
        </>
      )}

    </div>
  );
}
