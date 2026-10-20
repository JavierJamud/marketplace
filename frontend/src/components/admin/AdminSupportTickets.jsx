import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, ChevronDown, ImageOff, MousePointerClick, Navigation, Search, Server, Store, Terminal } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { exactDate, exactDateTime, timeAgo } from "../../lib/relativeTime.js";
import { Lightbox } from "../ui/Lightbox.jsx";
import { CardListSkeleton, ListSkeleton } from "../ui/Skeleton.jsx";

// Tickets de errores visuales que mandan las tiendas desde su panel (botón "Reportar un problema"). Lista con filtros y, al
// abrir uno: la captura de lo que veía la persona, su explicación, la copia de su consola, lo último que hizo, sus datos y
// el historial de respuestas. Cada respuesta llega por correo a quien reportó.
export const TICKET_STATUS = {
  NEW: { label: "Nuevo", tone: "bg-error/10 text-error" },
  IN_REVIEW: { label: "En revisión", tone: "bg-tertiary-accent/10 text-tertiary-accent" },
  WAITING_REPORTER: { label: "Esperando a la tienda", tone: "bg-secondary-container/30 text-on-surface" },
  RESOLVED: { label: "Solucionado", tone: "bg-verified/10 text-verified-dark" },
  CLOSED_NO_EVIDENCE: { label: "Cerrado sin evidencia", tone: "bg-surface-container text-on-surface-variant" },
  CLOSED_NOT_A_BUG: { label: "Cerrado: no es un error", tone: "bg-surface-container text-on-surface-variant" },
};
const FILTERS = [
  ["open", "Abiertos"],
  ["NEW", "Nuevos"],
  ["IN_REVIEW", "En revisión"],
  ["WAITING_REPORTER", "Esperando a la tienda"],
  ["closed", "Cerrados"],
  ["all", "Todos"],
];
// Respuestas listas para los cierres más comunes (el admin las puede editar antes de enviar).
const NO_EVIDENCE_TEXT = "No pudimos ver el problema en la captura: el reporte se envió desde otra pantalla o la imagen no muestra el error. Si sigue pasando, envía un reporte nuevo desde la pantalla exacta donde lo ves.";

export function StatusChip({ status }) {
  const s = TICKET_STATUS[status] ?? TICKET_STATUS.NEW;
  return <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${s.tone}`}>{s.label}</span>;
}

export default function AdminSupportTickets() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("ticket");
  const [filter, setFilter] = useState("open");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-support-tickets", filter, query],
    queryFn: async () => (await api.get("/admin/support-tickets", { params: { status: filter, q: query || undefined } })).data,
  });

  const open = (id) => {
    const next = new URLSearchParams(params);
    if (id) next.set("ticket", id);
    else next.delete("ticket");
    setParams(next);
  };

  if (selected) return <TicketDetail id={selected} onBack={() => open(null)} />;

  return (
    <div>
      <p className="mb-3 text-[13px] text-on-surface-variant">
        Problemas que las tiendas reportan desde su panel, con la captura de lo que veían. Se borran solos a los 90 días.
        {data ? ` Abiertos: ${data.openCount}.` : ""}
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFilter(id)} aria-pressed={filter === id} className={`min-h-10 rounded-full px-3.5 text-[12.5px] font-semibold ${filter === id ? "bg-primary text-white" : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"}`}>
            {label}
          </button>
        ))}
      </div>
      <label className="mb-4 flex min-h-11 items-center gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest px-3">
        <Search className="h-4 w-4 text-outline" aria-hidden="true" />
        <span className="sr-only">Buscar ticket</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Número (T-00042), tienda, correo o texto" className="min-w-0 flex-1 bg-transparent py-2 text-[13.5px] outline-none" />
      </label>

      {isLoading ? (
        <ListSkeleton rows={3} />
      ) : isError ? (
        <p className="text-[13px] text-error">
          No se pudieron cargar los tickets.{" "}
          <button type="button" onClick={() => refetch()} className="font-semibold underline">
            Reintentar
          </button>
        </p>
      ) : !data.tickets.length ? (
        <p className="rounded-2xl border border-dashed border-outline-variant px-4 py-8 text-center text-[13px] text-on-surface-variant">No hay tickets en este filtro.</p>
      ) : (
        <ul className="divide-y divide-surface-container-high overflow-hidden rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest">
          {data.tickets.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => open(t.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-container/50">
                <span className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${t.hasScreenshot ? "bg-tertiary-accent/10 text-tertiary-accent" : "bg-surface-container text-outline"}`} aria-hidden="true">
                  {t.hasScreenshot ? <Camera className="h-4 w-4" /> : <ImageOff className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13.5px] font-bold text-on-surface">{t.code}</span>
                    <StatusChip status={t.status} />
                    {t.section && <span className="text-[12px] text-on-surface-variant">· {t.section}</span>}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[13px] text-on-surface">{t.description}</span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-outline">
                    {t.vendor?.companyName ?? "Sin tienda"} · {t.reporterName ?? t.reporterEmail} · {exactDateTime(t.createdAt)}
                    {t._count.messages ? ` · ${t._count.messages} ${t._count.messages === 1 ? "respuesta" : "respuestas"}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TRAIL_ICON = { nav: Navigation, click: MousePointerClick, api: Server, input: MousePointerClick };

function TicketDetail({ id, onBack }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["admin-support-ticket", id], queryFn: async () => (await api.get(`/admin/support-tickets/${id}`)).data.ticket });
  const [shotUrl, setShotUrl] = useState(null);
  const [shotState, setShotState] = useState("idle");
  const [zoom, setZoom] = useState(false);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("");
  const [resolution, setResolution] = useState("");
  const [notify, setNotify] = useState(true);
  const [showConsole, setShowConsole] = useState(true);

  // La captura vive en una carpeta privada: se pide con la sesión del admin y se muestra desde memoria.
  useEffect(() => {
    if (!data?.hasScreenshot) return undefined;
    let url = null;
    setShotState("loading");
    api
      .get(`/admin/support-tickets/${id}/screenshot`, { responseType: "blob" })
      .then((r) => {
        url = URL.createObjectURL(r.data);
        setShotUrl(url);
        setShotState("ok");
      })
      .catch(() => setShotState("error"));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, data?.hasScreenshot]);

  useEffect(() => {
    if (data) {
      setStatus(data.status);
      setResolution(data.resolution ?? "");
    }
  }, [data]);

  const reply = useMutation({
    mutationFn: async (payload) => (await api.post(`/admin/support-tickets/${id}/reply`, payload)).data,
    onSuccess: () => {
      toast.success(notify ? "Guardado. Le avisamos por correo a quien reportó." : "Guardado.");
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["admin-support-ticket", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-support-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["admin-errors-unresolved-count"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  if (isLoading) return <CardListSkeleton />;
  if (isError || !data)
    return (
      <div className="flex flex-col items-start gap-2">
        <button type="button" onClick={onBack} className="inline-flex min-h-10 items-center gap-1.5 text-[13px] font-semibold text-tertiary-accent">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Tickets
        </button>
        <p className="text-[13px] text-error">
          No se pudo cargar el ticket (puede que ya se haya borrado a los 90 días).{" "}
          <button type="button" onClick={() => refetch()} className="font-semibold underline">
            Reintentar
          </button>
        </p>
      </div>
    );

  const t = data;
  const consoleLog = Array.isArray(t.consoleLog) ? t.consoleLog : [];
  const trail = Array.isArray(t.activityTrail) ? t.activityTrail : [];
  const errorsInConsole = consoleLog.filter((c) => c.level === "error").length;
  const closing = ["RESOLVED", "CLOSED_NO_EVIDENCE", "CLOSED_NOT_A_BUG"].includes(status);
  const needsResolution = status === "RESOLVED" && resolution.trim().length < 5;
  const canSave = !reply.isPending && !needsResolution && (body.trim().length >= 2 || status !== t.status);
  const card = "rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest p-4";

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 inline-flex min-h-10 items-center gap-1.5 text-[13px] font-semibold text-tertiary-accent">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Tickets
      </button>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="font-display text-[22px] font-extrabold text-on-surface">{t.code}</h2>
        <StatusChip status={t.status} />
        {t.section && <span className="rounded-full bg-tertiary-accent/10 px-2.5 py-0.5 text-[11.5px] font-bold text-tertiary-accent">{t.section}</span>}
      </div>
      <p className="mb-4 text-[12.5px] text-on-surface-variant">
        Recibido el {exactDateTime(t.createdAt)} ({timeAgo(t.createdAt).toLowerCase()}) · se borra el {exactDate(t.expiresAt)}
        {t.closedAt ? ` · cerrado el ${exactDateTime(t.closedAt)}` : ""}
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <section className={card}>
            <h3 className="mb-2 text-[13.5px] font-bold text-on-surface">Lo que veía la tienda</h3>
            {!t.hasScreenshot ? (
              <p className="flex items-center gap-2 text-[13px] text-on-surface-variant">
                <ImageOff className="h-4 w-4" aria-hidden="true" /> Este reporte llegó sin captura (el dispositivo no pudo tomarla).
              </p>
            ) : shotState === "ok" ? (
              <button type="button" onClick={() => setZoom(true)} className="block w-full overflow-hidden rounded-xl border border-surface-container-high bg-surface-container" aria-label="Ver la captura a pantalla completa">
                <img src={shotUrl} alt={`Captura del ticket ${t.code}`} className="mx-auto max-h-[520px] w-auto object-contain" />
              </button>
            ) : shotState === "error" ? (
              <p className="text-[13px] text-error">No se pudo cargar la captura.</p>
            ) : (
              <p className="text-[13px] text-on-surface-variant">Cargando la captura...</p>
            )}
            {t.hasScreenshot && shotState === "ok" && <p className="mt-1.5 text-[11.5px] text-outline">Toca la imagen para verla a pantalla completa.</p>}
          </section>

          <section className={card}>
            <h3 className="mb-1.5 text-[13.5px] font-bold text-on-surface">Lo que contó</h3>
            <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-on-surface">{t.description}</p>
            <p className="mt-2 break-all text-[12px] text-on-surface-variant">Pantalla: {t.pagePath}</p>
          </section>

          <section className={card}>
            <button type="button" onClick={() => setShowConsole((v) => !v)} aria-expanded={showConsole} className="flex min-h-10 w-full items-center justify-between gap-2 text-left">
              <span className="flex items-center gap-2 text-[13.5px] font-bold text-on-surface">
                <Terminal className="h-4 w-4 text-tertiary-accent" aria-hidden="true" /> Consola del navegador ({consoleLog.length}
                {errorsInConsole ? `, ${errorsInConsole} ${errorsInConsole === 1 ? "error" : "errores"}` : ""})
              </span>
              <ChevronDown className={`h-4 w-4 text-outline transition-transform ${showConsole ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
            {showConsole &&
              (consoleLog.length === 0 ? (
                <p className="mt-1 text-[12.5px] text-on-surface-variant">La consola estaba vacía.</p>
              ) : (
                <ol className="mt-2 max-h-[340px] overflow-auto rounded-lg bg-inverse-surface p-2.5 font-mono text-[11.5px] leading-relaxed">
                  {consoleLog.map((c, i) => (
                    <li key={i} className={`whitespace-pre-wrap break-words border-b border-white/5 py-1 ${c.level === "error" ? "text-[#ff8a80]" : c.level === "warn" ? "text-[#ffd180]" : "text-white/85"}`}>
                      <span className="text-white/45">{new Date(c.at).toLocaleTimeString("es-CU", { hour12: false })} {c.level.toUpperCase()} </span>
                      {c.text}
                    </li>
                  ))}
                </ol>
              ))}
          </section>

          <section className={card}>
            <h3 className="mb-2 text-[13.5px] font-bold text-on-surface">Lo último que hizo (de más antiguo a más reciente)</h3>
            {trail.length === 0 ? (
              <p className="text-[12.5px] text-on-surface-variant">Sin registro.</p>
            ) : (
              <ol className="max-h-[340px] space-y-1 overflow-auto">
                {trail.map((e, i) => {
                  const Icon = TRAIL_ICON[e.kind] ?? Navigation;
                  const failed = e.kind === "api" && /→ (5\d\d|4\d\d|sin respuesta)/.test(e.text);
                  return (
                    <li key={i} className="flex items-start gap-2 text-[12.5px]">
                      <span className="w-[62px] flex-shrink-0 tabular-nums text-outline">{new Date(e.at).toLocaleTimeString("es-CU", { hour12: false })}</span>
                      <Icon className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${failed ? "text-error" : "text-on-surface-variant"}`} aria-hidden="true" />
                      <span className={`min-w-0 break-all ${failed ? "font-semibold text-error" : "text-on-surface"}`}>{e.text}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <section className={card}>
            <h3 className="mb-2 text-[13.5px] font-bold text-on-surface">Quién lo reportó</h3>
            <dl className="space-y-1 text-[13px]">
              <div>
                <dt className="inline text-on-surface-variant">Nombre: </dt>
                <dd className="inline text-on-surface">{t.reporterName ?? "Sin nombre"}</dd>
              </div>
              <div>
                <dt className="inline text-on-surface-variant">Correo: </dt>
                <dd className="inline break-all text-on-surface">{t.reporterEmail}</dd>
              </div>
              {t.reporter?.phone && (
                <div>
                  <dt className="inline text-on-surface-variant">Teléfono: </dt>
                  <dd className="inline text-on-surface">{t.reporter.phone}</dd>
                </div>
              )}
              <div>
                <dt className="inline text-on-surface-variant">Rol: </dt>
                <dd className="inline text-on-surface">{t.reporterRole === "VENDOR_STAFF" ? "Usuario del sistema" : "Dueño de la tienda"}</dd>
              </div>
            </dl>
            {t.vendor && (
              <Link to={`/admin/tiendas/${t.vendor.id}`} className="mt-2 inline-flex min-h-10 items-center gap-1.5 text-[13px] font-bold text-tertiary-accent">
                <Store className="h-4 w-4" aria-hidden="true" /> {t.vendor.companyName}
              </Link>
            )}
            {t.device && (
              <p className="mt-2 break-words text-[12px] text-on-surface-variant">
                Pantalla {t.device.viewport ?? "?"} · {t.device.standalone ? "app instalada" : "navegador"}
                {t.device.version ? ` · v${t.device.version}` : ""}
                {t.device.online === false ? " · sin conexión" : ""}
                <span className="block text-outline">{t.device.userAgent}</span>
              </p>
            )}
          </section>

          <section className={card}>
            <h3 className="mb-2 text-[13.5px] font-bold text-on-surface">Respuestas</h3>
            {t.resolution && (
              <p className="mb-2 rounded-lg bg-verified/5 px-3 py-2 text-[12.5px] text-on-surface">
                <strong>Cómo se solucionó:</strong> {t.resolution}
              </p>
            )}
            {t.messages.length === 0 ? (
              <p className="mb-3 text-[12.5px] text-on-surface-variant">Todavía no le respondiste.</p>
            ) : (
              <ul className="mb-3 space-y-2">
                {t.messages.map((m) => (
                  <li key={m.id} className="rounded-lg bg-surface-container/60 px-3 py-2 text-[12.5px]">
                    {m.body && <p className="whitespace-pre-wrap break-words text-on-surface">{m.body}</p>}
                    <p className="mt-0.5 text-[11px] text-outline">
                      {exactDateTime(m.createdAt)}
                      {m.statusChange ? ` · pasó a «${TICKET_STATUS[m.statusChange]?.label ?? m.statusChange}»` : ""}
                      {m.emailedAt ? " · enviado por correo" : " · sin correo"}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!canSave) return;
                reply.mutate({ body: body.trim() || undefined, status: status !== t.status ? status : undefined, resolution: closing ? resolution.trim() || undefined : undefined, notify });
              }}
              className="flex flex-col gap-2.5"
            >
              <label className="text-[12.5px] font-semibold text-on-surface" htmlFor="ticket-status">
                Estado
              </label>
              <select
                id="ticket-status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  if (e.target.value === "CLOSED_NO_EVIDENCE" && !body.trim()) setBody(NO_EVIDENCE_TEXT);
                }}
                className="min-h-11 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[13.5px]"
              >
                {Object.entries(TICKET_STATUS).map(([k, s]) => (
                  <option key={k} value={k}>
                    {s.label}
                  </option>
                ))}
              </select>
              {status === "RESOLVED" && (
                <>
                  <label className="text-[12.5px] font-semibold text-on-surface" htmlFor="ticket-resolution">
                    Cómo se solucionó (obligatorio)
                  </label>
                  <textarea id="ticket-resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} rows={2} maxLength={2000} className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-[13.5px] outline-none focus:border-tertiary-accent" />
                </>
              )}
              <label className="text-[12.5px] font-semibold text-on-surface" htmlFor="ticket-reply">
                Respuesta para la tienda
              </label>
              <textarea id="ticket-reply" value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={4000} placeholder="Escribe lo que le quieres decir. Le llega por correo con el número del ticket." className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-[13.5px] outline-none focus:border-tertiary-accent" />
              <label className="flex min-h-10 items-center gap-2 text-[12.5px] text-on-surface">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 accent-tertiary-accent" />
                Avisar por correo a {t.reporterEmail}
              </label>
              <button type="submit" disabled={!canSave} className="min-h-11 rounded-xl bg-primary text-[13.5px] font-bold text-white disabled:opacity-50">
                {reply.isPending ? "Guardando..." : status !== t.status ? "Guardar y cambiar estado" : "Enviar respuesta"}
              </button>
            </form>
          </section>
        </div>
      </div>
      {zoom && shotUrl && <Lightbox src={shotUrl} onClose={() => setZoom(false)} />}
    </div>
  );
}
