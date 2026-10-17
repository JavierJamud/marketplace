import { useCallback, useEffect, useRef, useState } from "react";

// Avisos del chat cerrado (asistente del sitio y chat de cada tienda):
// - Si la bienvenida se cierra sola y la persona nunca abrió el chat, queda un punto con "1" en el ícono: hay un mensaje por leer.
// - Si cierra el chat mientras el bot todavía está respondiendo, al llegar la respuesta suma otro y muestra un adelanto corto
//   de lo que respondió, que se oculta solo a los pocos segundos (el número sigue hasta que abre el chat).
// Al abrir el chat todo se limpia.
const PREVIEW_AUTOHIDE_MS = 10000;
const PREVIEW_MAX = 110;

// Texto plano y corto para el adelanto: sin marcas de formato, cortado en una palabra completa.
export function replySummary(text) {
  const plain = String(text ?? "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>|]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= PREVIEW_MAX) return plain;
  const cut = plain.slice(0, PREVIEW_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 60)).trim()}…`;
}

export function useChatUnread(open) {
  const [unread, setUnread] = useState(0);
  const [preview, setPreview] = useState(null);
  const openRef = useRef(open);
  const openedOnceRef = useRef(false);
  openRef.current = open;

  useEffect(() => {
    if (!open) return;
    openedOnceRef.current = true;
    setUnread(0);
    setPreview(null);
  }, [open]);

  useEffect(() => {
    if (!preview) return undefined;
    const t = setTimeout(() => setPreview(null), PREVIEW_AUTOHIDE_MS);
    return () => clearTimeout(t);
  }, [preview]);

  // La bienvenida se cerró y el chat nunca se abrió: queda como mensaje sin leer.
  const markWelcomeUnread = useCallback(() => {
    if (!openRef.current && !openedOnceRef.current) setUnread((u) => Math.max(u, 1));
  }, []);

  // Llegó una respuesta: si el chat está cerrado, se avisa con el número y el adelanto.
  const notifyReply = useCallback((text) => {
    if (openRef.current) return;
    setUnread((u) => u + 1);
    setPreview(replySummary(text));
  }, []);

  const dismissPreview = useCallback(() => setPreview(null), []);

  return { unread: open ? 0 : unread, preview: open ? null : preview, markWelcomeUnread, notifyReply, dismissPreview };
}
