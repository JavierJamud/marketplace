import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../lib/api.js";
import { useZone } from "../context/LocationContext.jsx";
import { usePrefersReducedMotion } from "../lib/useMediaQuery.js";
import { StarRating } from "./ui/StarRating.jsx";
import { Lightbox } from "./ui/Lightbox.jsx";
import { ReviewCard } from "./ReviewsList.jsx";

// Portada: "Lo que opinan nuestros clientes". Muestra, de una en una, las reseñas más recientes de todas las tiendas (de la zona
// elegida) con la misma tarjeta que usan las páginas de producto y de tienda. Todo sale de reseñas reales: el promedio y el total
// son los de esas mismas reseñas. Sin reseñas no se muestra nada.
const MIN_SLIDES = 8; // el carrusel sin fin necesita varias tarjetas para llenar el ancho; con pocas se repiten (las copias no se leen ni se tabulan)

export function ReviewsShowcase() {
  const { zoneParams, zoneKey, waiting } = useZone();
  const reducedMotion = usePrefersReducedMotion();
  const [lightboxSrc, setLightboxSrc] = useState(null);

  const { data } = useQuery({
    queryKey: ["home-reviews", zoneKey],
    queryFn: async () => (await api.get("/reviews/featured", { params: zoneParams })).data,
    enabled: !waiting,
    staleTime: 60 * 1000,
  });
  const reviews = useMemo(() => data?.reviews ?? [], [data]);
  const looped = reviews.length >= 3;

  const slides = useMemo(() => {
    if (!looped) return reviews.map((r) => ({ r, key: r.id, copy: 0 }));
    const repeat = Math.max(1, Math.ceil(MIN_SLIDES / reviews.length));
    return Array.from({ length: repeat }, (_, round) => reviews.map((r) => ({ r, key: `${r.id}-${round}`, copy: round }))).flat();
  }, [reviews, looped]);

  const plugins = useMemo(() => (looped && !reducedMotion ? [Autoplay({ delay: 5000, stopOnMouseEnter: true, stopOnInteraction: false })] : []), [looped, reducedMotion]);
  const [emblaRef, embla] = useEmblaCarousel({ loop: looped, align: "center", duration: 30 }, plugins);
  const prev = useCallback(() => embla?.scrollPrev(), [embla]);
  const next = useCallback(() => embla?.scrollNext(), [embla]);
  const skipCopyFocus = useCallback((el) => {
    el?.querySelectorAll("a, button, [tabindex]").forEach((n) => n.setAttribute("tabindex", "-1"));
  }, []);

  if (!reviews.length) return null;
  const stats = data?.stats;

  return (
    <section className="container-app cv-auto pb-10 md:pb-14" aria-labelledby="opiniones-home">
      <div className="relative overflow-hidden rounded-[28px] bg-primary px-4 py-9 sm:px-8 md:rounded-[36px] md:px-10 md:py-12">
        {/* Comillas grandes de fondo: refuerzan que son opiniones, sin competir con las tarjetas. */}
        <span aria-hidden="true" className="pointer-events-none absolute -left-2 -top-10 select-none font-display text-[220px] font-extrabold leading-none text-secondary-container/15 md:-top-12 md:left-4 md:text-[300px]">“</span>

        <div className="relative grid gap-7 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:items-center lg:gap-10">
          <div>
            <h2 id="opiniones-home" className="font-display text-[26px] font-extrabold leading-[1.15] text-white md:text-[32px]">
              Lo que piensan los clientes de nuestros vendedores y productos
            </h2>
            <p className="mt-2 text-[13.5px] text-white/75">Opiniones reales de quienes ya compraron.</p>
            {stats?.total > 0 && (
              <div className="mt-4 flex items-center gap-3">
                <span className="font-display text-[40px] font-extrabold leading-none text-secondary-container">{stats.average.toFixed(1)}</span>
                <div>
                  <StarRating value={Math.round(stats.average)} size="h-4 w-4" />
                  <p className="mt-0.5 text-[12.5px] text-white/75">
                    {stats.total} {stats.total === 1 ? "reseña" : "reseñas"} de compradores
                  </p>
                </div>
              </div>
            )}
            {looped && (
              <div className="mt-5 hidden gap-2 lg:flex">
                <button type="button" onClick={prev} aria-label="Reseña anterior" className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-container">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button type="button" onClick={next} aria-label="Reseña siguiente" className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>

          <div className="min-w-0">
            {/* En celular y tableta el carrusel llega de borde a borde del panel y la reseña activa queda al centro, con un pedazo de la que
                sale a un lado y de la que entra al otro. */}
            <div className="-mx-4 overflow-hidden sm:-mx-8 md:-mx-10 lg:mx-0" ref={emblaRef} role="region" aria-label="Reseñas de clientes">
              <div className="flex touch-pan-y">
                {slides.map(({ r, key, copy }) => (
                  <div key={key} className="min-w-0 flex-none basis-[74%] px-1.5 sm:basis-[56%] md:basis-[46%] lg:basis-1/2 xl:basis-1/3" {...(copy > 0 ? { "aria-hidden": true, ref: skipCopyFocus } : {})}>
                    <ReviewCard r={r} showContext showStore onImageClick={(src) => setLightboxSrc(src)} />
                  </div>
                ))}
              </div>
            </div>
            {looped && (
              <div className="mt-4 flex justify-center gap-2 lg:hidden">
                <button type="button" onClick={prev} aria-label="Reseña anterior" className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 text-white hover:bg-white/10">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button type="button" onClick={next} aria-label="Reseña siguiente" className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container hover:brightness-95">
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </section>
  );
}
