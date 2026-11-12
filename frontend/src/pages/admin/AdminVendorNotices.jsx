import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { api, getErrorMessage } from "../../lib/api.js";
import toast from "../../lib/toast.jsx";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import ToggleSwitch from "../../components/admin/ToggleSwitch.jsx";
import { StorePicker } from "../../components/admin/StorePicker.jsx";

// Admin > Avisos a tiendas: un pop-up con HTML que les sale a los dueños de tienda al entrar a su panel, entre dos fechas
// y como mucho N veces por tienda (backend: controllers/vendorPanelNotices.controller.js).

const AUDIENCE = {
  ALL: "Todas las tiendas",
  WHATSAPP_OFF: "Solo tiendas sin avisos por WhatsApp",
  SELECTED: "Solo las tiendas que elijo",
};

const pad = (n) => String(n).padStart(2, "0");
// datetime-local trabaja en hora local, sin zona.
function toInput(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const inDays = (n) => toInput(Date.now() + n * 24 * 60 * 60 * 1000);
const dateLabel = (v) => new Date(v).toLocaleString("es", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function stateOf(n) {
  const now = Date.now();
  if (!n.isActive) return { label: "Apagado", cls: "bg-surface-container text-on-surface-variant" };
  if (new Date(n.endAt).getTime() <= now) return { label: "Terminado", cls: "bg-surface-container text-on-surface-variant" };
  if (new Date(n.startAt).getTime() > now) return { label: "Programado", cls: "bg-secondary/15 text-on-surface" };
  return { label: "Se está mostrando", cls: "bg-verified/15 text-verified-dark" };
}

// Aviso ya redactado para presentar los avisos por WhatsApp. El admin lo revisa y lo guarda.
const WHATSAPP_TEMPLATE = {
  title: "Ahora tus pedidos te llegan también por WhatsApp",
  html: [
    "<p>Baznova te puede avisar por <strong>WhatsApp</strong> cuando entra un pedido nuevo, cuando un producto se está agotando o cuando un cliente te escribe. Te llega aunque tengas el panel abierto y no estés mirando la pantalla.</p>",
    "<p><strong>Cómo activarlo:</strong></p>",
    "<ol>",
    "<li>Toca <strong>Activar ahora</strong>.</li>",
    "<li>En «Avisos de la tienda por WhatsApp», enciende el interruptor.</li>",
    "<li>Escribe el código de 6 números que te llega a tu WhatsApp.</li>",
    "</ol>",
    "<p>Ahí también te llegará el resumen de tu semana. Puedes apagarlo cuando quieras desde tu perfil.</p>",
  ].join("\n"),
  ctaLabel: "Activar ahora",
  ctaUrl: "/vendedor/perfil#avisos-whatsapp",
  audience: "WHATSAPP_OFF",
  maxViews: 3,
};

const emptyForm = () => ({
  title: "", html: "", ctaLabel: "", ctaUrl: "", audience: "ALL", stores: [],
  startAt: inDays(0), endAt: inDays(14), maxViews: 3, isActive: true,
});

// Vista previa en un marco sin scripts: el HTML aún no pasó por la limpieza del servidor.
function Preview({ title, html }) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:20px;font:14px/1.6 system-ui,sans-serif;color:#45474c}
    h1,h2,h3{color:#1b1c1d;line-height:1.25} strong{color:#1b1c1d} a{color:#00696f}
    img{max-width:100%;height:auto;border-radius:12px} .t{font-size:19px;font-weight:700;color:#1b1c1d;margin:0 0 8px}
  </style></head><body><p class="t"></p>${html}</body></html>`;
  return (
    <iframe
      title="Vista previa del aviso"
      sandbox=""
      srcDoc={doc.replace('<p class="t"></p>', `<p class="t">${title.replace(/[<>&]/g, "")}</p>`)}
      className="h-[460px] w-full rounded-xl border border-surface-container-high bg-white"
    />
  );
}

function NoticeEditor({ notice, onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() =>
    notice
      ? {
        ...notice, ctaLabel: notice.ctaLabel ?? "", ctaUrl: notice.ctaUrl ?? "", stores: notice.selectedStores ?? [],
        startAt: toInput(notice.startAt), endAt: toInput(notice.endAt),
      }
      : emptyForm()
  );
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: form.title, html: form.html, ctaLabel: form.ctaLabel || null, ctaUrl: form.ctaUrl || null, audience: form.audience,
        vendorIds: form.audience === "SELECTED" ? form.stores.map((v) => v.id) : [],
        startAt: new Date(form.startAt).toISOString(), endAt: new Date(form.endAt).toISOString(),
        maxViews: Number(form.maxViews), isActive: form.isActive,
      };
      return notice ? api.patch(`/admin/vendor-notices/${notice.id}`, body) : api.post("/admin/vendor-notices", body);
    },
    onSuccess: () => {
      toast.success(notice ? "Aviso guardado" : "Aviso creado");
      queryClient.invalidateQueries({ queryKey: ["admin-vendor-notices"] });
      onClose();
    },
    onError: async (err) => toast.error(await getErrorMessage(err, "No se pudo guardar el aviso.")),
  });

  return (
    <form
      className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5 shadow-sm sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[17px] font-bold text-on-surface">{notice ? "Editar aviso" : "Nuevo aviso"}</h2>
        {!notice && (
          <Button type="button" size="sm" variant="outline" onClick={() => setForm((f) => ({ ...f, ...WHATSAPP_TEMPLATE }))}>
            Usar el aviso de WhatsApp
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Input label="Título" required maxLength={120} value={form.title} onChange={set("title")} />
          <label className="block">
            <span className="mb-1 block text-label-md text-on-surface-variant">Contenido (HTML) <span className="text-error">*</span></span>
            <textarea
              required
              rows={9}
              value={form.html}
              onChange={set("html")}
              spellCheck={false}
              className="w-full resize-y rounded border border-outline-variant bg-surface-container-lowest p-3 font-mono text-[12.5px] leading-5 outline-none focus:border-tertiary-accent"
            />
            <span className="mt-1 block text-[12px] text-on-surface-variant">
              Párrafos, negritas, listas, enlaces e imágenes. Los scripts, formularios y estilos de página se quitan al guardar.
            </span>
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Texto del botón" maxLength={40} value={form.ctaLabel} onChange={set("ctaLabel")} placeholder="Activar ahora" />
            <Input label="Enlace del botón" maxLength={300} value={form.ctaUrl} onChange={set("ctaUrl")} placeholder="/vendedor/perfil" />
          </div>
          <p className="-mt-2 text-[12px] text-on-surface-variant">Opcional. Una página del panel (empieza por /) o una dirección https. Sin botón, el aviso muestra «Entendido».</p>
          <label className="block">
            <span className="mb-1 block text-label-md text-on-surface-variant">A quién</span>
            <select value={form.audience} onChange={set("audience")} className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-2.5 text-[14px] outline-none">
              {Object.entries(AUDIENCE).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          {form.audience === "SELECTED" && (
            <StorePicker value={form.stores} onChange={(stores) => setForm((f) => ({ ...f, stores }))} />
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Desde" type="datetime-local" required value={form.startAt} onChange={set("startAt")} />
            <Input label="Hasta" type="datetime-local" required value={form.endAt} onChange={set("endAt")} />
          </div>
          <div>
            <Input label="Veces que lo ve cada tienda" type="number" inputMode="numeric" min={1} max={50} required value={form.maxViews} onChange={set("maxViews")} />
            <p className="mt-1 text-[12px] text-on-surface-variant">Cuenta una vez por cada entrada al panel. Si la tienda toca el botón o «No volver a mostrar», deja de salirle.</p>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-label-md text-on-surface">Aviso encendido</span>
            <ToggleSwitch isActive={form.isActive} label="Aviso encendido" onToggle={() => setForm((f) => ({ ...f, isActive: !f.isActive }))} />
          </div>
        </div>
        <div>
          <span className="mb-1 block text-label-md text-on-surface-variant">Vista previa</span>
          <Preview title={form.title} html={form.html} />
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Guardando..." : "Guardar aviso"}</Button>
        <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
      </div>
    </form>
  );
}

export default function AdminVendorNotices() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null); // null | "new" | notice
  const [deleting, setDeleting] = useState(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-vendor-notices"],
    queryFn: () => api.get("/admin/vendor-notices").then((r) => r.data.notices),
  });
  const remove = useMutation({
    mutationFn: (id) => api.delete(`/admin/vendor-notices/${id}`),
    onSuccess: () => {
      toast.success("Aviso eliminado");
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["admin-vendor-notices"] });
    },
    onError: async (err) => toast.error(await getErrorMessage(err, "No se pudo eliminar.")),
  });

  return (
    <div className="max-w-[1100px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Megaphone} tone="teal" />
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Avisos a tiendas</h1>
      </div>
      <p className="mb-5 text-body-md text-on-surface-variant">
        Un aviso que les sale a los dueños de tienda al entrar a su panel, entre las fechas que elijas y las veces que elijas.
      </p>

      {editing ? (
        <NoticeEditor notice={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      ) : (
        <Button className="mb-5" onClick={() => setEditing("new")}><Plus className="h-4 w-4" aria-hidden="true" /> Nuevo aviso</Button>
      )}

      {!editing && (
        isLoading ? (
          <ListSkeleton rows={3} avatar={false} label="Cargando avisos" />
        ) : isError ? (
          <div className="flex flex-wrap items-center gap-3 text-[13.5px] text-on-surface-variant">
            No se pudieron cargar los avisos.
            <Button size="sm" variant="outline" onClick={() => refetch()}>Reintentar</Button>
          </div>
        ) : data.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-outline-variant px-5 py-10 text-center text-[13.5px] text-on-surface-variant">
            Todavía no hay avisos. Crea uno o usa el aviso de WhatsApp ya redactado.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.map((n) => {
              const state = stateOf(n);
              return (
                <li key={n.id} className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 shadow-sm sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${state.cls}`}>{state.label}</span>
                        <span className="text-[12px] text-on-surface-variant">
                          {n.audience === "SELECTED"
                            ? `Solo ${n.selectedStores.length === 1 ? n.selectedStores[0].companyName : `${n.selectedStores.length} tiendas elegidas`}`
                            : AUDIENCE[n.audience]}
                        </span>
                      </div>
                      <h2 className="break-words text-[15px] font-bold text-on-surface">{n.title}</h2>
                      <p className="mt-1 text-[12.5px] text-on-surface-variant">
                        Del {dateLabel(n.startAt)} al {dateLabel(n.endAt)} · hasta {n.maxViews} {n.maxViews === 1 ? "vez" : "veces"} por tienda
                      </p>
                      <p className="mt-1 text-[12.5px] text-on-surface">
                        Lo vieron {n.stores} {n.stores === 1 ? "tienda" : "tiendas"} ({n.shown} {n.shown === 1 ? "vez" : "veces"} en total) · {n.clicked} {n.clicked === 1 ? "tocó" : "tocaron"} el botón o «No volver a mostrar»
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button type="button" onClick={() => setEditing(n)} aria-label={`Editar ${n.title}`} className="flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => setDeleting(n)} aria-label={`Eliminar ${n.title}`} className="flex h-11 w-11 items-center justify-center rounded-full text-error hover:bg-error/10">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      )}

      {deleting && (
        <ConfirmDeleteModal
          title="¿Eliminar este aviso?"
          description={`«${deleting.title}» deja de salir a las tiendas y se borra la cuenta de quién lo vio.`}
          pending={remove.isPending}
          onConfirm={() => remove.mutate(deleting.id)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
