import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { MarketplaceChatWidget } from "./MarketplaceChatWidget.jsx";

// Bloque 269 (pedido explícito — "el chatbot de la página principal debe mostrarse
// también en la página de tiendas y en la del catálogo de productos"): antes se
// montaba solo en Home. Este componente aplica en un solo lugar las mismas reglas de
// siempre (el interruptor del admin en Marca y que la IA esté respondiendo) para que
// Inicio, Tiendas y Catálogo se comporten igual. La página de cada tienda y la de
// cada producto siguen con el chat de su propia tienda.
export function MarketplaceChatGate() {
  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  if (!(settings?.showChatWidget ?? true) || !(settings?.chatbotAvailable ?? true)) return null;
  return <MarketplaceChatWidget />;
}
