import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, Film, Trash2, Upload } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api, getErrorMessage } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";

// Página temporal (sin enlace en el menú): el admin sube un video, el servidor lo comprime y aquí aparece para descargar
// la versión comprimida. Los videos se borran solos a las 24 horas.
const MB = 1024 * 1024;
const formatSize = (bytes) => (bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const formatTime = (iso) => new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
// Enlace público del video comprimido: se puede pasar a otra persona y lo descarga sin cuenta mientras el video exista.
const publicLink = (id) => new URL(`${api.defaults.baseURL.replace(/\/$/, "")}/videos-temporales/${id}`, window.location.origin).href;

async function copyLink(id) {
  try {
    await navigator.clipboard.writeText(publicLink(id));
    toast.success("Enlace copiado. Quien lo tenga puede descargar el video.");
  } catch {
    window.prompt("Copia este enlace:", publicLink(id));
  }
}

export default function AdminTempVideo() {
  const queryClient = useQueryClient();
  const inputRef = useRef(null);
  const [uploadPct, setUploadPct] = useState(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-temp-videos"],
    queryFn: async () => (await api.get("/admin/temp-videos")).data,
    // Mientras haya uno comprimiéndose se pregunta cada 2 segundos para mover la barra; si no, no hace falta.
    refetchInterval: (q) => (q.state.data?.videos?.some((v) => v.status === "processing") ? 2000 : false),
  });
  const videos = data?.videos ?? [];
  const maxBytes = data?.maxBytes ?? 100 * MB;

  const upload = useMutation({
    mutationFn: async (file) => {
      const form = new FormData();
      form.append("video", file);
      return (
        await api.post("/admin/temp-videos", form, {
          timeout: 0,
          onUploadProgress: (e) => e.total && setUploadPct(Math.round((e.loaded / e.total) * 100)),
        })
      ).data;
    },
    onSuccess: () => {
      toast.success("Video subido. Se está comprimiendo.");
      queryClient.invalidateQueries({ queryKey: ["admin-temp-videos"] });
    },
    onError: async (err) => toast.error(await getErrorMessage(err, "No se pudo subir el video.")),
    onSettled: () => setUploadPct(null),
  });

  const remove = useMutation({
    mutationFn: (id) => api.delete(`/admin/temp-videos/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-temp-videos"] }),
    onError: async (err) => toast.error(await getErrorMessage(err, "No se pudo borrar.")),
  });

  function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > maxBytes) return toast.error(`Ese video pesa ${formatSize(file.size)}. El máximo es ${formatSize(maxBytes)}.`);
    upload.mutate(file);
  }

  return (
    <div className="max-w-[760px]">
      <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Comprimir video</h1>
      <p className="mb-5 mt-1 text-[13.5px] text-outline">
        Página temporal. Sube un video de hasta {formatSize(maxBytes)}: el servidor lo comprime y aquí lo descargas más liviano. Los
        videos se borran solos a las 24 horas.
      </p>
      <p className="-mt-3 mb-5 text-[13.5px] text-outline">
        Cada video tiene un enlace para compartir: quien lo reciba lo descarga sin iniciar sesión, hasta que lo borres o pasen las 24
        horas.
      </p>

      <input ref={inputRef} type="file" accept="video/*" className="sr-only" onChange={pickFile} tabIndex={-1} aria-hidden="true" />
      <Button size="lg" variant="dark" onClick={() => inputRef.current?.click()} disabled={upload.isPending} className="w-full sm:w-auto">
        <Upload className="h-5 w-5" aria-hidden="true" />
        {upload.isPending ? `Subiendo ${uploadPct ?? 0}%` : "Subir video"}
      </Button>
      {upload.isPending && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-container-high" role="progressbar" aria-valuenow={uploadPct ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label="Subida">
          <div className="h-full bg-secondary-container transition-[width]" style={{ width: `${uploadPct ?? 0}%` }} />
        </div>
      )}

      <div className="mt-7">
        {isLoading ? (
          <ListSkeleton rows={2} avatar={false} />
        ) : isError ? (
          <p className="text-[13.5px] text-error">No se pudo cargar la lista. Recarga la página.</p>
        ) : videos.length === 0 ? (
          <p className="text-[13.5px] text-outline">Todavía no hay videos. Cuando subas uno, aquí aparece el botón para descargarlo.</p>
        ) : (
          <ul className="grid gap-3">
            {videos.map((v) => (
              <li key={v.id} className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4">
                <div className="flex items-start gap-3">
                  <Film className="mt-0.5 h-5 w-5 flex-shrink-0 text-outline" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-on-surface">{v.name}</div>
                    <div className="text-[12.5px] text-outline">
                      Subido a las {formatTime(v.createdAt)} · original {formatSize(v.originalSize)}
                      {v.status === "done" && v.compressedSize != null && ` · comprimido ${formatSize(v.compressedSize)}`}
                    </div>
                  </div>
                </div>

                {v.status === "processing" && (
                  <div className="mt-3">
                    <div className="mb-1 text-[12.5px] text-on-surface-variant">Comprimiendo… {v.progress ?? 0}%</div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-container-high" role="progressbar" aria-valuenow={v.progress ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={`Compresión de ${v.name}`}>
                      <div className="h-full bg-tertiary-accent transition-[width]" style={{ width: `${v.progress ?? 0}%` }} />
                    </div>
                  </div>
                )}
                {v.status === "failed" && <p className="mt-2 text-[13px] text-error">{v.error}</p>}

                <div className="mt-3 flex flex-wrap gap-2">
                  {v.status === "done" && (
                    <>
                      <a
                        href={publicLink(v.id)}
                        download
                        className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded bg-secondary-container px-5 font-body text-label-md font-semibold text-on-secondary-container hover:brightness-95 sm:flex-none"
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                        Descargar comprimido
                      </a>
                      <Button variant="outline" onClick={() => copyLink(v.id)}>
                        <Copy className="h-4 w-4" aria-hidden="true" />
                        Copiar enlace
                      </Button>
                    </>
                  )}
                  <Button variant="outline" onClick={() => remove.mutate(v.id)} disabled={remove.isPending && remove.variables === v.id} aria-label={`Borrar ${v.name}`}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Borrar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
