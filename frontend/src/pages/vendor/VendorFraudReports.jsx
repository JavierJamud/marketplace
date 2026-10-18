import { ShieldAlert } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { ReportsCenter } from "../../components/reports/ReportsCenter.jsx";

// Reportes de la tienda: los que recibió (de clientes, otras tiendas o el equipo) y los que hizo ella, cada uno con su estado.
// La lista y las respuestas viven en ReportsCenter.jsx, compartido con el panel del cliente.
export default function VendorFraudReports() {
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <IconCircle icon={ShieldAlert} tone="orange" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Reportes</h1>
      </div>
      <ReportsCenter audience="vendor" />
    </div>
  );
}
