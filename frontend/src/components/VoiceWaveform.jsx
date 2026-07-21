import { useEffect, useRef } from "react";

// Bloque 39/40: ondas de audio REALES mientras el cliente graba — nivel de
// volumen real de su micrófono (Web Audio API, AnalyserNode sobre el mismo
// stream que ya usa MediaRecorder), no una animación de mentira en loop.
// Bloque 40 (bug real reportado en vivo: la animación se sentía lenta y
// "congelaba" el sistema por segundos) — la primera versión llamaba
// setState en cada requestAnimationFrame (hasta 60 veces por segundo), y
// cada llamada disparaba un re-render de React del widget completo. Ahora
// se escribe el alto de cada barrita DIRECTO al DOM vía refs, sin pasar por
// el ciclo de render de React — el mismo patrón que cualquier visualización
// de audio en tiempo real (React no está pensado para actualizar estado 60
// veces por segundo).
const BAR_COUNT = 5;
const MIN_HEIGHT_PCT = 15;

export function VoiceWaveform({ stream }) {
  const barRefs = useRef([]);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!stream) return;
    let ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return; // Web Audio no disponible — el dot rojo de al lado sigue avisando igual.
    }
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    function tick() {
      analyser.getByteFrequencyData(data);
      for (let i = 0; i < BAR_COUNT; i++) {
        const idx = Math.floor((i / BAR_COUNT) * data.length);
        const level = Math.max(MIN_HEIGHT_PCT, Math.round((data[idx] / 255) * 100));
        const bar = barRefs.current[i];
        if (bar) bar.style.height = `${level}%`;
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      cancelAnimationFrame(rafRef.current);
      source.disconnect();
      ctx.close().catch(() => {});
    };
  }, [stream]);

  return (
    <div className="flex h-5 flex-1 items-center justify-center gap-[3px]">
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span
          key={i}
          ref={(el) => (barRefs.current[i] = el)}
          className="w-[3px] rounded-full bg-error transition-[height] duration-100"
          style={{ height: `${MIN_HEIGHT_PCT}%` }}
        />
      ))}
    </div>
  );
}
