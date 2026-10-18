import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bug, Camera, CheckCircle2, Mic, Square, X } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { captureViewport } from "../../lib/screenCapture.js";
import { getDiagnostics } from "../../lib/diagnostics.js";
import { sectionForPath } from "../../lib/vendorSections.js";
import { exactDateTime } from "../../lib/relativeTime.js";
import { lockPageScroll } from "../../lib/scrollLock.js";
import { useVoiceRecorder } from "../../lib/useVoiceRecorder.js";
import { revealText, appendWord } from "../../lib/revealText.js";
import { RecordingIndicator, TranscribingIndicator } from "../RecordingIndicator.jsx";

// Botón flotante del panel de la tienda para reportar un error visual. Al tocarlo se toma primero la captura de lo que la
// persona ve (antes de abrir la ventana, para que la ventana no salga en ella); después la persona cuenta el problema,
// escribiéndolo o dictándolo (misma grabación y animación que el chat). Se envía con una copia de la consola y de lo último
// que hizo en la página (lib/diagnostics.js). El admin lo recibe al instante como ticket numerado.
const STATUS = {
  NEW: { label: "Recibido", tone: "bg-surface-container text-on-surface-variant" },
  IN_REVIEW: { label: "En revisión", tone: "bg-tertiary-accent/10 text-tertiary-accent" },
  WAITING_REPORTER: { label: "Esperando tu respuesta", tone: "bg-secondary-container/30 text-on-surface" },
  RESOLVED: { label: "Solucionado", tone: "bg-verified/10 text-verified-dark" },
  CLOSED_NO_EVIDENCE: { label: "Cerrado sin evidencia", tone: "bg-error/10 text-error" },
  CLOSED_NOT_A_BUG: { label: "Cerrado: no es un error", tone: "bg-surface-container text-on-surface-variant" },
};
const MIN_DESCRIPTION = 10;

export function ReportProblemButton() {
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [shot, setShot] = useState(null); // { blob, url } | { failed: true }
  const [page, setPage] = useState("");

  async function start() {
    if (capturing) return;
    setCapturing(true);
    const where = `${pathname}${search}`;
    try {
      const blob = await captureViewport();
      setShot(blob ? { blob, url: URL.createObjectURL(blob) } : { failed: true });
    } catch {
      setShot({ failed: true });
    } finally {
      setPage(where);
      setCapturing(false);
      setOpen(true);
    }
  }

  function close() {
    setOpen(false);
    if (shot?.url) URL.revokeObjectURL(shot.url);
    setShot(null);
  }

  return (
    <>
      <button
        type="button"
        data-no-capture
        onClick={start}
        disabled={capturing}
        aria-label="Reportar un problema en esta pantalla"
        title="Reportar un problema en esta pantalla"
        className="fixed bottom-4 left-4 z-40 flex h-12 items-center gap-2 rounded-full border border-surface-container-high bg-surface-container-lowest px-3.5 text-[13px] font-bold text-on-surface shadow-[0_10px_28px_-8px_rgba(14,26,40,0.38)] transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent disabled:opacity-70 sm:bottom-6 sm:left-6 lg:left-[296px] [html[data-camera-open]_&]:hidden"
      >
        {capturing ? <Camera className="h-5 w-5 animate-pulse text-tertiary-accent" aria-hidden="true" /> : <Bug className="h-5 w-5 text-tertiary-accent" aria-hidden="true" />}
        <span className="hidden sm:inline">{capturing ? "Tomando captura..." : "Reportar un problema"}</span>
      </button>
      {open && <ReportDialog shot={shot} page={page} onRetake={() => { close(); setTimeout(start, 150); }} onClose={close} />}
    </>
  );
}

function ReportDialog({ shot, page, onRetake, onClose }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("new");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null);
  const [zoom, setZoom] = useState(false);
  const voice = useVoiceRecorder();
  const dialogRef = useRef(null);
  const section = sectionForPath(page) ?? page;

  useEffect(() => {
    const unlock = lockPageScroll();
    const onKey = (e) => {
      if (e.key === "Escape" && !sending) onClose();
    };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.querySelector("textarea")?.focus();
    return () => {
      unlock();
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, sending]);

  async function stopVoice() {
    const spoken = await voice.stop();
    if (spoken) await revealText(spoken, (word, first) => setText((prev) => appendWord(prev, word, first)));
  }

  async function submit(e) {
    e.preventDefault();
    if (text.trim().length < MIN_DESCRIPTION || sending) return;
    setSending(true);
    try {
      const { consoleLog, activityTrail } = getDiagnostics();
      const form = new FormData();
      form.append("description", text.trim());
      form.append("pagePath", page);
      if (section) form.append("section", section);
      form.append("consoleLog", JSON.stringify(consoleLog));
      form.append("activityTrail", JSON.stringify(activityTrail));
      form.append(
        "device",
        JSON.stringify({
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          screen: `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}`,
          pixelRatio: window.devicePixelRatio || 1,
          language: navigator.language,
          online: navigator.onLine,
          version: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined,
          standalone: window.matchMedia?.("(display-mode: standalone)").matches ?? false,
        })
      );
      if (shot?.blob) form.append("screenshot", shot.blob, shot.blob.type === "image/webp" ? "captura.webp" : "captura.jpg");
      const { data } = await api.post("/support-tickets", form, { headers: { "Content-Type": "multipart/form-data" } });
      setSent(data.ticket);
      queryClient.invalidateQueries({ queryKey: ["my-support-tickets"] });
    } catch (err) {
      toast.error(err.response?.data?.error ?? "No se pudo enviar el reporte. Prueba de nuevo.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[160] flex items-end justify-center bg-black/45 sm:items-center sm:p-4" data-no-capture onClick={() => !sending && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-problem-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[94dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-surface-container-lowest sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-2 border-b border-surface-container-high px-4 py-3">
          <h2 id="report-problem-title" className="flex items-center gap-2 text-[15px] font-bold text-on-surface">
            <Bug className="h-5 w-5 text-tertiary-accent" aria-hidden="true" /> Reportar un problema
          </h2>
          <button type="button" onClick={onClose} disabled={sending} aria-label="Cerrar" className="flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div role="tablist" className="flex gap-1 border-b border-surface-container-high px-3">
          {[
            ["new", "Nuevo reporte"],
            ["mine", "Mis reportes"],
          ].map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`min-h-11 border-b-2 px-3 text-[13px] font-semibold ${tab === key ? "border-tertiary-accent text-tertiary-accent" : "border-transparent text-on-surface-variant"}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {tab === "mine" ? (
            <MyTickets />
          ) : sent ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CheckCircle2 className="h-10 w-10 text-verified-dark" aria-hidden="true" />
              <p className="text-[15px] font-bold text-on-surface">Reporte enviado</p>
              <p className="text-[13.5px] text-on-surface-variant">
                Tu número de ticket es <strong className="text-on-surface">{sent.code}</strong>. Te escribiremos a tu correo cuando tengamos una respuesta. También puedes verlo en «Mis reportes».
              </p>
              <button type="button" onClick={onClose} className="mt-2 min-h-11 rounded-full bg-primary px-6 text-[13.5px] font-bold text-white">
                Listo
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-3">
              <p className="flex gap-2 rounded-xl bg-secondary-container/20 px-3 py-2.5 text-[12.5px] leading-relaxed text-on-surface">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-secondary" aria-hidden="true" />
                <span>
                  Tienes que estar en la pantalla donde está el problema: la captura muestra lo que ves ahora. Si no estás en ella, cierra esta ventana, ve a esa pantalla y vuelve a tocar «Reportar un problema». Un reporte sin la captura del problema real se cierra sin solución.
                </span>
              </p>

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-on-surface">Captura de {section || "esta pantalla"}</span>
                  <button type="button" onClick={onRetake} className="min-h-9 rounded-full px-2 text-[12.5px] font-semibold text-tertiary-accent hover:underline">
                    Tomar otra
                  </button>
                </div>
                {shot?.url ? (
                  <button type="button" onClick={() => setZoom(true)} className="block w-full overflow-hidden rounded-xl border border-surface-container-high bg-surface-container" aria-label="Ver la captura en grande">
                    <img src={shot.url} alt="Captura de lo que se veía al tocar el botón" className="mx-auto max-h-56 w-auto object-contain" />
                  </button>
                ) : (
                  <p className="rounded-xl bg-error/5 px-3 py-2.5 text-[12.5px] text-error">No se pudo tomar la captura en este dispositivo. Puedes enviar el reporte igual, pero explica muy bien qué ves en la pantalla.</p>
                )}
              </div>

              <div>
                <label htmlFor="report-problem-text" className="mb-1.5 block text-[12.5px] font-semibold text-on-surface">
                  Cuéntanos el problema con detalle
                </label>
                <div className="flex items-end gap-2">
                  {voice.state === "recording" ? (
                    <RecordingIndicator stream={voice.stream} onCancel={voice.cancel} className="min-h-11" />
                  ) : voice.state === "transcribing" ? (
                    <TranscribingIndicator className="min-h-11" />
                  ) : (
                    <textarea
                      id="report-problem-text"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      rows={4}
                      maxLength={4000}
                      placeholder="Qué estabas haciendo, qué esperabas que pasara y qué pasó. Por ejemplo: al tocar «Confirmar venta» el botón no responde."
                      className="min-h-28 min-w-0 flex-1 resize-y rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-[14px] text-on-surface outline-none focus:border-tertiary-accent"
                    />
                  )}
                  {voice.supported && (
                    <button
                      type="button"
                      onClick={voice.state === "recording" ? stopVoice : voice.start}
                      disabled={voice.state === "transcribing" || sending}
                      aria-label={voice.state === "recording" ? "Detener y pasar la voz a texto" : "Dictar el problema con la voz"}
                      className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ${voice.state === "recording" ? "bg-error text-white" : "bg-surface-container text-on-surface hover:bg-surface-container-high"} disabled:opacity-50`}
                    >
                      {voice.state === "recording" ? <Square className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-5 w-5" aria-hidden="true" />}
                    </button>
                  )}
                </div>
                <p className="mt-1 text-[11.5px] text-on-surface-variant">
                  Puedes escribir o tocar el micrófono y hablar: tu voz se pasa a texto en la casilla para que la revises.
                  {text.trim().length > 0 && text.trim().length < MIN_DESCRIPTION ? ` Escribe al menos ${MIN_DESCRIPTION} caracteres.` : ""}
                </p>
              </div>

              <p className="text-[11.5px] leading-relaxed text-on-surface-variant">
                Junto con tu explicación se envía una copia de la consola de tu navegador y lo último que hiciste en el panel (pantallas, botones y respuestas del servidor), para entender qué pasó. Nunca lo que escribiste en los campos. Se guarda 90 días.
              </p>

              <button type="submit" disabled={sending || text.trim().length < MIN_DESCRIPTION || voice.state !== "idle"} className="min-h-12 rounded-xl bg-primary text-[14px] font-bold text-white disabled:opacity-50">
                {sending ? "Enviando..." : "Enviar reporte"}
              </button>
            </form>
          )}
        </div>
      </div>
      {zoom && shot?.url && (
        <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/85 p-3" onClick={(e) => { e.stopPropagation(); setZoom(false); }}>
          <img src={shot.url} alt="Captura en grande" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </div>
  );
}

function MyTickets() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["my-support-tickets"], queryFn: async () => (await api.get("/support-tickets/mine")).data.tickets });
  if (isLoading) return <p className="text-[13px] text-on-surface-variant">Cargando...</p>;
  if (isError)
    return (
      <p className="text-[13px] text-error">
        No se pudieron cargar tus reportes.{" "}
        <button type="button" onClick={() => refetch()} className="font-semibold underline">
          Reintentar
        </button>
      </p>
    );
  if (!data?.length) return <p className="text-[13px] text-on-surface-variant">Todavía no enviaste ningún reporte.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {data.map((t) => {
        const st = STATUS[t.status] ?? STATUS.NEW;
        return (
          <li key={t.id} className="rounded-xl border border-surface-container-high p-3">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <span className="text-[13px] font-bold text-on-surface">{t.code}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${st.tone}`}>{st.label}</span>
              {t.section && <span className="text-[12px] text-on-surface-variant">· {t.section}</span>}
            </div>
            <p className="line-clamp-3 text-[13px] text-on-surface">{t.description}</p>
            <p className="mt-0.5 text-[11.5px] text-outline">{exactDateTime(t.createdAt)}</p>
            {t.resolution && <p className="mt-2 rounded-lg bg-verified/5 px-2.5 py-1.5 text-[12.5px] text-on-surface"><strong>Cómo se solucionó:</strong> {t.resolution}</p>}
            {t.messages.filter((m) => m.body).map((m) => (
              <p key={m.id} className="mt-2 rounded-lg bg-surface-container/60 px-2.5 py-1.5 text-[12.5px] text-on-surface">
                <strong>Respuesta del equipo:</strong> {m.body}
                <span className="block text-[11px] text-outline">{exactDateTime(m.createdAt)}</span>
              </p>
            ))}
          </li>
        );
      })}
    </ul>
  );
}
