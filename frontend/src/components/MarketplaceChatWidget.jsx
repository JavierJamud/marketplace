import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { X, Send, RotateCcw, Mic, Square, Store as StoreIcon, AlertTriangle, Volume2, VolumeX } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../lib/api.js";
import { usePlatformSettings } from "../lib/usePlatformSettings.js";
import { isChatMuted, setChatMuted, playChatNotificationSound } from "../lib/chatSound.js";
import { TypingDots } from "./TypingDots.jsx";
import { VoiceWaveform } from "./VoiceWaveform.jsx";
import { VerifiedBadge } from "./ui/VerifiedBadge.jsx";
import { ChatFaceButton } from "./ChatFaceButton.jsx";

// Bloque 39: por debajo de esto, se trata como "no dijo nada" — ver
// stopAndSendRecording.
const MIN_RECORDING_MS = 600;

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}
function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

// Bloque 30: bot GENERAL del marketplace — distinto del bot por tienda
// (StoreChatWidget.jsx). No representa a ninguna tienda puntual, así que
// usa la marca de la plataforma (mismo círculo/letra que Logo() en
// Header.jsx) en vez de un color de vendedor. Bloque 38: ya NO se usa junto
// a los mensajes del chat (pedido explícito de sacar el avatar de ahí) —
// queda solo como branding del header del panel y de la burbuja proactiva.
function PlatformAvatar({ className }) {
  const { siteName } = usePlatformSettings();
  return (
    <div className={`flex flex-shrink-0 items-center justify-center rounded-full bg-secondary-container font-display font-extrabold text-primary ${className}`}>
      {siteName.charAt(0).toUpperCase()}
    </div>
  );
}

const SESSION_KEY = "zeudin_marketplace_chat_session";
const ACTIVITY_KEY = "zeudin_marketplace_chat_lastActivity";
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;
// Bloque 47: distinto de SESSION_EXPIRY_MS (eso es "¿la sesión guardada
// sigue viva?", solo se chequea al abrir/crear sesión) — esto es un timer
// EN VIVO mientras el widget está montado: 30 min reales sin actividad
// (mensaje enviado o panel abierto) reinician la charla solos, sin pedir
// confirmación (a diferencia del botón manual "Nuevo chat").
const IDLE_RESET_MS = 30 * 60 * 1000;

function touchActivity() {
  localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
}
// Mismo criterio de sesión/24h que StoreChatWidget.jsx (Bloque 26), pero con
// una sola clave global — este bot no está atado a ningún vendorId.
function getOrCreateSessionId() {
  const lastActivity = Number(localStorage.getItem(ACTIVITY_KEY) ?? 0);
  const expired = lastActivity && Date.now() - lastActivity > SESSION_EXPIRY_MS;
  let sessionId = expired ? null : localStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, sessionId);
    touchActivity();
  }
  return sessionId;
}
function startNewSession() {
  const sessionId = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, sessionId);
  touchActivity();
  return sessionId;
}

// Bloque 38: ya no lleva avatar al lado (pedido explícito) — el mensaje del
// bot queda solo con su burbuja de texto, se mantiene esta función igual
// para no repetir el max-width/margen en cada lugar donde se usa.
// Bloque 38 (fix real encontrado en vivo): un div de bloque sin ancho
// explícito se estira a ocupar todo el disponible en CSS — con el avatar
// (Bloque 37 y anteriores), este contenedor era "flex", así que la burbuja
// (como flex-item) se ajustaba sola a su contenido sin que nadie lo pidiera
// a propósito; al sacar el avatar y dejar un div de bloque simple, la
// burbuja (y los puntitos de "escribiendo") pasaron a ocupar el 88% completo
// del panel aunque el contenido fuera chico — se ve como una barra ancha
// casi vacía. "flex" (sin el avatar) alcanza para volver al tamaño correcto.
function BotRow({ children }) {
  return <div className="mb-3 flex max-w-[88%]">{children}</div>;
}

// Bloque 34: chips de preguntas sugeridas — las iniciales usan una
// categoría real del marketplace (fetch liviano a /business-categories, la
// misma que ya usa Home.jsx para el marquee — mismo queryKey, así que si
// el widget se monta en la Home el caché de react-query ya está tibio,
// nunca dos requests duplicados). Las de seguimiento dependen de si la
// ÚLTIMA respuesta mostró productos o no.
function initialChips(featuredCategory) {
  return ["¿Qué tiendas están verificadas?", featuredCategory ? `Buscar ${featuredCategory}` : "Ver categorías destacadas", "¿Cómo funciona la entrega?"];
}

function followUpChips(lastMessage) {
  if (lastMessage?.products?.length > 0) {
    return ["Ver más opciones", "Filtrar por precio", "Buscar en otras tiendas"];
  }
  return ["¿Qué tiendas están verificadas?", "Buscar otra categoría", "¿Cómo funciona la entrega?"];
}

// Mismo componente que StoreChatWidget.jsx (Bloque 34) — no se comparte a
// propósito, mismo criterio de siempre de mantener los dos widgets como
// hermanos independientes sin importar uno del otro.
function SuggestedChips({ chips, onPick, disabled }) {
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip}
          onClick={() => onPick(chip)}
          disabled={disabled}
          className="rounded-full border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-[11.5px] font-semibold text-on-surface-variant hover:border-tertiary-accent hover:text-tertiary-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {chip}
        </button>
      ))}
    </div>
  );
}

// Tarjeta de producto cross-tienda — a diferencia de ChatProductCard
// (StoreChatWidget.jsx), acá cada producto puede ser de una tienda
// DISTINTA (muestra su propio nombre de tienda). Sin acción de "Agregar al
// carrito" ni "Solicitar" a propósito — este bot nunca ejecuta ninguna
// acción de carrito (a diferencia del bot de tienda), el click lleva a la
// página real del producto donde el cliente agrega normalmente.
// Bloque 34: rediseñada a layout de lista compacta (mismo patrón que
// ChatProductCard) — imagen chica a la derecha, texto a la izquierda; acá
// sin botón "+" (nunca aplica en este bot), toda la tarjeta es un solo Link.
function MarketplaceProductCard({ product }) {
  const href = `/producto/${product.vendor.slug}/${product.slug}`;
  const discount = product.oldPrice ? Math.round(100 - (Number(product.price) / Number(product.oldPrice)) * 100) : null;
  return (
    <Link to={href} className="flex items-center gap-2.5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-2.5 shadow-sm">
      <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-md bg-surface-container">
        {product.images?.[0] ? (
          <img src={imgUrl(product.images[0])} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[8px] text-outline">Sin foto</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-semibold text-on-surface">{product.name}</p>
        {product.description && <p className="truncate text-[11px] text-outline">{product.description}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="text-[12.5px] font-bold text-on-surface">{fmtCUP(product.price)}</span>
          {product.oldPrice && (
            <>
              <span className="text-[10.5px] text-outline line-through">{fmtCUP(product.oldPrice)}</span>
              <span className="rounded-full bg-error/10 px-1.5 py-0.5 text-[9.5px] font-bold text-error">-{discount}%</span>
            </>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1 text-[9.5px] text-outline">
          <StoreIcon className="h-2.5 w-2.5 flex-shrink-0" />
          <span className="truncate">{product.vendor.companyName}</span>
        </div>
      </div>
    </Link>
  );
}

// Bloque 41 (pedido explícito): tarjeta de UNA tienda puntual — se muestra
// solo cuando el bot citó esa tienda en "vendorIds" (pregunta sobre una
// tienda concreta o unas pocas), nunca para un pedido amplio de "ver
// tiendas" (ahí va StoresButton, más abajo).
function MarketplaceVendorCard({ vendor }) {
  return (
    <Link
      to={`/tienda/${vendor.slug}`}
      className="flex items-center gap-2 rounded-lg border border-surface-container-high bg-surface-container-lowest p-2.5 shadow-sm"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-[12.5px] font-semibold text-on-surface">{vendor.companyName}</p>
          {vendor.isVerified && <VerifiedBadge size="sm" />}
        </div>
        <p className="truncate text-[11px] text-outline">{[vendor.rubro, vendor.zone].filter(Boolean).join(" · ") || "Ver tienda"}</p>
      </div>
    </Link>
  );
}

// Bloque 41 (pedido explícito): pedido amplio de tiendas ("mostrame
// tiendas") — en vez de que el bot enumere cada nombre en el texto, un
// botón real a la página completa de tiendas.
function ShowAllStoresButton() {
  return (
    <Link
      to="/tiendas"
      className="flex items-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 text-[12.5px] font-semibold text-tertiary-accent shadow-sm hover:border-tertiary-accent"
    >
      <StoreIcon className="h-4 w-4 flex-shrink-0" /> Ver todas las tiendas
    </Link>
  );
}

export function MarketplaceChatWidget() {
  const { siteName } = usePlatformSettings();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [messages, setMessages] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  // Bloque 33: booleano, no el string que mandaba el backend — antes esto
  // mostraba err.response.data.error tal cual, que en una falla real
  // (proveedor de IA caído, etc.) SÍ podía traer detalle técnico. Ahora
  // nunca importa qué mandó el backend: cualquier fallo es la misma
  // tarjeta genérica (ver JSX), el detalle real solo queda en Admin >
  // Errores.
  const [errorMsg, setErrorMsg] = useState(false);
  const [showBubble, setShowBubble] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  // Bloque 32: idle | recording | transcribing — reemplaza el estado de
  // imagen (derogado). "transcribing" cubre el hueco entre soltar el audio
  // y recibir el texto de /ai/transcribe; "sending" (de arriba) ya cubre el
  // tramo siguiente (una vez que el texto transcrito entra al flujo normal).
  const [recordingState, setRecordingState] = useState("idle");
  // Bloque 38: preferencia de sonido, leída una sola vez de localStorage al
  // montar (clave compartida con StoreChatWidget.jsx, ver chatSound.js).
  const [muted, setMuted] = useState(() => isChatMuted());
  const bottomRef = useRef(null);
  const resetPopoverRef = useRef(null);
  const sessionIdRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  // Bloque 39: timestamp de cuándo arrancó ESTA grabación — para el chequeo
  // de duración mínima antes de mandar a transcribir (ver stopAndSendRecording).
  const recordingStartRef = useRef(0);
  // Bloque 33: último mensaje intentado (texto o ya transcrito) — lo reusa
  // "Reintentar" en la tarjeta de error, como si el cliente lo acabara de
  // mandar de nuevo.
  const lastMessageRef = useRef("");
  // Bloque 47: timer de auto-reset por inactividad (ver IDLE_RESET_MS).
  const idleTimerRef = useRef(null);
  if (!sessionIdRef.current) sessionIdRef.current = getOrCreateSessionId();

  function scheduleIdleReset() {
    clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => reallyResetChat(), IDLE_RESET_MS);
  }

  // El widget vive montado toda la sesión de Home (es el único lugar donde
  // se monta) — este timer corre desde el montaje, sin importar si el panel
  // está abierto o cerrado en ese momento.
  useEffect(() => {
    scheduleIdleReset();
    return () => clearTimeout(idleTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bloque 34: mismo queryKey que Home.jsx (CategoryMarquee) — si este
  // widget se monta ahí (que es el único lugar donde vive, Home.jsx), el
  // caché de react-query ya suele estar tibio, sin pedir nada de más solo
  // para armar los chips iniciales. Bloque 39 (Parte 3, pedido explícito):
  // ya NO se elige al azar — se usa la categoría con MÁS tiendas activas
  // reales (vendorCount, ver businessCategories.controller.js), así el chip
  // siempre apunta a un rubro realmente relevante del marketplace.
  const { data: businessCategories } = useQuery({
    queryKey: ["business-categories"],
    queryFn: async () => (await api.get("/business-categories")).data.categories,
    staleTime: 5 * 60 * 1000,
  });
  const featuredCategory = useMemo(() => {
    if (!businessCategories?.length) return null;
    return [...businessCategories].sort((a, b) => (b.vendorCount ?? 0) - (a.vendorCount ?? 0))[0].name;
  }, [businessCategories]);

  useEffect(() => {
    if (!open || historyLoaded) return;
    api
      .get("/assistant/chat", { params: { sessionId: sessionIdRef.current } })
      .then(({ data }) => {
        setMessages(data.messages);
        if (data.expired) sessionIdRef.current = startNewSession();
      })
      .catch(() => {})
      .finally(() => setHistoryLoaded(true));
  }, [open, historyLoaded]);

  useEffect(() => {
    if (!confirmingReset) return;
    function onClickOutside(e) {
      if (resetPopoverRef.current && !resetPopoverRef.current.contains(e.target)) setConfirmingReset(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [confirmingReset]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending, open]);

  // Bloque 32: se saca la persistencia en localStorage por completo (antes
  // vencía a las 24h, Bloque 31) — pedido explícito de este bloque: la
  // burbuja tiene que aparecer en CADA carga de página, no solo la primera
  // vez que un navegador la ve. La X sigue cerrándola para esta apertura
  // puntual (setShowBubble(false)), simplemente ya no queda "recordado"
  // para la próxima carga.
  useEffect(() => {
    const showTimer = setTimeout(() => setShowBubble(true), 5000);
    return () => clearTimeout(showTimer);
  }, []);
  useEffect(() => {
    if (!showBubble) return;
    const hideTimer = setTimeout(() => setShowBubble(false), 8000);
    return () => clearTimeout(hideTimer);
  }, [showBubble]);
  useEffect(() => {
    if (open) setShowBubble(false);
  }, [open]);

  // Se limpia el micrófono si el cliente cierra el panel a mitad de una
  // grabación — nunca dejar un stream de audio abierto de fondo.
  useEffect(() => {
    if (!open) cancelRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSend(overrideMessage) {
    const message = (overrideMessage ?? text).trim();
    if (!message || sending) return;
    lastMessageRef.current = message;
    setText("");
    setErrorMsg(false);
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", content: message }]);
    setSending(true);
    try {
      const { data } = await api.post("/assistant/chat", { sessionId: sessionIdRef.current, message });
      setMessages((m) => [...m, data.message]);
      touchActivity();
      scheduleIdleReset();
      // Bloque 38: sonido corto al recibir la respuesta — solo puede pasar
      // acá (el panel está abierto, es la única forma de llegar a este
      // código) y solo si el cliente no lo silenció.
      if (!muted) playChatNotificationSound();
    } catch {
      // Bloque 33: nunca se muestra el error real — antes acá se
      // renderizaba err.response.data.error tal cual (bug real: en una
      // falla de verdad, ese texto podía traer detalle técnico). El
      // backend ya lo registró en Admin > Errores; acá solo se sabe QUE
      // falló, se renderiza como tarjeta genérica (ver JSX).
      setErrorMsg(true);
    } finally {
      setSending(false);
    }
  }

  // Bloque 33: "Reintentar" es literalmente volver a mandar el mismo texto
  // — no hace falta que el cliente lo reescriba ni un endpoint especial de
  // reintento, es un envío nuevo con el mismo contenido.
  function handleRetry() {
    handleSend(lastMessageRef.current);
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  // Bloque 32: graba audio del cliente — se transcribe con Groq Whisper
  // (/ai/transcribe) y el texto entra al mismo flujo que si lo hubiera
  // escrito. Sin login (a diferencia del límite de fotos que reemplaza).
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Tu navegador no soporta grabación de audio — escribe tu mensaje.");
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // El mensaje/prompt de permiso ya lo mostró el navegador — acá solo
      // se informa que el micrófono no quedó disponible, el input de texto
      // sigue funcionando igual.
      toast.error("No se pudo acceder al micrófono — revisa los permisos del navegador o escribe tu mensaje.");
      return;
    }
    streamRef.current = stream;
    audioChunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    mediaRecorderRef.current = recorder;
    recorder.start();
    recordingStartRef.current = Date.now();
    setRecordingState("recording");
  }

  function cancelRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    stopStream();
    setRecordingState("idle");
  }

  async function stopAndSendRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    // Bug real reportado en vivo: dos-tres clicks rápidos en "detener y
    // enviar" (el botón no llega a deshabilitarse antes del siguiente click,
    // React recién re-renderiza después) hacían que esta función corriera
    // más de una vez sobre el MISMO grabador — cada corrida agregaba su
    // propio listener de "stop" y terminaba mandando el mismo audio
    // transcrito 2-3 veces seguidas. Sacar la referencia ACÁ, antes de
    // cualquier await, hace que la segunda invocación (si llega a pasar el
    // "if (!recorder) return" de arriba por una carrera de milisegundos)
    // ya encuentre mediaRecorderRef.current en null y no siga.
    mediaRecorderRef.current = null;
    // Bloque 39 (pedido explícito): si soltó casi de inmediato, es casi
    // seguro que no llegó a decir nada — ni vale la pena mandarlo a
    // transcribir (Whisper puede "alucinar" texto sobre silencio/ruido muy
    // corto). Se corta ACÁ, antes de tocar el micrófono para nada más.
    const durationMs = Date.now() - recordingStartRef.current;
    setRecordingState("transcribing");
    const audioBlob = await new Promise((resolve) => {
      recorder.addEventListener("stop", () => resolve(new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" })), { once: true });
      recorder.stop();
    });
    stopStream();
    if (durationMs < MIN_RECORDING_MS) {
      toast.error("No se detectó audio — mantén presionado y habla.");
      setRecordingState("idle");
      return;
    }
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "audio.webm");
      const { data } = await api.post("/ai/transcribe", formData, { headers: { "Content-Type": "multipart/form-data" } });
      const transcribed = data.text?.trim();
      if (!transcribed) {
        // Bloque 39 (pedido explícito): audio real pero sin habla detectable
        // (silencio, ruido de fondo) — nunca se manda nada al chat ni se le
        // pide a la IA que "invente" una pregunta a partir de esto.
        toast.error("No pude entender el audio — prueba de nuevo o escribe tu mensaje.");
        return;
      }
      await handleSend(transcribed);
    } catch {
      toast.error("No pude entender el audio — prueba de nuevo o escribe tu mensaje.");
    } finally {
      setRecordingState("idle");
    }
  }

  function handleNewChat() {
    if (messages.length > 0) {
      setConfirmingReset(true);
      return;
    }
    reallyResetChat();
  }
  function reallyResetChat() {
    sessionIdRef.current = startNewSession();
    setMessages([]);
    setErrorMsg(null);
    setHistoryLoaded(true);
    setConfirmingReset(false);
    // Re-arma la ventana de 30 min — si el visitante sigue sin usar el chat,
    // vuelve a reiniciarse solo cada vez que se cumpla, no una única vez.
    scheduleIdleReset();
  }

  const recording = recordingState === "recording";
  const transcribing = recordingState === "transcribing";

  return (
    <>
      {!open && showBubble && (
        <div className="fixed bottom-[84px] right-5 z-[60] flex max-w-[260px] items-start gap-2 rounded-2xl rounded-br-md bg-surface-container-lowest p-3.5 shadow-2xl animate-fade-up sm:bottom-[100px] sm:right-6">
          <PlatformAvatar className="h-8 w-8 text-[13px]" />
          <p className="flex-1 text-[12.5px] leading-[17px] text-on-surface-variant">
            ¡Hola! Soy el asistente de compras de <span className="font-bold text-on-surface">{siteName}</span> — cuéntame qué buscas, por texto o por audio.
          </p>
          <button onClick={() => setShowBubble(false)} aria-label="Cerrar aviso" className="flex-shrink-0 text-outline hover:text-on-surface-variant">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Bloque 48 (pedido explícito, reemplaza el diseño del Bloque 47):
          botón de 3 estados (cerrado/hover/abierto, ver ChatFaceButton.jsx +
          .chat-face-btn en index.css) — se mantiene montado incluso con el
          panel abierto (a diferencia del Bloque 47) para que el estado
          "abierto" sea de verdad visible: en desktop el panel deja un hueco
          debajo (sm:bottom-24) donde el botón sigue viéndose y sirve de
          cierre alternativo; en mobile el panel de pantalla completa lo tapa
          solo (mismo z-index, el panel pinta después en el DOM), sin hacer
          falta ningún condicional aparte para ese caso. */}
      <ChatFaceButton
        isOpen={open}
        onClick={() => {
          setOpen((v) => !v);
          setShowBubble(false);
          scheduleIdleReset();
        }}
        ariaLabel={open ? `Cerrar asistente de compras de ${siteName}` : `Abrir asistente de compras de ${siteName}`}
        className="fixed bottom-5 right-5 z-[60] sm:bottom-6 sm:right-6"
      />

      {open && (
        <div
          className={
            // Bloque 51 (pedido explícito): antes el panel de mobile arrancaba
            // en bottom-0, pintando justo encima del botón (mismo z-[60],
            // el panel va después en el DOM) — lo tapaba por completo. Ahora
            // deja el mismo hueco que ya existía en desktop (sm:bottom-24
            // contra el bottom-6 del botón): bottom-[86px] contra el
            // bottom-5 del botón (20px) + su alto (52-60px según el ancho,
            // ver .chat-face-btn en index.css) siempre deja unos px libres
            // arriba del botón, así queda visible debajo del panel en vez
            // de tapado.
            // rounded-2xl en las 4 esquinas (antes rounded-t-2xl, solo
            // arriba) — con el panel ya despegado del borde inferior de la
            // pantalla, una esquina inferior recta se vería como un corte,
            // no como una tarjeta flotante a propósito.
            "fixed inset-x-0 bottom-[86px] z-[60] mx-2.5 flex h-[75dvh] max-h-[560px] flex-col rounded-2xl bg-surface-container-lowest shadow-2xl animate-fade-up " +
            "sm:inset-x-auto sm:inset-y-auto sm:mx-0 sm:top-6 sm:bottom-24 sm:right-6 sm:h-auto sm:w-[368px] sm:border sm:border-surface-container-high"
          }
        >
          <div className="flex items-center gap-2.5 rounded-t-2xl bg-primary px-4 py-3.5 text-white">
            <PlatformAvatar className="h-8 w-8 text-[13px]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-label-md font-bold">{siteName}</div>
              <div className="text-[11px] text-white/70">Asistente de compras</div>
            </div>
            {/* Bloque 38: mute toggle — clave compartida con el chat de
                tienda (ver chatSound.js), persiste entre recargas. */}
            <button
              onClick={() => {
                const next = !muted;
                setMuted(next);
                setChatMuted(next);
              }}
              aria-label={muted ? "Activar sonido" : "Silenciar sonido"}
              title={muted ? "Activar sonido" : "Silenciar sonido"}
              className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center text-white/70 hover:text-white"
            >
              {muted ? <VolumeX className="h-[18px] w-[18px]" /> : <Volume2 className="h-[18px] w-[18px]" />}
            </button>
            <div ref={resetPopoverRef} className="relative flex-shrink-0">
              <button
                onClick={handleNewChat}
                aria-label="Nueva conversación"
                title="Nueva conversación"
                className="flex h-[18px] w-[18px] items-center justify-center text-white/70 hover:text-white"
              >
                <RotateCcw className="h-[18px] w-[18px]" />
              </button>
              {confirmingReset && (
                <div className="absolute right-0 top-[calc(100%+10px)] z-10 w-[210px] rounded-lg border border-surface-container-high bg-surface-container-lowest p-3.5 text-left shadow-lg animate-fade-up">
                  <p className="mb-1 text-[12.5px] font-bold text-on-surface">¿Reiniciar conversación?</p>
                  <p className="mb-3 text-[11px] leading-4 text-outline">Se limpia la vista actual — el historial queda guardado igual.</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmingReset(false)}
                      className="flex-1 rounded border border-outline-variant py-1.5 text-[11.5px] font-semibold text-on-surface-variant hover:bg-surface-container"
                    >
                      Cancelar
                    </button>
                    <button onClick={reallyResetChat} className="flex-1 rounded bg-error py-1.5 text-[11.5px] font-bold text-white hover:brightness-95">
                      Reiniciar
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Cerrar chat"
              className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center text-white/70 hover:text-white"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <BotRow>
              <div className="rounded-lg rounded-tl-none bg-surface-container px-3.5 py-2.5 text-[13px] leading-5 text-on-surface-variant">
                ¡Hola! Cuéntame qué producto buscas, por texto o grabando un audio — te ayudo a encontrarlo en cualquier tienda de {siteName}.
              </div>
            </BotRow>

            {/* Bloque 34: chips iniciales — solo cuando ya se sabe con
                certeza que no hay historial (evita el flash de mostrarlos y
                sacarlos apenas carga una conversación previa real). */}
            {historyLoaded && messages.length === 0 && !sending && recordingState === "idle" && (
              <SuggestedChips chips={initialChips(featuredCategory)} onPick={handleSend} disabled={sending} />
            )}

            {open && !historyLoaded && <p className="py-2 text-center text-[12px] text-outline">Cargando conversación...</p>}

            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={m.id} className="mb-3 flex flex-col items-end">
                  {m.content && (
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-tr-none bg-primary-container px-3.5 py-2.5 text-[13px] leading-5 text-white">
                      {m.content}
                    </div>
                  )}
                </div>
              ) : (
                <div key={m.id} className="flex flex-col items-start">
                  <BotRow>
                    <div className="whitespace-pre-wrap rounded-lg rounded-tl-none bg-surface-container px-3.5 py-2.5 text-[13px] leading-5 text-on-surface-variant">
                      {m.content}
                    </div>
                  </BotRow>
                  {/* Bloque 34: rediseñadas como lista vertical (no
                      carrusel horizontal) — scroll propio si no entran
                      todas. */}
                  {m.products?.length > 0 && (
                    <div className="-mt-1.5 mb-3 flex w-full max-w-[95%] flex-col gap-2 overflow-y-auto pb-1" style={{ maxHeight: 280 }}>
                      {m.products.map((p) => (
                        <MarketplaceProductCard key={p.id} product={p} />
                      ))}
                    </div>
                  )}
                  {/* Bloque 41 (pedido explícito): tarjeta(s) de tienda
                      puntual O botón a "ver todas" — nunca los dos juntos
                      (el backend ya garantiza que no vengan ambos a la vez). */}
                  {m.vendors?.length > 0 && (
                    <div className="-mt-1.5 mb-3 flex w-full max-w-[95%] flex-col gap-2" style={{ maxHeight: 280 }}>
                      {m.vendors.map((v) => (
                        <MarketplaceVendorCard key={v.id} vendor={v} />
                      ))}
                    </div>
                  )}
                  {m.showAllStoresButton && (
                    <div className="-mt-1.5 mb-3 w-full max-w-[95%]">
                      <ShowAllStoresButton />
                    </div>
                  )}
                  {/* Bloque 34: chips de seguimiento — solo bajo la ÚLTIMA
                      respuesta, reemplazan al set anterior (nunca se
                      acumulan, solo existe UN "último mensaje" a la vez). El
                      bot ya manda sus propias sugerencias contextuales
                      (suggestedFollowUps, distintas turno a turno) — el set
                      fijo de acá solo es respaldo si no vinieron esta vez. */}
                  {i === messages.length - 1 && !sending && !errorMsg && recordingState === "idle" && (
                    <SuggestedChips chips={m.suggestedFollowUps?.length ? m.suggestedFollowUps : followUpChips(m)} onPick={handleSend} disabled={sending} />
                  )}
                </div>
              )
            )}

            {/* Bloque 38 (pedido explícito): sin avatar, sin texto de
                estado — solo la burbuja con los 3 puntitos animados con
                Framer Motion (ver TypingDots.jsx), mismo patrón de
                WhatsApp/Messenger. Transición de entrada suave (fade-up).
                Nunca queda en el historial: es un estado transitorio. */}
            {(sending || transcribing) && (
              <div className="mb-3 max-w-[88%] animate-fade-up">
                <TypingDots />
              </div>
            )}

            {/* Bloque 33: tarjeta genérica de error — nunca el mensaje real
                (el backend ya lo registró en Admin > Errores). Estilo de
                AVISO, distinto de una burbuja de texto más, con su propio
                botón de reintentar. Un solo estado (booleano) en vez de una
                lista: cada fallo nuevo la reemplaza, nunca se apilan varias. */}
            {errorMsg && (
              <div className="mb-3 flex max-w-[88%] items-start gap-1.5">
                <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-error/10 text-error">
                  <AlertTriangle className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 rounded-lg rounded-tl-none border border-error/20 bg-error/5 px-3.5 py-2.5">
                  <p className="text-[12.5px] leading-5 text-on-surface-variant">
                    Estamos teniendo problemas técnicos en este chat. Prueba de nuevo en un momento.
                  </p>
                  <button
                    onClick={handleRetry}
                    disabled={sending}
                    className="mt-2 flex items-center gap-1.5 rounded-full bg-error px-3.5 py-1.5 text-[11.5px] font-bold text-white disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" /> Reintentar
                  </button>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          <div className="flex flex-shrink-0 gap-2 border-t border-surface-container-high p-3">
            {recording ? (
              <div className="flex h-10 flex-1 items-center gap-2 rounded-full border border-error/40 bg-error/5 px-4">
                <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-error" />
                <span className="flex-1 text-[12.5px] text-error">Grabando...</span>
                <button onClick={cancelRecording} aria-label="Cancelar grabación" className="flex-shrink-0 text-outline hover:text-error">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : transcribing ? (
              <div className="flex h-10 flex-1 items-center gap-2 rounded-full border border-outline-variant bg-surface-container-lowest px-4 text-[12.5px] text-outline">
                Transcribiendo audio...
              </div>
            ) : (
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Pregunta algo o graba un audio"
                disabled={sending}
                className="h-10 flex-1 rounded-full border border-outline-variant bg-surface-container-lowest px-4 text-[13px] outline-none disabled:opacity-60"
              />
            )}

            <button
              onClick={recording ? stopAndSendRecording : startRecording}
              disabled={sending || transcribing}
              aria-label={recording ? "Detener y enviar audio" : "Grabar audio"}
              title={recording ? "Detener y enviar" : "Grabar mensaje de voz"}
              className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full disabled:opacity-50 ${
                recording ? "bg-error text-white" : "bg-surface-container text-on-surface-variant"
              }`}
            >
              {recording ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-4 w-4" />}
            </button>

            {!recording && !transcribing && (
              <button
                onClick={() => handleSend()}
                disabled={!text.trim() || sending}
                aria-label="Enviar mensaje"
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-tertiary-accent text-white disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>

          <p className="flex-shrink-0 py-1.5 text-center text-[10px] text-outline">Desarrollado por {siteName}</p>
        </div>
      )}
    </>
  );
}
