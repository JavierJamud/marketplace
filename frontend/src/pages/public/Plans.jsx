import { useEffect } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, CreditCard, Percent } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { applySeo } from "../../lib/seo.js";
import { staticSeoFor } from "../../lib/seoRoutes.js";
import { PlansCatalog, EnterpriseCta, usePublicPlans, isBadgeUpgrade } from "../../components/plans/PlansCatalog.jsx";

// Página pública de planes (/planes, enlazada desde el pie). Todo sale de lo que configura el admin en Suscripciones:
// precios, descuentos por meses, lo que incluye cada plan y cuál se destaca. El botón de cada tarjeta lleva la clave del
// plan (?plan=CLAVE): al registrarse, Account.jsx la recuerda y, si el plan se paga con la verificación (con insignia),
// termina en la verificación de ese plan.

// Estado en el que /vendedor/verificacion ya no vende un plan: solo VERIFIED muestra el resumen de la suscripción
// (SubscriptionOverview) sin el selector de pago e ignora ?plan. Una tienda así que elegía otro plan con insignia terminaba
// en una pantalla sin ninguna acción para cambiarlo. Con el cobro fallido, suspendida o con el plan vencido la pantalla sí
// abre el selector (showChooser) y deja pagar un plan con insignia, así que esas tiendas siguen yendo a la verificación.
const VERIFICATION_SETTLED = new Set(["VERIFIED"]);

// Título y descripción propios de /planes. Si seoRoutes.js ya trae la ruta se usa esa, así App.jsx y esta pantalla nunca
// ponen textos distintos.
function plansSeo(siteName) {
  return (
    staticSeoFor("/planes", siteName) ?? {
      title: `Planes y precios para tu tienda | ${siteName}`,
      description: `Compara los planes para vender en ${siteName}: precio por mes en CUP o en USD, descuento al pagar varios meses juntos y lo que incluye cada uno. Sin comisiones por venta.`,
      keywords: ["planes para tiendas", "precios", "vender en Cuba", "tienda en línea Cuba", "abrir una tienda en línea"],
      path: "/planes",
    }
  );
}

export default function Plans() {
  const { user } = useAuth();
  const { siteName, trialPlanName } = usePlatformSettings();
  const { data } = usePublicPlans();
  const isVendor = user?.role === "VENDOR";
  // El personal de una tienda no contrata planes (lo hace el dueño), pero sí ve cuál tiene su tienda: /vendors/me también le
  // responde a él. Antes caía en la rama de visitante y se le invitaba a crear otra tienda.
  const isStaff = user?.role === "VENDOR_STAFF";
  const { data: myVendor } = useQuery({ queryKey: ["my-vendor"], queryFn: async () => (await api.get("/vendors/me")).data.vendor, enabled: isVendor || isStaff });

  // No va con useSeo: el SEO por ruta de App.jsx (useRouteSeo) corre DESPUÉS que el de esta pantalla (los efectos del padre
  // van después que los del hijo) y, mientras /planes no esté en seoRoutes.js, ponía encima el título genérico. Se aplica en
  // la vuelta siguiente para quedar último; cuando la ruta esté en la tabla los dos ponen lo mismo y el orden da igual.
  useEffect(() => {
    const id = setTimeout(() => applySeo(plansSeo(siteName)), 0);
    return () => clearTimeout(id);
  }, [siteName]);

  // Pedir un plan que no se contrata desde el panel. El chat con el equipo solo existe para tiendas verificadas cuyo plan lo
  // incluye (requireApprovedVendor en vendors.controller.js); a las demás, Mensajes les mostraba un candado. Para ellas va el
  // WhatsApp de soporte con el pedido ya escrito, o la página de contacto si el admin no cargó ese número. Todos los enlaces
  // dicen "Pedir este plan": el aria-label nombra el plan para que en la lista de enlaces del lector de pantalla se distingan, y
  // empieza por el texto visible para que quien maneja la página por voz pueda decirlo tal cual (WCAG 2.5.3). El chat todavía
  // no acepta un texto inicial, así que ahí el vendedor escribe él qué plan quiere.
  const requestPlanLink = (plan, supportWhatsapp, className) => {
    const label = `Pedir este plan: ${plan.name}`;
    if (myVendor?.isVerified && myVendor?.planFeatures?.allowAdminChat) {
      return (
        <Link to="/vendedor/mensajes" aria-label={label} className={className}>
          Pedir este plan
        </Link>
      );
    }
    const digits = String(supportWhatsapp ?? "").replace(/\D/g, "");
    if (digits) {
      const store = myVendor?.companyName ? ` ${myVendor.companyName}` : "";
      const text = `Hola, quiero pasar mi tienda${store} al plan ${plan.name} de ${siteName}.`;
      return (
        <a href={`https://wa.me/${digits}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" aria-label={label} className={className}>
          Pedir este plan
        </a>
      );
    }
    return (
      <Link to="/contacto" aria-label={label} className={className}>
        Pedir este plan
      </Link>
    );
  };

  const cta = (plan, { dark, current, supportWhatsapp }) => {
    const base = "flex min-h-12 w-full items-center justify-center rounded-2xl px-4 text-center text-[14px] font-extrabold transition";
    const style = dark ? "bg-secondary-container text-on-secondary-container hover:brightness-95" : "bg-primary text-on-primary hover:bg-primary-container";
    const plain = `${base} border ${dark ? "border-white/30 text-white" : "border-outline-variant text-on-surface-variant"}`;
    if (isStaff) {
      return <span className={plain}>{current ? "Es el plan de tu tienda" : "El plan lo cambia el dueño de la tienda"}</span>;
    }
    if (plan.contactOnly) return <EnterpriseCta plan={plan} supportWhatsapp={supportWhatsapp} dark={dark} />;
    if (isVendor) {
      if (current) return <span className={plain}>Es tu plan actual</span>;
      // La verificación solo cobra planes con insignia: el de inicio no se elige (la tienda vuelve a él sola si deja de
      // pagar o cancela) y a uno gratis o cobrado sin insignia se pasa pidiéndoselo al equipo. Antes todos llevaban a la
      // verificación, que respondía que ese plan no se paga ahí.
      // A una tienda que paga otro plan se le dice cómo volver: al cancelar, al final de lo pagado baja al plan por defecto
      // (downgrade_cancelled). El botón "Cancelar suscripción" de SubscriptionOverview sale con la tienda verificada o con un
      // plan cobrado sin insignia (paysWithoutBadge); fuera de esos casos no hay nada que cancelar y queda "Plan de inicio".
      if (plan.isDefault) {
        const ownPlan = (data?.plans ?? []).find((p) => p.planType === myVendor?.planType);
        const paysWithoutBadge = !!ownPlan && !ownPlan.isFree && !ownPlan.contactOnly && !ownPlan.grantsBadge;
        if (myVendor?.planType && (myVendor.verificationStatus === "VERIFIED" || paysWithoutBadge)) {
          return (
            <Link to="/vendedor/verificacion" className={`${plain} ${dark ? "hover:bg-white/10" : "hover:bg-surface-container"}`}>
              Vuelves a este plan al cancelar tu suscripción
            </Link>
          );
        }
        return <span className={plain}>Plan de inicio</span>;
      }
      // Con la verificación ya resuelta, la pantalla de verificación no cambia de plan: también se pide al equipo.
      if (!isBadgeUpgrade(plan) || VERIFICATION_SETTLED.has(myVendor?.verificationStatus)) {
        return requestPlanLink(plan, supportWhatsapp, `${base} ${style}`);
      }
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
  // El plan de la prueba gratis lo elige el admin (bandera isTrialPlan), no es siempre el mismo. Puede estar oculto en esta
  // lista (solo trae los públicos) y aun así se le ofrece a toda tienda nueva: su nombre sale entonces de /settings. Si no
  // hay plan de prueba, la página no promete prueba.
  const trialName = (data?.plans ?? []).find((p) => p.isTrialPlan)?.name ?? trialPlanName;
  return (
    <div className="container-app py-10 sm:py-14">
      <header className="mx-auto mb-8 max-w-2xl text-center">
        <h1 className="font-display text-[32px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[40px]">Elige el plan para tu tienda</h1>
        <p className="mt-3 text-[15px] leading-[23px] text-on-surface-variant">
          Sin comisiones por venta. Empieza con lo básico y sube de plan cuando tu negocio lo pida.
          {trialDays && trialName ? ` Al registrarte puedes probar ${trialName} ${trialDays} ${trialDays === 1 ? "día" : "días"} gratis.` : ""}
        </p>
      </header>

      <PlansCatalog cta={cta} currentPlanType={isVendor || isStaff ? myVendor?.planType : undefined} />

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
