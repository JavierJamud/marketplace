import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { ShieldAlert, X, Eye, MousePointerClick, ShoppingBag, Star, Ban, UserX, Store } from "lucide-react";
import { api, getErrorMessage } from "../../lib/api.js";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { useFocusFromQuery } from "../../lib/useFocusFromQuery.js";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";
import { Tabs } from "../../components/ui/Tabs.jsx";
import { lockPageScroll } from "../../lib/scrollLock.js";

// Reportes de productos, tiendas y ventas rápidas, y la moderación que sigue (reglas en backend lib/moderation.js):
// revisar cada reporte con todo lo necesario para decidir (quién reportó, el dueño y sus avisos, la analítica, las
// imágenes), mantener o suspender con motivo (le llega por correo al dueño y a quien reportó), las apelaciones, las
// cuentas y tiendas sancionadas por avisos acumulados, la lista negra y las reglas configurables. La pestaña va en la URL.

function fmtDate(iso) {
  if (!iso) return "Sin fecha";
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtDay(iso) {
  return iso ? new Date(iso).toLocaleDateString("es-CU", { day: "numeric", month: "long", year: "numeric" }) : "Sin plazo";
}
function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

const STATUS_LABEL = {
  PENDING: { label: "Pendiente", cls: "bg-error/10 text-error" },
  EVIDENCE_REQUESTED: { label: "Esperando evidencia", cls: "bg-secondary-container/40 text-on-surface" },
  RESOLVED_NO_ACTION: { label: "Se mantuvo", cls: "bg-verified/10 text-verified-dark" },
  RESOLVED_SUSPENDED: { label: "Suspendido", cls: "bg-primary/10 text-primary" },
  DISMISSED: { label: "Se mantuvo", cls: "bg-verified/10 text-verified-dark" },
};
const APPEAL_LABEL = { PENDING: "Apelación pendiente", ACCEPTED: "Apelación aceptada", REJECTED: "Apelación rechazada" };

function targetInfo(r) {
  if (r.product) return { label: `Producto: ${r.product.name}`, sub: r.product.vendor?.companyName, href: r.product.vendor ? `/producto/${r.product.vendor.slug}/${r.product.slug}` : null };
  if (r.vendor) return { label: `Tienda: ${r.vendor.companyName}`, sub: null, href: `/tienda/${r.vendor.slug}` };
  if (r.customerListing) return { label: `Venta rápida: ${r.customerListing.name}`, sub: r.customerListing.owner?.fullName, href: `/ventas-rapidas/${r.customerListing.id}` };
  return { label: r.targetLabel ? `${r.targetLabel} (ya no existe)` : "Ya no existe", sub: null, href: null };
}

const TABS = [
  { id: "reportes", label: "Reportes" },
  { id: "apelaciones", label: "Apelaciones" },
  { id: "sancionados", label: "Cuentas y tiendas sancionadas" },
  { id: "lista-negra", label: "Lista negra" },
  { id: "reglas", label: "Reglas" },
];

export default function AdminFraudReports() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "reportes";
  const setTab = (id) => setParams(id === "reportes" ? {} : { tab: id }, { replace: true });

  return (
    <div>
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={ShieldAlert} tone="orange" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Reportes y moderación</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">
        Revisa cada reporte y decide si se mantiene o se suspende: el dueño y quien reportó reciben un correo con tu decisión y el motivo.
      </p>
      <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-5" />
      {tab === "reportes" && <ReportsList />}
      {tab === "apelaciones" && <ReportsList appeals />}
      {tab === "sancionados" && <SanctionedPanel />}
      {tab === "lista-negra" && <BlacklistPanel />}
      {tab === "reglas" && <RulesPanel />}
    </div>
  );
}

// --- Lista de reportes ----------------------------------------------------------------------------------------------------

function ReportsList({ appeals = false }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [openId, setOpenId] = useState(null);
  const status = appeals ? "APPEALS" : statusFilter;
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-fraud-reports", status],
    queryFn: async () => (await api.get("/admin/reports", { params: status ? { status } : undefined })).data.reports,
  });
  const reports = data ?? [];
  // Desde un aviso (?report=id) se abre ese reporte.
  const focused = useFocusFromQuery("report", !isLoading);
  useEffect(() => {
    if (focused) setOpenId(focused);
  }, [focused]);

  return (
    <div>
      {!appeals && (
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar por estado">
          {[
            ["", "Todos"],
            ["PENDING", "Pendientes"],
            ["EVIDENCE_REQUESTED", "Esperando evidencia"],
            ["RESOLVED_SUSPENDED", "Suspendidos"],
            ["DISMISSED", "Se mantuvieron"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={statusFilter === value}
              onClick={() => setStatusFilter(value)}
              className={`min-h-9 rounded-full px-3.5 text-[12px] font-semibold ${
                statusFilter === value ? "bg-tertiary-accent text-white" : "border border-surface-container-high bg-surface-container-lowest text-on-surface-variant"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
        <div className="hidden grid-cols-[1.8fr_1.3fr_1.2fr_1.8fr_1.1fr_auto] gap-3 bg-surface-container-low px-[22px] py-3.5 text-[11.5px] font-bold uppercase tracking-wide text-outline lg:grid">
          <span>Reportado</span>
          <span>Quién reportó</span>
          <span>Estado</span>
          <span>Motivo</span>
          <span>Fecha</span>
          <span />
        </div>
        {isLoading && <ListSkeleton />}
        {isError && (
          <p className="p-5 text-[13px] text-error">
            No se pudieron cargar los reportes.{" "}
            <button onClick={() => refetch()} className="min-h-11 font-semibold underline">
              Reintentar
            </button>
          </p>
        )}
        {!isLoading && !isError && reports.length === 0 && (
          <p className="p-5 text-body-md text-on-surface-variant">{appeals ? "No hay apelaciones pendientes." : "No hay reportes aquí."}</p>
        )}
        {reports.map((r) => {
          const target = targetInfo(r);
          const st = STATUS_LABEL[r.status] ?? STATUS_LABEL.PENDING;
          const images = r.images?.length ? r.images.length : r.screenshotUrl ? 1 : 0;
          return (
            <div
              key={r.id}
              data-focus-id={r.id}
              className={`flex flex-col gap-2 border-t border-surface-container px-4 py-3.5 lg:grid lg:grid-cols-[1.8fr_1.3fr_1.2fr_1.8fr_1.1fr_auto] lg:items-center lg:gap-3 lg:px-[22px] ${focused === r.id ? "bg-tertiary-accent/10" : ""}`}
            >
              <div className="min-w-0">
                <span className="text-[13px] font-semibold text-on-surface">{target.label}</span>
                {target.sub && <div className="text-[11.5px] text-outline">{target.sub}</div>}
              </div>
              <div className="min-w-0">
                <span className="text-[12.5px] font-semibold text-on-surface">{r.reporter?.fullName ?? "Sin nombre"}</span>
                <div className="break-all text-[11px] text-outline">{r.reporter?.email}</div>
              </div>
              <div className="flex flex-wrap gap-1">
                <span className={`w-fit rounded-full px-2.5 py-1 text-[11px] font-bold ${st.cls}`}>
                  {st.label}
                  {r.status === "EVIDENCE_REQUESTED" && r.evidenceSentAt && " · respondió"}
                </span>
                {r.appealStatus && <span className="w-fit rounded-full bg-secondary-container/40 px-2.5 py-1 text-[11px] font-bold text-on-surface">{APPEAL_LABEL[r.appealStatus]}</span>}
              </div>
              <p className="line-clamp-2 text-[12.5px] text-on-surface-variant">
                {r.message}
                {images > 0 && <span className="text-outline"> · {images} {images === 1 ? "imagen" : "imágenes"}</span>}
              </p>
              <span className="text-[12px] text-outline">{fmtDate(r.createdAt)}</span>
              <button onClick={() => setOpenId(r.id)} className="min-h-10 rounded-lg bg-primary px-4 text-[12.5px] font-bold text-white">
                Revisar
              </button>
            </div>
          );
        })}
      </div>
      {openId && <ReportDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// --- Detalle de un reporte ---------------------------------------------------------------------------------------------

function Section({ title, children }) {
  return (
    <section className="rounded-xl border border-surface-container-high p-4">
      <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-outline">{title}</h3>
      {children}
    </section>
  );
}
function Facts({ rows }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-2">
      {rows.filter(Boolean).map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11.5px] text-outline">{k}</dt>
          <dd className="break-words font-semibold text-on-surface">{v ?? "Sin dato"}</dd>
        </div>
      ))}
    </dl>
  );
}
function Gallery({ urls, alt }) {
  if (!urls?.length) return <p className="text-[12.5px] text-on-surface-variant">Sin imágenes.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((u, i) => (
        <a key={u} href={imgUrl(u)} target="_blank" rel="noreferrer" aria-label={`${alt} ${i + 1}: abrir en grande`}>
          <img src={imgUrl(u)} alt={`${alt} ${i + 1}`} className="h-24 w-24 rounded-lg object-cover" />
        </a>
      ))}
    </div>
  );
}
function Stat({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-container/60 px-3 py-2">
      <Icon className="h-4 w-4 flex-shrink-0 text-tertiary-accent" aria-hidden="true" />
      <div>
        <div className="text-[11px] text-outline">{label}</div>
        <div className="text-[14px] font-extrabold text-on-surface">{value}</div>
      </div>
    </div>
  );
}

function ReportDetail({ id, onClose }) {
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState(null); // { kind: "keep"|"suspend"|"accept"|"reject" }
  const [note, setNote] = useState("");
  const { data, isLoading, isError } = useQuery({ queryKey: ["admin-fraud-report", id], queryFn: async () => (await api.get(`/admin/reports/${id}`)).data });

  useEffect(() => {
    const unlock = lockPageScroll();
    const onKey = (e) => e.key === "Escape" && !prompt && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      unlock();
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, prompt]);

  const done = (msg) => {
    toast.success(msg);
    setPrompt(null);
    setNote("");
    queryClient.invalidateQueries({ queryKey: ["admin-fraud-reports"] });
    queryClient.invalidateQueries({ queryKey: ["admin-fraud-report", id] });
    queryClient.invalidateQueries({ queryKey: ["admin-fraud-reports-count"] });
  };
  const fail = async (err) => toast.error(await getErrorMessage(err, "No se pudo completar la acción."));
  const requestEvidence = useMutation({ mutationFn: () => api.post(`/admin/reports/${id}/request-evidence`), onSuccess: () => done("Le pedimos evidencia al dueño."), onError: fail });
  const decide = useMutation({
    mutationFn: ({ kind, text }) => {
      const url = { keep: "dismiss", suspend: "resolve", accept: "appeal/accept", reject: "appeal/reject" }[kind];
      const body = kind === "accept" || kind === "reject" ? { note: text } : { resolutionNote: text };
      return api.post(`/admin/reports/${id}/${url}`, body);
    },
    onSuccess: (_, { kind }) =>
      done({ keep: "Se mantiene. Avisamos al dueño y a quien reportó.", suspend: "Suspendido. Avisamos al dueño y a quien reportó.", accept: "Apelación aceptada: se publica de nuevo.", reject: "Apelación rechazada: se eliminó." }[kind]),
    onError: fail,
  });

  const r = data?.report;
  const open = r && ["PENDING", "EVIDENCE_REQUESTED"].includes(r.status);
  const appealPending = r?.appealStatus === "PENDING";
  const a = data?.analytics;
  const target = r ? targetInfo(r) : null;
  const PROMPTS = {
    keep: { title: "Mantener publicado", message: "No se toca nada. El dueño y quien reportó reciben un correo con este motivo.", confirm: "Mantener", danger: false },
    suspend: { title: "Suspender", message: "Sale del sitio y el dueño tiene un plazo para apelar; si no apela, se elimina. Cuenta como un aviso para su cuenta o tienda. Ambos reciben un correo con este motivo.", confirm: "Suspender", danger: true },
    accept: { title: "Aceptar la apelación", message: "Se vuelve a publicar y este reporte deja de contar como aviso. El dueño recibe un correo con este motivo.", confirm: "Aceptar", danger: false },
    reject: { title: "Rechazar la apelación", message: "Se elimina ahora. El dueño recibe un correo con este motivo.", confirm: "Rechazar y eliminar", danger: true },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center sm:p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Detalle del reporte" className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-surface-container-lowest p-5 shadow-2xl sm:rounded-2xl sm:p-6">
        <button onClick={onClose} aria-label="Cerrar" className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-outline hover:bg-surface-variant">
          <X className="h-5 w-5" />
        </button>
        {isLoading && <ListSkeleton />}
        {isError && <p className="text-[13px] text-error">No se pudo cargar el reporte.</p>}
        {r && (
          <div className="flex flex-col gap-3">
            <div className="pr-10">
              <h2 className="text-[18px] font-extrabold text-on-surface">{target.label}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${(STATUS_LABEL[r.status] ?? STATUS_LABEL.PENDING).cls}`}>{(STATUS_LABEL[r.status] ?? STATUS_LABEL.PENDING).label}</span>
                {r.appealStatus && <span className="rounded-full bg-secondary-container/40 px-2.5 py-1 text-[11px] font-bold text-on-surface">{APPEAL_LABEL[r.appealStatus]}</span>}
                {target.href && (
                  <Link to={target.href} target="_blank" className="inline-flex min-h-9 items-center text-[12.5px] font-semibold text-tertiary-accent underline">
                    Ver publicación
                  </Link>
                )}
              </div>
            </div>

            <Section title="Reporte">
              <p className="mb-2 whitespace-pre-line text-[13.5px] text-on-surface">{r.message}</p>
              <p className="mb-2 text-[11.5px] text-outline">Enviado el {fmtDate(r.createdAt)}</p>
              <Gallery urls={r.images?.length ? r.images : r.screenshotUrl ? [r.screenshotUrl] : []} alt="Captura del reporte" />
            </Section>

            <Section title="Quién reportó">
              <Facts
                rows={[
                  ["Nombre", data.reporter?.fullName],
                  ["Correo", data.reporter?.email],
                  ["Teléfono", data.reporter?.phone],
                  ["Tipo de cuenta", { CUSTOMER: "Cliente", VENDOR: "Tienda", ADMIN: "Admin" }[data.reporter?.role] ?? data.reporter?.role],
                  ["Cuenta creada", fmtDay(data.reporter?.createdAt)],
                  ["Reportes que ha hecho", data.reporter?._count?.reportsMade],
                ]}
              />
            </Section>

            <Section title={data.vendor ? "Tienda reportada" : "Dueño de la venta rápida"}>
              <Facts
                rows={[
                  data.vendor && ["Tienda", data.vendor.companyName],
                  ["Dueño", data.owner?.fullName],
                  ["Correo", data.owner?.email],
                  ["Teléfono", data.vendor?.whatsapp ?? data.owner?.phone],
                  ["Avisos confirmados", `${data.strikes.count} de ${data.strikes.limit}`],
                  ["Otros reportes recibidos", data.otherReports],
                  data.owner?.deletedAt && ["Estado", "Cuenta eliminada"],
                  data.owner?.fraudBlockedAt && ["Bloqueo por avisos", `Desde el ${fmtDay(data.owner.fraudBlockedAt)}`],
                  data.vendor?.fraudSuspendedAt && ["Suspensión por avisos", `Desde el ${fmtDay(data.vendor.fraudSuspendedAt)}`],
                ]}
              />
              {data.strikes.count + 1 >= data.strikes.limit && open && (
                <p className="mt-2 rounded-lg bg-error/10 p-2.5 text-[12.5px] font-semibold text-error">
                  Si lo suspendes, {data.strikes.kind === "VENDOR" ? "la tienda queda suspendida" : "la cuenta queda bloqueada"} por llegar al límite de avisos.
                </p>
              )}
            </Section>

            {a && (
              <Section title={a.kind === "LISTING" ? "Actividad de la venta rápida" : "Actividad del producto"}>
                <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat icon={Eye} label="Visitas" value={a.viewCount} />
                  {a.kind === "LISTING" ? <Stat icon={MousePointerClick} label="Clics en contactar" value={a.contactClickCount} /> : <Stat icon={MousePointerClick} label="Clics" value={a.clickCount} />}
                  {a.kind === "PRODUCT" ? <Stat icon={ShoppingBag} label="Ventas confirmadas" value={a.salesCount} /> : <Stat icon={ShoppingBag} label="Marcada vendida" value={a.isSold ? "Sí" : "No"} />}
                  {a.kind === "PRODUCT" ? <Stat icon={Star} label="Reseñas" value={a.reviewCount ? `${Number(a.rating).toFixed(1)} (${a.reviewCount})` : "Ninguna"} /> : <Stat icon={Star} label="Publicada" value={fmtDay(a.activatedAt ?? a.createdAt)} />}
                </div>
                {a.kind === "PRODUCT" && <p className="mb-2 text-[12.5px] text-on-surface-variant">Pedidos con este producto en los últimos 30 días: {a.orders30}</p>}
                <Gallery urls={a.images} alt="Foto publicada" />
              </Section>
            )}

            {r.evidenceSentAt && (
              <Section title="Respuesta del dueño">
                <p className="mb-2 whitespace-pre-line text-[13.5px] text-on-surface">{r.evidenceMessage}</p>
                <Gallery urls={r.evidenceImages} alt="Evidencia del dueño" />
              </Section>
            )}

            {r.appealSentAt && (
              <Section title="Apelación del dueño">
                <p className="mb-2 whitespace-pre-line text-[13.5px] text-on-surface">{r.appealMessage}</p>
                <p className="mb-2 text-[11.5px] text-outline">Enviada el {fmtDate(r.appealSentAt)}</p>
                <Gallery urls={r.appealImages} alt="Prueba de la apelación" />
                {r.appealNote && <p className="mt-2 text-[12.5px] text-on-surface-variant">Tu respuesta: {r.appealNote}</p>}
              </Section>
            )}

            {r.resolutionNote && !open && (
              <p className="rounded-lg bg-surface-container p-3 text-[12.5px] text-on-surface-variant">
                Decisión: {r.resolutionNote}
                {r.itemDeleteAt && ` · Se elimina el ${fmtDay(r.itemDeleteAt)} si no apela.`}
              </p>
            )}

            {(open || appealPending) && (
              <div className="sticky bottom-0 -mx-5 flex flex-wrap gap-2 border-t border-surface-container bg-surface-container-lowest px-5 pt-3 sm:-mx-6 sm:px-6">
                {open && r.status === "PENDING" && (
                  <button onClick={() => requestEvidence.mutate()} disabled={requestEvidence.isPending} className="min-h-11 rounded-xl border border-outline-variant px-4 text-[13px] font-semibold text-on-surface disabled:opacity-50">
                    Pedir evidencia al dueño
                  </button>
                )}
                {open && (
                  <>
                    <button onClick={() => setPrompt("keep")} className="min-h-11 rounded-xl bg-verified-dark px-4 text-[13px] font-bold text-white">
                      Mantener
                    </button>
                    <button onClick={() => setPrompt("suspend")} className="min-h-11 rounded-xl bg-error px-4 text-[13px] font-bold text-white">
                      Suspender
                    </button>
                  </>
                )}
                {appealPending && (
                  <>
                    <button onClick={() => setPrompt("accept")} className="min-h-11 rounded-xl bg-verified-dark px-4 text-[13px] font-bold text-white">
                      Aceptar apelación
                    </button>
                    <button onClick={() => setPrompt("reject")} className="min-h-11 rounded-xl bg-error px-4 text-[13px] font-bold text-white">
                      Rechazar y eliminar
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {prompt && (
        <ConfirmModal
          open
          title={PROMPTS[prompt].title}
          message={PROMPTS[prompt].message}
          confirmLabel={decide.isPending ? "Guardando..." : PROMPTS[prompt].confirm}
          confirmDisabled={note.trim().length < 5 || decide.isPending}
          danger={PROMPTS[prompt].danger}
          onConfirm={() => decide.mutate({ kind: prompt, text: note.trim() })}
          onCancel={() => setPrompt(null)}
        >
          <label htmlFor="decision-note" className="mb-1 block text-[12.5px] font-semibold text-on-surface">
            Motivo (se envía por correo)
          </label>
          <textarea
            id="decision-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Mínimo 5 caracteres"
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent"
          />
        </ConfirmModal>
      )}
    </div>
  );
}

// --- Sancionados -------------------------------------------------------------------------------------------------------

function SanctionedPanel() {
  const queryClient = useQueryClient();
  const [action, setAction] = useState(null); // { kind, id, name, op: "reactivate"|"delete" }
  const [reason, setReason] = useState("");
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["admin-sanctioned"], queryFn: async () => (await api.get("/admin/moderation/sanctioned")).data });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-sanctioned"] });
  const pause = useMutation({
    mutationFn: ({ kind, id }) => api.post(`/admin/moderation/${kind}/${id}/pause`),
    onSuccess: () => {
      toast.success("Plazo detenido: no se eliminará sola mientras revisas el caso.");
      refresh();
    },
    onError: async (err) => toast.error(await getErrorMessage(err, "No se pudo detener el plazo.")),
  });
  const run = useMutation({
    mutationFn: ({ kind, id, op }) => api.post(op === "reactivate" ? `/admin/moderation/${kind}/${id}/reactivate` : `/admin/moderation/${kind}/${id}/delete`, { reason: reason.trim() }),
    onSuccess: (_, { op }) => {
      toast.success(op === "reactivate" ? "Reactivada. Sus avisos anteriores dejan de contar." : "Eliminada y agregada a la lista negra.");
      setAction(null);
      setReason("");
      refresh();
    },
    onError: async (err) => toast.error(await getErrorMessage(err, "No se pudo completar la acción.")),
  });

  if (isLoading) return <ListSkeleton />;
  if (isError)
    return (
      <p className="text-[13px] text-error">
        No se pudo cargar.{" "}
        <button onClick={() => refetch()} className="min-h-11 font-semibold underline">
          Reintentar
        </button>
      </p>
    );

  const Row = ({ kind, id, icon: Icon, title, sub, lines }) => (
    <li className="flex flex-col gap-3 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-error" aria-hidden="true" />
        <div className="min-w-0">
          <div className="text-[14px] font-bold text-on-surface">{title}</div>
          <div className="break-all text-[12px] text-outline">{sub}</div>
          {lines.filter(Boolean).map((l) => (
            <div key={l} className="text-[12.5px] text-on-surface-variant">
              {l}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => pause.mutate({ kind, id })} className="min-h-11 rounded-xl border border-outline-variant px-3 text-[12.5px] font-semibold text-on-surface">
          Ya contactó: detener plazo
        </button>
        <button onClick={() => setAction({ kind, id, name: title, op: "reactivate" })} className="min-h-11 rounded-xl bg-verified-dark px-3 text-[12.5px] font-bold text-white">
          Reactivar
        </button>
        <button onClick={() => setAction({ kind, id, name: title, op: "delete" })} className="min-h-11 rounded-xl bg-error px-3 text-[12.5px] font-bold text-white">
          Eliminar y a lista negra
        </button>
      </div>
    </li>
  );

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-2 text-[14px] font-bold text-on-surface">Clientes bloqueados por avisos ({data.customers.length})</h2>
        {!data.customers.length ? (
          <p className="text-[13px] text-on-surface-variant">Ninguno.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.customers.map((c) => (
              <Row
                key={c.id}
                kind="customers"
                id={c.id}
                icon={UserX}
                title={c.fullName ?? "Sin nombre"}
                sub={`${c.email} · ${c.phone ?? "sin teléfono"}`}
                lines={[`Bloqueado el ${fmtDay(c.fraudBlockedAt)}`, c.fraudClaimDueAt ? `Se elimina el ${fmtDay(c.fraudClaimDueAt)} si no reclama` : "Plazo detenido: esperando tu decisión"]}
              />
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-[14px] font-bold text-on-surface">Tiendas suspendidas por avisos ({data.vendors.length})</h2>
        {!data.vendors.length ? (
          <p className="text-[13px] text-on-surface-variant">Ninguna.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.vendors.map((v) => (
              <Row
                key={v.id}
                kind="vendors"
                id={v.id}
                icon={Store}
                title={v.companyName}
                sub={`${v.user?.email ?? ""} · WhatsApp ${v.whatsapp ?? "sin dato"}`}
                lines={[
                  `Suspendida el ${fmtDay(v.fraudSuspendedAt)}`,
                  v.fraudContactDueAt ? `Plazo para contactar a soporte: ${fmtDay(v.fraudContactDueAt)}` : null,
                  v.fraudDeleteAt ? `Se elimina el ${fmtDay(v.fraudDeleteAt)}` : null,
                  !v.fraudContactDueAt && !v.fraudDeleteAt ? "Plazo detenido: esperando tu decisión" : null,
                ]}
              />
            ))}
          </ul>
        )}
      </section>

      {action && (
        <ConfirmModal
          open
          title={action.op === "reactivate" ? `Reactivar ${action.name}` : `Eliminar ${action.name}`}
          message={
            action.op === "reactivate"
              ? "Vuelve a funcionar con normalidad y sus avisos anteriores dejan de contar. Recibe un correo con este motivo."
              : "Se elimina ahora y sus datos (correo, teléfono, documento) entran en la lista negra: no podrá volver a registrarse. Recibe un correo con este motivo."
          }
          confirmLabel={run.isPending ? "Guardando..." : action.op === "reactivate" ? "Reactivar" : "Eliminar"}
          confirmDisabled={reason.trim().length < 5 || run.isPending}
          danger={action.op === "delete"}
          onConfirm={() => run.mutate(action)}
          onCancel={() => setAction(null)}
        >
          <label htmlFor="sanction-reason" className="mb-1 block text-[12.5px] font-semibold text-on-surface">
            Motivo
          </label>
          <textarea
            id="sanction-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Mínimo 5 caracteres"
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent"
          />
        </ConfirmModal>
      )}
    </div>
  );
}

// --- Lista negra ---------------------------------------------------------------------------------------------------------

function BlacklistPanel() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-blacklist", query],
    queryFn: async () => (await api.get("/admin/blacklist", { params: query ? { q: query } : undefined })).data.entries,
  });
  const remove = useMutation({
    mutationFn: (id) => api.post(`/admin/blacklist/${id}/remove`),
    onSuccess: () => {
      toast.success("Sacada de la lista negra: ya puede volver a registrarse.");
      setRemoving(null);
      queryClient.invalidateQueries({ queryKey: ["admin-blacklist"] });
    },
    onError: async (err) => toast.error(await getErrorMessage(err, "No se pudo sacar de la lista.")),
  });
  const entries = data ?? [];

  return (
    <div>
      <p className="mb-3 text-[13px] text-on-surface-variant">Personas y tiendas eliminadas por reportes confirmados. Nadie puede registrarse con estos correos, teléfonos o documentos.</p>
      <label htmlFor="blacklist-search" className="sr-only">
        Buscar en la lista negra
      </label>
      <input
        id="blacklist-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por nombre, correo, teléfono o documento"
        className="mb-4 h-11 w-full max-w-md rounded-xl border border-outline-variant bg-surface-container-lowest px-4 text-[13.5px] outline-none focus:border-tertiary-accent"
      />
      {isLoading && <ListSkeleton />}
      {isError && (
        <p className="text-[13px] text-error">
          No se pudo cargar.{" "}
          <button onClick={() => refetch()} className="min-h-11 font-semibold underline">
            Reintentar
          </button>
        </p>
      )}
      {!isLoading && !isError && !entries.length && <p className="text-[13px] text-on-surface-variant">{query ? "Nada coincide con la búsqueda." : "La lista negra está vacía."}</p>}
      <ul className="flex flex-col gap-2">
        {entries.map((e) => (
          <li key={e.id} className="flex flex-col gap-2 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <Ban className="mt-0.5 h-5 w-5 flex-shrink-0 text-error" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-[14px] font-bold text-on-surface">
                  {e.storeName ? `${e.storeName} · ` : ""}
                  {e.fullName ?? "Sin nombre"}
                  <span className="ml-2 text-[11.5px] font-semibold text-outline">{e.kind === "VENDOR" ? "Tienda" : "Cliente"}</span>
                </div>
                <div className="break-all text-[12.5px] text-on-surface-variant">{[e.email, e.phone && `+${e.phone}`, e.idNumber && `Doc. ${e.idNumber}`].filter(Boolean).join(" · ")}</div>
                <div className="text-[12px] text-outline">
                  {fmtDay(e.createdAt)}: {e.reason}
                </div>
              </div>
            </div>
            <button onClick={() => setRemoving(e)} className="min-h-11 rounded-xl border border-outline-variant px-4 text-[12.5px] font-semibold text-on-surface">
              Sacar de la lista
            </button>
          </li>
        ))}
      </ul>
      <ConfirmModal
        open={!!removing}
        title="Sacar de la lista negra"
        message={`${removing?.fullName ?? "Esta persona"} podrá volver a registrarse con estos datos.`}
        confirmLabel={remove.isPending ? "Guardando..." : "Sacar de la lista"}
        onConfirm={() => remove.mutate(removing.id)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

// --- Reglas ------------------------------------------------------------------------------------------------------------

const RULES = [
  { key: "fraudReportEvidenceDeadlineDays", label: "Días para responder cuando le pides evidencia al dueño", max: 60 },
  { key: "suspendedItemAppealDays", label: "Días para apelar algo suspendido antes de que se elimine", max: 365 },
  { key: "customerStrikeLimit", label: "Ventas rápidas suspendidas que bloquean la cuenta de un cliente", max: 50 },
  { key: "customerClaimDays", label: "Días que tiene un cliente bloqueado para reclamar antes de eliminarse", max: 365 },
  { key: "vendorStrikeLimit", label: "Suspensiones confirmadas que suspenden una tienda", max: 50 },
  { key: "vendorSupportContactDays", label: "Días que tiene una tienda suspendida para contactar a soporte", max: 365 },
  { key: "vendorFraudSuspensionDays", label: "Días más de suspensión si no contacta (al terminar, se elimina)", max: 730 },
];

function RulesPanel() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(null);
  const { data, isLoading, isError } = useQuery({ queryKey: ["admin-moderation-settings"], queryFn: async () => (await api.get("/admin/settings/moderation")).data.settings });
  useEffect(() => {
    if (data) setForm(Object.fromEntries(RULES.map((r) => [r.key, String(data[r.key])])));
  }, [data]);
  const save = useMutation({
    mutationFn: () => api.patch("/admin/settings/moderation", Object.fromEntries(RULES.map((r) => [r.key, Number(form[r.key])]))),
    onSuccess: () => {
      toast.success("Reglas guardadas. Se aplican desde ahora.");
      queryClient.invalidateQueries({ queryKey: ["admin-moderation-settings"] });
    },
    onError: async (err) => toast.error(await getErrorMessage(err, "No se pudieron guardar las reglas.")),
  });
  if (isLoading || !form) return isError ? <p className="text-[13px] text-error">No se pudieron cargar las reglas.</p> : <ListSkeleton />;
  const valid = RULES.every((r) => /^\d+$/.test(form[r.key]) && Number(form[r.key]) >= 1 && Number(form[r.key]) <= r.max);

  return (
    <div className="max-w-2xl rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5">
      <p className="mb-4 text-[13px] text-on-surface-variant">Ningún valor es fijo: cámbialos cuando quieras. Los cambios valen para lo que pase desde ahora; los plazos ya corriendo no cambian.</p>
      <div className="flex flex-col gap-3">
        {RULES.map((r) => (
          <label key={r.key} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <span className="text-[13px] text-on-surface">{r.label}</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={r.max}
              value={form[r.key]}
              onChange={(e) => setForm((f) => ({ ...f, [r.key]: e.target.value }))}
              className="h-11 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[14px] font-semibold outline-none focus:border-tertiary-accent sm:w-28"
            />
          </label>
        ))}
      </div>
      <button onClick={() => save.mutate()} disabled={!valid || save.isPending} className="mt-5 min-h-11 rounded-xl bg-primary px-5 text-[13.5px] font-bold text-white disabled:opacity-50">
        {save.isPending ? "Guardando..." : "Guardar reglas"}
      </button>
    </div>
  );
}
