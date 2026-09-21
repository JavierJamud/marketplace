import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Plus, Pencil, Trash2, Search, X, Tag, Code2, ImagePlus, Layers, Ban, CheckCircle2, Clock, Link2, Send, Megaphone } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { AiGenerateButton } from "../../components/AiGenerateButton.jsx";
import { UnsavedChangesModal } from "../../components/UnsavedChangesModal.jsx";
import { useDirtyModal } from "../../lib/useDirtyModal.js";

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
    // Bloque 196: sin borrador propio — solo busca y elige, cierra directo
    // al hacer clic afuera (mismo criterio que TableOrderDetailModal.jsx).
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
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
  // Bloque 192 (pedido explícito — "en admin aún dice horizontal y
  // vertical"): mismo criterio que VendorOffers.jsx (Bloque 153) — deja de
  // pedírsele al admin que elija a mano; se auto-detecta de las dimensiones
  // reales del archivo (ver handleCustomFile/useEffect más abajo). El campo
  // sigue existiendo y viajando al backend, solo que ya no hay ningún
  // control visible para tocarlo.
  const [orientation, setOrientation] = useState(offer?.orientation ?? "HORIZONTAL");
  const [htmlContent, setHtmlContent] = useState(offer?.htmlContent ?? "");
  const [customBlob, setCustomBlob] = useState(null);
  const [customPreview, setCustomPreview] = useState(null);
  const [buttonLabel, setButtonLabel] = useState(offer?.buttonLabel ?? "");
  const [buttonUrl, setButtonUrl] = useState(offer?.buttonUrl ?? "");
  const [durationDays, setDurationDays] = useState("");
  const [clearExpiry, setClearExpiry] = useState(false);
  const [status, setStatus] = useState(offer?.status ?? "ACTIVE");

  // Bloque 196 (pedido explícito — "si se hace clic fuera de un contenedor
  // mostrado como ventana o popup en el panel debe cerrarse automáticamente,
  // y si necesita que guarden datos debe preguntar si desea guardar o
  // descartar antes de cerrar"): mismo patrón de snapshot-en-ref que
  // ProductModal (VendorProducts.jsx). Se usa `customPreview` (string,
  // serializable) en vez de `customBlob` (un File — JSON.stringify no lo
  // compara de forma útil) para detectar una foto nueva elegida.
  const initialOfferSnapshot = useRef(
    JSON.stringify({ contentType, product, productImageUrl, title, description, tagline, discountLabel, orientation, htmlContent, customPreview, buttonLabel, buttonUrl, durationDays, clearExpiry, status })
  );
  const isDirty =
    JSON.stringify({ contentType, product, productImageUrl, title, description, tagline, discountLabel, orientation, htmlContent, customPreview, buttonLabel, buttonUrl, durationDays, clearExpiry, status }) !==
    initialOfferSnapshot.current;

  const existingImagePreview = isEdit && contentType === "CUSTOM" ? imgUrl(offer.imageUrl) : null;
  const aiProductName = isEdit ? offer.product?.name : product?.name;

  // Bloque 192: mismo patrón que VendorOffers.jsx — se lee el archivo tal
  // cual (nunca se le pide recortar nada) y se auto-detecta su orientación
  // real, solo para que quede guardada.
  function handleCustomFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setOrientation(img.naturalWidth >= img.naturalHeight ? "HORIZONTAL" : "VERTICAL");
      setCustomBlob(file);
      setCustomPreview(url);
    };
    img.src = url;
    e.target.value = "";
  }

  // Mismo criterio para una oferta de PRODUCTO (foto ya subida del
  // producto elegido, nunca un File nuevo).
  useEffect(() => {
    if (contentType !== "PRODUCT" || !productImageUrl) return;
    const img = new Image();
    img.onload = () => setOrientation(img.naturalWidth >= img.naturalHeight ? "HORIZONTAL" : "VERTICAL");
    img.src = imgUrl(productImageUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentType, productImageUrl]);

  const save = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("title", title.trim());
      if (description.trim()) form.append("description", description.trim());
      if (tagline.trim()) form.append("tagline", tagline.trim());
      if (discountLabel.trim()) form.append("discountLabel", discountLabel.trim());
      form.append("orientation", orientation);
      if (durationDays) form.append("durationDays", String(durationDays));
      // Bloque 192: el botón/enlace van siempre juntos o ninguno — el
      // backend valida esto igual (defensa real), esto es solo para que el
      // form no ni intente mandar uno solo.
      form.append("buttonLabel", buttonLabel.trim());
      form.append("buttonUrl", buttonUrl.trim());

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
  const buttonMismatch = !!buttonLabel.trim() !== !!buttonUrl.trim();
  const invalidButtonUrl = !!buttonUrl.trim() && !buttonUrl.trim().startsWith("/") && !/^https?:\/\//.test(buttonUrl.trim());
  const disabled = save.isPending || !title.trim() || missingImage || missingProduct || missingHtml || buttonMismatch || invalidButtonUrl;
  // Bloque 196: misma condición que ya deshabilita "Guardar" más abajo (sin
  // save.isPending) — reusada para no ofrecer "Guardar y salir" en el
  // diálogo de confirmación cuando el formulario ni siquiera pasaría esa
  // validación.
  const canSaveNow = !!title.trim() && !missingImage && !missingProduct && !missingHtml && !buttonMismatch && !invalidButtonUrl;
  const dirtyModal = useDirtyModal({
    isDirty,
    onClose,
    onSave: canSaveNow ? () => save.mutateAsync() : undefined,
  });

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={dirtyModal.handleBackdropClick}
    >
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
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Imagen de la oferta</span>
            <label className="relative flex aspect-[7/4] w-full max-w-[280px] cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-outline-variant bg-surface-container">
              {customPreview ?? existingImagePreview ? (
                <img src={customPreview ?? existingImagePreview} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex flex-col items-center gap-1.5 text-outline">
                  <ImagePlus className="h-6 w-6" />
                  <span className="text-[12px] font-semibold">Subir imagen</span>
                </span>
              )}
              {(customPreview ?? existingImagePreview) && (
                <span className="absolute inset-x-0 bottom-0 bg-inverse-surface/60 py-1 text-center text-[11px] font-semibold text-white">
                  Cambiar imagen
                </span>
              )}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleCustomFile} className="hidden" />
            </label>
            <p className="mt-1.5 text-[11.5px] text-outline">Se publica con el mismo tamaño que subas — se acomoda sola en la grilla.</p>
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
            {/* Bloque 192 (pedido explícito — "en admin la descripción...
                no tiene el botón para mejorar con IA"): mismo componente
                que VendorOffers.jsx, con kind="admin-offer" — no depende de
                ninguna tienda (ver el comentario largo en ai.controller.js). */}
            <AiGenerateButton kind="admin-offer" currentText={description} productName={aiProductName} onGenerated={setDescription} />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="1-2 frases que se lean rápido sobre la imagen..."
              className="min-h-[64px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none"
            />
          </div>
          <Input label="Frase corta (opcional)" value={tagline} onChange={(e) => setTagline(e.target.value)} />
          <Input label="Etiqueta de descuento (opcional)" placeholder="Ej: -15%, 2x1" value={discountLabel} onChange={(e) => setDiscountLabel(e.target.value)} />

          {/* Bloque 192 (pedido explícito — "el admin puede agregar un
              botón a la oferta y un enlace también"): EXCLUSIVO de las
              ofertas de admin (offers.controller.js del vendedor no acepta
              estos 2 campos) — le da a una CUSTOM del admin (que hoy no es
              clickeable, no tiene tienda propia detrás) un destino real, o
              le agrega un CTA visible a cualquier tipo de oferta. */}
          <div className="rounded-xl border border-outline-variant p-3.5">
            <div className="mb-2.5 flex items-center gap-1.5 text-label-md font-semibold text-on-surface-variant">
              <Link2 className="h-3.5 w-3.5" /> Botón y enlace (opcional)
            </div>
            <div className="flex flex-col gap-2.5">
              <Input
                label="Texto del botón"
                placeholder="Ej: Ver oferta, Comprar ahora"
                maxLength={30}
                value={buttonLabel}
                onChange={(e) => setButtonLabel(e.target.value)}
              />
              <Input
                label="Enlace"
                placeholder="/tienda/mi-tienda o https://..."
                value={buttonUrl}
                onChange={(e) => setButtonUrl(e.target.value)}
              />
            </div>
            {buttonMismatch && <p className="mt-1.5 text-[11.5px] font-semibold text-error">Completa los dos campos, o dejalos vacíos los dos.</p>}
            {!buttonMismatch && invalidButtonUrl && (
              <p className="mt-1.5 text-[11.5px] font-semibold text-error">El enlace debe empezar con / (interno) o con http(s):// (externo).</p>
            )}
            <p className="mt-1.5 text-[11px] text-outline">
              Interno (empieza con /) lleva dentro del sitio; externo (empieza con http:// o https://) abre en una pestaña nueva.
            </p>
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

      <UnsavedChangesModal
        open={dirtyModal.confirming}
        saving={dirtyModal.saving}
        onSave={canSaveNow ? dirtyModal.handleSaveAndClose : undefined}
        onDiscard={dirtyModal.handleDiscard}
        onCancel={dirtyModal.handleKeepEditing}
      />
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

// Bloque 194 (pedido explícito — "quiero agregar en el panel de admin en la
// sección de ofertas ofertas autodirigidas... para clientes o para
// vendedores... por email o... popup, o ambas... a vendedores en
// específico, como los registrados en el plan Business, o los no
// registrados, y a uno en específico"): 7 audiencias posibles — las 5
// primeras son grupos, las últimas 2 abren un buscador (ver
// TargetPickerModal) para elegir UN vendedor/cliente puntual.
const AUDIENCE_LABEL = {
  all_customers: "Todos los clientes",
  all_vendors: "Todos los vendedores",
  regular_vendors: "Vendedores Plan Regular",
  business_vendors: "Vendedores Plan Business",
  unverified_vendors: "Vendedores no verificados",
  specific_vendor: "Un vendedor específico",
  specific_customer: "Un cliente específico",
};
const AUDIENCE_OPTIONS = Object.keys(AUDIENCE_LABEL);
const DELIVERY_LABEL = { EMAIL: "Solo correo", POPUP: "Solo popup", BOTH: "Correo + popup" };
const TARGETED_STATUS_LABEL = { ACTIVE: "Activa", ARCHIVED: "Archivada" };
const TARGETED_STATUS_STYLE = {
  ACTIVE: { background: "rgba(12,174,83,0.12)", color: "#0A8F42" },
  ARCHIVED: { background: "rgba(117,119,124,0.12)", color: "#75777c" },
};

// Bloque 194: mismo patrón que ProductPickerModal de arriba, pero busca
// vendedores o clientes vía /admin/search (ya existe — Bloque 47, usado por
// la barra de búsqueda del panel — devuelve {id, label, to}, alcanza para
// mostrar un nombre y guardar el id elegido, sin inventar un endpoint nuevo).
function TargetPickerModal({ kind, onSelect, onClose }) {
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["admin-targeted-offer-target-search", kind, q],
    queryFn: async () => (await api.get("/admin/search", { params: { q } })).data,
    enabled: q.trim().length >= 2,
  });
  const results = kind === "vendor" ? data?.vendors : data?.customers;

  return (
    // Bloque 196: sin borrador propio — solo busca y elige, cierra directo
    // al hacer clic afuera.
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-title-lg font-bold text-on-surface">{kind === "vendor" ? "Elige una tienda" : "Elige un cliente"}</h3>
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
            placeholder={kind === "vendor" ? "Buscar tienda por nombre..." : "Buscar cliente por nombre o correo..."}
            className="h-10 w-full rounded-xl border border-outline-variant bg-surface-container-lowest pl-9 pr-3 text-[13px] outline-none"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {q.trim().length < 2 && <p className="py-6 text-center text-[13px] text-outline">Escribe al menos 2 letras.</p>}
          {isLoading && <p className="py-6 text-center text-[13px] text-outline">Buscando...</p>}
          {!isLoading && q.trim().length >= 2 && (results ?? []).length === 0 && (
            <p className="py-6 text-center text-[13px] text-outline">Sin resultados.</p>
          )}
          <div className="flex flex-col gap-1.5">
            {(results ?? []).map((r) => (
              <button
                key={r.id}
                onClick={() => onSelect(r)}
                className="rounded-xl p-2.5 text-left text-[13px] font-semibold text-on-surface hover:bg-surface-container"
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TargetedOfferModal({ offer, siteSettings, onClose }) {
  const queryClient = useQueryClient();
  const isEdit = !!offer;
  const [title, setTitle] = useState(offer?.title ?? "");
  const [message, setMessage] = useState(offer?.message ?? "");
  const [imageBlob, setImageBlob] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageLink, setImageLink] = useState("");
  const [existingImageUrl, setExistingImageUrl] = useState(offer?.imageUrl ?? null);
  const [ctaLabel, setCtaLabel] = useState(offer?.ctaLabel ?? "");
  const [ctaUrl, setCtaUrl] = useState(offer?.ctaUrl ?? "");
  const [audience, setAudience] = useState(offer?.audience ?? "all_customers");
  const [targetVendor, setTargetVendor] = useState(
    offer?.targetVendor ? { id: offer.targetVendor.id, label: offer.targetVendor.companyName } : null
  );
  const [targetCustomer, setTargetCustomer] = useState(
    offer?.targetUser ? { id: offer.targetUser.id, label: offer.targetUser.fullName ?? offer.targetUser.email } : null
  );
  const [pickerOpen, setPickerOpen] = useState(null); // null | "vendor" | "customer"
  // Bloque 194: 2 checkboxes independientes en vez del enum de 3 — más
  // natural acá, el backend los mapea a EMAIL/POPUP/BOTH (ver
  // targetedOffers.controller.js). Nueva oferta: las 2 marcadas por default.
  const [sendEmail, setSendEmail] = useState(offer ? offer.delivery === "EMAIL" || offer.delivery === "BOTH" : true);
  const [showPopup, setShowPopup] = useState(offer ? offer.delivery === "POPUP" || offer.delivery === "BOTH" : true);
  const [expiresAt, setExpiresAt] = useState(offer?.expiresAt ? offer.expiresAt.slice(0, 10) : "");
  const [clearExpiry, setClearExpiry] = useState(false);
  const [status, setStatus] = useState(offer?.status ?? "ACTIVE");

  // Bloque 196 (mismo patrón que OfferModal arriba): snapshot del borrador
  // con el que se abrió el modal — `imagePreview` (string, serializable) en
  // vez de `imageBlob` (un File) para detectar una foto nueva elegida.
  const initialTargetedSnapshot = useRef(
    JSON.stringify({ title, message, imageLink, existingImageUrl, imagePreview, ctaLabel, ctaUrl, audience, targetVendor, targetCustomer, sendEmail, showPopup, expiresAt, clearExpiry, status })
  );
  const isDirty =
    JSON.stringify({ title, message, imageLink, existingImageUrl, imagePreview, ctaLabel, ctaUrl, audience, targetVendor, targetCustomer, sendEmail, showPopup, expiresAt, clearExpiry, status }) !==
    initialTargetedSnapshot.current;

  function handleImageFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageBlob(file);
    setImagePreview(URL.createObjectURL(file));
    setImageLink("");
    e.target.value = "";
  }

  const ctaMismatch = !!ctaLabel.trim() !== !!ctaUrl.trim();
  const invalidCtaUrl = !!ctaUrl.trim() && !ctaUrl.trim().startsWith("/") && !/^https?:\/\//.test(ctaUrl.trim());
  const needsVendor = audience === "specific_vendor" && !targetVendor;
  const needsCustomer = audience === "specific_customer" && !targetCustomer;
  const deliveryMissing = !sendEmail && !showPopup;

  const save = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("title", title.trim());
      form.append("message", message.trim());
      form.append("audience", audience);
      if (audience === "specific_vendor" && targetVendor) form.append("targetVendorId", targetVendor.id);
      if (audience === "specific_customer" && targetCustomer) form.append("targetUserId", targetCustomer.id);
      form.append("ctaLabel", ctaLabel.trim());
      form.append("ctaUrl", ctaUrl.trim());
      form.append("sendEmail", String(sendEmail));
      form.append("showPopup", String(showPopup));
      if (imageBlob) form.append("image", imageBlob, "targeted-offer.jpg");
      else if (imageLink.trim()) form.append("imageUrl", imageLink.trim());
      else if (isEdit && !existingImageUrl) form.append("removeImage", "true");

      if (isEdit) {
        form.append("status", status);
        if (clearExpiry) form.append("clearExpiry", "true");
        else if (expiresAt) form.append("expiresAt", expiresAt);
        return (await api.patch(`/admin/targeted-offers/${offer.id}`, form, { headers: { "Content-Type": "multipart/form-data" } })).data;
      }
      if (expiresAt) form.append("expiresAt", expiresAt);
      return (await api.post("/admin/targeted-offers", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: (data) => {
      toast.success(isEdit ? "Oferta dirigida actualizada." : "Oferta dirigida creada.");
      // Bloque 194: un fallo de envío al crear NO revierte la oferta (ver el
      // comentario largo en createTargetedOffer, backend) — se avisa acá,
      // pero la oferta ya quedó guardada/disponible como popup igual.
      if (data?.emailWarning) toast.error(data.emailWarning);
      queryClient.invalidateQueries({ queryKey: ["admin-targeted-offers"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar la oferta dirigida."),
  });

  const disabled =
    save.isPending || !title.trim() || !message.trim() || ctaMismatch || invalidCtaUrl || needsVendor || needsCustomer || deliveryMissing;
  // Bloque 196: misma condición que ya deshabilita "Guardar" más abajo (sin
  // save.isPending).
  const canSaveNow = !!title.trim() && !!message.trim() && !ctaMismatch && !invalidCtaUrl && !needsVendor && !needsCustomer && !deliveryMissing;
  const dirtyModal = useDirtyModal({
    isDirty,
    onClose,
    onSave: canSaveNow ? () => save.mutateAsync() : undefined,
  });

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={dirtyModal.handleBackdropClick}
    >
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-title-lg font-bold text-on-surface">{isEdit ? "Editar oferta dirigida" : "Nueva oferta dirigida"}</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-outline hover:bg-surface-variant">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3.5">
          <Input label="Título" required value={title} onChange={(e) => setTitle(e.target.value)} />
          <div>
            <span className="mb-1 block text-label-md text-on-surface-variant">Mensaje</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Texto de la oferta..."
              className="min-h-[90px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none"
            />
          </div>

          <div>
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Imagen (opcional)</span>
            <label className="relative flex aspect-[7/4] w-full max-w-[280px] cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-outline-variant bg-surface-container">
              {imagePreview || existingImageUrl ? (
                <img src={imagePreview ?? imgUrl(existingImageUrl)} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex flex-col items-center gap-1.5 text-outline">
                  <ImagePlus className="h-6 w-6" />
                  <span className="text-[12px] font-semibold">Subir imagen</span>
                </span>
              )}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageFile} className="hidden" />
            </label>
            {(imagePreview || existingImageUrl) && (
              <button
                type="button"
                onClick={() => {
                  setImageBlob(null);
                  setImagePreview(null);
                  setExistingImageUrl(null);
                  setImageLink("");
                }}
                className="mt-1.5 text-[11.5px] font-semibold text-error hover:underline"
              >
                Quitar imagen
              </button>
            )}
            {siteSettings?.allowProductImageLinks && !imageBlob && !existingImageUrl && (
              <input
                value={imageLink}
                onChange={(e) => setImageLink(e.target.value)}
                placeholder="O pega el link de una imagen (https://...)"
                className="mt-2 h-9 w-full max-w-[320px] rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-tertiary-accent"
              />
            )}
          </div>

          <div className="rounded-xl border border-outline-variant p-3.5">
            <div className="mb-2.5 flex items-center gap-1.5 text-label-md font-semibold text-on-surface-variant">
              <Link2 className="h-3.5 w-3.5" /> Botón y enlace (opcional)
            </div>
            <div className="flex flex-col gap-2.5">
              <Input label="Texto del botón" placeholder="Ej: Ver oferta" maxLength={40} value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} />
              <Input label="Enlace" placeholder="/vendedor/verificacion o https://..." value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} />
            </div>
            {ctaMismatch && <p className="mt-1.5 text-[11.5px] font-semibold text-error">Completa los dos campos, o dejalos vacíos los dos.</p>}
            {!ctaMismatch && invalidCtaUrl && (
              <p className="mt-1.5 text-[11.5px] font-semibold text-error">El enlace debe empezar con / (interno) o con http(s):// (externo).</p>
            )}
          </div>

          <div>
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Audiencia</span>
            <select
              value={audience}
              onChange={(e) => {
                setAudience(e.target.value);
                setTargetVendor(null);
                setTargetCustomer(null);
              }}
              className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-2.5 text-[14px] outline-none"
            >
              {AUDIENCE_OPTIONS.map((a) => (
                <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>
              ))}
            </select>
            {audience === "specific_vendor" &&
              (targetVendor ? (
                <div className="mt-2 flex items-center justify-between rounded-lg bg-surface-container/60 px-3 py-2 text-[13px]">
                  <span className="font-semibold text-on-surface">{targetVendor.label}</span>
                  <button type="button" onClick={() => setPickerOpen("vendor")} className="text-[12px] font-semibold text-tertiary-accent hover:underline">
                    Cambiar
                  </button>
                </div>
              ) : (
                <Button type="button" variant="outline" className="mt-2 w-full" onClick={() => setPickerOpen("vendor")}>
                  <Search className="mr-1.5 h-4 w-4" /> Elegir tienda
                </Button>
              ))}
            {audience === "specific_customer" &&
              (targetCustomer ? (
                <div className="mt-2 flex items-center justify-between rounded-lg bg-surface-container/60 px-3 py-2 text-[13px]">
                  <span className="font-semibold text-on-surface">{targetCustomer.label}</span>
                  <button type="button" onClick={() => setPickerOpen("customer")} className="text-[12px] font-semibold text-tertiary-accent hover:underline">
                    Cambiar
                  </button>
                </div>
              ) : (
                <Button type="button" variant="outline" className="mt-2 w-full" onClick={() => setPickerOpen("customer")}>
                  <Search className="mr-1.5 h-4 w-4" /> Elegir cliente
                </Button>
              ))}
          </div>

          <div>
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Entrega</span>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-[13px] font-semibold text-on-surface">
                <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="h-4 w-4" />
                Enviar por correo
              </label>
              <label className="flex items-center gap-2 text-[13px] font-semibold text-on-surface">
                <input type="checkbox" checked={showPopup} onChange={(e) => setShowPopup(e.target.checked)} className="h-4 w-4" />
                Mostrar como popup al iniciar sesión
              </label>
            </div>
            {deliveryMissing && <p className="mt-1.5 text-[11.5px] font-semibold text-error">Elige al menos una forma de entrega.</p>}
            {isEdit && (
              <p className="mt-1.5 text-[11px] text-outline">
                Cambiar esto NO reenvía el correo — usa "Reenviar correo" desde la lista si hace falta.
              </p>
            )}
          </div>

          <div>
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Vencimiento (opcional)</span>
            <input
              type="date"
              disabled={clearExpiry}
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-[14px] outline-none disabled:opacity-50"
            />
            <p className="mt-1 text-[11px] text-outline">Sin vencimiento, el popup sigue mostrándose hasta que la archives a mano.</p>
            {isEdit && offer.expiresAt && (
              <label className="mt-2 flex items-center gap-2 text-[12px] font-semibold text-on-surface">
                <input type="checkbox" checked={clearExpiry} onChange={(e) => setClearExpiry(e.target.checked)} className="h-4 w-4" />
                Quitar el vencimiento actual
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
                {Object.entries(TARGETED_STATUS_LABEL).map(([k, l]) => (
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
        <TargetPickerModal
          kind={pickerOpen}
          onSelect={(r) => {
            if (pickerOpen === "vendor") setTargetVendor(r);
            else setTargetCustomer(r);
            setPickerOpen(null);
          }}
          onClose={() => setPickerOpen(null)}
        />
      )}

      <UnsavedChangesModal
        open={dirtyModal.confirming}
        saving={dirtyModal.saving}
        onSave={canSaveNow ? dirtyModal.handleSaveAndClose : undefined}
        onDiscard={dirtyModal.handleDiscard}
        onCancel={dirtyModal.handleKeepEditing}
      />
    </div>
  );
}

// Bloque 194: lista + acciones (editar, archivar/reactivar, reenviar correo,
// borrar) de las ofertas autodirigidas ya creadas.
function TargetedOffersSection() {
  const queryClient = useQueryClient();
  const [modalState, setModalState] = useState(null); // null | {} | offer
  const [toDelete, setToDelete] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-targeted-offers"],
    queryFn: async () => (await api.get("/admin/targeted-offers")).data.offers,
  });
  const { data: siteSettings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });

  const toggleStatus = useMutation({
    mutationFn: async ({ id, status }) => {
      const form = new FormData();
      form.append("status", status);
      return (await api.patch(`/admin/targeted-offers/${id}`, form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-targeted-offers"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar."),
  });

  const resendEmail = useMutation({
    mutationFn: async (id) => (await api.post(`/admin/targeted-offers/${id}/resend-email`)).data,
    onSuccess: () => {
      toast.success("Correo reenviado.");
      queryClient.invalidateQueries({ queryKey: ["admin-targeted-offers"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo reenviar el correo."),
  });

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/admin/targeted-offers/${id}`),
    onSuccess: () => {
      toast.success("Oferta dirigida eliminada.");
      queryClient.invalidateQueries({ queryKey: ["admin-targeted-offers"] });
      setToDelete(null);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo eliminar."),
  });

  return (
    <div>
      <div className="mb-[18px] flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[560px] text-[13.5px] text-outline">
          Ofertas dirigidas a un cliente, a un vendedor, o a un grupo puntual (ej. solo Plan Business) — por correo, popup al
          iniciar sesión, o ambas.
        </p>
        <button
          onClick={() => setModalState({})}
          className="flex items-center gap-1.5 rounded-full bg-secondary-container px-3.5 py-2 text-[12.5px] font-bold text-on-secondary-container"
        >
          <Plus className="h-3.5 w-3.5" /> Nueva oferta dirigida
        </button>
      </div>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}

      <div className="overflow-hidden rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
        {data?.map((o) => (
          <div key={o.id} className="flex items-center gap-3 border-b border-surface-container px-4 py-3 last:border-b-0">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-container">
              {o.imageUrl ? <img src={imgUrl(o.imageUrl)} alt="" className="h-full w-full object-cover" /> : <Send className="h-4 w-4 text-outline" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold text-on-surface">{o.title}</div>
              <div className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-outline">
                <span>
                  {AUDIENCE_LABEL[o.audience] ?? o.audience}
                  {o.audience === "specific_vendor" && o.targetVendor ? `: ${o.targetVendor.companyName}` : ""}
                  {o.audience === "specific_customer" && o.targetUser ? `: ${o.targetUser.fullName ?? o.targetUser.email}` : ""}
                </span>
                <span>·</span>
                <span>{DELIVERY_LABEL[o.delivery]}</span>
                <span>·</span>
                <span>{o.emailSentCount > 0 ? `${o.emailSentCount} correos enviados` : "Sin enviar por correo"}</span>
                <span>·</span>
                <span>{o.expiresAt ? `Vence ${fmtDate(o.expiresAt)}` : "No vence"}</span>
              </div>
            </div>
            <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={TARGETED_STATUS_STYLE[o.status]}>
              {TARGETED_STATUS_LABEL[o.status]}
            </span>
            {o.status === "ARCHIVED" ? (
              <button title="Reactivar" onClick={() => toggleStatus.mutate({ id: o.id, status: "ACTIVE" })} className="text-[#0A8F42]">
                <CheckCircle2 className="h-4 w-4" />
              </button>
            ) : (
              <button title="Archivar" onClick={() => toggleStatus.mutate({ id: o.id, status: "ARCHIVED" })} className="text-[#8A5100]">
                <Ban className="h-4 w-4" />
              </button>
            )}
            {(o.delivery === "EMAIL" || o.delivery === "BOTH") && (
              <button
                title="Reenviar correo"
                disabled={resendEmail.isPending}
                onClick={() => resendEmail.mutate(o.id)}
                className="text-tertiary-accent disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
            <button onClick={() => setModalState(o)} className="text-tertiary-accent">
              <Pencil className="h-4 w-4" />
            </button>
            <button onClick={() => setToDelete(o)} className="text-error">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {!isLoading && !data?.length && (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <Send className="h-6 w-6 text-outline" />
            <p className="text-body-md text-on-surface-variant">Todavía no creaste ninguna oferta dirigida.</p>
          </div>
        )}
      </div>

      {modalState && <TargetedOfferModal offer={modalState.id ? modalState : null} siteSettings={siteSettings} onClose={() => setModalState(null)} />}
      {toDelete && (
        <ConfirmDeleteModal
          title={`¿Eliminar "${toDelete.title}"?`}
          description="Se deja de mostrar/enviar de inmediato y no se puede deshacer."
          pending={remove.isPending}
          onConfirm={() => remove.mutate(toDelete.id)}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  );
}

export default function AdminOffers() {
  const queryClient = useQueryClient();
  // Bloque 194 (pedido explícito — "en el panel de admin en la sección de
  // ofertas [agregar] ofertas autodirigidas"): tab simple arriba de la
  // página existente — "home" es todo lo que ya había (ofertas del Home +
  // política), "targeted" es la sección nueva. Ningún estado/lógica previa
  // se tocó, solo queda envuelta en la rama "home".
  const [pageTab, setPageTab] = useState("home");
  const [statusTab, setStatusTab] = useState("ALL");
  const [modalState, setModalState] = useState(null); // null | {} | offer
  const [toDelete, setToDelete] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-offers", statusTab],
    queryFn: async () => (await api.get("/admin/offers", { params: statusTab === "ALL" ? {} : { status: statusTab } })).data.offers,
    enabled: pageTab === "home",
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
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Tag} tone="orange" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Ofertas</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">
        Crea ofertas oficiales (producto, imagen personalizada o HTML insertado), modera las de los vendedores, y lanza
        ofertas dirigidas a un cliente, un vendedor, o un grupo puntual.
      </p>

      {/* Bloque 194: tab-bar simple — cambia qué lista+modal se muestra,
          reusando el layout general de la página (título/descripción de
          arriba quedan compartidos para las 2 secciones). */}
      <div className="mb-[18px] flex gap-1.5 border-b border-surface-container-high">
        {[
          { id: "home", label: "Ofertas del Home", icon: Tag },
          { id: "targeted", label: "Ofertas autodirigidas", icon: Megaphone },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setPageTab(id)}
            className={`flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] font-bold ${
              pageTab === id ? "border-tertiary-accent text-tertiary-accent" : "border-transparent text-on-surface-variant"
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {pageTab === "targeted" ? (
        <TargetedOffersSection />
      ) : (
        <>
          <div className="mb-[18px] rounded-[10px] bg-tertiary-accent/[0.08] px-3.5 py-2.5 text-[12px] text-tertiary-accent">
            💡 Las ofertas del admin no vencen automáticamente salvo que les pongas una duración — así la sección "Ofertas"
            del Home nunca se queda vacía por vencimiento. Si en algún momento no hay ninguna activa (ni del admin ni de
            vendedores), la sección se oculta sola del Home.
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
              className="flex items-center gap-1.5 rounded-full bg-secondary-container px-3.5 py-2 text-[12.5px] font-bold text-on-secondary-container"
            >
              <Plus className="h-3.5 w-3.5" /> Nueva oferta
            </button>
          </div>

          {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}

          <div className="overflow-hidden rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
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
        </>
      )}
    </div>
  );
}
