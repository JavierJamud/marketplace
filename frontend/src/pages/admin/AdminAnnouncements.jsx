import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Plus, Pencil, Trash2, ImagePlus } from "lucide-react";
import { api } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";

const PAGE_LABEL = { HOME: "Inicio", STORES: "Tiendas", ALL: "Todo el sitio" };
const POSITION_LABEL = { HERO: "Hero", TOP_BAR: "Franja superior" };

function fmtDateInput(iso) {
  // datetime-local necesita "YYYY-MM-DDTHH:mm" en hora local, sin offset.
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDateLabel(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" });
}

function todayLocal() {
  return fmtDateInput(new Date());
}
function inAWeekLocal() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return fmtDateInput(d);
}

function computeState(a) {
  const now = new Date();
  if (!a.isActive) return { label: "Inactivo", bg: "#f0edee", color: "#75777c" };
  if (new Date(a.endAt) < now) return { label: "Vencido", bg: "#f0edee", color: "#75777c" };
  if (new Date(a.startAt) > now) return { label: "Programado", bg: "rgba(254,152,0,0.15)", color: "#8A5100" };
  return { label: "En vivo", bg: "rgba(12,174,83,0.12)", color: "#0A8F42" };
}

function AnnouncementModal({ announcement, onClose }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(announcement?.title ?? "");
  const [body, setBody] = useState(announcement?.body ?? "");
  const [page, setPage] = useState(announcement?.page ?? "HOME");
  const [position, setPosition] = useState(announcement?.position ?? "HERO");
  const [startAt, setStartAt] = useState(announcement ? fmtDateInput(announcement.startAt) : todayLocal());
  const [endAt, setEndAt] = useState(announcement ? fmtDateInput(announcement.endAt) : inAWeekLocal());
  const [isActive, setIsActive] = useState(announcement?.isActive ?? true);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(announcement?.imageUrl ? `${api.defaults.baseURL}${announcement.imageUrl}` : null);

  function handleFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  const save = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("title", title);
      form.append("body", body);
      form.append("page", page);
      form.append("position", position);
      form.append("startAt", new Date(startAt).toISOString());
      form.append("endAt", new Date(endAt).toISOString());
      form.append("isActive", String(isActive));
      if (file) form.append("image", file);
      return announcement
        ? (await api.patch(`/admin/announcements/${announcement.id}`, form, { headers: { "Content-Type": "multipart/form-data" } })).data
        : (await api.post("/admin/announcements", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      toast.success(announcement ? "Anuncio actualizado." : "Anuncio creado.");
      queryClient.invalidateQueries({ queryKey: ["admin-announcements"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el anuncio."),
  });

  const invalidRange = new Date(endAt) <= new Date(startAt);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-surface-container-lowest p-6">
        <h2 className="mb-4 text-title-lg font-bold text-on-surface">{announcement ? "Editar anuncio" : "Nuevo anuncio"}</h2>

        <div className="flex flex-col gap-3.5">
          <Input label="Título" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Envío gratis esta semana" />

          <div>
            <span className="mb-1 block text-label-md text-on-surface-variant">Texto (opcional)</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Detalle corto del anuncio..."
              className="min-h-[70px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest p-3 text-[14px] outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="mb-1 block text-label-md text-on-surface-variant">Página</span>
              <select value={page} onChange={(e) => setPage(e.target.value)} className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-2.5 text-[14px] outline-none">
                {Object.entries(PAGE_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <span className="mb-1 block text-label-md text-on-surface-variant">Posición</span>
              <select value={position} onChange={(e) => setPosition(e.target.value)} className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-2.5 text-[14px] outline-none">
                {Object.entries(POSITION_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="mb-1 block text-label-md text-on-surface-variant">Desde</span>
              <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-2.5 text-[13px] outline-none" />
            </div>
            <div>
              <span className="mb-1 block text-label-md text-on-surface-variant">Hasta</span>
              <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-2.5 text-[13px] outline-none" />
            </div>
          </div>
          {invalidRange && <p className="text-[11.5px] font-semibold text-error">"Hasta" tiene que ser posterior a "Desde".</p>}

          <div>
            <span className="mb-1 block text-label-md text-on-surface-variant">Imagen (opcional)</span>
            <label className="flex h-[110px] w-full cursor-pointer items-center justify-center overflow-hidden rounded border border-dashed border-outline-variant bg-surface-container">
              {preview ? (
                <img src={preview} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex flex-col items-center gap-1 text-outline">
                  <ImagePlus className="h-5 w-5" />
                  <span className="text-[11.5px]">Subir imagen</span>
                </span>
              )}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} className="hidden" />
            </label>
          </div>

          <label className="flex items-center gap-2 text-[13px] font-semibold text-on-surface">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4" />
            Activo
          </label>
        </div>

        <div className="mt-5 flex gap-2.5">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={save.isPending}>Cancelar</Button>
          <Button className="flex-1" disabled={!title.trim() || invalidRange || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AdminAnnouncements() {
  const queryClient = useQueryClient();
  const [modalState, setModalState] = useState(null); // null | {} | announcement
  const [toDelete, setToDelete] = useState(null);

  const { data: announcements, isLoading } = useQuery({
    queryKey: ["admin-announcements"],
    queryFn: async () => (await api.get("/admin/announcements")).data.announcements,
  });

  const toggleActive = useMutation({
    mutationFn: async (a) => {
      const form = new FormData();
      form.append("isActive", String(!a.isActive));
      return (await api.patch(`/admin/announcements/${a.id}`, form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-announcements"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar."),
  });

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/admin/announcements/${id}`),
    onSuccess: () => {
      toast.success("Anuncio eliminado.");
      queryClient.invalidateQueries({ queryKey: ["admin-announcements"] });
      setToDelete(null);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo eliminar el anuncio."),
  });

  return (
    <div className="max-w-[900px]">
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Anuncios</h1>
      <p className="mb-2 text-[13.5px] text-outline">
        Banners programados para el Home o Tiendas del sitio público — solo se muestran dentro de su rango de fechas y con "Activo" encendido.
      </p>
      <div className="mb-[22px] rounded-[10px] bg-tertiary-accent/[0.08] px-3.5 py-2.5 text-[12px] text-tertiary-accent">
        💡 Nada acá es solo decorativo: el Home y Tiendas públicos consultan esta lista en vivo, así que crear/editar/desactivar un anuncio se ve reflejado ahí de inmediato.
      </div>

      <div className="mb-[18px] flex justify-end">
        <button
          onClick={() => setModalState({})}
          className="flex items-center gap-1.5 rounded-md bg-secondary-container px-3.5 py-2 text-[12.5px] font-bold text-on-secondary-container"
        >
          <Plus className="h-3.5 w-3.5" /> Nuevo anuncio
        </button>
      </div>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}

      <div className="overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest">
        {announcements?.map((a) => {
          const state = computeState(a);
          return (
            <div key={a.id} className="flex items-center gap-3 border-b border-surface-container px-4 py-3 last:border-b-0">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-container">
                {a.imageUrl ? (
                  <img src={`${api.defaults.baseURL}${a.imageUrl}`} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus className="h-4 w-4 text-outline" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold text-on-surface">{a.title}</div>
                <div className="text-[11.5px] text-outline">
                  {PAGE_LABEL[a.page]} · {POSITION_LABEL[a.position]} · {fmtDateLabel(a.startAt)} – {fmtDateLabel(a.endAt)}
                </div>
              </div>
              <button
                onClick={() => toggleActive.mutate(a)}
                className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                style={{ background: state.bg, color: state.color }}
              >
                {state.label}
              </button>
              <button onClick={() => setModalState(a)} className="text-tertiary-accent">
                <Pencil className="h-4 w-4" />
              </button>
              <button onClick={() => setToDelete(a)} className="text-error">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
        {!isLoading && !announcements?.length && <p className="p-4 text-body-md text-on-surface-variant">Todavía no hay anuncios cargados.</p>}
      </div>

      {modalState && <AnnouncementModal announcement={modalState.id ? modalState : null} onClose={() => setModalState(null)} />}
      {toDelete && (
        <ConfirmDeleteModal
          title={`¿Eliminar "${toDelete.title}"?`}
          description="El banner deja de mostrarse en el sitio público de inmediato."
          pending={remove.isPending}
          onConfirm={() => remove.mutate(toDelete.id)}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  );
}
