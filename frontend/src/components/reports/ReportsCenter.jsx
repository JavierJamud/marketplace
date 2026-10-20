import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, Camera, CheckCircle2, Clock, Inbox, Send } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api, getErrorMessage } from "../../lib/api.js";
import { exactDateTime } from "../../lib/relativeTime.js";
import { Tabs } from "../ui/Tabs.jsx";
import { MyTickets } from "../vendor/ReportProblemButton.jsx";
import { CardListSkeleton } from "../ui/Skeleton.jsx";

// Reportes de una persona en un solo lugar, en dos pestañas:
//  - Recibidos: lo que otros (clientes, tiendas o el admin) reportaron de tu tienda, tus productos o tus ventas rápidas.
//  - Enviados: lo que reportaste tú (fraude, comentarios y, en el panel de la tienda, los problemas de la plataforma).
// Lo usan el panel de la tienda (VendorFraudReports.jsx) y el del cliente (CustomerPanel.jsx). La pestaña abierta va en la URL
// (?vista=enviados) para poder enlazarla directo.

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

function Pill({ meta }) {
  return <span className={`w-fit rounded-full px-2.5 py-1 text-[11.5px] font-bold ${meta.tone}`}>{meta.label}</span>;
}

const TONE = {
  wait: "bg-secondary-container/40 text-on-surface",
  alert: "bg-error/10 text-error",
  ok: "bg-verified/10 text-verified-dark",
  neutral: "bg-surface-container text-on-surface-variant",
};

// Reportes recibidos: el estado contado desde el lado de quien fue reportado.
const RECEIVED_STATUS = {
  PENDING: { label: "En revisión del equipo", tone: TONE.wait },
  EVIDENCE_REQUESTED: { label: "Necesitamos tu respuesta", tone: TONE.alert },
  RESOLVED_NO_ACTION: { label: "Cerrado sin acción contra ti", tone: TONE.ok },
  RESOLVED_SUSPENDED: { label: "Suspendido por fraude", tone: TONE.alert },
  DISMISSED: { label: "Descartado", tone: TONE.ok },
};

// Reportes hechos: el estado contado desde el lado de quien reportó.
const MADE_STATUS = {
  PENDING: { label: "Recibido, en revisión", tone: TONE.wait },
  EVIDENCE_REQUESTED: { label: "En revisión: se pidió una explicación", tone: TONE.wait },
  RESOLVED_NO_ACTION: { label: "Revisado: no se encontró fraude", tone: TONE.neutral },
  RESOLVED_SUSPENDED: { label: "Confirmado: se suspendió", tone: TONE.ok },
  DISMISSED: { label: "Revisado: descartado", tone: TONE.neutral },
};
const REVIEW_STATUS = {
  REPORTED: { label: "Recibido, en revisión", tone: TONE.wait },
  KEPT: { label: "Revisado: el comentario se mantiene", tone: TONE.neutral },
  SUSPENDED: { label: "Confirmado: el comentario se quitó", tone: TONE.ok },
};

function receivedTarget(r) {
  if (r.product) return `Producto: ${r.product.name}`;
  if (r.vendor) return `Tu tienda: ${r.vendor.companyName}`;
  if (r.customerListing) return `Tu venta rápida: ${r.customerListing.name}`;
  return "Ya no existe";
}

function madeTarget(r) {
  if (r.product) return { label: `Producto: ${r.product.name}`, href: r.product.vendor ? `/producto/${r.product.vendor.slug}/${r.product.slug}` : null };
  if (r.vendor) return { label: `Tienda: ${r.vendor.companyName}`, href: `/tienda/${r.vendor.slug}` };
  if (r.customerListing) return { label: `Venta rápida: ${r.customerListing.name}`, href: `/ventas-rapidas/${r.customerListing.id}` };
  return { label: "Ya no existe", href: null };
}

function ListState({ isLoading, isError, refetch, empty, emptyText }) {
  if (isLoading) return <CardListSkeleton />;
  if (isError)
    return (
      <p className="text-[13px] text-error">
        No se pudieron cargar los reportes.{" "}
        <button type="button" onClick={() => refetch()} className="min-h-11 font-semibold underline">
          Reintentar
        </button>
      </p>
    );
  if (empty)
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-8 text-center">
        <ShieldAlert className="h-7 w-7 text-outline" aria-hidden="true" />
        <p className="text-[13.5px] text-on-surface-variant">{emptyText}</p>
      </div>
    );
  return null;
}

// --- Recibidos -----------------------------------------------------------------------------------------------------------

export function ReceivedReports({ emptyText }) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState({});
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["my-fraud-reports"],
    queryFn: async () => (await api.get("/reports/me/list")).data.reports,
  });

  const submitEvidence = useMutation({
    mutationFn: async ({ id, message, files }) => {
      const form = new FormData();
      form.append("evidenceMessage", message);
      files.forEach((f) => form.append("evidence", f));
      return (await api.post(`/reports/${id}/evidence`, form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: (_, { id }) => {
      toast.success("Respuesta enviada", "El equipo la va a revisar.");
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["my-fraud-reports"] });
    },
    onError: async (err) => toast.error(await getErrorMessage(err, "No se pudo enviar tu respuesta.")),
  });

  const reports = data ?? [];
  const updateDraft = (id, patch) => setDrafts((prev) => ({ ...prev, [id]: { message: "", files: [], ...prev[id], ...patch } }));

  const state = <ListState isLoading={isLoading} isError={isError} refetch={refetch} empty={!reports.length} emptyText={emptyText} />;
  if (isLoading || isError || !reports.length) return state;

  return (
    <ul className="flex flex-col gap-3">
      {reports.map((r) => {
        const needsResponse = r.status === "EVIDENCE_REQUESTED" && !r.evidenceSentAt;
        const draft = drafts[r.id] ?? { message: "", files: [] };
        return (
          <li key={r.id} className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 sm:p-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[14px] font-bold text-on-surface">{receivedTarget(r)}</span>
              <Pill meta={RECEIVED_STATUS[r.status] ?? RECEIVED_STATUS.PENDING} />
            </div>
            <p className="mb-1 text-[13px] text-on-surface-variant">"{r.message}"</p>
            <p className="mb-2 text-[11.5px] text-outline">Reportado el {exactDateTime(r.createdAt)}</p>
            <a href={imgUrl(r.screenshotUrl)} target="_blank" rel="noreferrer" className="mb-2 inline-flex min-h-11 items-center text-[12.5px] font-semibold text-tertiary-accent hover:underline">
              Ver la captura del reporte
            </a>

            {needsResponse && r.evidenceDueAt && (
              <p className="mb-3 flex items-center gap-1.5 text-[12.5px] font-semibold text-error">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" /> Tienes hasta el {exactDateTime(r.evidenceDueAt)} para responder.
              </p>
            )}

            {r.evidenceSentAt && (
              <div className="mb-3 rounded-lg bg-surface-container p-3">
                <p className="mb-1 flex items-center gap-1.5 text-[12px] font-bold text-verified-dark">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Ya respondiste ({exactDateTime(r.evidenceSentAt)})
                </p>
                <p className="text-[13px] text-on-surface-variant">{r.evidenceMessage}</p>
                {r.evidenceImages?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {r.evidenceImages.map((url) => (
                      <a key={url} href={imgUrl(url)} target="_blank" rel="noreferrer">
                        <img src={imgUrl(url)} alt="Tu evidencia" className="h-16 w-16 rounded-md object-cover" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {r.resolutionNote && ["RESOLVED_NO_ACTION", "RESOLVED_SUSPENDED", "DISMISSED"].includes(r.status) && (
              <p className="mb-3 rounded-lg bg-surface-container p-3 text-[12.5px] text-on-surface-variant">Nota del equipo: {r.resolutionNote}</p>
            )}

            {needsResponse && (
              <div className="mt-2 border-t border-surface-container pt-3">
                <label htmlFor={`evidence-${r.id}`} className="mb-1 block text-[12.5px] font-semibold text-on-surface">
                  Tu respuesta
                </label>
                <textarea
                  id={`evidence-${r.id}`}
                  value={draft.message}
                  onChange={(e) => updateDraft(r.id, { message: e.target.value })}
                  rows={3}
                  placeholder="Explica qué pasó (mínimo 10 caracteres)"
                  className="mb-2 w-full resize-none rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[14px] text-on-surface outline-none focus:border-tertiary-accent"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-outline-variant px-3 text-[12.5px] font-semibold text-on-surface-variant hover:bg-surface-variant/40">
                    <Camera className="h-4 w-4" aria-hidden="true" />
                    {draft.files.length > 0 ? `${draft.files.length} foto(s)` : "Adjuntar captura (opcional)"}
                    <input
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/webp"
                      multiple
                      className="sr-only"
                      onChange={(e) => updateDraft(r.id, { files: Array.from(e.target.files ?? []).slice(0, 4) })}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (draft.message.trim().length < 10) return toast.error("Cuéntanos qué pasó (mínimo 10 caracteres).");
                      submitEvidence.mutate({ id: r.id, message: draft.message.trim(), files: draft.files });
                    }}
                    disabled={submitEvidence.isPending}
                    className="min-h-11 rounded-lg bg-tertiary-accent px-4 text-[13px] font-bold text-white disabled:opacity-50"
                  >
                    {submitEvidence.isPending ? "Enviando..." : "Enviar respuesta"}
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// --- Hechos --------------------------------------------------------------------------------------------------------------

function MadeCard({ title, href, status, text, date, resolvedAt }) {
  return (
    <li className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 sm:p-5">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        {href ? (
          <Link to={href} className="text-[14px] font-bold text-on-surface hover:underline">
            {title}
          </Link>
        ) : (
          <span className="text-[14px] font-bold text-on-surface">{title}</span>
        )}
        <Pill meta={status} />
      </div>
      {text && <p className="line-clamp-3 text-[13px] text-on-surface-variant">"{text}"</p>}
      <p className="mt-1 text-[11.5px] text-outline">
        Lo reportaste el {exactDateTime(date)}
        {resolvedAt ? ` · revisado el ${exactDateTime(resolvedAt)}` : ""}
      </p>
    </li>
  );
}

export function MadeReports({ withTickets }) {
  const [kind, setKind] = useState("all");
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["my-reports-made"],
    queryFn: async () => (await api.get("/reports/me/made")).data,
  });
  const fraud = data?.reports ?? [];
  const reviews = data?.reviewReports ?? [];

  const KINDS = [
    { id: "all", label: "Todos" },
    ...(withTickets ? [{ id: "tickets", label: "Problemas de la plataforma" }] : []),
    { id: "fraud", label: `Fraude${fraud.length ? ` (${fraud.length})` : ""}` },
    { id: "reviews", label: `Comentarios${reviews.length ? ` (${reviews.length})` : ""}` },
  ];

  const fraudList = (
    <ul className="flex flex-col gap-3">
      {fraud.map((r) => {
        const t = madeTarget(r);
        return <MadeCard key={r.id} title={t.label} href={t.href} status={MADE_STATUS[r.status] ?? MADE_STATUS.PENDING} text={r.message} date={r.createdAt} resolvedAt={r.resolvedAt} />;
      })}
    </ul>
  );
  const reviewList = (
    <ul className="flex flex-col gap-3">
      {reviews.map((r) => (
        <MadeCard
          key={r.id}
          title={`Comentario en ${r.product?.name ?? r.vendor?.companyName ?? "una reseña"}`}
          status={REVIEW_STATUS[r.reportStatus] ?? REVIEW_STATUS.REPORTED}
          text={r.reportReason || r.comment}
          date={r.reportedAt}
          resolvedAt={r.reportResolvedAt}
        />
      ))}
    </ul>
  );

  // Cargando, error o vacío (devuelve null cuando hay algo que mostrar).
  const loadState = (empty, emptyText) =>
    isLoading || isError || empty ? <ListState isLoading={isLoading} isError={isError} refetch={refetch} empty={empty} emptyText={emptyText} /> : null;

  const section = (title, body) => (
    <section className="mb-5">
      <h3 className="mb-2 text-[13px] font-bold text-on-surface">{title}</h3>
      {body}
    </section>
  );

  return (
    <div>
      <div role="group" aria-label="Tipo de reporte" className="mb-4 flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            aria-pressed={kind === k.id}
            onClick={() => setKind(k.id)}
            className={`min-h-10 flex-shrink-0 rounded-full border px-3.5 text-[12.5px] font-semibold ${
              kind === k.id ? "border-tertiary-accent bg-tertiary-accent text-white" : "border-surface-container-high bg-surface-container-lowest text-on-surface-variant"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      {kind === "tickets" && <MyTickets />}
      {kind === "fraud" && (loadState(!fraud.length, "No has reportado ningún fraude.") ?? fraudList)}
      {kind === "reviews" && (loadState(!reviews.length, "No has reportado ningún comentario.") ?? reviewList)}
      {kind === "all" && (
        <>
          {withTickets && section("Problemas de la plataforma", <MyTickets />)}
          {loadState(!withTickets && !fraud.length && !reviews.length, "Todavía no has hecho ningún reporte. Si ves algo raro en un producto, una tienda o un comentario, usa el botón Reportar.") ?? (
            <>
              {fraud.length > 0 && section("Fraude", fraudList)}
              {reviews.length > 0 && section("Comentarios", reviewList)}
            </>
          )}
        </>
      )}
    </div>
  );
}

// --- Las dos pestañas juntas ---------------------------------------------------------------------------------------------

export function ReportsCenter({ audience }) {
  const [params, setParams] = useSearchParams();
  const view = params.get("vista") === "enviados" ? "made" : "received";
  const isVendor = audience === "vendor";
  const { data: received } = useQuery({ queryKey: ["my-fraud-reports"], queryFn: async () => (await api.get("/reports/me/list")).data.reports });
  const pending = (received ?? []).filter((r) => r.status === "EVIDENCE_REQUESTED" && !r.evidenceSentAt).length;

  const TABS = [
    { id: "received", label: pending ? `Recibidos (${pending})` : "Recibidos", icon: Inbox },
    { id: "made", label: "Enviados", icon: Send },
  ];
  const setView = (id) => {
    const next = new URLSearchParams(params);
    if (id === "made") next.set("vista", "enviados");
    else next.delete("vista");
    setParams(next, { replace: true });
  };

  return (
    <div>
      <Tabs tabs={TABS} value={view} onChange={setView} className="mb-4" />
      {view === "received" ? (
        <>
          <p className="mb-3 text-[13px] text-on-surface-variant">
            {isVendor
              ? "Lo que clientes, otras tiendas o el equipo reportaron de tu tienda o tus productos. Si te piden una explicación, respóndela antes del plazo."
              : "Lo que otras personas reportaron de tus ventas rápidas. Si te piden una explicación, respóndela antes del plazo."}
          </p>
          <ReceivedReports emptyText={isVendor ? "Nadie ha reportado tu tienda ni tus productos." : "Nadie ha reportado tus ventas rápidas."} />
        </>
      ) : (
        <>
          <p className="mb-3 text-[13px] text-on-surface-variant">
            {isVendor ? "Lo que tu tienda reportó y en qué estado está: problemas de la plataforma, fraudes y comentarios." : "Lo que reportaste y en qué estado está."}
          </p>
          <MadeReports withTickets={isVendor} />
        </>
      )}
    </div>
  );
}
