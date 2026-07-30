import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Gift, Plus, X, Pencil, Power, Clock, Sparkles, ShieldAlert } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { AiGenerateButton } from "../../components/AiGenerateButton.jsx";
import { ImageCropUploader } from "../../components/ImageCropUploader.jsx";
import { DiscountCodeFormModal } from "../../components/vendor/DiscountCodeFormModal.jsx";

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtDateInput(iso) {
  const d = iso ? new Date(iso) : new Date(Date.now() + 7 * 86400000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function discountLabel(code) {
  if (!code) return "";
  return code.type === "PERCENTAGE" ? `-${Number(code.value)}%` : `-${Number(code.value).toLocaleString("es-CU")} CUP`;
}

function StoreOfferFormModal({ offer, discountCodes, siteSettings, onClose, onSaved }) {
  const isEdit = !!offer;
  const [title, setTitle] = useState(isEdit ? offer.title : "");
  const [description, setDescription] = useState(isEdit ? offer.description ?? "" : "");
  const [imageBlob, setImageBlob] = useState(null);
  const [imageLink, setImageLink] = useState("");
  const [discountCodeId, setDiscountCodeId] = useState(isEdit ? offer.discountCode.id : "");
  const [discountCodeExclusive, setDiscountCodeExclusive] = useState(isEdit ? offer.discountCodeExclusive : false);
  const [isLimitedTime, setIsLimitedTime] = useState(isEdit ? offer.isLimitedTime : false);
  const [expiresAt, setExpiresAt] = useState(fmtDateInput(isEdit ? offer.expiresAt : null));
  const [showCreateCode, setShowCreateCode] = useState(false);

  const existingImagePreview = isEdit ? imgUrl(offer.imageUrl) : null;

  const save = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("title", title.trim());
      if (description.trim()) form.append("description", description.trim());
      form.append("discountCodeId", discountCodeId);
      form.append("isLimitedTime", String(isLimitedTime));
      if (isLimitedTime) {
        form.append("expiresAt", new Date(expiresAt).toISOString());
        form.append("discountCodeExclusive", String(discountCodeExclusive));
      }
      if (imageBlob) form.append("image", imageBlob, "store-offer.jpg");
      else if (imageLink.trim()) form.append("imageUrl", imageLink.trim());

      if (isEdit) return (await api.patch(`/store-offers/${offer.id}`, form, { headers: { "Content-Type": "multipart/form-data" } })).data;
      return (await api.post("/store-offers", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      toast.success(isEdit ? "Oferta actualizada." : "Oferta publicada en tu tienda.");
      onSaved();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar la oferta."),
  });

  const missingImage = !isEdit && !imageBlob && !imageLink.trim();
  const disabledSubmit = save.isPending || !title.trim() || !discountCodeId || missingImage || (isLimitedTime && !expiresAt);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-title-lg text-on-surface">{isEdit ? "Editar oferta de tienda" : "Nueva oferta de tienda"}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-outline hover:bg-surface-variant">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4">
          <ImageCropUploader
            value={existingImagePreview}
            aspect={16 / 9}
            recommendedLabel="Tamaño recomendado: 1200×675px (horizontal)"
            onFileReady={(blob) => {
              setImageBlob(blob);
              setImageLink("");
            }}
          />
          {siteSettings?.allowProductImageLinks && (
            <input
              value={imageLink}
              onChange={(e) => {
                setImageLink(e.target.value);
                if (e.target.value) setImageBlob(null);
              }}
              placeholder="O pega el link de una imagen (https://...)"
              className="mt-2 h-9 w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-primary-container"
            />
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="flex flex-col gap-3.5"
        >
          <Input label="Título de la oferta" required value={title} onChange={(e) => setTitle(e.target.value)} />

          <div>
            <AiGenerateButton kind="offer" currentText={description} onGenerated={setDescription} />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descripción corta y persuasiva de la oferta..."
              className="min-h-[64px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none"
            />
          </div>

          <div>
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Código de descuento</span>
            <div className="flex gap-2">
              <select
                value={discountCodeId}
                onChange={(e) => setDiscountCodeId(e.target.value)}
                className="h-11 flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none"
              >
                <option value="">Elige un código...</option>
                {discountCodes?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} ({discountLabel(c)}) {c.active ? "" : "· inactivo"}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowCreateCode(true)}
                className="flex-shrink-0 rounded-md border border-outline-variant px-3.5 text-[12.5px] font-bold text-tertiary-accent hover:bg-surface-container"
              >
                + Crear nuevo
              </button>
            </div>
            {!discountCodes?.length && (
              <p className="mt-1.5 text-[11px] text-outline">Todavía no tienes códigos de descuento — crea uno para esta oferta.</p>
            )}
          </div>

          <label className="flex items-center gap-2 text-[13px] font-semibold text-on-surface">
            <input type="checkbox" checked={isLimitedTime} onChange={(e) => setIsLimitedTime(e.target.checked)} className="h-4 w-4" />
            Oferta por tiempo limitado
          </label>

          {isLimitedTime && (
            <div>
              <span className="mb-1 block text-label-sm text-outline">Vence el</span>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-2.5 text-[13px] outline-none"
              />
              {!discountCodeExclusive && (
                <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-tertiary-accent/[0.08] p-2.5 text-[11.5px] text-on-surface">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-tertiary-accent" />
                  Recomendado: usa un código exclusivo para esta oferta (con "+ Crear nuevo") — se desactiva solo cuando la oferta vence.
                  Si reusas uno existente, vos decidís cuándo desactivarlo.
                </p>
              )}
            </div>
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

      {showCreateCode && (
        <DiscountCodeFormModal
          onClose={() => setShowCreateCode(false)}
          onSaved={(createdCode) => {
            setDiscountCodeId(createdCode.id);
            setDiscountCodeExclusive(true);
            setShowCreateCode(false);
          }}
        />
      )}
    </div>
  );
}

export default function VendorStoreOffers() {
  const { vendor } = useOutletContext();
  const queryClient = useQueryClient();
  const [formTarget, setFormTarget] = useState(null); // null cerrado, {} crear, offer editar

  const { data: storeOffers, isLoading } = useQuery({
    queryKey: ["my-store-offers"],
    queryFn: async () => (await api.get("/store-offers/me/list")).data.storeOffers,
    enabled: !!vendor?.isVerified,
  });
  const { data: discountCodes } = useQuery({
    queryKey: ["my-discount-codes"],
    queryFn: async () => (await api.get("/discount-codes/me/list")).data.discountCodes,
  });
  const { data: siteSettings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }) => (await api.patch(`/store-offers/${id}`, { active })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-store-offers"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar la oferta."),
  });

  function closeForm() {
    setFormTarget(null);
  }
  function handleSaved() {
    closeForm();
    queryClient.invalidateQueries({ queryKey: ["my-store-offers"] });
    queryClient.invalidateQueries({ queryKey: ["my-discount-codes"] });
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-[25px] font-bold text-on-surface">Ofertas de tienda</h1>
          <p className="text-[12px] text-outline">Ofertas dentro de tu tienda — distintas de la sección "Ofertas" del Home.</p>
        </div>
        <div title={!vendor?.isVerified ? "Disponible solo para tiendas verificadas" : undefined}>
          <Button className="rounded-xl font-bold" disabled={!vendor?.isVerified} onClick={() => setFormTarget({})}>
            <Plus className="mr-1 h-4 w-4" /> Agregar oferta
          </Button>
        </div>
      </div>
      <p className="mb-[22px] text-[13.5px] text-outline">
        Se muestran en la página pública de tu tienda mientras estén activas. Cada una lleva un código de descuento
        asignado — puedes reusar uno ya existente o crear uno nuevo exclusivo para la oferta.
      </p>

      {!vendor?.isVerified && (
        <EmptyState
          icon={ShieldAlert}
          title="Disponible solo para tiendas verificadas"
          description="Verifica tu tienda para poder publicar ofertas dentro de tu propia página."
        />
      )}

      {vendor?.isVerified && isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}

      {vendor?.isVerified && !isLoading && !storeOffers?.length && (
        <EmptyState
          icon={Gift}
          title="Todavía no publicaste ninguna oferta de tienda"
          description="Agrega una con imagen, descripción y un código de descuento — se muestra en tu tienda mientras esté activa."
        />
      )}

      {vendor?.isVerified && storeOffers?.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {storeOffers.map((o) => (
            <div key={o.id} className="overflow-hidden rounded-2xl border border-surface-container-high bg-surface-container-lowest shadow-sm">
              <div className="relative h-36 w-full overflow-hidden bg-surface-container">
                <img src={imgUrl(o.imageUrl)} alt="" className="h-full w-full object-cover" />
                <span
                  className={`absolute left-2.5 top-2.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold ${
                    o.active ? "bg-verified/90 text-white" : "bg-surface-container-highest text-outline"
                  }`}
                >
                  {o.active ? "Activa" : "Inactiva"}
                </span>
                <span className="absolute right-2.5 top-2.5 rounded-full bg-error px-2.5 py-1 text-[10.5px] font-bold text-white">
                  {o.discountCode.code} · {discountLabel(o.discountCode)}
                </span>
              </div>
              <div className="p-3.5">
                <div className="mb-1 truncate text-[13.5px] font-semibold text-on-surface">{o.title}</div>
                {o.isLimitedTime && o.expiresAt && (
                  <div className="mb-2 flex items-center gap-1.5 text-[11.5px] text-outline">
                    <Clock className="h-3 w-3 flex-shrink-0" /> Vence el {fmtDate(o.expiresAt)}
                  </div>
                )}
                <div className="flex items-center gap-3.5">
                  <button
                    onClick={() => setFormTarget(o)}
                    className="flex items-center gap-1.5 text-[12px] font-semibold text-tertiary-accent hover:underline"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </button>
                  <button
                    onClick={() => toggleActive.mutate({ id: o.id, active: !o.active })}
                    disabled={toggleActive.isPending}
                    className="flex items-center gap-1.5 text-[12px] font-semibold text-error hover:underline disabled:opacity-50"
                  >
                    <Power className="h-3.5 w-3.5" /> {o.active ? "Retirar" : "Reactivar"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {formTarget && (
        <StoreOfferFormModal
          offer={formTarget.id ? formTarget : null}
          discountCodes={discountCodes}
          siteSettings={siteSettings}
          onClose={closeForm}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
