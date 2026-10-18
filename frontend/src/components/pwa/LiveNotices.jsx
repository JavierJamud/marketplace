import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import toast from "../../lib/toast.jsx";
import { NOTICE_EVENT } from "../../lib/useRealtime.js";

// Avisos que llegan por el canal en vivo mientras la página está abierta (con la página cerrada llegan como push del sistema).
// Se muestran con el mismo estilo que el resto de los avisos del sitio (Sileo) y, si tienen a dónde llevar, con el botón "Ver".
const DURATION_MS = 8000;

export function LiveNotices() {
  const navigate = useNavigate();
  const nav = useRef(navigate);
  nav.current = navigate;

  useEffect(() => {
    const shown = new Map(); // tag -> id del aviso, para reemplazar en vez de apilar avisos del mismo tema
    const onNotice = (e) => {
      const n = e.detail ?? {};
      // Los pedidos nuevos ya tienen su propia ventana con sonido en el panel de la tienda.
      if (n.category === "orders" && String(n.tag ?? "").startsWith("vn-") && /^\/vendedor/.test(window.location.pathname)) return;
      if (n.tag && shown.has(n.tag)) toast.dismiss(shown.get(n.tag));
      const url = n.url && n.url !== window.location.pathname ? n.url : null;
      const id = url
        ? toast.action(n.title ?? "Aviso", n.body, { label: "Ver", duration: DURATION_MS, onClick: () => nav.current(url) })
        : toast.info(n.title ?? "Aviso", n.body, { icon: "bell", duration: DURATION_MS });
      if (n.tag) shown.set(n.tag, id);
    };
    window.addEventListener(NOTICE_EVENT, onNotice);
    return () => window.removeEventListener(NOTICE_EVENT, onNotice);
  }, []);

  return null;
}
