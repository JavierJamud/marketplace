import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Sparkles, ImagePlus, Link2, X, MessageCircle, Wallet } from "lucide-react";
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

  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });

  useEffect(() => {
    if (settings) setName(settings.siteName ?? "");
  }, [settings]);

  const saveName = useMutation({
    mutationFn: async () => (await api.patch("/admin/settings/branding", { siteName: name.trim() })).data,
    onSuccess: () => {
      toast.success("Nombre de la plataforma actualizado.");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el nombre."),
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
    </div>
  );
}
