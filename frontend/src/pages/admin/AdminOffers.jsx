import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Plus, Pencil, Trash2, Search, X, Tag, Code2, ImagePlus, Layers, Ban, CheckCircle2, Clock } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { ImageCropUploader } from "../../components/ImageCropUploader.jsx";

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}
function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" });
}

const STATUS_STYLE = {
  ACTIVE: { background: "rgba(12,174,83,0.12)", color: "#0A8F42" },
  EXPIRED: { background: "rgba(117,119,124,0.12)", color: "#75777c" },
  REMOVED: { background: "rgba(186,26,26,0.12)", color: "#ba1a1a" },
  SUSPENDED: { background: "rgba(254,152,0,0.15)", color: "#8A5100" },
};
const STATUS_LABEL = { ACTIVE: "Activa", EXPIRED: "Vencida", REMOVED: "Retirada", SUSPENDED: "Suspendida" };
const STATUS_TABS = ["ALL", "ACTIVE", "EXPIRED", "REMOVED", "SUSPENDED"];
const STATUS_TAB_LABEL = { ALL: "Todas", ACTIVE: "Activas", EXPIRED: "Vencidas", REMOVED: "Retiradas", SUSPENDED: "Suspendidas" };
const CONTENT_TYPE_LABEL = { PRODUCT: "Producto", CUSTOM: "Personalizada", HTML: "HTML" };
const CONTENT_TYPE_ICON = { PRODUCT: Layers, CUSTOM: ImagePlus, HTML: Code2 };

// Bloque 51: a diferencia del picker del vendedor (VendorOffers.jsx, que
// busca solo entre SUS productos vía /products/me/list), el admin puede
// destacar el producto de CUALQUIER tienda del sitio — reusa /search
// (público) en vez de un endpoint nuevo.
function ProductPickerModal({ onSelect, onClose }) {
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["admin-offers-product-search", q],
    queryFn: async () => (await api.get("/search", { params: { q } })).data.products,
    enabled: q.trim().length >= 2,
  });

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-title-lg font-bold text-on-surface">Elige un producto</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-outline hover:bg-surface-variant">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-outline" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar producto en todo el sitio..."
            className="h-10 w-full rounded-xl border border-outline-variant bg-surface-container-lowest pl-9 pr-3 text-[13px] outline-none"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {q.trim().length < 2 && <p className="py-6 text-center text-[13px] text-outline">Escribe al menos 2 letras.</p>}
          {isLoading && <p className="py-6 text-center text-[13px] text-outline">Buscando...</p>}
          {!isLoading && q.trim().length >= 2 && (data ?? []).length === 0 && (
            <p className="py-6 text-center text-[13px] text-outline">Sin resultados.</p>
          )}
          <div className="flex flex-col gap-1.5">
            {(data ?? []).map((p) => (
              <button key={p.id} onClick={() => onSelect(p)} className="flex items-center gap-3 rounded-xl p-2.5 text-left hover:bg-surface-container">
                <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-lg bg-surface-container">
                  {p.images?.[0] && <img src={imgUrl(p.images[0])} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-on-surface">{p.name}</div>
                  <div className="truncate text-[11.5px] text-outline">{p.vendor?.companyName} · {fmtCUP(p.price)}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function OfferModal({ offer, onClose }) {
  const queryClient = useQueryClient();
  const isEdit = !!offer;
  const [contentType, setContentType] = useState(offer?.contentType ?? "PRODUCT");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [product, setProduct] = useState(offer?.product ?? null);
  const [productImageUrl, setProductImageUrl] = useState(offer?.contentType === "PRODUCT" ? offer.imageUrl : "");
  const [title, setTitle] = useState(offer?.title ?? "");
  const [description, setDescription] = useState(offer?.description ?? "");
  const [tagline, setTagline] = useState(offer?.tagline ?? "");
  const [discountLabel, setDiscountLabel] = useState(offer?.discountLabel ?? "");
  const [orientation, setOrientation] = useState(offer?.orientation ?? "HORIZONTAL");
  const [htmlContent, setHtmlContent] = useState(offer?.htmlContent ?? "");
  const [customBlob, setCustomBlob] = useState(null);
  const [durationDays, setDurationDays] = useState("");
  const [clearExpiry, setClearExpiry] = useState(false);
  const [status, setStatus] = useState(offer?.status ?? "ACTIVE");

  const aspect = orientation === "VERTICAL" ? 3 / 4 : 16 / 9;
  const existingImagePreview = isEdit && contentType === "CUSTOM" ? imgUrl(offer.imageUrl) : null;

  const save = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("title", title.trim());
      if (description.trim()) form.append("description", description.trim());
      if (tagline.trim()) form.append("tagline", tagline.trim());
      if (discountLabel.trim()) form.append("discountLabel", discountLabel.trim());
      form.append("orientation", orientation);
      if (durationDays) form.append("durationDays", String(durationDays));

      if (contentType === "PRODUCT" && productImageUrl) form.append("imageUrl", productImageUrl);
      if (contentType === "CUSTOM" && customBlob) form.append("image", customBlob, "offer.jpg");
      if (contentType === "HTML") form.append("htmlContent", htmlContent);

      if (isEdit) {
        form.append("status", status);
        if (clearExpiry) form.append("clearExpiry", "true");
        return (await api.patch(`/admin/offers/${offer.id}`, form, { headers: { "Content-Type": "multipart/form-data" } })).data;
      }
      form.append("contentType", contentType);
      if (contentType === "PRODUCT" && product) form.append("productId", product.id);
      return (await api.post("/admin/offers", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      toast.success(isEdit ? "Oferta actualizada." : "Oferta creada.");
      queryClient.invalidateQueries({ queryKey: ["admin-offers"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar la oferta."),
  });

  const missingImage = contentType === "CUSTOM" && !customBlob && !existingImagePreview;
  const missingProduct = contentType === "PRODUCT" && !productImageUrl;
  const missingHtml = contentType === "HTML" && !htmlContent.trim();
  const disabled = save.isPending || !title.trim() || missingImage || missingProduct || missingHtml;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-title-lg font-bold text-on-surface">{isEdit ? "Editar oferta" : "Nueva oferta"}</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-outline hover:bg-surface-variant">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!isEdit && (
          <div className="mb-4 grid grid-cols-3 gap-2">
            {["PRODUCT", "CUSTOM", "HTML"].map((ct) => {
              const Icon = CONTENT_TYPE_ICON[ct];
              return (
                <button
                  key={ct}
                  type="button"
                  onClick={() => setContentType(ct)}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border-2 py-3 text-[11.5px] font-bold ${
                    contentType === ct ? "border-tertiary-accent bg-tertiary-accent/10 text-tertiary-accent" : "border-outline-variant text-on-surface-variant"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {CONTENT_TYPE_LABEL[ct]}
                </button>
              );
            })}
          </div>
        )}
        {!isEdit && contentType === "HTML" && (
          <p className="mb-4 rounded-lg bg-tertiary-accent/[0.08] px-3 py-2 text-[11.5px] text-tertiary-accent">
            El bloque HTML se sanitiza automáticamente al guardar (se eliminan scripts y contenido inseguro).
          </p>
        )}

        {contentType === "PRODUCT" && (
          <div className="mb-4">
            {product ? (
              <div className="flex items-center gap-3 rounded-xl bg-surface-container/40 p-3">
                <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-surface-container">
                  {(product.images?.[0]) && <img src={imgUrl(product.images[0])} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-on-surface">{product.name}</div>
                  <div className="truncate text-[11.5px] text-outline">{product.vendor?.companyName}</div>
                </div>
                {!isEdit && (
                  <button type="button" onClick={() => setPickerOpen(true)} className="text-[12px] font-semibold text-tertiary-accent hover:underline">
                    Cambiar
                  </button>
                )}
              </div>
            ) : (
              <Button type="button" variant="outline" className="w-full" onClick={() => setPickerOpen(true)}>
                <Search className="mr-1.5 h-4 w-4" /> Elegir producto
              </Button>
            )}
            {product?.images?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {product.images.map((img) => (
                  <button
                    key={img}
                    type="button"
                    onClick={() => setProductImageUrl(img)}
                    className={`h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border-2 ${
                      productImageUrl === img ? "border-tertiary-accent" : "border-transparent"
                    }`}
                  >
                    <img src={imgUrl(img)} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {contentType === "CUSTOM" && (
          <div className="mb-4">
            <ImageCropUploader
              value={existingImagePreview}
              aspect={aspect}
              recommendedLabel={orientation === "VERTICAL" ? "Tamaño recomendado: 900×1200px (vertical)" : "Tamaño recomendado: 1200×675px (horizontal)"}
              onFileReady={setCustomBlob}
            />
          </div>
        )}

        {contentType === "HTML" && (
          <div className="mb-4">
            <span className="mb-1 block text-label-md text-on-surface-variant">HTML de la oferta</span>
            <textarea
              value={htmlContent}
              onChange={(e) => setHtmlContent(e.target.value)}
              placeholder="<div>...</div>"
              className="min-h-[120px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest p-3 font-mono text-[12px] outline-none"
            />
            {htmlContent.trim() && (
              <div className="mt-2 overflow-hidden rounded-lg border border-outline-variant p-2">
                <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-outline">Vista previa</div>
                <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3.5">
          <Input label="Título" required value={title} onChange={(e) => setTitle(e.target.value)} />
          <div>
            <span className="mb-1 block text-label-md text-on-surface-variant">Descripción (opcional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[64px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none"
            />
          </div>
          <Input label="Frase corta (opcional)" value={tagline} onChange={(e) => setTagline(e.target.value)} />
          <Input label="Etiqueta de descuento (opcional)" placeholder="Ej: -15%, 2x1" value={discountLabel} onChange={(e) => setDiscountLabel(e.target.value)} />

          <div>
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Orientación</span>
            <div className="grid grid-cols-2 gap-2.5">
              {[{ v: "HORIZONTAL", l: "Horizontal" }, { v: "VERTICAL", l: "Vertical" }].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setOrientation(o.v)}
                  className={`rounded-xl border-2 py-2.5 text-[12.5px] font-bold ${
                    orientation === o.v ? "border-tertiary-accent bg-tertiary-accent/10 text-tertiary-accent" : "border-outline-variant text-on-surface-variant"
                  }`}
                >
                  {o.l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Duración en días (opcional)</span>
            <input
              type="number"
              min={1}
              max={365}
              disabled={clearExpiry}
              placeholder="Sin duración = no vence sola"
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-[14px] outline-none disabled:opacity-50"
            />
            <p className="mt-1 text-[11px] text-outline">
              A diferencia de las ofertas de vendedores, las del admin no vencen automáticamente salvo que pongas una duración acá.
            </p>
            {isEdit && offer.expiresAt && (
              <label className="mt-2 flex items-center gap-2 text-[12px] font-semibold text-on-surface">
                <input type="checkbox" checked={clearExpiry} onChange={(e) => setClearExpiry(e.target.checked)} className="h-4 w-4" />
                Quitar el vencimiento actual (que no vuelva a vencer)
              </label>
            )}
          </div>

          {isEdit && (
            <div>
              <span className="mb-1.5 block text-label-md text-on-surface-variant">Estado</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-2.5 text-[14px] outline-none"
              >
                {Object.entries(STATUS_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="mt-5 flex gap-2.5">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={save.isPending}>Cancelar</Button>
          <Button className="flex-1" disabled={disabled} onClick={() => save.mutate()}>
            {save.isPending ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </div>

      {pickerOpen && (
        <ProductPickerModal
          onSelect={(p) => {
            setProduct(p);
            setProductImageUrl(p.images?.[0] ?? "");
            if (!title.trim()) setTitle(p.name);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

// Bloque 51 (pedido explícito): cada cuántos días un vendedor verificado
// puede publicar/republicar una oferta, y cuánto dura activa por default —
// antes hardcodeado en offers.controller.js, ahora editable acá. Se ve
// reflejado de inmediato en VendorOffers.jsx (mismo GET /offers/me/list) y
// en VendorVerification.jsx (plan/suscripción, mismo GET /settings).
function OfferPolicyCard() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  const [cooldownDays, setCooldownDays] = useState("");
  const [durationDays, setDurationDays] = useState("");

  useEffect(() => {
    if (settings) {
      setCooldownDays(String(settings.offerCooldownDays));
      setDurationDays(String(settings.offerDefaultDurationDays));
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.patch("/admin/settings/offer-policy", {
          offerCooldownDays: Number(cooldownDays),
          offerDefaultDurationDays: Number(durationDays),
        })
      ).data,
    onSuccess: () => {
      toast.success("Política de ofertas actualizada.");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar la política."),
  });

  const dirty =
    settings &&
    cooldownDays !== "" &&
    durationDays !== "" &&
    (Number(cooldownDays) !== settings.offerCooldownDays || Number(durationDays) !== settings.offerDefaultDurationDays);

  return (
    <div className="mb-[18px] rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5">
      <div className="mb-3 flex items-center gap-2 text-[14px] font-bold text-on-surface">
        <Clock className="h-4 w-4 text-tertiary-accent" /> Política de ofertas de vendedores
      </div>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-label-md text-on-surface-variant">Cada cuántos días puede publicar una oferta nueva</span>
          <input
            type="number"
            min={1}
            max={365}
            value={cooldownDays}
            onChange={(e) => setCooldownDays(e.target.value)}
            className="h-10 w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13.5px] outline-none"
          />
        </div>
        <div>
          <span className="mb-1 block text-label-md text-on-surface-variant">Duración por default de cada oferta (días)</span>
          <input
            type="number"
            min={1}
            max={365}
            value={durationDays}
            onChange={(e) => setDurationDays(e.target.value)}
            className="h-10 w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13.5px] outline-none"
          />
        </div>
      </div>
      <p className="mt-2 text-[11.5px] text-outline">
        Se refleja de inmediato en el panel de cada vendedor: la sección "Ofertas" (reloj de cuándo puede publicar de nuevo)
        y "Verificación y plan".
      </p>
      {dirty && (
        <Button className="mt-3" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando..." : "Guardar política"}
        </Button>
      )}
    </div>
  );
}

export default function AdminOffers() {
  const queryClient = useQueryClient();
  const [statusTab, setStatusTab] = useState("ALL");
  const [modalState, setModalState] = useState(null); // null | {} | offer
  const [toDelete, setToDelete] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-offers", statusTab],
    queryFn: async () => (await api.get("/admin/offers", { params: statusTab === "ALL" ? {} : { status: statusTab } })).data.offers,
  });

  const quickStatus = useMutation({
    mutationFn: async ({ id, status }) => {
      const form = new FormData();
      form.append("status", status);
      return (await api.patch(`/admin/offers/${id}`, form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-offers"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar."),
  });

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/admin/offers/${id}`),
    onSuccess: () => {
      toast.success("Oferta eliminada.");
      queryClient.invalidateQueries({ queryKey: ["admin-offers"] });
      setToDelete(null);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo eliminar la oferta."),
  });

  return (
    <div className="max-w-[980px]">
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Ofertas</h1>
      <p className="mb-2 text-[13.5px] text-outline">
        Crea ofertas oficiales (producto, imagen personalizada o HTML insertado) y modera las de los vendedores: suspende,
        oculta o elimina las que no cumplan las políticas.
      </p>
      <div className="mb-[18px] rounded-[10px] bg-tertiary-accent/[0.08] px-3.5 py-2.5 text-[12px] text-tertiary-accent">
        💡 Las ofertas del admin no vencen automáticamente salvo que les pongas una duración — así la sección "Ofertas" del
        Home nunca se queda vacía por vencimiento. Si en algún momento no hay ninguna activa (ni del admin ni de vendedores),
        la sección se oculta sola del Home.
      </div>

      <OfferPolicyCard />

      <div className="mb-[18px] flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusTab(s)}
              className={`rounded-full px-3.5 py-1.5 text-[12px] font-bold ${
                statusTab === s ? "bg-tertiary-accent text-white" : "bg-surface-container text-on-surface-variant"
              }`}
            >
              {STATUS_TAB_LABEL[s]}
            </button>
          ))}
        </div>
        <button
          onClick={() => setModalState({})}
          className="flex items-center gap-1.5 rounded-md bg-secondary-container px-3.5 py-2 text-[12.5px] font-bold text-on-secondary-container"
        >
          <Plus className="h-3.5 w-3.5" /> Nueva oferta
        </button>
      </div>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}

      <div className="overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest">
        {data?.map((o) => {
          const Icon = CONTENT_TYPE_ICON[o.contentType];
          return (
            <div key={o.id} className="flex items-center gap-3 border-b border-surface-container px-4 py-3 last:border-b-0">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-container">
                {o.imageUrl ? <img src={imgUrl(o.imageUrl)} alt="" className="h-full w-full object-cover" /> : <Icon className="h-4 w-4 text-outline" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold text-on-surface">{o.title}</div>
                <div className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-outline">
                  <span>{o.createdByAdmin ? "Oficial (admin)" : o.vendor?.companyName ?? "Vendedor"}</span>
                  <span>·</span>
                  <span>{CONTENT_TYPE_LABEL[o.contentType]}</span>
                  <span>·</span>
                  <span>{o.expiresAt ? `Vence ${fmtDate(o.expiresAt)}` : "No vence"}</span>
                </div>
              </div>
              <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={STATUS_STYLE[o.status]}>
                {STATUS_LABEL[o.status]}
              </span>
              {o.status === "SUSPENDED" ? (
                <button title="Reactivar" onClick={() => quickStatus.mutate({ id: o.id, status: "ACTIVE" })} className="text-[#0A8F42]">
                  <CheckCircle2 className="h-4 w-4" />
                </button>
              ) : (
                o.status === "ACTIVE" && (
                  <button title="Suspender" onClick={() => quickStatus.mutate({ id: o.id, status: "SUSPENDED" })} className="text-[#8A5100]">
                    <Ban className="h-4 w-4" />
                  </button>
                )
              )}
              <button onClick={() => setModalState(o)} className="text-tertiary-accent">
                <Pencil className="h-4 w-4" />
              </button>
              <button onClick={() => setToDelete(o)} className="text-error">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
        {!isLoading && !data?.length && (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <Tag className="h-6 w-6 text-outline" />
            <p className="text-body-md text-on-surface-variant">No hay ofertas en esta vista.</p>
          </div>
        )}
      </div>

      {modalState && <OfferModal offer={modalState.id ? modalState : null} onClose={() => setModalState(null)} />}
      {toDelete && (
        <ConfirmDeleteModal
          title={`¿Eliminar "${toDelete.title}"?`}
          description="Se quita del Home de inmediato y no se puede deshacer."
          pending={remove.isPending}
          onConfirm={() => remove.mutate(toDelete.id)}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  );
}
