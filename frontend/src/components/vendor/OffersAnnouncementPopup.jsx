import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { X, Tag, Percent, Sparkles } from "lucide-react";
import { api } from "../../lib/api.js";

function seenKey(vendorId) {
  return `zeudin_offers_announcement_seen_${vendorId}`;
}

// Bloque 50: solo a vendedores VERIFICADOS (no tiene sentido anunciarles la
// función a quienes ni siquiera pueden usarla todavía), una única vez por
// tienda (localStorage, no sessionStorage — a diferencia de
// AnnouncementPopup.jsx, acá se pidió explícito que NO vuelva a aparecer al
// re-entrar). Cualquier forma de cerrarlo (X, click afuera, Esc, o el CTA
// primario) marca el flag — el pedido original consideraba un checkbox "no
// mostrar de nuevo" aparte, pero el propio bloque recomienda que cerrar ya
// cuente como visto, así que un checkbox separado terminaría siendo
// puramente decorativo; se resuelve con un botón secundario en su lugar.
export function OffersAnnouncementPopup({ vendor }) {
  const [dismissed, setDismissed] = useState(() => !!vendor?.id && localStorage.getItem(seenKey(vendor.id)) === "1");
  // Bloque 51: cooldown/duración ahora los configura el admin (AdminOffers.jsx)
  // en vez de ser fijos — este texto ya no puede hardcodear "30 días"/"cada
  // semana". Mismo query key que VendorOffers.jsx/VendorVerification.jsx,
  // así que normalmente ya está en caché cuando este popup se muestra.
  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  const cooldownDays = settings?.offerCooldownDays ?? 7;
  const durationDays = settings?.offerDefaultDurationDays ?? 30;

  function dismiss() {
    if (vendor?.id) localStorage.setItem(seenKey(vendor.id), "1");
    setDismissed(true);
  }

  const show = vendor?.isVerified && !dismissed;

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
          onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
          onKeyDown={(e) => { if (e.key === "Escape") dismiss(); }}
          tabIndex={-1}
        >
          <motion.div
            className="relative w-full max-w-[440px] overflow-hidden rounded-3xl bg-surface-container-lowest shadow-2xl"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            <button
              onClick={dismiss}
              aria-label="Cerrar aviso"
              className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/10 text-on-surface-variant hover:bg-black/20"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="relative h-[130px] overflow-hidden bg-gradient-to-br from-primary to-primary-container">
              <motion.div className="flex h-full items-center justify-center gap-5" variants={container} initial="hidden" animate="show">
                <motion.div variants={decorItem} className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm">
                  <Tag className="h-7 w-7 text-secondary-container" />
                </motion.div>
                <motion.div variants={decorItem} className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary-container shadow-lg">
                  <Percent className="h-8 w-8 text-on-secondary-container" />
                </motion.div>
                <motion.div variants={decorItem} className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm">
                  <Sparkles className="h-5 w-5 text-secondary-container" />
                </motion.div>
              </motion.div>
            </div>

            <div className="p-6">
              <h2 className="mb-2 font-display text-[20px] font-bold text-on-surface">¡Ya puedes crear ofertas!</h2>
              <p className="mb-5 text-[13.5px] leading-relaxed text-on-surface-variant">
                Destaca uno de tus productos en la sección "Ofertas" del Home, visible para todo el público. Cada oferta
                dura hasta {durationDays} días y puedes publicar una nueva cada {cooldownDays} días.
              </p>
              <div className="flex flex-col gap-2.5 sm:flex-row">
                <Link
                  to="/vendedor/ofertas"
                  onClick={dismiss}
                  className="flex-1 rounded-xl bg-primary px-4 py-3 text-center text-[13.5px] font-bold text-white hover:bg-primary/90"
                >
                  Crear mi primera oferta
                </Link>
                <button
                  onClick={dismiss}
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
