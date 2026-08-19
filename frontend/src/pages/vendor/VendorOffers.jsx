import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Tag, Plus, X, Search, Clock, Trash2, ShieldAlert, Pencil, ImagePlus, Layers } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { AiGenerateButton } from "../../components/AiGenerateButton.jsx";
import { ImageCropUploader } from "../../components/ImageCropUploader.jsx";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

// Bloque 50: mismo criterio que ProductCard.jsx/Store.jsx — la imagen puede
// ser un archivo servido por este backend (ruta relativa) o un link externo
// ya absoluto pegado por el vendedor.
function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "long", year: "numeric" });
}

// Bloque 51: expiresAt puede ser null (reservado a ofertas del admin) — acá
// nunca pasa para las del vendedor, pero la función queda a prueba de eso.
function remainingLabel(expiresAt) {
  if (!expiresAt) return "No vence";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Vencida";
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days >= 1) return `${days}d ${hours}h restantes`;
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m restantes`;
}

// Bloque 51 (pedido explícito): reloj en vivo — cuando no está disponible
// crear/republicar una oferta, muestra cuánto falta en vez de solo la fecha.
// Se recalcula 1 vez por minuto (misma cadencia que el reloj de vencimiento
// de OffersSlider.jsx), no hace falta más precisión para esto.
function useLiveRemainingLabel(targetIso) {
  const [label, setLabel] = useState(() => (targetIso ? remainingLabel(targetIso) : null));
  useEffect(() => {
    if (!targetIso) {
      setLabel(null);
      return;
    }
    setLabel(remainingLabel(targetIso));
    const id = setInterval(() => setLabel(remainingLabel(targetIso)), 60000);
    return () => clearInterval(id);
  }, [targetIso]);
  return label;
}

const STATUS_STYLE = {
  ACTIVE: { background: "rgba(12,174,83,0.12)", color: "#0A8F42" },
  EXPIRED: { background: "rgba(117,119,124,0.12)", color: "#75777c" },
  REMOVED: { background: "rgba(186,26,26,0.12)", color: "#ba1a1a" },
  SUSPENDED: { background: "rgba(254,152,0,0.15)", color: "#8A5100" },
};
const STATUS_LABEL = { ACTIVE: "Activa", EXPIRED: "Vencida", REMOVED: "Retirada", SUSPENDED: "Suspendida" };
const CONTENT_TYPE_LABEL = { PRODUCT: "Desde un producto", CUSTOM: "Personalizada" };

function ProductPickerModal({ onSelect, onClose }) {
  const [search, setSearch] = useState("");
  const { data: products, isLoading } = useQuery({
    queryKey: ["my-products"],
    queryFn: async () => (await api.get("/products/me/list")).data.products,
  });
  const filtered = (products ?? []).filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-title-lg text-on-surface">Elige un producto</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-outline hover:bg-surface-variant">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-outline" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar producto por nombre..."
            className="h-10 w-full rounded-xl border border-outline-variant bg-surface-container-lowest pl-9 pr-3 text-[13px] outline-none focus:border-tertiary-accent"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading && <p className="py-6 text-center text-[13px] text-outline">Cargando productos...</p>}
          {!isLoading && filtered.length === 0 && (
            <p className="py-6 text-center text-[13px] text-outline">No se encontraron productos.</p>
          )}
          <div className="flex flex-col gap-1.5">
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelect(p)}
                className="flex items-center gap-3 rounded-xl p-2.5 text-left hover:bg-surface-container"
              >
                <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-lg bg-surface-container">
                  {p.images?.[0] && <img src={imgUrl(p.images[0])} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-on-surface">{p.name}</div>
                  <div className="text-[11.5px] text-outline">{fmtCUP(p.price)}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Elegir entre las dos únicas formas que tiene el vendedor de crear una
// oferta — el HTML insertado queda reservado al admin (pedido explícito).
function TypeChoiceModal({ onChoose, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-title-lg text-on-surface">Nueva oferta</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-outline hover:bg-surface-variant">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            onClick={() => onChoose("product")}
            className="flex flex-col items-center gap-2.5 rounded-xl border-2 border-outline-variant p-5 text-center hover:border-tertiary-accent"
          >
            <Layers className="h-7 w-7 text-tertiary-accent" />
            <span className="text-[13.5px] font-bold text-on-surface">Desde un producto</span>
            <span className="text-[11.5px] text-outline">Elige un producto ya cargado y usa una de sus fotos.</span>
          </button>
          <button
            onClick={() => onChoose("custom")}
            className="flex flex-col items-center gap-2.5 rounded-xl border-2 border-outline-variant p-5 text-center hover:border-tertiary-accent"
          >
            <ImagePlus className="h-7 w-7 text-tertiary-accent" />
            <span className="text-[13.5px] font-bold text-on-surface">Personalizada</span>
            <span className="text-[11.5px] text-outline">Sube tu propia imagen, recórtala y arma el texto.</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// Formulario único para las 3 situaciones: crear desde producto, crear
// personalizada y editar (cualquiera de las dos, incluida republicación).
function OfferFormModal({ mode, product, offer, canCreateNow, nextAvailableAt, onClose, onSaved }) {
  const isEdit = mode === "edit";
  const contentType = isEdit ? offer.contentType : mode === "create-product" ? "PRODUCT" : "CUSTOM";
  const productImages = isEdit ? offer.product?.images ?? [] : product?.images ?? [];
  const needsRepublish = isEdit && offer.status !== "ACTIVE" && offer.status !== "SUSPENDED";

  const [title, setTitle] = useState(isEdit ? offer.title : product?.name ?? "");
  const [description, setDescription] = useState(isEdit ? offer.description ?? "" : "");
  const [tagline, setTagline] = useState(isEdit ? offer.tagline ?? "" : "");
  const [discountLabel, setDiscountLabel] = useState(isEdit ? offer.discountLabel ?? "" : "");
  const [orientation, setOrientation] = useState(isEdit ? offer.orientation : "HORIZONTAL");
  const [durationDays, setDurationDays] = useState(isEdit ? "" : "30");
  const [productImageUrl, setProductImageUrl] = useState(isEdit && contentType === "PRODUCT" ? offer.imageUrl : product?.images?.[0] ?? "");
  const [customBlob, setCustomBlob] = useState(null);
  const [republish, setRepublish] = useState(false);

  const aspect = orientation === "VERTICAL" ? 3 / 4 : 16 / 9;
  const existingImagePreview = isEdit && contentType === "CUSTOM" ? imgUrl(offer.imageUrl) : null;
  const aiProductName = isEdit ? offer.product?.name : product?.name;

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

      if (isEdit) {
        if (needsRepublish && republish) form.append("republish", "true");
        return (await api.patch(`/offers/${offer.id}`, form, { headers: { "Content-Type": "multipart/form-data" } })).data;
      }
      form.append("contentType", contentType);
      if (contentType === "PRODUCT") form.append("productId", product.id);
      return (await api.post("/offers", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      toast.success(isEdit ? "Oferta actualizada." : "Oferta publicada — ya se muestra en el Home.");
      onSaved();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar la oferta."),
  });

  const missingImage = contentType === "CUSTOM" && !customBlob && !existingImagePreview;
  const disabledSubmit = save.isPending || !title.trim() || (contentType === "PRODUCT" && !productImageUrl) || missingImage;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-title-lg text-on-surface">
            {isEdit ? "Editar oferta" : contentType === "PRODUCT" ? "Nueva oferta desde un producto" : "Nueva oferta personalizada"}
          </h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-outline hover:bg-surface-variant">
            <X className="h-4 w-4" />
          </button>
        </div>

        {contentType === "PRODUCT" ? (
          <>
            <div className="mb-4 flex items-center gap-3 rounded-xl bg-surface-container/40 p-3">
              <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-surface-container">
                {productImages[0] && <img src={imgUrl(productImages[0])} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-on-surface">{aiProductName}</div>
                {!isEdit && <div className="text-[11.5px] text-outline">{fmtCUP(product.price)}</div>}
              </div>
            </div>
            <div className="mb-4">
              <span className="mb-1.5 block text-label-md text-on-surface-variant">Imagen de la oferta</span>
              <div className="flex flex-wrap gap-2">
                {productImages.map((img) => (
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
            </div>
          </>
        ) : (
          <div className="mb-4">
            <ImageCropUploader
              value={existingImagePreview}
              aspect={aspect}
              recommendedLabel={
                orientation === "VERTICAL" ? "Tamaño recomendado: 900×1200px (vertical)" : "Tamaño recomendado: 1200×675px (horizontal)"
              }
              onFileReady={setCustomBlob}
            />
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="flex flex-col gap-3.5"
        >
          <Input label="Título" required value={title} onChange={(e) => setTitle(e.target.value)} />

          <div>
            <AiGenerateButton kind="offer" currentText={description} productName={aiProductName} onGenerated={setDescription} />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="1-2 frases que se lean rápido sobre la imagen..."
              className="min-h-[64px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none"
            />
          </div>

          <Input
            label="Frase corta (opcional)"
            placeholder="Ej: Envío gratis esta semana"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
          />
          <Input
            label="Etiqueta de descuento (opcional)"
            placeholder="Ej: -15%, 2x1"
            value={discountLabel}
            onChange={(e) => setDiscountLabel(e.target.value)}
          />

          <div>
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Orientación</span>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { v: "HORIZONTAL", l: "Horizontal" },
                { v: "VERTICAL", l: "Vertical" },
              ].map((o) => (
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
            <span className="mb-1.5 block text-label-md text-on-surface-variant">
              Duración en días {isEdit && "(déjalo vacío para no cambiarla)"}
            </span>
            <input
              type="number"
              min={1}
              max={90}
              placeholder="30"
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-[14px] outline-none"
            />
            <p className="mt-1 text-[11px] text-outline">Los clientes ven un reloj con el tiempo restante de la oferta.</p>
          </div>

          {needsRepublish && (
            <label className="flex items-start gap-2 rounded-xl bg-tertiary-accent/[0.08] p-3 text-[12.5px] text-on-surface">
              <input type="checkbox" checked={republish} onChange={(e) => setRepublish(e.target.checked)} className="mt-0.5 h-4 w-4" />
              <span>
                Volver a publicar esta oferta ahora ({STATUS_LABEL[offer.status]} → Activa).
                {!canCreateNow && nextAvailableAt && (
                  <span className="mt-1 block font-semibold text-error">
                    Ya usaste tu publicación de esta semana — disponible desde el {fmtDate(nextAvailableAt)}.
                  </span>
                )}
              </span>
            </label>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={disabledSubmit}>
              {save.isPending ? "Guardando..." : isEdit ? "Guardar cambios" : "Publicar oferta"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function VendorOffers() {
  const { vendor } = useOutletContext();
  const queryClient = useQueryClient();
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);

  const { data } = useQuery({
    queryKey: ["my-offers"],
    queryFn: async () => (await api.get("/offers/me/list")).data,
    enabled: !!vendor?.isVerified,
  });

  const cooldownRemaining = useLiveRemainingLabel(data?.canCreateNow ? null : data?.nextAvailableAt);

  const remove = useMutation({
    mutationFn: async (id) => (await api.patch(`/offers/${id}/remove`)).data,
    onSuccess: () => {
      toast.success("Oferta retirada.");
      setRemoveTarget(null);
      queryClient.invalidateQueries({ queryKey: ["my-offers"] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo retirar la oferta.");
      setRemoveTarget(null);
    },
  });

  const offers = data?.offers ?? [];
  const canCreateNow = data?.canCreateNow ?? true;

  function closeAll() {
    setTypeModalOpen(false);
    setPickerOpen(false);
    setSelectedProduct(null);
    setCustomModalOpen(false);
    setEditTarget(null);
  }
  function handleSaved() {
    closeAll();
    queryClient.invalidateQueries({ queryKey: ["my-offers"] });
  }
  function handleChooseType(type) {
    setTypeModalOpen(false);
    if (type === "product") setPickerOpen(true);
    else setCustomModalOpen(true);
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-[25px] font-bold text-on-surface">Ofertas</h1>
        <div title={!vendor?.isVerified ? "Disponible solo para tiendas verificadas" : undefined}>
          <Button
            className="rounded-xl font-bold"
            disabled={!vendor?.isVerified || !canCreateNow}
            onClick={() => setTypeModalOpen(true)}
          >
            <Plus className="mr-1 h-4 w-4" /> Agregar oferta
          </Button>
        </div>
      </div>
      <p className="mb-[22px] text-[13.5px] text-outline">
        Crea una oferta desde un producto ya cargado o una personalizada con tu propia imagen. Se muestra en el Home
        mientras esté activa. Puedes publicar/republicar una oferta nueva cada {data?.cooldownDays ?? 7} días
        {data?.defaultDurationDays ? `, activa hasta ${data.defaultDurationDays} días por default` : ""}.
      </p>

      {!vendor?.isVerified ? (
        <EmptyState
          icon={ShieldAlert}
          title="Disponible solo para tiendas verificadas"
          description="Verifica tu tienda para poder destacar tus productos con ofertas en la página principal."
          action={
            <Link
              to="/vendedor/verificacion"
              className="mt-1 inline-flex items-center gap-1.5 rounded-xl bg-secondary-container px-5 py-2.5 text-[13px] font-bold text-primary transition hover:brightness-95"
            >
              Ver planes
            </Link>
          }
        />
      ) : (
        <>
          {!canCreateNow && data?.nextAvailableAt && (
            <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl bg-[#8a5100]/[0.08] px-3.5 py-2.5 text-[12.5px] text-[#8a5100]">
              <Clock className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">
                Ya publicaste/republicaste una oferta hace poco. Puedes crear la próxima a partir del {fmtDate(data.nextAvailableAt)}.
              </span>
              {cooldownRemaining && (
                <span className="flex-shrink-0 rounded-full bg-[#8a5100]/15 px-2.5 py-1 text-[11.5px] font-bold">
                  {cooldownRemaining}
                </span>
              )}
            </div>
          )}

          {offers.length === 0 ? (
            <EmptyState
              icon={Tag}
              title="Todavía no publicaste ninguna oferta"
              description="Elige un producto o crea una personalizada — se muestra en el Home mientras esté activa."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {offers.map((o) => (
                <div key={o.id} className="overflow-hidden rounded-2xl border border-surface-container-high bg-surface-container-lowest shadow-sm">
                  <div className={`relative w-full overflow-hidden bg-surface-container ${o.orientation === "VERTICAL" ? "h-48" : "h-36"}`}>
                    <img src={imgUrl(o.imageUrl)} alt="" className="h-full w-full object-cover" />
                    <span className="absolute left-2.5 top-2.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold" style={STATUS_STYLE[o.status]}>
                      {STATUS_LABEL[o.status]}
                    </span>
                    {o.discountLabel && (
                      <span className="absolute right-2.5 top-2.5 rounded-full bg-error px-2.5 py-1 text-[10.5px] font-bold text-white">
                        {o.discountLabel}
                      </span>
                    )}
                  </div>
                  <div className="p-3.5">
                    <div className="mb-0.5 truncate text-[13.5px] font-semibold text-on-surface">{o.title}</div>
                    <div className="mb-2 truncate text-[11.5px] text-outline">
                      {CONTENT_TYPE_LABEL[o.contentType]}
                      {o.contentType === "PRODUCT" && o.product && ` · ${o.product.name}`}
                    </div>
                    <div className="mb-3 flex items-center gap-1.5 text-[11.5px] text-outline">
                      <Clock className="h-3 w-3 flex-shrink-0" />
                      {o.status === "ACTIVE" ? remainingLabel(o.expiresAt) : `Vencía el ${fmtDate(o.expiresAt)}`}
                    </div>
                    <div className="flex items-center gap-3.5">
                      {o.status !== "SUSPENDED" && (
                        <button
                          onClick={() => setEditTarget(o)}
                          className="flex items-center gap-1.5 text-[12px] font-semibold text-tertiary-accent hover:underline"
                        >
                          <Pencil className="h-3.5 w-3.5" /> Editar
                        </button>
                      )}
                      {o.status === "ACTIVE" && (
                        <button
                          onClick={() => setRemoveTarget(o)}
                          className="flex items-center gap-1.5 text-[12px] font-semibold text-error hover:underline"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Retirar
                        </button>
                      )}
                    </div>
                    {o.status === "SUSPENDED" && (
                      <p className="mt-2 text-[11px] text-error">Suspendida por el equipo de la plataforma.</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {typeModalOpen && <TypeChoiceModal onChoose={handleChooseType} onClose={closeAll} />}
      {pickerOpen && !selectedProduct && <ProductPickerModal onSelect={setSelectedProduct} onClose={closeAll} />}
      {selectedProduct && <OfferFormModal mode="create-product" product={selectedProduct} onClose={closeAll} onSaved={handleSaved} />}
      {customModalOpen && <OfferFormModal mode="create-custom" onClose={closeAll} onSaved={handleSaved} />}
      {editTarget && (
        <OfferFormModal
          mode="edit"
          offer={editTarget}
          canCreateNow={canCreateNow}
          nextAvailableAt={data?.nextAvailableAt}
          onClose={closeAll}
          onSaved={handleSaved}
        />
      )}

      <ConfirmModal
        open={!!removeTarget}
        title="¿Retirar esta oferta?"
        message="Deja de mostrarse en el Home de inmediato. No libera tu límite semanal — la próxima oferta nueva sigue contando desde la fecha en que creaste esta."
        confirmLabel={remove.isPending ? "Retirando..." : "Retirar oferta"}
        danger
        confirmDisabled={remove.isPending}
        onConfirm={() => remove.mutate(removeTarget.id)}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
