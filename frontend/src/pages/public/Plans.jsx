import { useEffect } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, CreditCard, Percent } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { PlansCatalog, EnterpriseCta, usePublicPlans } from "../../components/plans/PlansCatalog.jsx";

// Página pública de planes (/planes, enlazada desde el pie). Todo sale de lo que configura el admin en Suscripciones:
// precios, descuentos por meses, lo que incluye cada plan y cuál se destaca.
export default function Plans() {
  const { user } = useAuth();
  const { data } = usePublicPlans();
  const isVendor = user?.role === "VENDOR";
  const { data: myVendor } = useQuery({ queryKey: ["my-vendor"], queryFn: async () => (await api.get("/vendors/me")).data.vendor, enabled: isVendor });

  useEffect(() => {
    document.title = "Planes para tu tienda | Baznova";
  }, []);

  const cta = (plan, { dark, current, supportWhatsapp }) => {
    if (plan.contactOnly) return <EnterpriseCta plan={plan} supportWhatsapp={supportWhatsapp} dark={dark} />;
    const base = "flex min-h-12 w-full items-center justify-center rounded-2xl px-4 text-[14px] font-extrabold transition";
    const style = dark ? "bg-secondary-container text-on-secondary-container hover:brightness-95" : "bg-primary text-on-primary hover:bg-primary-container";
    if (isVendor) {
      if (current) return <span className={`${base} border ${dark ? "border-white/30 text-white" : "border-outline-variant text-on-surface-variant"}`}>Es tu plan actual</span>;
      return (
        <Link to={`/vendedor/verificacion?plan=${plan.planType}`} className={`${base} ${style}`}>
          Elegir {plan.name}
        </Link>
      );
    }
    return (
      <Link to={`/vendedor/ingresar?tab=registro&plan=${plan.planType}`} className={`${base} ${style}`}>
        {plan.isFree ? "Crear mi tienda gratis" : `Empezar con ${plan.name}`}
      </Link>
    );
  };

  const trialDays = data?.trialDays;
  return (
    <div className="container-app py-10 sm:py-14">
      <header className="mx-auto mb-8 max-w-2xl text-center">
        <h1 className="font-display text-[32px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[40px]">Elige el plan para tu tienda</h1>
        <p className="mt-3 text-[15px] leading-[23px] text-on-surface-variant">
          Sin comisiones por venta. Empieza con lo básico y sube de plan cuando tu negocio lo pida.
          {trialDays ? ` Al registrarte puedes probar Premium ${trialDays} días gratis.` : ""}
        </p>
      </header>

      <PlansCatalog cta={cta} currentPlanType={isVendor ? myVendor?.planType : undefined} />

      <section className="mx-auto mt-12 grid max-w-4xl gap-3 sm:grid-cols-3">
        {[
          [CreditCard, "Paga como te quede mejor", "Con tarjeta en USD o por transferencia en CUP."],
          [Percent, "Ahorra pagando por adelantado", "Al pagar varios meses juntos se aplica el descuento de cada plan."],
          [CalendarClock, "Te avisamos antes de cobrar", "Recibes un aviso días antes de tu fecha de pago."],
        ].map(([Icon, title, text]) => (
          <div key={title} className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4">
            <Icon className="h-5 w-5 text-tertiary-accent" aria-hidden="true" />
            <p className="mt-2 text-[14px] font-bold text-on-surface">{title}</p>
            <p className="mt-0.5 text-[13px] leading-[19px] text-on-surface-variant">{text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
