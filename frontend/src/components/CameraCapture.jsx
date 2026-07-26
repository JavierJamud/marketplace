import { useEffect, useRef, useState } from "react";
import { Camera, RotateCcw, AlertTriangle } from "lucide-react";

const COUNTDOWN_SECONDS = 3;

// Captura en vivo por cámara — Bloque 10, reemplaza el input de archivo del
// KYC. Nunca ofrece un selector de galería: si el navegador niega el
// permiso, se muestra un aviso claro en vez de un fallback a upload de
// archivo (eso rompería el propósito anti-fraude del flujo).
// shape: "oval" (selfie, con línea de escaneo) | "rect" (documento, marco guía).
export function CameraCapture({ shape, label, instructions, facingMode = "user", onCaptured }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);

  // idle | requesting | denied | live | counting | done
  const [phase, setPhase] = useState("idle");
  const [count, setCount] = useState(COUNTDOWN_SECONDS);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    return () => {
      stopStream();
      clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  // El <video> solo se monta en el DOM cuando phase pasa a "live"/"counting"
  // (ver el render más abajo) — asignar srcObject ANTES de eso no hace nada
  // porque videoRef.current todavía es null. Este effect corre después de
  // que React commitea el nuevo DOM, momento en el que el ref ya existe.
  useEffect(() => {
    if ((phase === "live" || phase === "counting") && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [phase]);

  async function startCamera() {
    setPhase("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: false });
      streamRef.current = stream;
      setPhase("live");
    } catch {
      setPhase("denied");
    }
  }

  function startCountdown() {
    setPhase("counting");
    let n = COUNTDOWN_SECONDS;
    setCount(n);
    const tick = () => {
      n -= 1;
      if (n <= 0) {
        capture();
      } else {
        setCount(n);
        timerRef.current = setTimeout(tick, 1000);
      }
    };
    timerRef.current = setTimeout(tick, 1000);
  }

  function capture(attempt = 0) {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    if (!video.videoWidth || !video.videoHeight) {
      // El stream todavía no entregó un frame real — reintentar un par de
      // frames en vez de armar un canvas 0x0 (que produce un blob null).
      if (attempt < 30) {
        requestAnimationFrame(() => capture(attempt + 1));
      } else {
        setPhase("live");
      }
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setPhase("live");
          return;
        }
        stopStream();
        setPreviewUrl(URL.createObjectURL(blob));
        setPhase("done");
        onCaptured(blob);
      },
      "image/jpeg",
      0.9
    );
  }

  function retake() {
    setPreviewUrl(null);
    onCaptured(null);
    startCamera();
  }

  return (
    <div className="overflow-hidden rounded-lg border border-surface-container-high">
      <div className="relative flex aspect-[4/3] w-full items-center justify-center bg-[#101418]">
        {phase === "idle" && (
          <button
            type="button"
            onClick={startCamera}
            className="flex flex-col items-center gap-2.5 text-white/85 hover:text-white"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
              <Camera className="h-6 w-6" />
            </span>
            <span className="text-[13px] font-semibold">Activar cámara</span>
          </button>
        )}

        {phase === "requesting" && <p className="text-[13px] text-white/70">Solicitando acceso a la cámara...</p>}

        {phase === "denied" && (
          <div className="flex max-w-[240px] flex-col items-center gap-2 text-center">
            <AlertTriangle className="h-7 w-7 text-secondary-container" />
            <p className="text-[12.5px] text-white/85">
              No pudimos acceder a tu cámara. Habilita el permiso de cámara en tu navegador para continuar — el KYC no acepta fotos
              de galería.
            </p>
            <button type="button" onClick={startCamera} className="mt-1 text-[12.5px] font-bold text-secondary-container">
              Reintentar
            </button>
          </div>
        )}

        {(phase === "live" || phase === "counting") && (
          <>
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
            {shape === "oval" ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="relative h-[78%] w-[58%] overflow-hidden rounded-[50%] border-[3px] border-white/85">
                  <div className="absolute inset-x-0 h-[3px] animate-kyc-scan bg-verified shadow-[0_0_10px_2px_rgba(12,174,83,0.8)]" />
                </div>
              </div>
            ) : (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                <div className="h-full w-full animate-kyc-pulse rounded-lg border-[3px] border-dashed border-white/85" />
              </div>
            )}
            {phase === "counting" && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 font-display text-3xl font-extrabold text-primary">
                  {count}
                </span>
              </div>
            )}
            {phase === "live" && (
              <p className="absolute bottom-3 left-0 right-0 text-center text-[12px] font-semibold text-white/90">
                {instructions}
              </p>
            )}
          </>
        )}

        {phase === "done" && previewUrl && (
          <img src={previewUrl} alt={label} className="h-full w-full object-cover" />
        )}

        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="flex items-center justify-between gap-3 bg-surface-container-lowest px-3.5 py-2.5">
        <span className="text-[11.5px] font-semibold text-outline">
          {label}
          {phase === "done" && " · ✓ Capturada"}
        </span>
        {phase === "live" && (
          <button
            type="button"
            onClick={startCountdown}
            className="rounded-[7px] bg-secondary-container px-3 py-1.5 text-[12px] font-bold text-on-secondary-container"
          >
            Capturar
          </button>
        )}
        {phase === "done" && (
          <button type="button" onClick={retake} className="flex items-center gap-1 text-[12px] font-bold text-tertiary-accent">
            <RotateCcw className="h-3.5 w-3.5" /> Volver a capturar
          </button>
        )}
      </div>
    </div>
  );
}
