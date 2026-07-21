// Bloque 38: sonido corto de notificación al recibir respuesta del bot +
// preferencia de silenciado — compartida entre los dos widgets de chat
// (tienda y general) con UNA sola clave de localStorage: un cliente que
// apaga el sonido en un chat probablemente lo quiere apagado en el otro
// también. Sintetizado con Web Audio API (sin archivo de audio ni librería
// nueva) — un solo tono corto con ataque/decay rápido tipo "pop/ding",
// nunca una melodía.
const MUTE_KEY = "zeudin_chat_muted";

export function isChatMuted() {
  return localStorage.getItem(MUTE_KEY) === "1";
}

export function setChatMuted(muted) {
  localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
}

let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

export function playChatNotificationSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.1);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
  } catch {
    // Web Audio bloqueado/no disponible (política de autoplay del
    // navegador antes de una interacción, navegador viejo, etc.) — nunca
    // rompe el chat por esto, simplemente no suena.
  }
}
