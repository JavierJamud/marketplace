import { MessageSquareText } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import BusinessAssistantPanel from "../../components/assistant/BusinessAssistantPanel.jsx";

// Bloque 246: asistente de negocio del admin. Distinto de "Asistente del
// marketplace" (AdminAssistant.jsx), que sirve para ENTRENAR al bot público:
// este es una herramienta de trabajo para el admin, con lectura de toda la
// plataforma. Solo lee y recomienda; no cambia nada por su cuenta.
const QUICK_PROMPTS = [
  "Dame un resumen del día de la plataforma",
  "¿Qué debo atender primero hoy?",
  "¿Qué tiendas venden más este mes?",
  "¿Cómo va el embudo de verificación?",
  "¿Están funcionando bien las integraciones de IA?",
];

export default function AdminBusinessAssistant() {
  return (
    <div>
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={MessageSquareText} tone="teal" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Asistente de negocio</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">Pregunta por las ventas, tiendas, clientes y pendientes de la plataforma. Lee los datos reales y te dice a qué pantalla ir.</p>
      <BusinessAssistantPanel
        endpoint="/admin/business-assistant"
        quickPrompts={QUICK_PROMPTS}
        intro="Solo lectura: no cambia nada por su cuenta."
      />
    </div>
  );
}
