import { useCallback, useEffect, useRef, useState } from "react";
import toast from "./toast.jsx";
import { api } from "./api.js";

// Bloque 276 (pedido explícito — "el asistente de negocio debe tener los mensajes por voz del chat
// de la página principal: un botón que graba y el audio se traduce a texto"): misma técnica del
// chat público (MarketplaceChatWidget): se graba con MediaRecorder, se manda a /ai/transcribe
// (Whisper) y el texto vuelve a quien lo usa. Una grabación muy corta se descarta porque
// Whisper puede inventar texto sobre silencio. El micrófono nunca queda abierto: se suelta al
// terminar, al cancelar y al desmontar.
const MIN_RECORDING_MS = 700;

export function useVoiceRecorder() {
  const [state, setState] = useState("idle"); // idle | recording | transcribing
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    stopStream();
    setState("idle");
  }, [stopStream]);

  useEffect(() => cancel, [cancel]);

  const start = useCallback(async () => {
    if (!supported) {
      toast.error("Tu navegador no permite grabar audio: escribe tu mensaje.");
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("No se pudo usar el micrófono. Revisa los permisos del navegador o escribe tu mensaje.");
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorderRef.current = recorder;
    recorder.start();
    startedAtRef.current = Date.now();
    setState("recording");
  }, [supported]);

  // Termina la grabación y devuelve el texto transcrito (o null si no se entendió nada).
  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return null;
    recorderRef.current = null;
    const durationMs = Date.now() - startedAtRef.current;
    setState("transcribing");
    const blob = await new Promise((resolve) => {
      recorder.addEventListener("stop", () => resolve(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })), { once: true });
      recorder.stop();
    });
    stopStream();
    try {
      if (durationMs < MIN_RECORDING_MS) {
        toast.error("No se escuchó nada. Mantén el botón y habla.");
        return null;
      }
      const form = new FormData();
      form.append("audio", blob, "audio.webm");
      const { data } = await api.post("/ai/transcribe", form, { headers: { "Content-Type": "multipart/form-data" } });
      const text = data.text?.trim();
      if (!text) {
        toast.error("No pude entender el audio. Prueba de nuevo o escribe tu mensaje.");
        return null;
      }
      return text;
    } catch {
      toast.error("No pude entender el audio. Prueba de nuevo o escribe tu mensaje.");
      return null;
    } finally {
      setState("idle");
    }
  }, [stopStream]);

  return { state, supported, start, stop, cancel };
}
