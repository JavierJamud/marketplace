import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ExternalLink, FileText, RotateCcw } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";

const PAGE_META = {
  terminos: { label: "Términos y condiciones", path: "/terminos" },
  privacidad: { label: "Política de privacidad", path: "/privacidad" },
  faq: { label: "Preguntas frecuentes", path: "/faq" },
  ayuda: { label: "Centro de ayuda", path: "/ayuda" },
  contacto: { label: "Contacto", path: "/contacto" },
};

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function EditPageModal({ page, onClose }) {
  const queryClient = useQueryClient();
  const [html, setHtml] = useState(page.htmlContent ?? "");

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
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo restaurar."),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
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
          HTML libre — se sanitiza al guardar (se sacan scripts y atributos de evento). Dejalo vacío y guardá para volver
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
            onClick={() => restore.mutate()}
            disabled={restore.isPending || save.isPending || !page.htmlContent}
            className="flex items-center gap-1.5 rounded-md border border-outline-variant px-3.5 py-2 text-[12.5px] font-semibold text-on-surface-variant disabled:opacity-40"
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
    </div>
  );
}

export default function AdminPages() {
  const [editing, setEditing] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-static-pages"],
    queryFn: async () => (await api.get("/admin/static-pages")).data.pages,
  });

  return (
    <div className="max-w-[720px]">
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Páginas</h1>
      <p className="mb-[22px] text-[13.5px] text-outline">
        Términos, privacidad, FAQ, ayuda y contacto — editá el HTML libre o dejalas con su contenido predeterminado.
      </p>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}

      <div className="overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest">
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
