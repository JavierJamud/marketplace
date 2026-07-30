import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { X, Send, RotateCcw, ShoppingCart, Mic, Square, AlertTriangle, Volume2, VolumeX } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../lib/api.js";
import { usePlatformSettings } from "../lib/usePlatformSettings.js";
import { useCart } from "../context/CartContext.jsx";
import { AddToCartControl } from "./AddToCartControl.jsx";
import { RequestProductButton } from "./RequestProductButton.jsx";
import { isChatMuted, setChatMuted, playChatNotificationSound } from "../lib/chatSound.js";
import { TypingDots } from "./TypingDots.jsx";
import { VoiceWaveform } from "./VoiceWaveform.jsx";
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

// Bloque 28: mismo "asset" que el avatar de Store.jsx (círculo con el
// color de marca de la tienda + su inicial) — hoy no existe un logo/imagen
// real subible para tiendas (ver Vendor.logoUrl/coverUrl, sin UI de carga
// en ningún lado del proyecto), así que esto ES el avatar real de la
// tienda en toda la app, no un placeholder de este bloque puntual. Bloque
// 38: ya NO se usa junto a los mensajes del chat (pedido explícito de sacar
// el avatar de ahí) — queda solo como branding del header del panel y de
// la burbuja proactiva.
function VendorAvatar({ vendor, className }) {
  const color = vendor.color ?? "#232F3E";
  return (
    <div style={{ background: color }} className={`flex flex-shrink-0 items-center justify-center rounded-full font-display font-extrabold text-white ${className}`}>
      {vendor.companyName[0]}
    </div>
  );
}

// Bloque 26: sesión vencida a las 24h desde el último mensaje — mismo
// umbral que SESSION_EXPIRY_MS en chat.controller.js (el backend es la
// fuente de verdad final, esto es el chequeo del lado del cliente para no
// ni siquiera pedir el historial viejo si ya se sabe que venció).
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

// Bloque 47: mismo criterio que MarketplaceChatWidget.jsx — timer EN VIVO
// mientras el widget está montado, distinto de SESSION_EXPIRY_MS (que solo
// se chequea al abrir/crear sesión).
const IDLE_RESET_MS = 30 * 60 * 1000;

function sessionKey(vendorId) {
  return `zeudin_chat_session_${vendorId}`;
}
function activityKey(vendorId) {
  return `zeudin_chat_lastActivity_${vendorId}`;
}

// Registra la marca de "último mensaje" — se llama después de cada envío
// exitoso. Es lo que getOrCreateSessionId usa para decidir si la sesión
// guardada sigue viva o hay que arrancar una nueva.
function touchActivity(vendorId) {
  localStorage.setItem(activityKey(vendorId), String(Date.now()));
}

// Un sessionId por tienda (no uno global) — así el historial de una tienda
// nunca se mezcla con el de otra en localStorage. Sin login: el sessionId ES
// la identidad del cliente para este chat, se genera una sola vez... salvo
// que la última actividad guardada tenga más de 24h, en cuyo caso se trata
// como si nunca hubiera existido (Bloque 26).
function getOrCreateSessionId(vendorId) {
  const lastActivity = Number(localStorage.getItem(activityKey(vendorId)) ?? 0);
  const expired = lastActivity && Date.now() - lastActivity > SESSION_EXPIRY_MS;

  let sessionId = expired ? null : localStorage.getItem(sessionKey(vendorId));
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(sessionKey(vendorId), sessionId);
    touchActivity(vendorId);
  }
  return sessionId;
}

// Usado tanto por la expiración de 24h detectada tarde (el backend avisa
// `expired: true`) como por el botón manual "Nuevo chat" — misma acción en
// los dos casos: identidad de conversación nueva de cero.
function startNewSession(vendorId) {
  const sessionId = crypto.randomUUID();
  localStorage.setItem(sessionKey(vendorId), sessionId);
  touchActivity(vendorId);
  return sessionId;
}

// Bloque 24: burbuja proactiva a los 5s de entrar a la tienda.
// Bloque 31: primer intento de arreglo — guardaba un timestamp con
// vencimiento a las 24h (SESSION_EXPIRY_MS) en vez de "visto para siempre"
// (bug real: antes, cualquiera que ya hubiera abierto la tienda una vez no
// volvía a ver la burbuja NUNCA MÁS en ese navegador).
// Bloque 32: pedido explícito — la burbuja debe aparecer en CADA carga de
// página, no solo la primera vez (ni siquiera con vencimiento de 24h). Se
// saca la persistencia en localStorage por completo: ya no hay "visto" que
// recordar entre cargas, solo el timer de este montaje puntual del
// componente (ver el useEffect de la burbuja más abajo).
const BUBBLE_DELAY_MS = 5000;
const BUBBLE_AUTOHIDE_MS = 8000;

// Bloque 24/34: tarjeta de producto embebida en el chat — rediseñada en el
// Bloque 34 a layout de lista compacta (imagen chica a la derecha, texto a
// la izquierda, acción al final), inspirado en el patrón de apps de
// delivery modernas — mismos datos/misma lógica de siempre, nunca abre
// ProductDetail.jsx para agregar. Respeta el mismo criterio de stock del
// Bloque 23: agotado -> "Solicitar", no "Agregar al carrito". Esta acción
// manual (click del cliente en el botón) es distinta de addToCart (Bloque
// 28, el cliente PIDIÓ agregarlo por texto y ya se ejecutó solo) — ambas
// terminan llamando al mismo CartContext.addItem.
function ChatProductCard({ product, vendor }) {
  const href = `/producto/${vendor.slug}/${product.slug}`;
  // Mismo cálculo que Product.jsx — precio tachado + badge de % solo si el
  // producto realmente tiene oldPrice cargado, nunca inventado.
  const discount = product.oldPrice ? Math.round(100 - (Number(product.price) / Number(product.oldPrice)) * 100) : null;
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-2.5 shadow-sm">
      <Link to={href} className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-md bg-surface-container">
        {product.images?.[0] ? (
          <img src={imgUrl(product.images[0])} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[8px] text-outline">Sin foto</div>
        )}
      </Link>
      <Link to={href} className="min-w-0 flex-1">
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
      </Link>
      <div className="flex-shrink-0">
        {product.stock > 0 ? (
          <AddToCartControl product={{ ...product, vendorId: vendor.id, vendor }} size="sm" variant="circle" />
        ) : (
          <RequestProductButton productId={product.id} size="sm" />
        )}
      </div>
    </div>
  );
}

// Bloque 34: chips de preguntas sugeridas — las iniciales (antes de
// escribir nada) usan datos REALES de esta tienda (category/businessCategory
// y si hay algún producto con oldPrice, ambos ya vienen en el `vendor` que
// pasa Store.jsx/Product.jsx, sin pedir nada extra al backend), nunca
// genéricas de cualquier rubro. Las de seguimiento dependen de si la ÚLTIMA
// respuesta del bot mostró productos o no — única señal real disponible del
// lado del cliente sin tener que interpretar el texto libre del bot.
// Bloque 39 (Parte 3, pedido explícito): "las preguntas más comunes para
// ESA empresa", derivadas de datos reales ya disponibles en "vendor" (nada
// nuevo que pedirle al backend) — rubro, ofertas, destacados, horario y
// pagos cargados. Se arma un pool priorizado por lo más específico/real
// primero, con un fallback genérico mínimo al final solo para rellenar si
// a la tienda le falta algún dato (recién creada, sin ventas, etc.).
function initialChipsFor(vendor) {
  const category = vendor.category?.name || vendor.businessCategory?.name;
  const hasOffers = vendor.products?.some((p) => p.oldPrice);
  const hasFeatured = vendor.products?.some((p) => p.isFeatured);
  const hasSchedule = vendor.schedules?.some((s) => !s.isClosed);
  const hasPayments = vendor.acceptedPaymentMethods?.length > 0;

  const pool = [];
  if (hasOffers) pool.push("¿Qué ofertas hay?");
  if (category) pool.push(`Ver ${category}`);
  if (hasFeatured) pool.push("Ver los más destacados");
  if (hasSchedule) pool.push("¿Qué horario tienen?");
  if (hasPayments) pool.push("¿Cómo puedo pagar?");
  pool.push("Mostrame el catálogo", "¿Tienen delivery?"); // fallback mínimo si falta dato real

  return ["¿Qué me recomiendan?", ...pool].slice(0, 3);
}

function followUpChipsFor(lastMessage) {
  if (lastMessage?.products?.length > 0) {
    return ["Ver más opciones", "Filtrar por precio", "¿Tienen otro color o talla?"];
  }
  return ["¿Qué me recomiendan?", "Ver catálogo", "¿Tienen delivery?"];
}

// Mismo margen que la fila de tarjetas de producto — reemplaza al set
// anterior, nunca se acumulan (ver dónde se renderiza en el JSX: siempre UN
// solo set visible, el inicial o el de seguimiento del último mensaje,
// nunca ambos).
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

// Bloque 28: fila de mensaje del bot — factor común para el saludo, cada
// respuesta real y el error, así se ven consistentes sin repetir el layout
// varias veces. Bloque 38: ya no lleva avatar al lado (pedido explícito) —
// el mensaje del bot queda solo con su burbuja de texto.
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

// Bloque 21: chat con IA, solo para tiendas verificadas (el backend también
// lo exige — vendors/:vendorId/chat devuelve 403 si no, este componente no
// es la única barrera). Se monta igual en Store.jsx y Product.jsx, siempre
// con el mismo `vendor` (id + companyName alcanza).
export function StoreChatWidget({ vendor }) {
  const { siteName } = usePlatformSettings();
  const { vendorId: cartVendorId, items, total, addItem, removeItem, clearCart } = useCart();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [messages, setMessages] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState(false);
  const [showBubble, setShowBubble] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  // Bloque 32: idle | recording | transcribing — grabación de audio (mismo
  // mecanismo que MarketplaceChatWidget.jsx, ver sus comentarios).
  const [recordingState, setRecordingState] = useState("idle");
  // Bloque 38: preferencia de sonido, leída una sola vez de localStorage al
  // montar (clave compartida con MarketplaceChatWidget.jsx, ver chatSound.js).
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
  // Bloque 33: último mensaje que se intentó mandar (texto tipeado o ya
  // transcrito de un audio) — "Reintentar" en la tarjeta de error lo reusa
  // tal cual, como si el cliente lo acabara de mandar de nuevo, sin
  // pedirle que lo reescriba.
  const lastMessageRef = useRef("");
  // Bloque 47: timer de auto-reset por inactividad (ver IDLE_RESET_MS).
  const idleTimerRef = useRef(null);
  if (!sessionIdRef.current) sessionIdRef.current = getOrCreateSessionId(vendor.id);

  function scheduleIdleReset() {
    clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => reallyResetChat(), IDLE_RESET_MS);
  }

  // El widget vive montado toda la visita a la tienda — corre desde el
  // montaje, sin importar si el panel está abierto o cerrado.
  useEffect(() => {
    scheduleIdleReset();
    return () => clearTimeout(idleTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bloque 28: cuántos ítems/cuánto total mostrar en la franja de carrito
  // del panel — mismo cálculo que el contador del header (Header.jsx), leído
  // directo de CartContext (no un estado propio) para que se actualice solo
  // sin importar si el agregado vino del chat, de una card o de otra pestaña.
  const cartCount = items.reduce((a, i) => a + i.quantity, 0);

  // Se pide el historial recién al abrir por primera vez (no en cada
  // render de la página) — así refrescar mantiene la charla sin pedirle
  // nada al backend hasta que el cliente realmente abre el widget.
  useEffect(() => {
    if (!open || historyLoaded) return;
    api
      .get(`/vendors/${vendor.id}/chat`, { params: { sessionId: sessionIdRef.current } })
      .then(({ data }) => {
        setMessages(data.messages);
        // Bloque 26: el backend detectó que esta sesión venció (>24h) pese
        // a que el chequeo de localStorage al montar no lo agarró — ej. la
        // pestaña quedó abierta desde ayer. Rota el sessionId ahora para
        // que el PRÓXIMO mensaje ya arranque una conversación limpia.
        if (data.expired) sessionIdRef.current = startNewSession(vendor.id);
      })
      .catch(() => { })
      .finally(() => setHistoryLoaded(true));
  }, [open, historyLoaded, vendor.id]);

  // Cierra el popover de confirmación de "Nuevo chat" al clickear afuera —
  // mismo patrón que AccountMenu/SearchBar en Header.jsx.
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

  // Bloque 24: burbuja proactiva — a los 5s de entrar a la tienda, si el
  // cliente todavía no abrió el chat y no la vio antes en esta tienda,
  // aparece sola; se esconde a los pocos segundos si la ignora, o de una
  // si abre el chat mientras tanto (ver el useEffect siguiente).
  useEffect(() => {
    const showTimer = setTimeout(() => setShowBubble(true), BUBBLE_DELAY_MS);
    return () => clearTimeout(showTimer);
  }, [vendor.id]);

  useEffect(() => {
    if (!showBubble) return;
    const hideTimer = setTimeout(() => setShowBubble(false), BUBBLE_AUTOHIDE_MS);
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
      // Bloque 30: le mandamos al backend cuánto de cada producto ya tiene
      // el cliente en su carrito — es la única forma de que sepa el
      // disponible real (CartContext es 100% del cliente, el backend no
      // tiene otra ventana a eso). El carrito es de UN vendedor a la vez
      // (CartContext.vendorId, no hay vendorId por ítem) — si pertenece a
      // otra tienda, no hay nada de ESTA tienda en el carrito, van 0 items.
      const cartQuantities = cartVendorId === vendor.id ? Object.fromEntries(items.map((i) => [i.productId, i.quantity])) : {};
      const { data } = await api.post(`/vendors/${vendor.id}/chat`, { sessionId: sessionIdRef.current, message, cartQuantities });
      setMessages((m) => [...m, data.message]);
      touchActivity(vendor.id);
      scheduleIdleReset();
      // Bloque 38: sonido corto al recibir la respuesta — solo puede pasar
      // acá (el panel está abierto, es la única forma de llegar a este
      // código) y solo si el cliente no lo silenció.
      if (!muted) playChatNotificationSound();

      // Bloque 28: acá se ejecuta la acción REAL — el modelo solo decidió
      // (y ya validó el backend contra el catálogo real + stock) que el
      // cliente pidió agregar esto; el "ya lo agregué" que ve el cliente lo
      // genera la interfaz recién ACÁ, después de que CartContext.addItem
      // corrió de verdad, nunca como texto que el modelo simplemente dijo.
      if (data.message.addToCart?.length > 0) {
        let addedAny = false;
        for (const item of data.message.addToCart) {
          const result = addItem(
            {
              id: item.id,
              name: item.name,
              price: Number(item.price),
              // Bloque 56: `null` (no un número) le dice a CartContext que
              // este producto no tiene techo real de stock que respetar.
              stock: item.unlimitedStock ? null : item.stock,
              vendorId: vendor.id,
              vendorName: vendor.companyName,
              vendorSlug: vendor.slug,
              vendorColor: vendor.color,
              vendorVerified: vendor.isVerified,
              vendorWhatsapp: vendor.whatsapp,
            },
            item.quantity
          );
          if (!result.conflict) addedAny = true;
        }
        // Si hubo conflicto de tienda (carrito con otro vendedor), el modal
        // global ya se encarga (mismo CartConflictModal de siempre) — acá
        // solo se confirma lo que realmente se agregó sin pisar nada.
        if (addedAny) {
          const names = data.message.addToCart.map((i) => i.name).join(", ");
          toast.success(`✓ Agregado al carrito: ${names}`);
        }
      }

      // Bloque 40 (bug real reportado en vivo: el cliente pidió vaciar el
      // carrito, el bot dijo que sí pero el carrito real no cambiaba) —
      // mismo criterio que addToCart arriba: el texto del bot nunca alcanza
      // por sí solo, la acción real (CartContext.clearCart/removeItem) se
      // ejecuta ACÁ, después de la respuesta ya validada por el backend.
      if (data.message.clearCart) {
        clearCart();
        toast.success("Carrito vaciado");
      } else if (data.message.removeFromCart?.length > 0) {
        data.message.removeFromCart.forEach((id) => removeItem(id));
      }
    } catch {
      // Bloque 33: nunca se muestra el error real (ni mensaje de excepción,
      // ni código, ni proveedor) — el backend ya lo registró en Admin >
      // Errores; acá solo se sabe QUE falló, se renderiza como tarjeta
      // (ver JSX) en vez de burbuja de texto.
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
  // escrito (mismo mecanismo que MarketplaceChatWidget.jsx).
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Tu navegador no soporta grabación de audio — escribe tu mensaje.");
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
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

  // Bloque 26: "Nuevo chat" — mismo efecto que la expiración automática de
  // 24h, pero disparado a mano por el cliente en cualquier momento. Si ya
  // hay conversación de por medio, pide confirmación antes (evita perder
  // una charla por un toque accidental); si está vacía, reinicia directo.
  function handleNewChat() {
    if (messages.length > 0) {
      setConfirmingReset(true);
      return;
    }
    reallyResetChat();
  }

  function reallyResetChat() {
    sessionIdRef.current = startNewSession(vendor.id);
    setMessages([]);
    setErrorMsg(false);
    setHistoryLoaded(true);
    setConfirmingReset(false);
    // Re-arma la ventana de 30 min — sigue reiniciándose solo si el
    // visitante nunca vuelve a usar el chat, no una única vez.
    scheduleIdleReset();
  }

  return (
    <>
      {/* Bloque 24: burbuja proactiva — mismo rincón que el botón flotante,
          apilada justo arriba. Se cierra con la X sin abrir el chat, o sola
          al abrirlo (ver useEffects de arriba). */}
      {!open && showBubble && (
        <div className="fixed bottom-[84px] right-5 z-[60] flex max-w-[260px] items-start gap-2 rounded-2xl rounded-br-md bg-surface-container-lowest p-3.5 shadow-2xl animate-fade-up sm:bottom-[100px] sm:right-6">
          <VendorAvatar vendor={vendor} className="h-8 w-8 text-[13px]" />
          <p className="flex-1 text-[12.5px] leading-[17px] text-on-surface-variant">
            ¡Hola! Soy el asistente de <span className="font-bold text-on-surface">{vendor.companyName}</span>, te ayudo a encontrar el producto ideal.
          </p>
          <button
            onClick={() => setShowBubble(false)}
            aria-label="Cerrar aviso"
            className="flex-shrink-0 text-outline hover:text-on-surface-variant"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Bloque 48 (pedido explícito, reemplaza el diseño del Bloque 28/47):
          mismo botón de 3 estados que el bot general — ya no usa el color
          de marca de la tienda para este botón puntual (instrucción directa
          del bloque: "aplica igual a ambos widgets", el mismo tertiary-accent
          para los dos). Se mantiene montado con el panel abierto por el
          mismo motivo que MarketplaceChatWidget.jsx: en desktop el panel
          deja hueco debajo, en mobile el panel de pantalla completa lo tapa
          solo (mismo z-index, pinta después en el DOM). */}
      <ChatFaceButton
        isOpen={open}
        onClick={() => {
          setOpen((v) => !v);
          setShowBubble(false);
          scheduleIdleReset();
        }}
        ariaLabel={open ? "Cerrar chat con IA de la tienda" : "Abrir chat con IA de la tienda"}
        className="fixed bottom-5 right-5 z-[60] sm:bottom-6 sm:right-6"
      />

      {open && (
        <div
          className={
            // Mobile: bottom-sheet con dvh (no vh) — en Safari/Chrome mobile
            // real, vh se calcula contra el viewport GRANDE (barra de
            // direcciones oculta) y queda más alto que el área visible real
            // cuando la barra está mostrada; dvh sí sigue el tamaño visible
            // real en cada momento.
            // Bloque 51 (pedido explícito): antes arrancaba en bottom-0,
            // pintando justo encima del botón (mismo z-[60], el panel va
            // después en el DOM) — lo tapaba por completo en mobile.
            // bottom-[86px] deja el mismo tipo de hueco que ya existía en
            // desktop (sm:bottom-24 contra el bottom-6 del botón), así el
            // botón queda visible debajo del panel en vez de tapado.
            // rounded-2xl en las 4 esquinas (antes rounded-t-2xl, solo
            // arriba) + mx-2.5: con el panel ya despegado del borde inferior
            // de la pantalla, se ve como tarjeta flotante a propósito, no
            // como una hoja pegada al borde con un corte recto abajo.
            "fixed inset-x-0 bottom-[86px] z-[60] mx-2.5 flex h-[75dvh] max-h-[560px] flex-col rounded-2xl bg-surface-container-lowest shadow-2xl animate-fade-up " +
            // Desktop: alto por top+bottom (no un h-[…] fijo) — así el panel
            // se achica solo en pantallas bajas (ej. 1366x768, la resolución
            // de laptop más común) en vez de invadir el header de la tienda
            // por arriba. max-h-[560px] (heredado de la clase base) sigue
            // poniendo un techo en monitores muy altos.
            "sm:inset-x-auto sm:inset-y-auto sm:mx-0 sm:top-6 sm:bottom-24 sm:right-6 sm:h-auto sm:w-[368px] sm:border sm:border-surface-container-high"
          }
        >
          <div className="flex items-center gap-2.5 rounded-t-2xl bg-tertiary px-4 py-3.5 text-white">
            <VendorAvatar vendor={vendor} className="h-8 w-8 text-[13px]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-label-md font-bold">{vendor.companyName}</div>
              <div className="text-[11px] text-white/70">Asistente con IA</div>
            </div>
            {/* Bloque 38: mute toggle — clave compartida con el chat
                general (ver chatSound.js), persiste entre recargas. */}
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
            {/* Bloque 26: "Nuevo chat" — mismo rincón que el botón de
                cerrar, con su propio popover de confirmación si hay
                conversación de por medio (ver handleNewChat). */}
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

          {/* Bloque 28: franja de estado del carrito — lee CartContext
              directo (mismo total que el header del sitio), se actualiza
              sola sin importar de dónde vino el agregado. Solo se muestra
              si hay algo, para no ocupar espacio en un panel ya angosto
              cuando el carrito está vacío. */}
          {cartCount > 0 && (
            <Link
              to="/carrito"
              className="flex flex-shrink-0 items-center justify-between border-b border-surface-container-high bg-secondary-container/10 px-4 py-2 text-[12px] font-bold text-secondary hover:bg-secondary-container/[0.15]"
            >
              <span className="flex items-center gap-1.5">
                <ShoppingCart className="h-3.5 w-3.5" />
                Carrito: {cartCount} {cartCount === 1 ? "ítem" : "ítems"} · {fmtCUP(total)}
              </span>
              <span className="text-[11px]">Ver →</span>
            </Link>
          )}

          <div className="flex-1 overflow-y-auto p-4">
            <BotRow>
              <div className="rounded-lg rounded-tl-none bg-surface-container px-3.5 py-2.5 text-[13px] leading-5 text-on-surface-variant">
                ¡Hola! Preguntame lo que quieras sobre {vendor.companyName} — productos, precios, horarios, políticas...
              </div>
            </BotRow>

            {/* Bloque 34: chips iniciales — solo cuando ya se sabe con
                certeza que no hay historial (evita el flash de mostrarlos y
                sacarlos apenas carga una conversación previa real). */}
            {historyLoaded && messages.length === 0 && !sending && recordingState === "idle" && (
              <SuggestedChips chips={initialChipsFor(vendor)} onPick={handleSend} disabled={sending} />
            )}

            {open && !historyLoaded && <p className="py-2 text-center text-[12px] text-outline">Cargando conversación...</p>}

            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={m.id} className="mb-3 flex flex-col items-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-tr-none bg-primary-container px-3.5 py-2.5 text-[13px] leading-5 text-white">
                    {m.content}
                  </div>
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
                      todas. Se sacan del BotRow (que tiene max-w-[88%]) para
                      que puedan usar el ancho completo disponible. */}
                  {m.products?.length > 0 && (
                    <div className="-mt-1.5 mb-3 flex w-full max-w-[95%] flex-col gap-2 overflow-y-auto pb-1" style={{ maxHeight: 280 }}>
                      {m.products.map((p) => (
                        <ChatProductCard key={p.id} product={p} vendor={vendor} />
                      ))}
                    </div>
                  )}
                  {/* Bloque 34: chips de seguimiento — solo bajo la ÚLTIMA
                      respuesta del bot, y solo si no hay nada más en curso
                      (reemplazan al set anterior en vez de acumularse, ya
                      que solo existe UN "último mensaje" a la vez). El bot
                      ya manda sus propias sugerencias contextuales
                      (suggestedFollowUps, distintas turno a turno según lo
                      que acaba de responder) — el set fijo de acá solo es
                      respaldo si el modelo no las incluyó esta vez. */}
                  {i === messages.length - 1 && !sending && !errorMsg && recordingState === "idle" && (
                    <SuggestedChips chips={m.suggestedFollowUps?.length ? m.suggestedFollowUps : followUpChipsFor(m)} onPick={handleSend} disabled={sending} />
                  )}
                </div>
              )
            )}

            {/* Bloque 38 (pedido explícito): sin avatar, sin texto de
                estado — solo la burbuja con los 3 puntitos animados con
                Framer Motion (ver TypingDots.jsx), mismo patrón de
                WhatsApp/Messenger. Transición de entrada suave (fade-up).
                Nunca queda en el historial: es un estado transitorio. */}
            {(sending || recordingState === "transcribing") && (
              <div className="mb-3 max-w-[88%] animate-fade-up">
                <TypingDots />
              </div>
            )}

            {/* Bloque 33: tarjeta genérica de error — nunca el mensaje real
                (ver postChatMessage, siempre "chat_unavailable" sin
                detalle). Estilo de AVISO, distinto de una burbuja de texto
                más, con su propio botón de reintentar. Un solo estado
                (booleano) en vez de una lista: cada fallo nuevo la
                reemplaza, nunca se apilan varias. */}
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
            {recordingState === "recording" ? (
              <div className="flex h-10 flex-1 items-center gap-2 rounded-full border border-error/40 bg-error/5 px-4">
                <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-error" />
                <span className="flex-1 text-[12.5px] text-error">Grabando...</span>
                <button onClick={cancelRecording} aria-label="Cancelar grabación" className="flex-shrink-0 text-outline hover:text-error">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : recordingState === "transcribing" ? (
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
              onClick={recordingState === "recording" ? stopAndSendRecording : startRecording}
              disabled={sending || recordingState === "transcribing"}
              aria-label={recordingState === "recording" ? "Detener y enviar audio" : "Grabar audio"}
              title={recordingState === "recording" ? "Detener y enviar" : "Grabar mensaje de voz"}
              className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full disabled:opacity-50 ${recordingState === "recording" ? "bg-error text-white" : "bg-surface-container text-on-surface-variant"
                }`}
            >
              {recordingState === "recording" ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-4 w-4" />}
            </button>

            {recordingState === "idle" && (
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

          {/* Bloque 28: pie discreto — no compite con el contenido, va
              debajo de todo lo funcional. */}
          <p className="flex-shrink-0 py-1.5 text-center text-[10px] text-outline">Desarrollado por {siteName}</p>
        </div>
      )}
    </>
  );
}
