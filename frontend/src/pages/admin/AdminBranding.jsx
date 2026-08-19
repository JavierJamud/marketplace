import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Sparkles, ImagePlus, Link2, X, MessageCircle, Wallet, Share2, Plus, Tag, LifeBuoy } from "lucide-react";
import { api } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";

function resolveLogoUrl(logoUrl) {
  if (!logoUrl) return null;
  return /^https?:\/\//.test(logoUrl) ? logoUrl : `${api.defaults.baseURL}${logoUrl}`;
}

// Bloque 49 (pedido explícito): "Marca de la plataforma" — nombre y logo
// configurables sin redeploy, reflejados sitewide vía usePlatformSettings().
// Mismo patrón de fetch/local-state/save que PlanLimitsPanel en
// AdminLocations.jsx, en su propia página (no un panel más ahí) porque el
// pedido fue explícito por una sección nueva.
export default function AdminBranding() {
  const queryClient = useQueryClient();
  const fileRef = useRef(null);
  const [name, setName] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [filePreview, setFilePreview] = useState(null);
  // Bloque 61: usadas por la fila de íconos del footer de los correos — ver
  // emailShell() en backend/src/templates/_shared.js. "Sitio web" no
  // necesita un campo acá, siempre es la URL del propio sitio.
  const [social, setSocial] = useState({ whatsappUrl: "", instagramUrl: "", facebookUrl: "" });
  // Bloque 75 (pedido explícito): número crudo (no un link) para el botón
  // "Contactar soporte" que ve un vendedor con la tienda bloqueada/suspendida.
  const [supportWhatsapp, setSupportWhatsapp] = useState("");

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

  const uploadLogoFile = useMutation({
    mutationFn: async (file) => {
      const form = new FormData();
      form.append("logo", file);
      return (await api.post("/admin/settings/branding/logo", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      toast.success("Logo actualizado.");
      setFilePreview(null);
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => {
      setFilePreview(null);
      toast.error(err.response?.data?.error ?? "No se pudo subir el logo.");
    },
  });

  const saveLogoLink = useMutation({
    mutationFn: async (logoUrl) => (await api.patch("/admin/settings/branding", { logoUrl })).data,
    onSuccess: () => {
      toast.success("Logo actualizado.");
      setLinkInput("");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el link."),
  });

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilePreview(URL.createObjectURL(file));
    uploadLogoFile.mutate(file);
    e.target.value = "";
  }

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

  // Bloque 52: cuáles de los métodos de pago OPCIONALES ("cod"/"prepaid")
  // puede ofrecer un vendedor al cargar un producto — "whatsapp" es fijo,
  // siempre disponible, no vive en esta lista (ver products.controller.js).
  const OPTIONAL_METHODS = [
    { id: "cod", label: "Contra entrega" },
    { id: "prepaid", label: "Transferencia" },
  ];
  const toggleProductPaymentMethods = useMutation({
    mutationFn: async (next) => (await api.patch("/admin/settings/product-payment-methods", { productPaymentMethods: next })).data,
    onSuccess: () => {
      toast.success("Métodos de pago de producto actualizados.");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });
  function toggleMethod(id) {
    const current = settings?.productPaymentMethods ?? ["cod", "prepaid"];
    const next = current.includes(id) ? current.filter((m) => m !== id) : [...current, id];
    toggleProductPaymentMethods.mutate(next);
  }

  // Bloque 65 (pedido explícito): de qué conjunto fijo puede elegir una
  // tienda su moneda operativa única, en el registro o al cambiarla después
  // (VendorOnboarding.jsx/VendorSettings.jsx) — mismo patrón que los
  // métodos de pago de arriba, nunca puede quedar vacío.
  const ALL_CURRENCIES = ["CUP", "USD", "EUR", "MXN"];
  const toggleAvailableCurrencies = useMutation({
    mutationFn: async (next) => (await api.patch("/admin/settings/available-currencies", { availableCurrencies: next })).data,
    onSuccess: () => {
      toast.success("Monedas disponibles actualizadas.");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });
  function toggleCurrency(id) {
    const current = settings?.availableCurrencies ?? ALL_CURRENCIES;
    if (current.length === 1 && current.includes(id)) {
      toast.error("Tiene que quedar al menos una moneda disponible.");
      return;
    }
    const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
    toggleAvailableCurrencies.mutate(next);
  }

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

  function addProductBadge() {
    const value = badgeDraft.trim();
    if (!value || value === "Nuevo" || productBadges.includes(value)) return;
    setProductBadges([...productBadges, value]);
    setBadgeDraft("");
  }

  const currentLogoUrl = filePreview ?? resolveLogoUrl(settings?.logoUrl);
  const previewName = name.trim() || "Nombre de la plataforma";

  return (
    <div className="max-w-[720px]">
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Marca de la plataforma</h1>
      <p className="mb-[22px] text-[13.5px] text-outline">
        El nombre y el logo se usan en todo el sitio — header, footer, títulos de página, correos, PDFs y mensajes de
        WhatsApp — sin necesidad de un redespliegue.
      </p>

      {/* Vista previa en vivo, mismo tratamiento visual que el header real */}
      <div className="mb-6 flex items-center gap-2.5 rounded-2xl bg-primary px-5 py-4 shadow-sm">
        {currentLogoUrl ? (
          <img src={currentLogoUrl} alt={previewName} className="h-9 w-9 flex-shrink-0 rounded object-cover" />
        ) : (
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-secondary-container font-display text-lg font-extrabold text-primary">
            {previewName.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="font-display text-xl font-bold tracking-tight text-white">{previewName}</span>
      </div>

      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
          <Sparkles className="h-4 w-4 text-tertiary-accent" /> Nombre
        </div>
        <p className="mb-4 text-[12.5px] text-outline">Reemplaza "ZeuDin" en toda la interfaz, los correos y los documentos generados.</p>
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: ZeuDin" className="flex-1" />
          <Button
            className="rounded-xl px-5"
            disabled={saveName.isPending || !name.trim() || name.trim() === settings?.siteName}
            onClick={() => saveName.mutate()}
          >
            {saveName.isPending ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
          <ImagePlus className="h-4 w-4 text-tertiary-accent" /> Logo
        </div>
        <p className="mb-4 text-[12.5px] text-outline">Sube un archivo o pega el link de una imagen ya alojada en otro lugar. Sin logo, se muestra la inicial del nombre.</p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploadLogoFile.isPending}
            className="flex h-10 items-center gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest px-4 text-[13px] font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
          >
            <ImagePlus className="h-4 w-4" /> {uploadLogoFile.isPending ? "Subiendo..." : "Subir archivo"}
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" className="hidden" onChange={handleFileChange} />

          {settings?.logoUrl && (
            <button
              type="button"
              onClick={() => saveLogoLink.mutate("")}
              disabled={saveLogoLink.isPending}
              className="flex h-10 items-center gap-1.5 rounded-xl border border-error/30 px-4 text-[13px] font-semibold text-error hover:bg-error/10 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" /> Quitar logo
            </button>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <div className="relative flex-1">
            <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-outline" />
            <input
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && linkInput.trim()) { e.preventDefault(); saveLogoLink.mutate(linkInput.trim()); } }}
              placeholder="O pega el link de una imagen (https://...)"
              className="h-10 w-full rounded-xl border border-outline-variant bg-surface-container-lowest pl-9 pr-3 text-[13px] outline-none focus:border-tertiary-accent"
            />
          </div>
          <Button
            variant="outline"
            className="rounded-xl px-5"
            disabled={saveLogoLink.isPending || !linkInput.trim()}
            onClick={() => saveLogoLink.mutate(linkInput.trim())}
          >
            {saveLogoLink.isPending ? "Guardando..." : "Guardar link"}
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

      {/* Bloque 75 (pedido explícito): número crudo, no un link — lo usa el
          botón "Contactar soporte" que ve un vendedor con la tienda
          bloqueada/suspendida (VendorLayout.jsx) para armar un mensaje de
          WhatsApp prellenado. Cambiarlo acá actualiza el botón en todos
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

      <div className="mt-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
          <Wallet className="h-4 w-4 text-tertiary-accent" /> Métodos de pago de producto
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Cuáles puede ofrecer un vendedor al cargar un producto (VendorProducts.jsx). "WhatsApp" es el canal universal, siempre
          disponible por default y no se puede apagar.
        </p>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2.5 text-body-md text-on-surface">
            <input type="checkbox" checked disabled />
            WhatsApp <span className="text-label-sm text-outline">(siempre activo)</span>
          </label>
          {OPTIONAL_METHODS.map((m) => (
            <label key={m.id} className="flex items-center gap-2.5 text-body-md text-on-surface">
              <input
                type="checkbox"
                checked={(settings?.productPaymentMethods ?? ["cod", "prepaid"]).includes(m.id)}
                disabled={toggleProductPaymentMethods.isPending}
                onChange={() => toggleMethod(m.id)}
              />
              {m.label}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
          <Wallet className="h-4 w-4 text-tertiary-accent" /> Monedas disponibles para productos
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Qué monedas pueden elegir los vendedores al publicar cada producto. Por defecto siempre USD.
          Tiene que quedar al menos una activa.
        </p>
        <div className="flex flex-col gap-2">
          {ALL_CURRENCIES.map((c) => (
            <label key={c} className="flex items-center gap-2.5 text-body-md text-on-surface">
              <input
                type="checkbox"
                checked={(settings?.availableCurrencies ?? ALL_CURRENCIES).includes(c)}
                disabled={toggleAvailableCurrencies.isPending}
                onChange={() => toggleCurrency(c)}
              />
              {c}
            </label>
          ))}
        </div>
      </div>

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
    </div>
  );
}
