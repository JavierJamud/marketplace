import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { BadgeCheck, CreditCard, PartyPopper } from "lucide-react";
import { api } from "../../lib/api.js";
import { exactDateTime } from "../../lib/relativeTime.js";

// Felicitación cuando el equipo aprueba los documentos de la tienda (pasa a "Pago pendiente"). Aparece al entrar al panel,
// una vez por sesión, mientras la tienda todavía no eligió cómo pagar: así no se le pasa que solo le falta el paso 3 (el
// pago) para tener el plan Premium. "Elegir forma de pago" la lleva a Suscripción. En esa misma página no aparece.
// Mismo estilo y animación que la bienvenida de la prueba gratis (TrialWelcomePopup).
const seenKey = (vendorId) => `docs-approved-welcome-${vendorId}`;

function seenThisSession(vendorId) {
  try {
    return sessionStorage.getItem(seenKey(vendorId)) === "1";
  } catch {
    return false;
  }
}

export function DocsApprovedPopup({ vendor }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(() => seenThisSession(vendor?.id));
  const { data } = useQuery({
    queryKey: ["my-verification"],
    queryFn: async () => (await api.get("/verification/me")).data.verification,
    enabled: !!vendor?.id,
    staleTime: 30_000,
  });

  const show = !!vendor?.id && !dismissed && data?.verificationStatus === "PENDING_PAYMENT" && !data?.paymentMethod && pathname !== "/vendedor/verificacion";
  const deadline = data?.paymentDeadlineAt ? new Date(data.paymentDeadlineAt) : null;

  function close(goToPayment) {
    try {
      sessionStorage.setItem(seenKey(vendor.id), "1");
    } catch {
      /* sin almacenamiento: se vuelve a mostrar al recargar */
    }
    setDismissed(true);
    if (goToPayment) navigate("/vendedor/verificacion");
  }

  const container = { hidden: {}, show: { transition: { staggerChildren: 0.1, delayChildren: 0.2 } } };
  const decorItem = {
    hidden: { opacity: 0, scale: 0.3, y: 14 },
    show: { opacity: 1, scale: 1, y: 0, transition: { type: "spring", stiffness: 220, damping: 13 } },
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/55 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="docs-approved-title"
            className="relative max-h-[92dvh] w-full max-w-[440px] overflow-y-auto rounded-3xl bg-surface-container-lowest text-center shadow-2xl"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ type: "spring", stiffness: 240, damping: 20 }}
          >
            <div className="relative h-[140px] overflow-hidden bg-gradient-to-br from-verified to-primary">
              <motion.div className="flex h-full items-center justify-center gap-6" variants={container} initial="hidden" animate="show">
                <motion.div variants={decorItem} className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15">
                  <PartyPopper className="h-8 w-8 text-white" aria-hidden="true" />
                </motion.div>
                <motion.div variants={decorItem} className="flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-lg">
                  <BadgeCheck className="h-10 w-10 text-verified" aria-hidden="true" />
                </motion.div>
              </motion.div>
            </div>

            <div className="p-6">
              <h2 id="docs-approved-title" className="mb-2 font-display text-[21px] font-bold text-on-surface">
                ¡Felicidades, aprobamos tu cuenta!
              </h2>
              <p className="mb-4 text-[13.5px] leading-relaxed text-on-surface-variant">
                El equipo de revisión ya aprobó los documentos de <strong className="text-on-surface">{vendor.companyName}</strong>. Solo te falta terminar de configurarla para tener todos los beneficios del plan Premium.
              </p>
              <ol className="mb-5 space-y-1.5 text-left text-[13px]">
                <li className="flex items-center gap-2 text-on-surface-variant">
                  <BadgeCheck className="h-4 w-4 flex-shrink-0 text-verified-dark" aria-hidden="true" /> Paso 1: datos de tu tienda
                </li>
                <li className="flex items-center gap-2 text-on-surface-variant">
                  <BadgeCheck className="h-4 w-4 flex-shrink-0 text-verified-dark" aria-hidden="true" /> Paso 2: documentos aprobados
                </li>
                <li className="flex items-center gap-2 font-bold text-on-surface">
                  <CreditCard className="h-4 w-4 flex-shrink-0 text-tertiary-accent" aria-hidden="true" /> Paso 3: elige cómo pagar tu plan
                </li>
              </ol>
              {deadline && (
                <p className="mb-4 rounded-xl bg-secondary-container/20 px-3 py-2 text-[12.5px] text-on-surface">
                  Elige la forma de pago antes del{" "}
                  <strong>{exactDateTime(deadline)}</strong>. Después la aprobación vence y hay que volver a pedirla.
                </p>
              )}
              <button type="button" onClick={() => close(true)} className="mb-2 w-full min-h-12 rounded-xl bg-primary px-4 text-[14px] font-bold text-white hover:bg-primary/90">
                Elegir forma de pago
              </button>
              <button type="button" onClick={() => close(false)} className="w-full min-h-11 rounded-xl text-[13px] font-semibold text-on-surface-variant hover:bg-surface-container">
                Más tarde
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
