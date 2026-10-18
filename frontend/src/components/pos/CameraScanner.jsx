import { useEffect, useRef, useState } from "react";
import { CameraOff, Flashlight, FlashlightOff, SwitchCamera, X } from "lucide-react";

// Lector de códigos con la cámara del celular o la tablet: lee sin parar (códigos de barras y QR) y llama a onScan con cada
// código. El mismo código solo vuelve a contar cuando sale de la imagen al menos GONE_MS: sostener el producto frente a la
// cámara suma una sola unidad, y retirarlo y volver a pasarlo suma otra.
//
// Para que lea rápido:
//  - Donde el navegador trae lector propio (BarcodeDetector: Chrome en Android) se usa ese, que decodifica en el teléfono y
//    es varias veces más rápido. En el resto (iPhone, Firefox) se usa ZXing, que se carga solo al abrir la cámara.
//  - Con ZXing no se analiza la foto entera: solo la franja del centro (donde la persona pone el código), reducida, y solo
//    con los formatos de un comercio. Menos píxeles y menos formatos que probar = más lecturas por segundo.
//  - La cámara se pide en alta resolución y con enfoque continuo; tocar la imagen vuelve a enfocar.
//  - Linterna, acercar (x2) y cambiar de cámara aparecen solo si el teléfono los permite.
const GONE_MS = 900;
const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "codabar", "qr_code", "data_matrix"];
// Franja del centro que se analiza con ZXing (proporción del ancho y del alto del video) y ancho máximo al reducirla.
const BAND_W = 0.9;
const BAND_H = 0.55;
const BAND_MAX_PX = 960;
const CAMERA_KEY = "pos-camera-id";

function savedCameraId() {
  try {
    return localStorage.getItem(CAMERA_KEY) || "";
  } catch {
    return "";
  }
}

async function nativeDetector() {
  if (typeof window === "undefined" || !("BarcodeDetector" in window)) return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
    return formats.length ? new window.BarcodeDetector({ formats }) : null;
  } catch {
    return null;
  }
}

async function zxingReader() {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.ITF,
    BarcodeFormat.QR_CODE,
  ]);
  return new BrowserMultiFormatReader(hints);
}

// Pitido corto al leer: en el iPhone no hay vibración, y en el mostrador el sonido confirma sin mirar la pantalla.
function makeBeep() {
  let ctx = null;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = AC ? new AC() : null;
  } catch {
    ctx = null;
  }
  return {
    play() {
      if (!ctx) return;
      try {
        if (ctx.state === "suspended") ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 1760;
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      } catch {
        /* sin sonido */
      }
    },
    close() {
      ctx?.close?.().catch(() => {});
    },
  };
}

export function CameraScanner({ onScan, onClose, title = "Escanear", hint }) {
  const videoRef = useRef(null);
  const trackRef = useRef(null);
  const last = useRef({ code: "", seenAt: 0 });
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [error, setError] = useState("");
  const [flash, setFlash] = useState(false);
  const [cameraId, setCameraId] = useState(savedCameraId);
  const [cameras, setCameras] = useState([]);
  const [caps, setCaps] = useState({ torch: false, zoom: null, focus: false });
  const [torchOn, setTorchOn] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  // Mientras la cámara está abierta, el botón flotante del asistente se oculta para no tapar la imagen (ver
  // BusinessAssistantWidget).
  useEffect(() => {
    document.documentElement.dataset.cameraOpen = "1";
    return () => {
      delete document.documentElement.dataset.cameraOpen;
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    let stream = null;
    let timer = null;
    const beep = makeBeep();
    const canvas = document.createElement("canvas");
    const c2d = canvas.getContext("2d", { willReadFrequently: true });

    const found = (raw) => {
      const code = String(raw || "").trim();
      if (!code) return;
      const now = Date.now();
      const repeated = code === last.current.code && now - last.current.seenAt < GONE_MS;
      last.current = { code, seenAt: now };
      if (repeated) return;
      setFlash(true);
      setTimeout(() => setFlash(false), 180);
      navigator.vibrate?.(40);
      beep.play();
      onScanRef.current(code);
    };

    (async () => {
      try {
        const video = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...video, ...(cameraId ? { deviceId: { exact: cameraId } } : { facingMode: { ideal: "environment" } }) } });
        } catch (err) {
          // La cámara guardada ya no existe (otro teléfono, permisos borrados): se vuelve a la trasera por defecto.
          if (!cameraId || err?.name === "NotAllowedError") throw err;
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...video, facingMode: { ideal: "environment" } } });
        }
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        const c = track.getCapabilities?.() ?? {};
        if (c.focusMode?.includes("continuous")) await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
        setCaps({ torch: !!c.torch, zoom: c.zoom && c.zoom.max > 1 ? c.zoom : null, focus: !!c.focusMode?.length });

        const el = videoRef.current;
        el.srcObject = stream;
        await el.play().catch(() => {});

        // Con el permiso ya dado los nombres de las cámaras están disponibles: se listan las traseras (si el teléfono no
        // dice cuál es cuál, todas) para el botón de cambiar de cámara.
        navigator.mediaDevices
          .enumerateDevices()
          .then((list) => {
            const all = list.filter((d) => d.kind === "videoinput" && d.deviceId);
            const back = all.filter((d) => /back|rear|trasera|environment/i.test(d.label));
            if (!stopped) setCameras(back.length > 1 ? back : all);
          })
          .catch(() => {});

        const detector = await nativeDetector();
        const reader = detector ? null : await zxingReader();
        if (stopped) return;

        const tick = async () => {
          if (stopped) return;
          if (el.readyState >= 2 && el.videoWidth) {
            try {
              if (detector) {
                const codes = await detector.detect(el);
                if (codes[0]) found(codes[0].rawValue);
              } else {
                const sw = el.videoWidth * BAND_W;
                const sh = el.videoHeight * BAND_H;
                const scale = Math.min(1, BAND_MAX_PX / sw);
                canvas.width = Math.round(sw * scale);
                canvas.height = Math.round(sh * scale);
                c2d.drawImage(el, (el.videoWidth - sw) / 2, (el.videoHeight - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
                found(reader.decodeFromCanvas(canvas).getText());
              }
            } catch {
              /* sin código en este cuadro */
            }
          }
          if (!stopped) timer = setTimeout(tick, detector ? 40 : 60);
        };
        tick();
      } catch (err) {
        if (stopped) return;
        setError(
          err?.name === "NotAllowedError"
            ? "No diste permiso para usar la cámara. Actívalo en los ajustes del navegador o escribe el código."
            : "No se pudo abrir la cámara en este dispositivo. Escribe el código o usa un lector USB."
        );
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
      beep.close();
      setTorchOn(false);
      setZoomed(false);
    };
  }, [cameraId]);

  function toggleTorch() {
    const next = !torchOn;
    trackRef.current
      ?.applyConstraints({ advanced: [{ torch: next }] })
      .then(() => setTorchOn(next))
      .catch(() => {});
  }

  // x2 deja alejar el teléfono del producto: la mayoría de las cámaras no enfoca a menos de 10 cm, y el código pequeño se ve
  // borroso si se acerca demasiado.
  function toggleZoom() {
    if (!caps.zoom) return;
    const next = !zoomed;
    const value = next ? Math.min(caps.zoom.max, 2) : Math.max(caps.zoom.min ?? 1, 1);
    trackRef.current
      ?.applyConstraints({ advanced: [{ zoom: value }] })
      .then(() => setZoomed(next))
      .catch(() => {});
  }

  // Tocar la imagen vuelve a enfocar (enfoque de un disparo y luego continuo otra vez).
  function refocus() {
    const track = trackRef.current;
    const modes = track?.getCapabilities?.().focusMode ?? [];
    if (!modes.includes("single-shot")) return;
    track
      .applyConstraints({ advanced: [{ focusMode: "single-shot" }] })
      .then(() => setTimeout(() => track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {}), 800))
      .catch(() => {});
  }

  function nextCamera() {
    if (cameras.length < 2) return;
    const current = trackRef.current?.getSettings?.().deviceId || cameraId;
    const i = cameras.findIndex((d) => d.deviceId === current);
    const next = cameras[(i + 1) % cameras.length].deviceId;
    try {
      localStorage.setItem(CAMERA_KEY, next);
    } catch {
      /* sin almacenamiento: vale solo esta vez */
    }
    setCameraId(next);
  }

  const control = "flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-bold text-white transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

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
        <>
          <div className="relative overflow-hidden">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption, jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
            <video ref={videoRef} muted playsInline autoPlay onClick={refocus} className="block aspect-[4/3] w-full bg-black object-cover" />
            {/* Ventana de lectura: la misma franja que se analiza, con el resto oscurecido para que se vea dónde poner el código. */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
              <div className={`relative h-[55%] w-[90%] rounded-xl border-2 shadow-[0_0_0_100vmax_rgba(0,0,0,0.38)] transition-colors ${flash ? "border-verified" : "border-white/80"}`}>
                <div className={`absolute inset-x-4 top-1/2 h-0.5 -translate-y-1/2 transition-colors ${flash ? "bg-verified" : "bg-secondary"}`} />
              </div>
            </div>
            {hint && <p className="pointer-events-none absolute inset-x-0 top-0 bg-black/45 px-3 py-1.5 text-center text-[12px] text-white">{hint}</p>}
          </div>
          {(caps.torch || caps.zoom || cameras.length > 1 || caps.focus) && (
            <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-2.5">
              {caps.torch && (
                <button type="button" onClick={toggleTorch} aria-pressed={torchOn} className={`${control} ${torchOn ? "bg-secondary text-primary" : "bg-white/10 hover:bg-white/20"}`}>
                  {torchOn ? <FlashlightOff className="h-5 w-5" aria-hidden="true" /> : <Flashlight className="h-5 w-5" aria-hidden="true" />}
                  {torchOn ? "Apagar luz" : "Linterna"}
                </button>
              )}
              {caps.zoom && (
                <button type="button" onClick={toggleZoom} aria-pressed={zoomed} aria-label={zoomed ? "Volver a tamaño normal" : "Acercar la imagen al doble"} className={`${control} ${zoomed ? "bg-white text-primary" : "bg-white/10 hover:bg-white/20"}`}>
                  {zoomed ? "x2" : "x1"}
                </button>
              )}
              {cameras.length > 1 && (
                <button type="button" onClick={nextCamera} aria-label="Usar otra cámara" className={`${control} bg-white/10 hover:bg-white/20`}>
                  <SwitchCamera className="h-5 w-5" aria-hidden="true" />
                </button>
              )}
              {caps.focus && <p className="w-full text-center text-[11.5px] text-white/70">Toca la imagen para volver a enfocar.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
