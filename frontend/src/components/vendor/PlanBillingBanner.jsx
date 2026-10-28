import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, CalendarClock } from "lucide-react";

// Cobro de un plan sin insignia (el Básico cuando deja de ser gratis, ver planBilling.service.js del backend). Le dice al
// dueño en qué punto está: fecha de cobro cerca, pedidos en pausa por no pagar o tienda suspendida. Sin cobro en curso
// (billingNoticeStage vacío) no muestra nada.
const DAY_MS = 24 * 60 * 60 * 1000;
const fmtDate = (d) => new Date(d).toLocaleDateString("es-CU", { day: "numeric", month: "long" });

export function PlanBillingBanner({ vendor }) {
  const { pathname } = useLocation();
  if (!vendor?.billingNoticeStage || !vendor.nextPaymentDueDate) return null;
  const due = new Date(vendor.nextPaymentDueDate);
  const msLeft = due.getTime() - Date.now();
  const suspended = !!vendor.billingSuspendedAt;
  const overdue = msLeft <= 0;
  if (!suspended && !overdue && msLeft > 7 * DAY_MS) return null;

  const tone = suspended || overdue ? "border-error/30 bg-error/[0.06]" : "border-tertiary-accent/30 bg-tertiary-accent/[0.06]";
  const Icon = suspended || overdue ? AlertTriangle : CalendarClock;
  const title = suspended ? "Tu tienda está suspendida por falta de pago" : overdue ? "Tu tienda no está recibiendo pedidos" : `Tu plan se cobra el ${fmtDate(due)}`;
  const text = suspended
    ? "Los clientes no la ven y su enlace está cerrado. Paga tu plan y vuelve a estar en línea al momento."
    : overdue
      ? `El pago de tu plan venció el ${fmtDate(due)}. Tu tienda se ve, pero no recibe pedidos nuevos hasta que pagues.`
      : "Paga antes de esa fecha para seguir recibiendo pedidos sin pausa.";

  return (
    <div role={suspended || overdue ? "alert" : "status"} className={`mb-4 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center ${tone}`}>
      <Icon className={`h-5 w-5 flex-shrink-0 ${suspended || overdue ? "text-error" : "text-tertiary-accent"}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-bold text-on-surface">{title}</p>
        <p className="text-[12.5px] text-on-surface-variant">{text}</p>
      </div>
      {!["/vendedor/verificacion", "/vendedor/pago-manual"].includes(pathname) && (
        <Link to="/vendedor/verificacion" className="flex min-h-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary px-4 text-[13px] font-bold text-white hover:bg-primary/90">
          Pagar mi plan
        </Link>
      )}
    </div>
  );
}
