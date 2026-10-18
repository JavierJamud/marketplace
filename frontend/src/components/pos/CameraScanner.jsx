import { useEffect, useRef, useState } from "react";
import { CameraOff, X } from "lucide-react";

// Lector de códigos con la cámara del celular o la tablet: lee sin parar (códigos de barras y QR) y llama a onScan con cada
// código. El mismo código no se repite antes de REPEAT_MS: así sostener el producto frente a la cámara no lo suma diez veces,
// pero pasarlo de nuevo sí suma otra unidad. La librería se carga solo al abrir la cámara.
const REPEAT_MS = 1500;

export function CameraScanner({ onScan, onClose, title = "Escanear", hint }) {
  const videoRef = useRef(null);
  const last = useRef({ code: "", at: 0 });
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [error, setError] = useState("");
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let controls = null;
    let cancelled = false;
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 120 });
        controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, videoRef.current, (result) => {
          if (!result) return;
          const code = result.getText().trim();
          const now = Date.now();
          if (!code || (code === last.current.code && now - last.current.at < REPEAT_MS)) return;
          last.current = { code, at: now };
          setFlash(true);
          setTimeout(() => setFlash(false), 180);
          navigator.vibrate?.(40);
          onScanRef.current(code);
        });
        if (cancelled) controls.stop();
      } catch (err) {
        if (cancelled) return;
        setError(
          err?.name === "NotAllowedError"
            ? "No diste permiso para usar la cámara. Actívalo en los ajustes del navegador o escribe el código."
            : "No se pudo abrir la cámara en este dispositivo. Escribe el código o usa un lector USB."
        );
      }
    })();
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, []);

  return (
    <div className="overflow-hidden rounded-2xl border border-surface-container-high bg-inverse-surface">
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-white">
        <p className="text-[13px] font-bold">{title}</p>
        <button type="button" onClick={onClose} aria-label="Cerrar la cámara" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>
      {error ? (
        <div className="flex flex-col items-center gap-2 px-4 pb-5 pt-2 text-center text-[13px] text-white/85">
          <CameraOff className="h-8 w-8" aria-hidden="true" />
          {error}
        </div>
      ) : (
        <div className="relative">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} muted playsInline className="block aspect-[4/3] w-full bg-black object-cover" />
          <div className={`pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 transition-colors ${flash ? "bg-verified" : "bg-secondary"}`} aria-hidden="true" />
          {hint && <p className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-1.5 text-center text-[12px] text-white">{hint}</p>}
        </div>
      )}
    </div>
  );
}
