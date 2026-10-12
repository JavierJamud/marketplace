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
  // El chat se monta cuando la página ya terminó de cargar y el navegador está libre: así no compite con la imagen del
  // encabezado ni con el resto de la portada.
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const start = () => {
      const run = () => !cancelled && setIdle(true);
      if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 4000 });
      else setTimeout(run, 1500);
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", start);
    };
  }, []);
  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  if (!idle || !(settings?.showChatWidget ?? true) || !(settings?.chatbotAvailable ?? true)) return null;
  return (
    <Suspense fallback={null}>
      <MarketplaceChatWidget />
    </Suspense>
  );
}
