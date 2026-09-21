import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { ExternalLink, FileText, RotateCcw } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { UnsavedChangesModal } from "../../components/UnsavedChangesModal.jsx";
import { useDirtyModal } from "../../lib/useDirtyModal.js";

// Bloque 53: esta sección quedó SOLO para Términos/Privacidad — FAQ pasó a
// tener su propia sección con CRUD real (ver AdminFaq.jsx), y Contacto/Ayuda
// a sus propias páginas de edición (AdminContacto.jsx/AdminAyuda.jsx),
// aunque sigan usando el mismo mecanismo de StaticPage por debajo.
const PAGE_META = {
  terminos: { label: "Términos y condiciones", path: "/terminos" },
  privacidad: { label: "Política de privacidad", path: "/privacidad" },
};

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function EditPageModal({ page, onClose }) {
  const queryClient = useQueryClient();
  const [html, setHtml] = useState(page.htmlContent ?? "");
  const [confirmingRestore, setConfirmingRestore] = useState(false);

  // Bloque 196 (pedido explícito — "si se hace clic fuera de un contenedor
  // mostrado como ventana o popup en el panel debe cerrarse automáticamente,
  // y si necesita que guarden datos debe preguntar si desea guardar o
  // descartar antes de cerrar"): solo `html` es el borrador — "Restaurar
  // predeterminado" es su propia acción inmediata (con su propio confirm),
  // no pasa por acá.
  const initialHtmlSnapshot = useRef(html);
  const isDirty = html !== initialHtmlSnapshot.current;

  const save = useMutation({
    mutationFn: async () => (await api.put(`/admin/static-pages/${page.slug}`, { htmlContent: html })).data,
    onSuccess: () => {
      toast.success("Página actualizada.");
      queryClient.invalidateQueries({ queryKey: ["admin-static-pages"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  const restore = useMutation({
    mutationFn: async () => (await api.put(`/admin/static-pages/${page.slug}`, { htmlContent: null })).data,
    onSuccess: () => {
      toast.success("Se restauró el contenido predeterminado.");
      queryClient.invalidateQueries({ queryKey: ["admin-static-pages"] });
      onClose();
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo restaurar.");
      setConfirmingRestore(false);
    },
  });

  // Bloque 196: sin ninguna validación extra — "Guardar y salir" siempre
  // está disponible acá.
  const dirtyModal = useDirtyModal({ isDirty, onClose, onSave: () => save.mutateAsync() });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={dirtyModal.handleBackdropClick}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-surface-container-lowest p-6">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-title-lg font-bold text-on-surface">{PAGE_META[page.slug].label}</h2>
          <a
            href={PAGE_META[page.slug].path}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-[12.5px] font-semibold text-tertiary-accent hover:underline"
          >
            Ver página pública <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <p className="mb-3 text-[12.5px] text-outline">
          HTML libre — se sanitiza al guardar (se sacan scripts y atributos de evento). Déjalo vacío y guarda para volver
          al contenido predeterminado.
        </p>
        <textarea
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          placeholder="<h1>Título</h1>\n<p>Contenido...</p>"
          className="min-h-[360px] flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest p-3.5 font-mono text-[12.5px] outline-none focus:border-tertiary-accent"
        />
        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            onClick={() => setConfirmingRestore(true)}
            disabled={restore.isPending || save.isPending || !page.htmlContent}
            className="flex items-center gap-1.5 rounded-full border border-outline-variant px-3.5 py-2 text-[12.5px] font-semibold text-on-surface-variant disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Restaurar predeterminado
          </button>
          <div className="flex gap-2.5">
            <Button variant="outline" onClick={onClose} disabled={save.isPending || restore.isPending}>Cancelar</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || restore.isPending}>
              {save.isPending ? "Guardando..." : "Guardar cambios"}
            </Button>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmingRestore}
        title={`¿Restaurar "${PAGE_META[page.slug].label}" al contenido predeterminado?`}
        message="Se pierde el HTML editado de esta página. Esta acción no se puede deshacer."
        confirmLabel={restore.isPending ? "Restaurando..." : "Sí, restaurar"}
        danger
        onConfirm={() => restore.mutate()}
        onCancel={() => setConfirmingRestore(false)}
      />

      <UnsavedChangesModal
        open={dirtyModal.confirming}
        saving={dirtyModal.saving}
        onSave={dirtyModal.handleSaveAndClose}
        onDiscard={dirtyModal.handleDiscard}
        onCancel={dirtyModal.handleKeepEditing}
      />
    </div>
  );
}

export default function AdminPages() {
  const [editing, setEditing] = useState(null);

  const { data: allPages, isLoading } = useQuery({
    queryKey: ["admin-static-pages"],
    queryFn: async () => (await api.get("/admin/static-pages")).data.pages,
  });
  // El backend todavía devuelve "ayuda"/"contacto" en esta misma lista (own
  // StaticPage por debajo) — pero esta pantalla ahora solo gestiona las
  // slugs de PAGE_META (Términos/Privacidad); las otras dos tienen su
  // propia sección de menú (AdminContacto.jsx/AdminAyuda.jsx).
  const data = allPages?.filter((p) => p.slug in PAGE_META);

  return (
    <div className="max-w-[720px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={FileText} tone="teal" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Términos y privacidad</h1>
      </div>
      <p className="mb-[22px] text-[13.5px] text-outline">
        Edita el HTML libre de estas dos páginas legales, o déjalas con su contenido predeterminado.
      </p>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}

      <div className="overflow-hidden rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
        {data?.map((p) => (
          <div key={p.slug} className="flex items-center gap-3 border-b border-surface-container px-4 py-3.5 last:border-b-0">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-tertiary-accent/10">
              <FileText className="h-4 w-4 text-tertiary-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold text-on-surface">{PAGE_META[p.slug].label}</div>
              <div className="text-[11.5px] text-outline">
                {p.htmlContent ? `Editada · ${fmtDate(p.updatedAt)}` : "Predeterminada"}
              </div>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                p.htmlContent ? "bg-tertiary-accent/10 text-tertiary-accent" : "bg-surface-container text-outline"
              }`}
            >
              {p.htmlContent ? "Editada" : "Predeterminada"}
            </span>
            <button onClick={() => setEditing(p)} className="rounded-[7px] bg-surface-container px-3 py-1.5 text-[12px] font-semibold text-on-surface-variant">
              Editar
            </button>
          </div>
        ))}
      </div>

      {editing && <EditPageModal page={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
