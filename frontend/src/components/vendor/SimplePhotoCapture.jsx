import { useEffect, useRef, useState } from "react";
import { Camera, RotateCcw, Upload } from "lucide-react";

// Bloque 183 (pedido explícito — "al registrar ese nuevo usuario... el
// vendedor o administrador deberá tomar una foto de ese usuario
// registrado"): a propósito MUCHO más simple que CameraCapture.jsx (el de
// KYC — detección de rostro, cuenta regresiva automática, video de
// liveness girando la cabeza). Esto es solo "sacale una foto a la persona
// que tenés al lado" — cámara + botón de captura manual + reintentar, sin
// ninguna de esas piezas que acá no hacen falta. También acepta subir un
// archivo (por si la cámara del dispositivo no anda o el vendedor prefiere
// una foto que ya tiene).
export function SimplePhotoCapture({ onCaptured }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const streamRef = useRef(null);
  const [phase, setPhase] = useState("idle"); // idle | requesting | denied | live | done
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    return () => stopStream();
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    if (phase === "live" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [phase]);

  async function startCamera() {
    setPhase("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;
      setPhase("live");
    } catch {
      setPhase("denied");
    }
  }

  function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stopStream();
        setPreviewUrl(URL.createObjectURL(blob));
        setPhase("done");
        onCaptured(blob);
      },
      "image/jpeg",
      0.9
    );
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    stopStream();
    setPreviewUrl(URL.createObjectURL(file));
    setPhase("done");
    onCaptured(file);
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
            <p className="text-[12.5px] text-white/85">No pudimos acceder a la cámara. Puedes subir una foto en su lugar.</p>
            <button type="button" onClick={startCamera} className="text-[12.5px] font-bold text-secondary-container">
              Reintentar cámara
            </button>
          </div>
        )}
        {phase === "live" && <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />}
        {phase === "done" && previewUrl && <img src={previewUrl} alt="Foto capturada" className="h-full w-full object-cover" />}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="flex items-center justify-between gap-3 bg-surface-container-lowest px-3.5 py-2.5">
        <span className="text-[11.5px] font-semibold text-outline">
          Foto del usuario{phase === "done" && " · ✓ Capturada"}
        </span>
        <div className="flex items-center gap-2">
          {phase === "live" && (
            <button type="button" onClick={capture} className="rounded-[7px] bg-secondary-container px-3 py-1.5 text-[12px] font-bold text-on-secondary-container">
              Capturar
            </button>
          )}
          {phase === "done" && (
            <button type="button" onClick={retake} className="flex items-center gap-1 text-[12px] font-bold text-tertiary-accent">
              <RotateCcw className="h-3.5 w-3.5" /> Volver a tomar
            </button>
          )}
          {phase !== "done" && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 text-[12px] font-semibold text-outline hover:text-on-surface"
            >
              <Upload className="h-3.5 w-3.5" /> Subir foto
            </button>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
        </div>
      </div>
    </div>
  );
}
