import { useEffect, useState } from "react";
import { X, ShieldAlert, Camera } from "lucide-react";
import { api, getErrorMessage } from "../lib/api.js";
import toast from "../lib/toast.jsx";

const MAX_SCREENSHOT_MB = 6;

/**
 * ReportFraudModal — Feature B (pedido explícito): reportar una posible
 * estafa en un producto, tienda o anuncio de venta rápida. Captura de
 * pantalla y mensaje son los dos obligatorios (mismo criterio que el
 * backend, ver reports.controller.js) — el botón que abre este modal debe
 * resolver el login ANTES de abrirlo (mismo patrón que goToReviewLogin en
 * Product.jsx), acá se asume que ya hay sesión.
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
  const [screenshot, setScreenshot] = useState(null);
  const [preview, setPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setMessage("");
      setScreenshot(null);
      setPreview(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_SCREENSHOT_MB * 1024 * 1024) {
      toast.error(`La captura no puede pesar más de ${MAX_SCREENSHOT_MB}MB.`);
      return;
    }
    setScreenshot(file);
    setPreview(URL.createObjectURL(file));
  }

  async function handleSubmit() {
    if (!screenshot) return toast.error("La captura de pantalla es obligatoria.");
    if (message.trim().length < 10) return toast.error("Contanos qué pasó (mínimo 10 caracteres).");

    setSubmitting(true);
    try {
      const form = new FormData();
      form.append(targetField, targetId);
      form.append("message", message.trim());
      form.append("screenshot", screenshot);
      await api.post("/reports", form, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Reporte enviado — el equipo lo va a revisar.");
      onClose?.();
    } catch (err) {
      toast.error(await getErrorMessage(err, "No se pudo enviar el reporte."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-surface-container-lowest p-6 shadow-2xl"
        style={{ animation: "modal-pop 0.18s ease-out" }}
      >
        <button onClick={onClose} className="absolute right-4 top-4 rounded-full p-1.5 text-outline hover:bg-surface-variant hover:text-on-surface">
          <X className="h-4 w-4" />
        </button>

        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-error/10">
          <ShieldAlert className="h-6 w-6 text-error" />
        </div>

        <h2 className="mb-1 text-[16px] font-bold text-on-surface">Reportar estafa</h2>
        <p className="mb-4 text-[13.5px] leading-relaxed text-on-surface-variant">
          Contanos qué pasó con {targetLabel}. Un admin revisa cada reporte — captura y mensaje son obligatorios para poder evaluarlo.
        </p>

        <label className="mb-3 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-outline-variant p-4 text-center hover:bg-surface-variant/40">
          {preview ? (
            <img src={preview} alt="Captura" className="h-28 w-full rounded-lg object-cover" />
          ) : (
            <>
              <Camera className="h-6 w-6 text-outline" />
              <span className="text-[12.5px] font-semibold text-on-surface-variant">Subir captura de pantalla (obligatorio)</span>
            </>
          )}
          <input type="file" accept="image/jpeg,image/jpg,image/png,image/webp" className="hidden" onChange={handleFile} />
        </label>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="Explicá qué pasó (mínimo 10 caracteres)..."
          className="mb-4 w-full resize-none rounded-xl border border-outline-variant bg-surface-container-lowest p-3 text-[13.5px] text-on-surface outline-none focus:border-primary"
        />

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

      <style>{`
        @keyframes modal-pop {
          from { opacity: 0; transform: scale(0.94) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
