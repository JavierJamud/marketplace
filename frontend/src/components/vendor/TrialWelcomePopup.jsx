import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ShieldCheck, PartyPopper } from "lucide-react";
import { api } from "../../lib/api.js";

// Bloque 235 (pedido explícito — "se le da una bienvenida al panel de
// vendedor de tienda verificada con un popup de bienvenida para el
// vendedor. Animado"): sin librerías nuevas (ni Remotion — eso renderiza
// VIDEO, no sirve para un popup en vivo dentro de la app — ni confetti) a
// propósito, mismo criterio que el resto del proyecto de evitar
// dependencias de terceros en tiempo de ejecución — `motion` (Framer
// Motion) ya está instalada y ya la usa OffersAnnouncementPopup.jsx. El
// "festejo" sale de 2 íconos con resorte (spring) entrando escalonados,
// no de una librería de confetti aparte.
export function TrialWelcomePopup({ vendor }) {
  const queryClient = useQueryClient();
  // Bloque 235: mismo staleTime corto que TrialOfferPopup.jsx — ver el
  // comentario ahí.
  const { data } = useQuery({
    queryKey: ["vendor-trial"],
    queryFn: async () => (await api.get("/vendors/me/trial")).data.trial,
    enabled: !!vendor?.id,
    staleTime: 20_000,
  });
  const markSeen = useMutation({
    mutationFn: async () => (await api.post("/vendors/me/trial/welcome-seen")).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vendor-trial"] }),
  });

  const show = !!vendor?.id && !!data?.trialEndsAt && !data?.trialWelcomeSeenAt;
  const trialEndsLabel = data?.trialEndsAt
    ? new Date(data.trialEndsAt).toLocaleDateString("es-CU", { day: "2-digit", month: "long" })
    : null;

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: 0.1, delayChildren: 0.2 } },
  };
  const decorItem = {
    hidden: { opacity: 0, scale: 0.3, y: 14 },
    show: { opacity: 1, scale: 1, y: 0, transition: { type: "spring", stiffness: 220, damping: 13 } },
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          // Bloque 235 (bug real encontrado probando en vivo): la primera
          // vez que el trial se activa, `vendor.isVerified` pasa a true en
          // el MISMO instante — OffersAnnouncementPopup (z-[80], "ya podés
          // crear ofertas") se vuelve elegible exactamente a la vez que
          // este popup, y sin una prioridad explícita terminaba tapando el
          // momento de bienvenida. z-[85] garantiza que la bienvenida
          // siempre gane cuando coinciden — Offers igual se termina
          // mostrando solo, apenas el vendedor cierra este.
          className="fixed inset-0 z-[85] flex items-center justify-center bg-black/55 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="relative w-full max-w-[440px] overflow-hidden rounded-3xl bg-surface-container-lowest text-center shadow-2xl"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ type: "spring", stiffness: 240, damping: 20 }}
          >
            <div className="relative h-[150px] overflow-hidden bg-gradient-to-br from-verified to-primary">
              <motion.div className="flex h-full items-center justify-center gap-6" variants={container} initial="hidden" animate="show">
                <motion.div variants={decorItem} className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm">
                  <PartyPopper className="h-8 w-8 text-white" />
                </motion.div>
                <motion.div variants={decorItem} className="flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-lg">
                  <ShieldCheck className="h-10 w-10 text-verified" />
                </motion.div>
              </motion.div>
            </div>

            <div className="p-6">
              <h2 className="mb-2 font-display text-[21px] font-bold text-on-surface">¡Tu tienda ya está verificada!</h2>
              <p className="mb-5 text-[13.5px] leading-relaxed text-on-surface-variant">
                Activaste tu trial gratuito de 30 días del Plan Premium — ya tenés el badge de verificación y todas las
                funciones Premium activas, sin costo.
                {trialEndsLabel && <> Vence el <strong>{trialEndsLabel}</strong>, te avisamos antes de que termine.</>}
              </p>
              <button
                onClick={() => markSeen.mutate()}
                disabled={markSeen.isPending}
                className="w-full rounded-xl bg-primary px-4 py-3 text-[13.5px] font-bold text-white hover:bg-primary/90 disabled:opacity-60"
              >
                ¡Vamos!
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
