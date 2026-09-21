import { useEffect, useRef, useState } from "react";
import { Camera, RotateCcw, AlertTriangle, ArrowLeftCircle, ArrowRightCircle, ScanFace } from "lucide-react";

const COUNTDOWN_SECONDS = 3;

// Bloque 146 (pedido explícito — "quiero que ese láser detecte cuándo la
// persona tenga la cara puesta en el círculo y automáticamente va a ser el
// scanner... la foto del documento... cuando esté bien enmarcada, la foto
// se va a tomar automáticamente"): antes la línea verde de la selfie y el
// marco punteado del documento eran PURAMENTE decorativos — una animación
// CSS en loop, sin ninguna detección real detrás (bug real reportado en
// vivo). Ahora sí hay detección real:
//  - Selfie: FaceDetector nativo del navegador (Shape Detection API) —
//    soportado en Chrome/Edge, NO en Safari/Firefox (no existe un
//    polyfill liviano razonable sin sumar varios MB de un modelo de ML;
//    se decidió no bloquear el trámite en esos navegadores en vez de
//    forzar una dependencia pesada — ver supportsAutoDetection abajo).
//  - Documento: heurístico real de estabilidad de frames (poca diferencia
//    frame a frame = cámara quieta, + contraste real dentro del marco =
//    hay algo ahí, no una superficie lisa) — funciona en cualquier
//    navegador, no depende de ninguna API de detección.
// El botón "Capturar" manual SIEMPRE queda disponible en los 2 casos — la
// detección automática es un plus, nunca lo único que puede disparar la
// foto (así ningún navegador queda sin poder completar el trámite).
const hasFaceDetector = typeof window !== "undefined" && "FaceDetector" in window;
const hasMediaRecorder = typeof window !== "undefined" && "MediaRecorder" in window;

// Cuánto tiene que durar la cara bien encuadrada (o el documento quieto)
// antes de disparar la captura sola — bajo a propósito (~1.5-2s) para que
// se sienta responsivo sin disparar por un frame suelto/con temblor.
const REQUIRED_STABLE_FRAMES = 9;
const DETECT_INTERVAL_MS = 180;

// Bloque 146: el <video> se pinta SIN espejar (no hay transform:scaleX(-1)
// en ningún lado de este archivo) — lo que ve la cámara es exactamente lo
// que se analiza, sin tener que revertir coordenadas para la detección.
function isFaceWellFramed(face, video) {
  const box = face.boundingBox;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return false;
  const cx = (box.x + box.width / 2) / vw;
  const cy = (box.y + box.height / 2) / vh;
  // El óvalo visual (ver el render, h-[78%] w-[58%] centrado) no mapea 1:1
  // contra el frame intrínseco del video por el object-cover del <video>
  // — se usa una tolerancia generosa en vez de una proyección geométrica
  // exacta, suficiente para saber "más o menos centrada y a buena
  // distancia", que es lo que hace falta acá.
  const centered = cx > 0.3 && cx < 0.7 && cy > 0.18 && cy < 0.78;
  const widthRatio = box.width / vw;
  const sizeOk = widthRatio > 0.2 && widthRatio < 0.78;
  return centered && sizeOk;
}

function pickSupportedMimeType() {
  const candidates = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  for (const c of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(c)) return c;
  }
  return undefined;
}

const LIVENESS_PROMPT = {
  "liveness-left": { text: "Gira la cabeza hacia la IZQUIERDA", Icon: ArrowLeftCircle },
  "liveness-right": { text: "Gira la cabeza hacia la DERECHA", Icon: ArrowRightCircle },
};
const LIVENESS_MAX_MS = 4500;
const LIVENESS_SHIFT_THRESHOLD = 0.07;

// shape: "oval" (selfie, con detección de rostro + video de giro) | "rect"
// (documento, con detección de estabilidad+contraste).
// onCaptured(blob|null): la foto frontal (siempre). onVideoCaptured(blob|null)
// (opcional, solo shape="oval"): el video de liveness, si el navegador lo
// soporta — nunca bloquea el flujo si no se pudo grabar.
export function CameraCapture({ shape, label, instructions, facingMode = "user", onCaptured, onVideoCaptured }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const detectRafRef = useRef(null);
  const faceDetectorRef = useRef(null);
  const stableFramesRef = useRef(0);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const capturedPhotoBlobRef = useRef(null);
  const lastFaceCenterXRef = useRef(null);
  const shiftDetectedRef = useRef(false);

  // idle | requesting | denied | live | counting | liveness-left | liveness-right | done
  const [phase, setPhase] = useState("idle");
  const [count, setCount] = useState(COUNTDOWN_SECONDS);
  const [previewUrl, setPreviewUrl] = useState(null);
  // searching | detected — solo relevante para shape="oval" en fase "live".
  const [faceState, setFaceState] = useState("searching");
  // searching | steady — solo relevante para shape="rect" en fase "live".
  const [docState, setDocState] = useState("searching");

  const supportsLiveness = shape === "oval" && hasFaceDetector && hasMediaRecorder;
  const supportsAutoDetection = shape === "oval" ? hasFaceDetector : true; // el heurístico de documento no necesita ninguna API especial.

  useEffect(() => {
    return () => {
      stopStream();
      clearTimeout(timerRef.current);
      cancelAnimationFrame(detectRafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  // El <video> solo se monta en el DOM cuando phase pasa a "live" y fases
  // siguientes — asignar srcObject ANTES de eso no hace nada porque
  // videoRef.current todavía es null. Este effect corre después de que
  // React commitea el nuevo DOM, momento en el que el ref ya existe.
  useEffect(() => {
    const showsVideo = phase === "live" || phase === "counting" || phase === "liveness-left" || phase === "liveness-right";
    if (showsVideo && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [phase]);

  async function startCamera() {
    setPhase("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: supportsLiveness });
      streamRef.current = stream;
      setPhase("live");
    } catch {
      setPhase("denied");
    }
  }

  // --- Detección automática mientras phase === "live" -----------------------
  useEffect(() => {
    if (phase !== "live" || !supportsAutoDetection) {
      stableFramesRef.current = 0;
      setFaceState("searching");
      setDocState("searching");
      return;
    }

    let cancelled = false;
    let lastRun = 0;

    if (shape === "oval") {
      if (!faceDetectorRef.current) {
        try {
          faceDetectorRef.current = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
        } catch {
          return; // API presente pero falló al construir — se queda en manual.
        }
      }
      const tick = (ts) => {
        if (cancelled) return;
        if (ts - lastRun >= DETECT_INTERVAL_MS && videoRef.current?.readyState >= 2) {
          lastRun = ts;
          faceDetectorRef.current
            .detect(videoRef.current)
            .then((faces) => {
              if (cancelled) return;
              const ok = faces.length === 1 && isFaceWellFramed(faces[0], videoRef.current);
              if (ok) {
                stableFramesRef.current += 1;
                setFaceState("detected");
                if (stableFramesRef.current >= REQUIRED_STABLE_FRAMES) {
                  cancelled = true;
                  startCountdown();
                  return;
                }
              } else {
                stableFramesRef.current = 0;
                setFaceState("searching");
              }
            })
            .catch(() => {
              // Un frame que falla no rompe nada — simplemente no cuenta
              // para la racha de frames estables.
            });
        }
        detectRafRef.current = requestAnimationFrame(tick);
      };
      detectRafRef.current = requestAnimationFrame(tick);
    } else {
      // Documento: estabilidad de frames (poco movimiento) + contraste real
      // (hay algo adentro del marco, no una superficie lisa) — ver el
      // comentario largo arriba del archivo.
      const sampleCanvas = document.createElement("canvas");
      sampleCanvas.width = 64;
      sampleCanvas.height = 48;
      const sctx = sampleCanvas.getContext("2d", { willReadFrequently: true });
      let prevFrame = null;

      const tick = (ts) => {
        if (cancelled) return;
        if (ts - lastRun >= DETECT_INTERVAL_MS && videoRef.current?.readyState >= 2) {
          lastRun = ts;
          try {
            sctx.drawImage(videoRef.current, 0, 0, sampleCanvas.width, sampleCanvas.height);
            const frame = sctx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
            if (prevFrame) {
              let diff = 0;
              let min = 255;
              let max = 0;
              for (let i = 0; i < frame.length; i += 4) {
                diff += Math.abs(frame[i] - prevFrame[i]);
                if (frame[i] < min) min = frame[i];
                if (frame[i] > max) max = frame[i];
              }
              const avgDiff = diff / (frame.length / 4);
              const hasContrast = max - min > 40;
              if (avgDiff < 6 && hasContrast) {
                stableFramesRef.current += 1;
                setDocState("steady");
                if (stableFramesRef.current >= REQUIRED_STABLE_FRAMES) {
                  cancelled = true;
                  startCountdown();
                  return;
                }
              } else {
                stableFramesRef.current = 0;
                setDocState("searching");
              }
            }
            prevFrame = frame;
          } catch {
            // Frame ilegible (raro) — no cuenta, sigue intentando.
          }
        }
        detectRafRef.current = requestAnimationFrame(tick);
      };
      detectRafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(detectRafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, shape]);

  // --- Giro de cabeza (liveness) mientras phase es liveness-left/right ------
  useEffect(() => {
    if (phase !== "liveness-left" && phase !== "liveness-right") return;
    if (!hasFaceDetector) {
      advanceLiveness();
      return;
    }
    let cancelled = false;
    const startTime = performance.now();

    const tick = (ts) => {
      if (cancelled) return;
      const elapsed = ts - startTime;
      const finish = () => {
        cancelled = true;
        advanceLiveness();
      };
      if (videoRef.current?.readyState >= 2 && faceDetectorRef.current) {
        faceDetectorRef.current
          .detect(videoRef.current)
          .then((faces) => {
            if (cancelled) return;
            if (faces.length === 1) {
              const box = faces[0].boundingBox;
              const cx = (box.x + box.width / 2) / videoRef.current.videoWidth;
              if (lastFaceCenterXRef.current === null) lastFaceCenterXRef.current = cx;
              const delta = cx - lastFaceCenterXRef.current;
              // Sin espejar el video: al girar la cabeza hacia SU izquierda,
              // la cámara la ve moverse hacia la derecha del frame (delta
              // positivo) — por eso el signo pedido es el opuesto del lado
              // del prompt.
              const wantsPositiveDelta = phase === "liveness-left";
              const shifted = wantsPositiveDelta ? delta > LIVENESS_SHIFT_THRESHOLD : delta < -LIVENESS_SHIFT_THRESHOLD;
              if (shifted) shiftDetectedRef.current = true;
            }
            if (shiftDetectedRef.current || elapsed >= LIVENESS_MAX_MS) finish();
            else detectRafRef.current = requestAnimationFrame(tick);
          })
          .catch(() => {
            if (elapsed >= LIVENESS_MAX_MS) finish();
            else detectRafRef.current = requestAnimationFrame(tick);
          });
      } else if (elapsed >= LIVENESS_MAX_MS) {
        finish();
      } else {
        detectRafRef.current = requestAnimationFrame(tick);
      }
    };
    detectRafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(detectRafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // `advanceLiveness` se recrea en cada render con el `phase` de ESE
  // render — y se llama siempre desde dentro del efecto de detección que
  // corresponde a ese mismo `phase` (el efecto se reinicia entero cada vez
  // que `phase` cambia, ver el array de dependencias `[phase]` de arriba),
  // así que acá adentro `phase` siempre es el real, nunca uno viejo.
  function advanceLiveness() {
    lastFaceCenterXRef.current = null;
    shiftDetectedRef.current = false;
    if (phase === "liveness-left") setPhase("liveness-right");
    else stopRecordingAndFinish();
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
        capturedPhotoBlobRef.current = blob;
        if (supportsLiveness) startLivenessSequence();
        else finishCapture(blob);
      },
      "image/jpeg",
      0.9
    );
  }

  function startLivenessSequence() {
    recordedChunksRef.current = [];
    try {
      const recorder = new MediaRecorder(streamRef.current, { mimeType: pickSupportedMimeType() });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.start();
    } catch {
      // MediaRecorder existe pero falló al arrancar (raro) — se sigue sin
      // video, nunca se pierde la foto ya capturada por esto.
      finishCapture(capturedPhotoBlobRef.current);
      return;
    }
    shiftDetectedRef.current = false;
    lastFaceCenterXRef.current = null;
    setPhase("liveness-left");
  }

  function stopRecordingAndFinish() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      finishCapture(capturedPhotoBlobRef.current);
      return;
    }
    recorder.onstop = () => {
      const videoBlob = recordedChunksRef.current.length
        ? new Blob(recordedChunksRef.current, { type: recorder.mimeType || "video/webm" })
        : null;
      onVideoCaptured?.(videoBlob);
      finishCapture(capturedPhotoBlobRef.current);
    };
    recorder.stop();
  }

  function finishCapture(photoBlob) {
    stopStream();
    setPreviewUrl(URL.createObjectURL(photoBlob));
    setPhase("done");
    onCaptured(photoBlob);
  }

  function retake() {
    setPreviewUrl(null);
    onCaptured(null);
    onVideoCaptured?.(null);
    capturedPhotoBlobRef.current = null;
    startCamera();
  }

  // Salida manual de un lado del giro (el detector puede no tomar el
  // movimiento en algunos ángulos/luces) — nunca deja a la persona
  // trabada esperando, aparte del vencimiento automático a los ~4.5s.
  function skipLivenessStep() {
    shiftDetectedRef.current = true;
  }

  const isLivenessPhase = phase === "liveness-left" || phase === "liveness-right";
  const showsVideoEl = phase === "live" || phase === "counting" || isLivenessPhase;

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

        {showsVideoEl && (
          <>
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
            {shape === "oval" ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div
                  className={`relative h-[78%] w-[58%] overflow-hidden rounded-[50%] border-[3px] transition-colors ${
                    faceState === "detected" ? "border-verified" : "border-white/85"
                  }`}
                >
                  {faceState === "detected" ? (
                    <div className="absolute inset-0 bg-verified/10" />
                  ) : (
                    <div className="absolute inset-x-0 h-[3px] animate-kyc-scan bg-verified shadow-[0_0_10px_2px_rgba(12,174,83,0.8)]" />
                  )}
                </div>
              </div>
            ) : (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                <div
                  className={`h-full w-full rounded-lg border-[3px] transition-colors ${
                    docState === "steady" ? "border-verified" : "animate-kyc-pulse border-dashed border-white/85"
                  }`}
                />
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
              <p className="absolute bottom-3 left-0 right-0 px-3 text-center text-[12px] font-semibold text-white/90">
                {supportsAutoDetection && shape === "oval" && faceState === "detected"
                  ? "Quieto, verificando..."
                  : supportsAutoDetection && shape === "rect" && docState === "steady"
                    ? "Quieto, verificando..."
                    : instructions}
              </p>
            )}
            {isLivenessPhase && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-between p-3">
                <span className="flex items-center gap-1.5 rounded-full bg-error px-2.5 py-1 text-[10.5px] font-bold text-white">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> REC
                </span>
                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-full bg-black/60 px-3.5 py-2 text-[12.5px] font-bold text-white">
                    {(() => {
                      const { Icon } = LIVENESS_PROMPT[phase];
                      return <Icon className="h-4 w-4 flex-shrink-0" />;
                    })()}
                    {LIVENESS_PROMPT[phase].text}
                  </div>
                  <button
                    type="button"
                    onClick={skipLivenessStep}
                    className="pointer-events-auto rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-white/85 hover:bg-white/25"
                  >
                    Ya giré, continuar
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {phase === "done" && previewUrl && (
          <img src={previewUrl} alt={label} className="h-full w-full object-cover" />
        )}

        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="flex items-center justify-between gap-3 bg-surface-container-lowest px-3.5 py-2.5">
        <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-outline">
          {shape === "oval" && supportsAutoDetection && phase === "live" && <ScanFace className="h-3.5 w-3.5" />}
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
