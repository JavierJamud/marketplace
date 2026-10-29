import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, X } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { REPORT_EVENT, collectReportContext } from "../lib/errorReport.js";
import { Button } from "./ui/Button.jsx";

// Ventana para reportar un problema. Se abre desde el botón de los avisos de "problema de conexión" y desde la pantalla
// de error de la página. La persona cuenta qué estaba haciendo; el sitio agrega la pantalla, la petición que falló y el
// navegador, y todo llega al panel del admin y a su correo. Se cierra con Escape.
export default function ReportErrorModal() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState(null);
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState("idle"); // idle | sending | sent | error
  const textRef = useRef(null);

  useEffect(() => {
    const onOpen = (e) => {
      setFailure(e.detail?.failure ?? null);
      setDescription("");
      setState("idle");
      setOpen(true);
    };
    window.addEventListener(REPORT_EVENT, onOpen);
    return () => window.removeEventListener(REPORT_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    textRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  async function submit(e) {
    e.preventDefault();
    if (description.trim().length < 5) return;
    setState("sending");
    try {
      await api.post(
        "/error-reports",
        { description: description.trim(), contactEmail: !user && email.trim() ? email.trim() : undefined, context: collectReportContext(failure) },
        { skipErrorReport: true }
      );
      setState("sent");
    } catch {
      setState("error");
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/50 p-3 sm:items-center sm:p-4" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby="report-title" className="modal-panel-5 relative w-full max-w-md rounded-2xl bg-surface-container-lowest p-5 shadow-2xl sm:p-6">
        <button onClick={() => setOpen(false)} aria-label="Cerrar" className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-outline hover:bg-surface-container">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        {state === "sent" ? (
          <div className="py-4 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-11 w-11 text-verified" aria-hidden="true" />
            <h2 id="report-title" className="mb-1 font-display text-[19px] font-extrabold text-on-surface">Gracias, ya recibimos tu reporte</h2>
            <p className="mb-5 text-[13.5px] text-on-surface-variant">Lo vamos a revisar. Mientras tanto, puedes intentar de nuevo en unos minutos.</p>
            <Button className="w-full" onClick={() => setOpen(false)}>Cerrar</Button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h2 id="report-title" className="mb-1 pr-10 font-display text-[19px] font-extrabold text-on-surface">Reportar un problema</h2>
            <p className="mb-4 text-[13px] text-on-surface-variant">Cuéntanos qué estabas haciendo o qué pasó. Nosotros añadimos los datos técnicos para encontrarlo más rápido.</p>
            <label htmlFor="report-desc" className="mb-1 block text-label-md font-semibold text-on-surface">¿Qué estabas haciendo?</label>
            <textarea
              id="report-desc"
              ref={textRef}
              required
              minLength={5}
              maxLength={2000}
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Por ejemplo: estaba agregando un producto al carrito y no avanzó."
              className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-[14px] text-on-surface focus:border-tertiary-accent focus:outline-none focus:ring-2 focus:ring-tertiary-accent/30"
            />
            {!user && (
              <>
                <label htmlFor="report-email" className="mb-1 mt-3 block text-label-md font-semibold text-on-surface">Tu correo (opcional, por si necesitamos escribirte)</label>
                <input id="report-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="min-h-11 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[14px] text-on-surface focus:border-tertiary-accent focus:outline-none focus:ring-2 focus:ring-tertiary-accent/30" />
              </>
            )}
            {state === "error" && (
              <p role="alert" className="mt-3 rounded-xl bg-error/10 p-3 text-[13px] font-semibold text-error">
                No pudimos enviar el reporte ahora mismo. Revisa tu conexión e inténtalo otra vez, o escríbenos desde la página de Contacto.
              </p>
            )}
            <Button type="submit" className="mt-4 w-full" disabled={state === "sending" || description.trim().length < 5}>
              {state === "sending" ? "Enviando..." : "Enviar reporte"}
            </Button>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
