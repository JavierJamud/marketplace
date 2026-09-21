import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { ExternalLink, RotateCcw, FileText } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button } from "../ui/Button.jsx";
import { ConfirmModal } from "../ConfirmModal.jsx";
import { IconCircle } from "../dashboard/DashboardCard.jsx";

// Bloque 53: editor de una sola página estática (Contacto, Centro de ayuda)
// — antes vivían mezcladas en la lista genérica de AdminPages.jsx junto con
// Términos/Privacidad/FAQ; ahora cada una tiene su propia sección de menú,
// así que el editor se muestra directo en la página en vez de dentro de un
// modal sobre una lista de 1 fila. Comparte la misma queryKey
// "admin-static-pages" que AdminPages.jsx — es el mismo endpoint
// (GET /admin/static-pages trae las 4 slugs restantes), así que ambas
// pantallas comparten caché sin pedirlo dos veces.
export function StaticPageEditor({ slug, label, publicPath, helpText, icon = FileText }) {
  const queryClient = useQueryClient();
  const [html, setHtml] = useState("");
  const [confirmingRestore, setConfirmingRestore] = useState(false);

  const { data: pages, isLoading } = useQuery({
    queryKey: ["admin-static-pages"],
    queryFn: async () => (await api.get("/admin/static-pages")).data.pages,
  });
  const page = pages?.find((p) => p.slug === slug);

  useEffect(() => {
    if (page) setHtml(page.htmlContent ?? "");
  }, [page?.htmlContent]);

  const save = useMutation({
    mutationFn: async () => (await api.put(`/admin/static-pages/${slug}`, { htmlContent: html })).data,
    onSuccess: () => {
      toast.success("Página actualizada.");
      queryClient.invalidateQueries({ queryKey: ["admin-static-pages"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  const restore = useMutation({
    mutationFn: async () => (await api.put(`/admin/static-pages/${slug}`, { htmlContent: null })).data,
    onSuccess: () => {
      toast.success("Se restauró el contenido predeterminado.");
      setConfirmingRestore(false);
      queryClient.invalidateQueries({ queryKey: ["admin-static-pages"] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo restaurar.");
      setConfirmingRestore(false);
    },
  });

  return (
    <div className="max-w-[820px]">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <IconCircle icon={icon} tone="teal" />
          <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">{label}</h1>
        </div>
        <a
          href={publicPath}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-[12.5px] font-semibold text-tertiary-accent hover:underline"
        >
          Ver página pública <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      <p className="mb-[22px] text-[13.5px] text-outline">
        {helpText} HTML libre — se sanitiza al guardar (se sacan scripts y atributos de evento). Déjalo vacío y guarda
        para volver al contenido predeterminado.
        {page?.htmlContent && (
          <span className="ml-1.5 rounded-full bg-tertiary-accent/10 px-2 py-0.5 text-[11px] font-bold text-tertiary-accent">Editada</span>
        )}
      </p>

      {isLoading ? (
        <p className="text-body-md text-on-surface-variant">Cargando...</p>
      ) : (
        <>
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            placeholder="<h1>Título</h1>\n<p>Contenido...</p>"
            className="min-h-[380px] w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3.5 font-mono text-[12.5px] outline-none focus:border-tertiary-accent"
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <button
              onClick={() => setConfirmingRestore(true)}
              disabled={restore.isPending || save.isPending || !page?.htmlContent}
              className="flex items-center gap-1.5 rounded-md border border-outline-variant px-3.5 py-2 text-[12.5px] font-semibold text-on-surface-variant disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Restaurar predeterminado
            </button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || restore.isPending}>
              {save.isPending ? "Guardando..." : "Guardar cambios"}
            </Button>
          </div>
        </>
      )}

      <ConfirmModal
        open={confirmingRestore}
        title={`¿Restaurar "${label}" al contenido predeterminado?`}
        message="Se pierde el HTML editado de esta página. Esta acción no se puede deshacer."
        confirmLabel={restore.isPending ? "Restaurando..." : "Sí, restaurar"}
        danger
        onConfirm={() => restore.mutate()}
        onCancel={() => setConfirmingRestore(false)}
      />
    </div>
  );
}
