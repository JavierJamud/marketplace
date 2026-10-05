import { MessageSquareText } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import BusinessAssistantPanel from "../../components/assistant/BusinessAssistantPanel.jsx";

// Bloque 246: asistente de negocio del vendedor (solo el dueño, solo tiendas
// verificadas con plan de pago). Ve únicamente los datos de SU tienda: el
// servidor fija la tienda desde la sesión, el chat nunca la elige.
const QUICK_PROMPTS = [
  "Resumen de mis ventas de hoy",
  "¿Qué productos se están agotando?",
  "¿Cuáles son mis productos más vendidos este mes?",
  "Dame consejos para esta semana",
  "¿Qué productos no se venden y qué hago con ellos?",
];

export default function VendorAssistant() {
  return (
    <div>
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={MessageSquareText} tone="teal" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Asistente de negocio</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">Pregúntale a tu negocio en lenguaje normal. Responde con tus datos reales y te dice dónde hacer cada cambio.</p>
      <BusinessAssistantPanel
        endpoint="/vendors/me/assistant"
        quickPrompts={QUICK_PROMPTS}
        intro="Solo lectura: no cambia nada por su cuenta."
        lockedAction={{ to: "/vendedor/verificacion", label: "Ver verificación y plan" }}
      />
    </div>
  );
}
