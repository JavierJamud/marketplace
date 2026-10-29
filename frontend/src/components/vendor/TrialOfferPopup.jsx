import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { X, Gift, Check, Sparkles, CreditCard, Landmark } from "lucide-react";
import { api } from "../../lib/api.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import toast from "../../lib/toast.jsx";

// Cuántas líneas de "incluye" caben sin empujar los botones fuera de un teléfono bajo; el resto está en /planes.
const MAX_INCLUDES = 6;

// Bloque 235 (pedido explícito — trial gratuito de 30 días del Plan
// Premium, gancho de lanzamiento): mismo molde visual/de animación que
// OffersAnnouncementPopup.jsx (misma librería `motion`, ya instalada — no
// hace falta ninguna dependencia nueva). A diferencia de ese popup (que se
// descarta para siempre vía localStorage), acá el "visto"/"rechazado" vive
// en el backend (Vendor.trialOfferDismissedAt) — "se vuelve a mostrar,
// pero como mucho 1 vez por día", pedido explícito, y tiene que sobrevivir
// entre dispositivos, cosa que localStorage nunca podría.
export function TrialOfferPopup({ vendor }) {
  const queryClient = useQueryClient();
  // Al aceptar, la tienda elige cómo pagará después de la prueba (tarjeta con cobro automático o CUP a mano).
  const [choosingBilling, setChoosingBilling] = useState(false);

  // Bloque 235: staleTime corto a propósito (el default global del
  // proyecto es 5min, ver queryClient.js) — el checklist cambia seguido
  // mientras el vendedor completa su perfil, y aunque las mutaciones
  // relevantes ya invalidan esta key a mano, esto es una red de seguridad
  // para que nunca se quede pegado mostrando un estado viejo por minutos.
  const { data } = useQuery({
    queryKey: ["vendor-trial"],
    queryFn: async () => (await api.get("/vendors/me/trial")).data.trial,
    enabled: !!vendor?.id,
    staleTime: 20_000,
  });
  // Planes de /settings (misma caché que el resto del panel). El plan de la prueba y el de inicio se reconocen por su bandera
  // (isTrialPlan / isDefault), no por la clave: antes se buscaba "BUSINESS" y se escribía "Básico", y si el admin cambiaba el
  // plan de prueba la oferta seguía nombrando y listando el viejo.
  const { plans, trialPlanKey, defaultPlanName, trialDays } = usePlatformSettings();
  const trialPlan = plans.find((p) => p.planType === trialPlanKey) ?? null;
  const backTo = defaultPlanName ? `al plan ${defaultPlanName}` : "a tu plan de inicio";

  // onError: antes un fallo (sin red, la oferta ya no aplicaba) no decía nada y el botón parecía no responder.
  const accept = useMutation({
    mutationFn: async (billing) => (await api.post("/vendors/me/trial/accept", { billing })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vendor-trial"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No pudimos empezar tu prueba. Intenta de nuevo."),
  });
  const decline = useMutation({
    mutationFn: async () => (await api.post("/vendors/me/trial/decline")).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vendor-trial"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No pudimos cerrar el aviso. Intenta de nuevo."),
  });

  // Sin plan de prueba configurado no hay nada que ofrecer (y mientras /settings no responde, se espera).
  const show = !!vendor?.id && !!data?.eligibleForOffer && !!trialPlan;
  const includes = trialPlan?.includes ?? [];
  const daysText = `${trialDays} ${trialDays === 1 ? "día" : "días"}`;

  // La tarjeta dice ser modal (aria-modal), así que al abrirse el foco entra en ella: antes se quedaba detrás, en la página,
  // y con teclado o lector de pantalla no se llegaba al aviso. Escape escucha en document (como ConfirmModal) porque el
  // onKeyDown del fondo solo servía después de tocar dentro.
  const dialogRef = useRef(null);
  useEffect(() => {
    if (show) dialogRef.current?.focus({ preventScroll: true });
  }, [show]);
  const declinePending = decline.isPending;
  const declineMutate = decline.mutate;
  useEffect(() => {
    if (!show) return undefined;
    function onKey(e) {
      if (e.key === "Escape" && !declinePending) declineMutate();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [show, declinePending, declineMutate]);

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
  };
  const decorItem = {
    hidden: { opacity: 0, scale: 0.4, y: 10 },
    show: { opacity: 1, scale: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 14 } },
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => { if (e.target === e.currentTarget && !decline.isPending) decline.mutate(); }}
        >
          {/* La tarjeta no pasa del 90% del alto y solo su cuerpo se desplaza: a 390x667 los botones quedaban fuera de la
              pantalla. La X va fuera de la zona que se desplaza para que siempre se pueda cerrar. */}
          <motion.div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="trial-offer-title"
            className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-[460px] flex-col overflow-hidden rounded-3xl bg-surface-container-lowest shadow-2xl outline-none"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            <button
              onClick={() => decline.mutate()}
              disabled={decline.isPending}
              aria-label="Cerrar aviso"
              className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/10 text-on-surface-variant hover:bg-black/20"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="relative h-[96px] flex-shrink-0 overflow-hidden bg-gradient-to-br from-primary to-primary-container sm:h-[130px]">
              <motion.div className="flex h-full items-center justify-center gap-5" variants={container} initial="hidden" animate="show">
                <motion.div variants={decorItem} className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm">
                  <Gift className="h-7 w-7 text-secondary-container" />
                </motion.div>
                <motion.div variants={decorItem} className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary-container shadow-lg">
                  <Sparkles className="h-8 w-8 text-on-secondary-container" />
                </motion.div>
              </motion.div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
              <h2 id="trial-offer-title" className="mb-1 font-display text-[20px] font-bold text-on-surface">
                {daysText} gratis del plan {trialPlan?.displayName}
              </h2>
              <p className="mb-4 text-[13px] text-on-surface-variant">
                Prueba todo sin costo durante {daysText}. Puedes seguir pagando o volver {backTo} cuando quieras, sin compromiso.
              </p>

              {/* `includes` ya trae las funciones del catálogo y las personalizadas que el admin encendió en el plan. Se
                  muestran las primeras y el resto queda en /planes: con todas, la lista empujaba los botones fuera. */}
              {includes.length > 0 && (
                <div className="mb-5">
                  <ul className="flex flex-col gap-2">
                    {includes.slice(0, MAX_INCLUDES).map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-[13px] text-on-surface">
                        <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-verified" strokeWidth={2.5} />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  {includes.length > MAX_INCLUDES && (
                    <Link to="/planes" className="mt-1 inline-flex min-h-11 items-center text-[13px] font-semibold text-primary underline-offset-2 hover:underline">
                      Ver todo lo que incluye ({includes.length - MAX_INCLUDES} más)
                    </Link>
                  )}
                </div>
              )}

              {choosingBilling ? (
                <div className="flex flex-col gap-2.5">
                  <p className="text-[13px] font-bold text-on-surface">¿Cómo pagarás cuando termine la prueba?</p>
                  <button
                    type="button"
                    onClick={() => accept.mutate("CARD")}
                    disabled={accept.isPending}
                    className="flex min-h-11 items-start gap-3 rounded-xl border border-outline-variant p-3.5 text-left hover:border-tertiary-accent disabled:opacity-60"
                  >
                    <CreditCard className="mt-0.5 h-5 w-5 flex-shrink-0 text-tertiary-accent" aria-hidden="true" />
                    <span>
                      <span className="block text-[13.5px] font-bold text-on-surface">Con tarjeta</span>
                      <span className="block text-[12px] text-on-surface-variant">Registras tu tarjeta al final de los pasos. Hoy no se cobra nada; al terminar los {daysText} se cobra el primer mes solo. Puedes cancelar antes.</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => accept.mutate("CUP")}
                    disabled={accept.isPending}
                    className="flex min-h-11 items-start gap-3 rounded-xl border border-outline-variant p-3.5 text-left hover:border-tertiary-accent disabled:opacity-60"
                  >
                    <Landmark className="mt-0.5 h-5 w-5 flex-shrink-0 text-tertiary-accent" aria-hidden="true" />
                    <span>
                      <span className="block text-[13.5px] font-bold text-on-surface">En CUP</span>
                      <span className="block text-[12px] text-on-surface-variant">Sin tarjeta. Cuando termine la prueba pagas por transferencia; si no, vuelves {backTo}.</span>
                    </span>
                  </button>
                </div>
              ) : null}
            </div>

            {/* Pie fijo, fuera de la zona que se desliza: con letra grande en el teléfono o muchas funciones en el plan, los
                botones quedaban abajo, fuera de la pantalla, y no se podía aceptar ni rechazar (visto en un Galaxy M14). */}
            <div className="flex-shrink-0 border-t border-surface-container-high bg-surface-container-lowest px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {choosingBilling ? (
                <button type="button" onClick={() => setChoosingBilling(false)} className="min-h-11 w-full rounded-xl border border-outline-variant px-4 text-[13.5px] font-semibold text-on-surface hover:bg-surface-variant">
                  Volver
                </button>
              ) : (
              <div className="flex flex-col gap-2.5 sm:flex-row">
                <button
                  onClick={() => setChoosingBilling(true)}
                  disabled={accept.isPending}
                  className="min-h-11 flex-1 rounded-xl bg-primary px-4 py-3 text-center text-[13.5px] font-bold text-white hover:bg-primary/90 disabled:opacity-60"
                >
                  Empezar mi prueba gratis
                </button>
                <button
                  onClick={() => decline.mutate()}
                  disabled={decline.isPending}
                  className="min-h-11 flex-1 rounded-xl border border-outline-variant px-4 py-3 text-[13.5px] font-semibold text-on-surface hover:bg-surface-variant"
                >
                  Ahora no
                </button>
              </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
