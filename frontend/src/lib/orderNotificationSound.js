// Bloque 175 (pedido explícito — "dime dónde es la carpeta que debo
// agregar un audio que tengo... quiero que se reproduzca ese audio a todo
// volumen siempre con cada nuevo pedido"): reemplaza el timbre sintetizado
// (Web Audio) de Bloque 164 por un archivo real, elegido por el vendedor —
// ya cargado en `frontend/public/sounds/`. Todo lo que vive en `public/` se
// sirve tal cual en la raíz del sitio (Vite) — por eso la URL real es
// `/sounds/...`, sin `public` en el medio.
// Bloque 178 (bug real reportado en vivo, encontrado con la red del
// navegador — NO era un problema de permisos de autoplay): CUALQUIER
// request a un archivo `.mp3` volvía "204 Intercepted by the IDM Advanced
// Integration" — Internet Download Manager intercepta por extensión/tipo
// de contenido, incluso pedido con `fetch()` (se probó y también lo agarra
// — no alcanza con evitar `<audio src="...">` directo). La forma real de
// evitarlo es que la URL/el archivo NUNCA se vea como audio de cara al
// navegador/extensión: el archivo real vive con extensión `.dat` (contenido
// mp3 real adentro, el nombre es lo único que cambia) — así ni la URL ni el
// Content-Type que devuelve el server (application/octet-stream, por la
// extensión desconocida) disparan el filtro de IDM. El navegador igual lo
// puede reproducir perfecto: el Blob se re-etiqueta a mano con
// `type: "audio/mpeg"` antes de armar el object URL — eso es lo que de
// verdad decide cómo se decodifica, no el Content-Type que mandó el server.
const SOUND_URL = "/sounds/new-order.dat";

let audioEl = null;
let readyPromise = null;

function ensureAudioEl() {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = "auto";
  }
  if (!readyPromise) {
    readyPromise = fetch(SOUND_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        const audioBlob = blob.type === "audio/mpeg" ? blob : new Blob([blob], { type: "audio/mpeg" });
        audioEl.src = URL.createObjectURL(audioBlob);
        return audioEl;
      })
      .catch(() => {
        // El fetch+blob falló por lo que sea (red, CORS en algún despliegue
        // raro, etc.) — mejor intentar con la URL directa de todas formas
        // que quedarse sin sonido: en la mayoría de las máquinas (sin un
        // interceptor de descargas activo) esto funciona igual de bien.
        audioEl.src = SOUND_URL;
        return audioEl;
      });
  }
  return readyPromise;
}

// Bloque 178 (bug real reportado en vivo — "el audio ya está en la carpeta
// pero cuando llegan los pedidos aún no suena, si se necesitan permisos
// para los navegadores, haz que se lo pida al usuario o que se active
// automáticamente al primer clic dentro del panel"): además del problema
// real de arriba (IDM), esto deja resuelta la otra mitad — la política de
// autoplay del navegador en sí. `unlocked` es la fuente de verdad real:
// cada interacción reintenta hasta que un intento de reproducir realmente
// funciona (antes se daba por desbloqueada después de UN solo intento, sin
// chequear si de verdad funcionó). `isAudioUnlocked()`/`forceUnlockAudio()`
// quedan exportados para el aviso persistente del panel
// (AudioUnlockBanner.jsx) — la mitad "pídeselo al usuario": mientras el
// desbloqueo automático no se confirme, ese aviso ofrece un botón que el
// vendedor puede tocar a mano, un gesto real e inequívoco que ningún
// navegador puede rechazar.
let unlocked = false;
export function isAudioUnlocked() {
  return unlocked;
}

function markUnlocked() {
  if (unlocked) return;
  unlocked = true;
  window.dispatchEvent(new Event("zeudin:audio-unlocked"));
}

// Reproduce silenciado un instante y pausa — el truco real para "desbloquear"
// un <audio> de cara a reproducciones futuras SIN gesto (el poll de fondo
// que detecta un pedido nuevo) es que el navegador haya visto un play()
// exitoso durante un gesto real; muted no le quita validez a ese permiso en
// ningún navegador de los que importan acá (Chrome/Firefox/Safari/Edge).
export function forceUnlockAudio() {
  return ensureAudioEl().then((el) => {
    const prevMuted = el.muted;
    el.muted = true;
    return el
      .play()
      .then(() => {
        el.pause();
        el.currentTime = 0;
        el.muted = prevMuted;
        markUnlocked();
        return true;
      })
      .catch(() => {
        el.muted = prevMuted;
        return false;
      });
  });
}

export function unlockAudioOnFirstInteraction() {
  if (unlocked) return;
  const events = ["click", "keydown", "touchstart"];
  function attempt() {
    if (unlocked) {
      events.forEach((e) => document.removeEventListener(e, attempt));
      return;
    }
    forceUnlockAudio().then((ok) => {
      if (ok) events.forEach((e) => document.removeEventListener(e, attempt));
    });
  }
  events.forEach((e) => document.addEventListener(e, attempt));
}

// Bloque 175 (pedido explícito — "si entran varios [pedidos] a la vez el
// audio no debe superponerse entre otros audios, solo sonará uno y luego
// el otro mientras se vayan verificando"): una cola simple en vez de
// disparar un <audio>.play() nuevo por cada aviso — si el sonido del
// pedido anterior todavía está sonando cuando entra uno nuevo, este se
// encola y arranca recién cuando el anterior termina (evento "ended"),
// nunca superpuesto. Reusa el MISMO elemento <audio> para las 2 (no crea
// uno nuevo por pedido) — más liviano y es justo lo que permite detectar
// "todavía está sonando" con un solo flag.
let playing = false;
let pendingCount = 0;

function playNext() {
  if (playing || pendingCount === 0) return;
  playing = true;
  pendingCount--;
  ensureAudioEl().then((el) => {
    el.currentTime = 0;
    el.volume = 1; // Bloque 175: "a todo volumen" — siempre el máximo, nunca atenuado.
    const onEnd = () => {
      playing = false;
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("error", onEnd);
      playNext();
    };
    el.addEventListener("ended", onEnd);
    el.addEventListener("error", onEnd); // Archivo faltante/corrupto: no deja la cola trabada para siempre.
    el
      .play()
      .then(markUnlocked) // Si esto funcionó, el audio real ya está desbloqueado — apaga el aviso persistente si seguía visible.
      .catch(() => {
        // Todavía bloqueado por autoplay (ningún gesto tuvo éxito todavía) —
        // nunca rompe el panel por esto, el popup visual sigue apareciendo
        // igual; el aviso persistente sigue ofreciendo el botón manual.
        onEnd();
      });
  });
}

export function playNewOrderSound() {
  pendingCount++;
  playNext();
}
