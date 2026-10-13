import { StoreChatWidget } from "./StoreChatWidget.jsx";
import { useFlow } from "../context/FlowContext.jsx";

// El chat de una tienda también espera a que el lugar esté resuelto y las cookies aceptadas (ver FlowContext).
export function GatedStoreChat({ vendor }) {
  const { canShowChat } = useFlow();
  if (!canShowChat) return null;
  return <StoreChatWidget vendor={vendor} />;
}
