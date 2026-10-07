import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, X } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { ConfirmModal } from "../ConfirmModal.jsx";

// Bloque 279 (pedido explícito — "la sección Imagen principal del sitio, que estaba al final del
// Dashboard, se mueve a Mi perfil > Marca de la plataforma, donde viven las configuraciones
// generales"): imágenes del hero de la Home. Cambiarlas pide el código de confirmación del admin.
export function HeroImagesCard() {
  const queryClient = useQueryClient();
  const fileRef = useRef(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const { data: settings } = useQuery({ queryKey: ["site-settings"], queryFn: async () => (await api.get("/settings")).data.settings });
  const heroImages = settings?.heroImages ?? [];

  const uploadHero = useMutation({
    mutationFn: async (files) => {
      const form = new FormData();
      for (const f of files) form.append("images", f);
      return (await api.post("/admin/settings/hero-images", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: (_data, files) => {
      toast.success(files.length > 1 ? "Imágenes agregadas al hero." : "Imagen agregada al hero.");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => {
      if (!err.actionCodeCancelled) toast.error(err.response?.data?.error ?? "No se pudieron subir las imágenes.");
    },
  });

  const removeHero = useMutation({
    mutationFn: async (url) => (await api.delete("/admin/settings/hero-images", { data: { url } })).data,
    onSuccess: () => {
      setRemoveTarget(null);
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => {
      setRemoveTarget(null);
      if (!err.actionCodeCancelled) toast.error(err.response?.data?.error ?? "No se pudo eliminar la imagen.");
    },
  });

  function handleFileChange(e) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    uploadHero.mutate(files);
    e.target.value = "";
  }

  return (
    <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
        <ImagePlus className="h-4 w-4 text-tertiary-accent" aria-hidden="true" /> Imagen principal del sitio
      </div>
      <p className="mb-1 text-[12.5px] text-outline">Se muestra en la primera sección (hero) de la Home para todos los visitantes. Una a la vez, con un fundido automático. Si subes más de una, abajo del hero aparecen puntos que marcan cuántas hay. Si no subes ninguna, se usa un placeholder.</p>
      <p className="mb-4 text-[12.5px] text-outline">
        Tamaño recomendado: <strong>1200×800px</strong> o más grande, en relación <strong>3:2</strong>. Cada imagen se ajusta completa al recuadro sin deformarse ni recortarse; si tiene otra relación de aspecto, queda centrada con el sobrante relleno.
      </p>
      <div className="flex flex-wrap gap-2.5">
        {heroImages.map((url) => (
          <div key={url} className="group relative h-[90px] w-[130px] flex-shrink-0 overflow-hidden rounded-xl border border-surface-container-high bg-surface-container">
            <img src={`${api.defaults.baseURL}${url}`} alt="" className="h-full w-full object-contain" />
            <button
              type="button"
              onClick={() => setRemoveTarget(url)}
              disabled={removeHero.isPending}
              aria-label="Quitar esta imagen del hero"
              className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-white sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploadHero.isPending}
          className="flex h-[90px] w-[130px] flex-shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-outline-variant text-on-secondary-container transition-colors hover:bg-surface-container/40 disabled:opacity-50"
        >
          <ImagePlus className="h-5 w-5" aria-hidden="true" />
          <span className="text-[12px] font-bold">{uploadHero.isPending ? "Subiendo..." : "Agregar imagen(es)"}</span>
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={handleFileChange} />
      </div>

      <ConfirmModal
        open={!!removeTarget}
        title="¿Eliminar esta imagen del hero?"
        message="Se quita del slider de la Home de inmediato. Esta acción no se puede deshacer."
        confirmLabel={removeHero.isPending ? "Eliminando..." : "Sí, eliminar"}
        danger
        onConfirm={() => removeHero.mutate(removeTarget)}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
