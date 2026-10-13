import { useFlow } from "../context/FlowContext.jsx";
import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
// El chat se descarga aparte, después de la página: no retrasa la primera carga.
const MarketplaceChatWidget = lazy(() => import("./MarketplaceChatWidget.jsx").then((m) => ({ default: m.MarketplaceChatWidget })));

// Bloque 269 (pedido explícito — "el chatbot de la página principal debe mostrarse
// también en la página de tiendas y en la del catálogo de productos"): antes se
// montaba solo en Home. Este componente aplica en un solo lugar las mismas reglas de
// siempre (el interruptor del admin en Marca y que la IA esté respondiendo) para que
// Inicio, Tiendas y Catálogo se comporten igual. La página de cada tienda y la de
// cada producto siguen con el chat de su propia tienda.
export function MarketplaceChatGate() {
  // El asistente aparece al final de la secuencia de bienvenida: lugar resuelto y cookies aceptadas.
  const { canShowChat } = useFlow();
  // El chat se monta cuando la persona empieza a usar la página (toca, desplaza, mueve el ratón o escribe) o 6 s después de
  // que terminó de cargar: así su código no compite con la primera pantalla ni bloquea el hilo mientras carga.
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const EVENTS = ["pointerdown", "touchstart", "scroll", "keydown", "mousemove"];
    let timer;
    const go = () => setIdle(true);
    const onLoad = () => {
      timer = setTimeout(go, 6000);
    };
    EVENTS.forEach((e) => window.addEventListener(e, go, { once: true, passive: true }));
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => {
      clearTimeout(timer);
      EVENTS.forEach((e) => window.removeEventListener(e, go));
      window.removeEventListener("load", onLoad);
    };
  }, []);
  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  if (!canShowChat || !idle || !(settings?.showChatWidget ?? true) || !(settings?.chatbotAvailable ?? true)) return null;
  return (
    <Suspense fallback={null}>
      <MarketplaceChatWidget />
    </Suspense>
  );
}
