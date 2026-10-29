import { useEffect, useState } from "react";
import { X, ShieldAlert, Camera, Trash2 } from "lucide-react";
import { api, getErrorMessage } from "../lib/api.js";
import toast from "../lib/toast.jsx";
import { lockPageScroll } from "../lib/scrollLock.js";

const MAX_SCREENSHOT_MB = 6;
const MAX_IMAGES = 4;

/**
 * ReportFraudModal: reportar un producto, una tienda o una venta rápida. El motivo es obligatorio; las capturas son
 * opcionales (pedido del dueño), solo imágenes y hasta 4. El botón que lo abre solo se muestra con sesión iniciada.
 *
 * Props:
 *   open        {boolean}
 *   onClose     {function}
 *   targetField {"productId"|"vendorId"|"customerListingId"}
 *   targetId    {string}
 *   targetLabel {string} — ej. "este producto", "esta tienda", "este anuncio"
 */
export function ReportFraudModal({ open, onClose, targetField, targetId, targetLabel = "esto" }) {
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState([]); // [{ file, url }]
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setMessage("");
      setFiles([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", onKey);
    const unlock = lockPageScroll();
    return () => {
      document.removeEventListener("keydown", onKey);
      unlock();
    };
  }, [open, onClose]);

  if (!open) return null;

  function handleFiles(e) {
    const picked = [...(e.target.files ?? [])];
    e.target.value = "";
    const next = [];
    for (const file of picked) {
      if (!file.type.startsWith("image/")) {
        toast.error("Solo se pueden subir imágenes.");
        continue;
      }
      if (file.size > MAX_SCREENSHOT_MB * 1024 * 1024) {
        toast.error(`Cada imagen puede pesar hasta ${MAX_SCREENSHOT_MB} MB.`);
        continue;
      }
      next.push({ file, url: URL.createObjectURL(file) });
    }
    setFiles((prev) => [...prev, ...next].slice(0, MAX_IMAGES));
  }

  async function handleSubmit() {
    if (message.trim().length < 10) return toast.error("Cuéntanos el motivo (mínimo 10 caracteres)."); 

    setSubmitting(true);
    try {
      const form = new FormData();
      form.append(targetField, targetId);
      form.append("message", message.trim());
      for (const f of files) form.append("images", f.file);
      await api.post("/reports", form, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Reporte enviado. Lo revisamos y te avisamos por correo.");
      onClose?.();
    } catch (err) {
      toast.error(await getErrorMessage(err, "No se pudo enviar el reporte."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        className="modal-panel-6 relative w-full max-w-md rounded-2xl bg-surface-container-lowest p-6 shadow-2xl motion-safe:animate-modal-pop"
      >
        <button onClick={onClose} className="absolute right-4 top-4 rounded-full p-1.5 text-outline hover:bg-surface-variant hover:text-on-surface">
          <X className="h-4 w-4" />
        </button>

        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-error/10">
          <ShieldAlert className="h-6 w-6 text-error" />
        </div>

        <h2 className="mb-1 text-[16px] font-bold text-on-surface">Reportar</h2>
        <p className="mb-4 text-[13.5px] leading-relaxed text-on-surface-variant">
          Cuéntanos qué pasa con {targetLabel}. Lo revisamos y te avisamos por correo lo que decidimos. Mientras lo revisamos, sigue publicado.
        </p>

        <label htmlFor="report-message" className="mb-1 block text-[12.5px] font-semibold text-on-surface">
          Motivo del reporte
        </label>
        <textarea
          id="report-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="Por ejemplo: pagué y nunca lo entregaron, o las fotos son de otro producto."
          className="mb-4 w-full resize-none rounded-xl border border-outline-variant bg-surface-container-lowest p-3 text-[13.5px] text-on-surface outline-none focus:border-primary"
        />

        <div className="mb-1 text-[12.5px] font-semibold text-on-surface">Capturas o fotos (opcional)</div>
        <p className="mb-2 text-[12px] text-on-surface-variant">Si tienes pruebas, súbelas: solo imágenes, hasta {MAX_IMAGES}.</p>
        {files.length > 0 && (
          <div className="mb-2 grid grid-cols-4 gap-2">
            {files.map((f, i) => (
              <div key={f.url} className="relative aspect-square overflow-hidden rounded-lg bg-surface-container">
                <img src={f.url} alt={`Captura ${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={`Quitar captura ${i + 1}`}
                  className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        {files.length < MAX_IMAGES && (
          <label className="mb-4 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-outline-variant p-3 text-center hover:bg-surface-variant/40">
            <Camera className="h-5 w-5 text-outline" aria-hidden="true" />
            <span className="text-[12.5px] font-semibold text-on-surface-variant">{files.length ? "Agregar otra imagen" : "Subir imágenes"}</span>
            <input type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
          </label>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={onClose}
            className="order-2 rounded-xl border border-outline-variant px-5 py-2.5 text-[13px] font-semibold text-on-surface transition hover:bg-surface-variant sm:order-1"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="order-1 rounded-xl bg-error px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-error/90 disabled:cursor-not-allowed disabled:opacity-50 sm:order-2"
          >
            {submitting ? "Enviando..." : "Enviar reporte"}
          </button>
        </div>
      </div>

    </div>
  );
}
