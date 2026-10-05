import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { X, Gift, Check, Sparkles } from "lucide-react";
import { api } from "../../lib/api.js";

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
  // Mismo query key que ya comparten PlanComparisonModal.jsx/
  // VendorVerification.jsx — normalmente ya está en caché.
  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  const business = settings?.plans?.find((p) => p.planType === "BUSINESS");

  const accept = useMutation({
    mutationFn: async () => (await api.post("/vendors/me/trial/accept")).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vendor-trial"] }),
  });
  const decline = useMutation({
    mutationFn: async () => (await api.post("/vendors/me/trial/decline")).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vendor-trial"] }),
  });

  const show = !!vendor?.id && !!data?.eligibleForOffer;

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
          onKeyDown={(e) => { if (e.key === "Escape" && !decline.isPending) decline.mutate(); }}
          tabIndex={-1}
        >
          <motion.div
            className="relative w-full max-w-[460px] overflow-hidden rounded-3xl bg-surface-container-lowest shadow-2xl"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            <button
              onClick={() => decline.mutate()}
              disabled={decline.isPending}
              aria-label="Cerrar aviso"
              className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/10 text-on-surface-variant hover:bg-black/20"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="relative h-[130px] overflow-hidden bg-gradient-to-br from-primary to-primary-container">
              <motion.div className="flex h-full items-center justify-center gap-5" variants={container} initial="hidden" animate="show">
                <motion.div variants={decorItem} className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm">
                  <Gift className="h-7 w-7 text-secondary-container" />
                </motion.div>
                <motion.div variants={decorItem} className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary-container shadow-lg">
                  <Sparkles className="h-8 w-8 text-on-secondary-container" />
                </motion.div>
              </motion.div>
            </div>

            <div className="p-6">
              <h2 className="mb-1 font-display text-[20px] font-bold text-on-surface">
                30 días gratis de {business?.displayName ?? "Premium"}
              </h2>
              <p className="mb-4 text-[13px] text-on-surface-variant">
                Prueba todo sin costo durante 30 días. Puedes seguir pagando o volver a Regular cuando quieras, sin compromiso.
              </p>

              {business?.features?.length > 0 && (
                <ul className="mb-5 flex flex-col gap-2">
                  {business.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-[13px] text-on-surface">
                      <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-verified" strokeWidth={2.5} />
                      {feature}
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-col gap-2.5 sm:flex-row">
                <button
                  onClick={() => accept.mutate()}
                  disabled={accept.isPending}
                  className="flex-1 rounded-xl bg-primary px-4 py-3 text-center text-[13.5px] font-bold text-white hover:bg-primary/90 disabled:opacity-60"
                >
                  {accept.isPending ? "Activando..." : "Empezar mi trial gratis"}
                </button>
                <button
                  onClick={() => decline.mutate()}
                  disabled={decline.isPending}
                  className="flex-1 rounded-xl border border-outline-variant px-4 py-3 text-[13.5px] font-semibold text-on-surface hover:bg-surface-variant"
                >
                  Ahora no
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
