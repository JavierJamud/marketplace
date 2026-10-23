import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import toast from "../../lib/toast.jsx";
import { NOTICE_EVENT } from "../../lib/useRealtime.js";
import { OrderNoticeCard } from "./OrderNoticeCard.jsx";

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
      // Los pedidos nuevos ya tienen su propia ventana con sonido en el panel de la tienda. Los demás avisos de pedidos (atrasado,
      // cancelado o cambiado por el cliente) no la tienen y se muestran aquí.
      if (n.type === "NEW_ORDER" && /^\/vendedor/.test(window.location.pathname)) return;
      if (n.tag && shown.has(n.tag)) toast.dismiss(shown.get(n.tag));
      const url = n.url && n.url !== window.location.pathname ? n.url : null;
      // Pedido (nuevo para la tienda, recibido para el cliente): tarjeta con el detalle en lugar de una línea de texto.
      if (n.detail?.kind === "order") {
        const title = n.detail.audience === "vendor" ? "Pedido nuevo" : "Pedido recibido";
        const card = <OrderNoticeCard d={n.detail} />;
        // Se despliega casi enseguida y se queda abierto 10 s para poder leerlo (por defecto Sileo lo pliega a los 4 s).
        const autopilot = { expand: 300, collapse: 10000 };
        const id = url
          ? toast.action(title, card, { label: "Ver pedido", duration: 12000, onClick: () => nav.current(url), autopilot })
          : toast.success(title, card, { icon: "order", duration: 12000, autopilot });
        if (n.tag) shown.set(n.tag, id);
        return;
      }
      // Un pedido que lleva rato esperando se queda más tiempo en pantalla: es el que más importa no perderse.
      const duration = n.type === "ORDER_OVERDUE" ? 20000 : DURATION_MS;
      const id = url
        ? toast.action(n.title ?? "Aviso", n.body, { label: "Ver", duration, onClick: () => nav.current(url) })
        : toast.info(n.title ?? "Aviso", n.body, { icon: "bell", duration });
      if (n.tag) shown.set(n.tag, id);
    };
    window.addEventListener(NOTICE_EVENT, onNotice);
    return () => window.removeEventListener(NOTICE_EVENT, onNotice);
  }, []);

  return null;
}
