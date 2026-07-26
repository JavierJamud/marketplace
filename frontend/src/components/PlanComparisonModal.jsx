import { Link } from "react-router-dom";
import { Check, X } from "lucide-react";

const ROWS = [
  { label: "Productos publicados", regular: "Hasta 20", business: "Ilimitados" },
  { label: "Emails manuales a clientes", regular: "10 por mes", business: "Ilimitados" },
  { label: "Pedidos por WhatsApp o panel", regular: true, business: true },
  { label: "Badge de tienda verificada", regular: false, business: true },
  { label: "Destacada en la home", regular: false, business: true },
  { label: "Recomendaciones con IA", regular: false, business: true },
  { label: "Horarios de atención", regular: false, business: true },
];

function Cell({ value }) {
  if (value === true) return <Check className="mx-auto h-4 w-4 text-verified" strokeWidth={2.5} />;
  if (value === false) return <X className="mx-auto h-4 w-4 text-outline/50" strokeWidth={2.5} />;
  return <span className="text-[12.5px] font-semibold text-on-surface">{value}</span>;
}

// Se muestra una sola vez, justo después de crear una tienda (Account.jsx
// stepper y VendorOnboarding.jsx) — nunca en el login, así que no hace falta
// persistir un flag de "ya lo vio": está atado al onSuccess del create.
export function PlanComparisonModal({ onContinueRegular, businessHref = "/vendedor/configuracion" }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-surface-container-lowest p-6 sm:p-8">
        <div className="mb-1 text-center font-display text-[13px] font-bold uppercase tracking-wide text-secondary">
          ¡Tu tienda ya existe!
        </div>
        <h2 className="mb-2 text-center font-display text-headline-md text-on-surface">Elige cómo empezar</h2>
        <p className="mb-6 text-center text-[13px] text-outline">
          Arrancas en el Plan Regular, gratis. Puedes pasar a Business cuando quieras desde tu panel.
        </p>

        <div className="mb-6 overflow-hidden rounded-lg border border-surface-container-high">
          <div className="grid grid-cols-[1.4fr_1fr_1fr] bg-surface-container text-center text-[11.5px] font-bold text-on-surface-variant">
            <div className="px-3 py-2.5 text-left">Incluye</div>
            <div className="px-3 py-2.5">Regular</div>
            <div className="px-3 py-2.5 text-secondary">Business</div>
          </div>
          {ROWS.map((row) => (
            <div key={row.label} className="grid grid-cols-[1.4fr_1fr_1fr] items-center border-t border-surface-container-high text-center">
              <div className="px-3 py-2.5 text-left text-[12px] text-on-surface-variant">{row.label}</div>
              <div className="px-3 py-2.5">
                <Cell value={row.regular} />
              </div>
              <div className="px-3 py-2.5">
                <Cell value={row.business} />
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row">
          <button
            onClick={onContinueRegular}
            className="flex-1 rounded bg-primary-container py-3 text-label-md font-bold text-white hover:bg-primary"
          >
            Continuar con Regular
          </button>
          <Link
            to={businessHref}
            className="flex-1 rounded bg-secondary-container py-3 text-center text-label-md font-bold text-on-secondary-container hover:brightness-95"
          >
            Conocer Business
          </Link>
        </div>
      </div>
    </div>
  );
}
