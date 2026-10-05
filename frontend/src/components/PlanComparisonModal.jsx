import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { api } from "../lib/api.js";

// Bloque 52 (pedido explícito — "debe haber una concordancia con todo"):
// antes esta tabla era un array ROWS 100% hardcodeado, sin ninguna relación
// con lo que el backend realmente aplicaba (podía decir "Business: IA,
// destacado, horarios" aunque el admin hubiera apagado esas funciones para
// ese plan). Ahora se arma en vivo a partir de settings.plans (PlanConfig
// del backend, GET /settings) — la MISMA fuente que usa el admin
// (AdminSubscriptions.jsx → "Configuración de planes") y el propio panel de
// vendedor (VendorVerification.jsx), así las 3 pantallas nunca pueden
// mostrar algo distinto entre sí.
function buildRows(regular, business) {
  if (!regular || !business) return [];
  const limitLabel = (n) => (n === null ? "Ilimitados" : `Hasta ${n}`);
  return [
    { label: "Productos publicados", regular: limitLabel(regular.maxProducts), business: limitLabel(business.maxProducts) },
    {
      label: "Emails manuales a clientes",
      regular: regular.maxMonthlyOrderEmails === null ? "Ilimitados" : `${regular.maxMonthlyOrderEmails} por mes`,
      business: business.maxMonthlyOrderEmails === null ? "Ilimitados" : `${business.maxMonthlyOrderEmails} por mes`,
    },
    { label: "Pedidos por WhatsApp", regular: regular.allowWhatsappOrders, business: business.allowWhatsappOrders },
    { label: "Pedidos por el panel", regular: regular.allowPanelOrders, business: business.allowPanelOrders },
    { label: "Badge de tienda verificada", regular: false, business: true },
    { label: "Destacada en la home", regular: regular.featuredInHome, business: business.featuredInHome },
    { label: "Chatbot con IA", regular: regular.allowAiChatbot, business: business.allowAiChatbot },
    { label: "Asistente de negocio con IA", regular: regular.allowAiAssistant, business: business.allowAiAssistant },
    { label: "Horarios de atención", regular: regular.allowSchedules, business: business.allowSchedules },
    { label: "Ofertas de tienda", regular: regular.allowStoreOffers, business: business.allowStoreOffers },
  ];
}

function Cell({ value }) {
  if (value === true) return <Check className="mx-auto h-4 w-4 text-verified" strokeWidth={2.5} />;
  if (value === false) return <X className="mx-auto h-4 w-4 text-outline/50" strokeWidth={2.5} />;
  return <span className="text-[12.5px] font-semibold text-on-surface">{value}</span>;
}

// Se muestra una sola vez, justo después de crear una tienda (Account.jsx
// stepper) — nunca en el login, así que no hace falta persistir un flag de
// "ya lo vio": está atado al onSuccess del create.
export function PlanComparisonModal({ onContinueRegular, businessHref = "/vendedor/configuracion" }) {
  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  const regular = settings?.plans?.find((p) => p.planType === "REGULAR");
  const business = settings?.plans?.find((p) => p.planType === "BUSINESS");
  const rows = buildRows(regular, business);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-surface-container-lowest p-6 sm:p-8">
        <div className="mb-1 text-center font-display text-[13px] font-bold uppercase tracking-wide text-secondary">
          ¡Tu tienda ya existe!
        </div>
        <h2 className="mb-2 text-center font-display text-headline-md text-on-surface">Elige cómo empezar</h2>
        <p className="mb-6 text-center text-[13px] text-outline">
          Arrancas en el Plan {regular?.displayName ?? "Regular"}, gratis. Puedes pasar a {business?.displayName ?? "Premium"} cuando
          quieras desde tu panel.
        </p>

        <div className="mb-6 overflow-hidden rounded-lg border border-surface-container-high">
          <div className="grid grid-cols-[1.4fr_1fr_1fr] bg-surface-container text-center text-[11.5px] font-bold text-on-surface-variant">
            <div className="px-3 py-2.5 text-left">Incluye</div>
            <div className="px-3 py-2.5">{regular?.displayName ?? "Regular"}</div>
            <div className="px-3 py-2.5 text-secondary">{business?.displayName ?? "Premium"}</div>
          </div>
          {rows.length ? (
            rows.map((row) => (
              <div key={row.label} className="grid grid-cols-[1.4fr_1fr_1fr] items-center border-t border-surface-container-high text-center">
                <div className="px-3 py-2.5 text-left text-[12px] text-on-surface-variant">{row.label}</div>
                <div className="px-3 py-2.5">
                  <Cell value={row.regular} />
                </div>
                <div className="px-3 py-2.5">
                  <Cell value={row.business} />
                </div>
              </div>
            ))
          ) : (
            <div className="px-3 py-4 text-center text-[12px] text-outline">Cargando planes...</div>
          )}
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row">
          <button
            onClick={onContinueRegular}
            className="flex-1 rounded bg-primary-container py-3 text-label-md font-bold text-white hover:bg-primary"
          >
            Continuar con {regular?.displayName ?? "Regular"}
          </button>
          <Link
            to={businessHref}
            className="flex-1 rounded bg-secondary-container py-3 text-center text-label-md font-bold text-on-secondary-container hover:brightness-95"
          >
            Conocer {business?.displayName ?? "Premium"}
          </Link>
        </div>
      </div>
    </div>
  );
}
