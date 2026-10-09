import { useSearchParams } from "react-router-dom";
import { Settings, SlidersHorizontal, ShoppingBag, CreditCard, ShieldCheck, Plug } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { Tabs } from "../../components/ui/Tabs.jsx";
import AdminBranding from "./AdminBranding.jsx";
import AdminSecurity from "./AdminSecurity.jsx";
import AdminIntegrations from "./AdminIntegrations.jsx";
import { PlanConfigTab, CupPaymentSettingsCard } from "./AdminSubscriptions.jsx";
import { ListingPolicyCard } from "./AdminOffers.jsx";
import { ReviewPolicyCard } from "./AdminReviews.jsx";
import { ProductImageLinksPanel } from "./AdminLocations.jsx";

// Pedido explícito: una sola sección "Configuración" con TODOS los ajustes del
// panel, en vez de tenerlos repartidos por Marca, Seguridad, Suscripciones,
// Ofertas, Comentarios, Países e Integraciones. "Marca de la plataforma" (en Mi
// perfil) se queda solo con lo que es de la marca: nombre, redes e imágenes del Home.
const TABS = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "catalogo", label: "Tiendas y productos", icon: ShoppingBag },
  { id: "planes", label: "Planes y pagos", icon: CreditCard },
  { id: "seguridad", label: "Seguridad", icon: ShieldCheck },
  { id: "integraciones", label: "Integraciones", icon: Plug },
];

export default function AdminSettings() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const tab = TABS.some((t) => t.id === requested) ? requested : "general";

  return (
    <div>
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Settings} tone="teal" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Configuración</h1>
      </div>
      <p className="mb-5 text-[13.5px] text-outline">Todos los ajustes de la plataforma en un solo lugar.</p>

      <Tabs tabs={TABS} value={tab} onChange={(id) => setParams({ tab: id }, { replace: true })} className="mb-6" />

      {tab === "general" && (
        <div className="max-w-[820px]">
          <AdminBranding mode="general" />
        </div>
      )}
      {tab === "catalogo" && (
        // Bloque 292 (pedido explícito — "estas dos secciones están pegadas, no puede pasar"): las tarjetas
        // de esta pestaña van en una columna con separación fija, todas del mismo ancho.
        <div className="flex max-w-[820px] flex-col gap-5">
          <AdminBranding mode="catalog" />
          <ProductImageLinksPanel />
          <h2 className="mt-3 text-[15px] font-bold text-on-surface">Políticas de venta rápida y comentarios</h2>
          <ListingPolicyCard />
          <ReviewPolicyCard />
        </div>
      )}
      {tab === "planes" && (
        <div className="max-w-[820px]">
          <PlanConfigTab />
          <div className="mt-6">
            <CupPaymentSettingsCard />
          </div>
        </div>
      )}
      {tab === "seguridad" && <AdminSecurity embedded />}
      {tab === "integraciones" && <AdminIntegrations embedded />}
    </div>
  );
}
