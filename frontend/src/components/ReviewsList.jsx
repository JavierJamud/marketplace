import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import useEmblaCarousel from "embla-carousel-react";
import { Check, ChevronLeft, ChevronRight, MessageCircle, MessageSquareText } from "lucide-react";
import { StarRating } from "./ui/StarRating.jsx";
import { EmptyState } from "./ui/EmptyState.jsx";
import { imgUrl } from "../lib/imgUrl.js";
import { timeAgo } from "../lib/relativeTime.js";
import { usePlatformSettings } from "../lib/usePlatformSettings.js";
import { usePrefersReducedMotion } from "../lib/useMediaQuery.js";

// Tarjeta de reseña, pequeña y siempre del mismo tamaño. De arriba abajo: el perfil del cliente con su nombre y, a la derecha, las fotos
// que compartió (hasta 2: una al frente y la otra detrás, inclinada); la calificación; el título (si el cliente puso uno); el comentario;
// cuándo se escribió y si fue compra verificada; y abajo el botón de las respuestas de la tienda o de la plataforma, que al tocarlo
// reemplazan el comentario sin cambiar el tamaño, y "Reportar".

function initials(name) {
  return (name ?? "?")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// Avatar del cliente: alterna entre el naranja y el verde azulado de la marca según su nombre.
const AVATAR_TONES = ["bg-secondary-container text-on-secondary-container", "bg-tertiary-accent text-white"];
const toneFor = (name) => AVATAR_TONES[(String(name ?? "?").charCodeAt(0) || 0) % AVATAR_TONES.length];

// Las fotos del comentario: la primera al frente y, si hay una segunda, detrás y un poco inclinada.
function PhotoStack({ images, onOpen }) {
  const [front, back] = images;
  const frame = "overflow-hidden rounded bg-surface-container shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-tertiary-accent";
  return (
    <div className="pointer-events-none absolute right-4 top-4 z-10 h-14 w-[5.25rem] [&>*]:pointer-events-auto">
      {back && (
        <button type="button" onClick={() => onOpen?.(imgUrl(back))} aria-label="Ver la segunda foto de la reseña" className={`absolute right-0 top-1.5 h-11 w-11 rotate-[12deg] ${frame}`}>
          <img src={imgUrl(back)} alt="" loading="lazy" className="h-full w-full object-cover" />
        </button>
      )}
      <button type="button" onClick={() => onOpen?.(imgUrl(front))} aria-label="Ver la foto de la reseña" className={`absolute top-0 z-10 h-[3.25rem] w-[3.25rem] shadow-lg ${back ? "left-1" : "right-0"} ${frame}`}>
        <img src={imgUrl(front)} alt="" loading="lazy" className="h-full w-full object-cover" />
      </button>
    </div>
  );
}

export function ReviewCard({ r, vendorName, vendorSlug, showContext = false, onImageClick, currentUserId, onReportClick, onReading }) {
  const { siteName } = usePlatformSettings();
  const [expanded, setExpanded] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  // "Reportar" lo ve cualquiera menos el autor del comentario. Sin sesión, tocarlo lleva a iniciar sesión (lo resuelve quien usa la tarjeta).
  const canReport = !(currentUserId && r.userId === currentUserId);
  // Con el texto desplegado o las respuestas abiertas, el carrusel no debe pasar a otra reseña (se está leyendo).
  const reading = expanded || showReplies;
  useEffect(() => {
    onReading?.(r.id, reading);
    return () => onReading?.(r.id, false);
  }, [onReading, r.id, reading]);
  const photos = (r.images ?? []).slice(0, 2);
  const storeName = vendorName ?? r.vendor?.companyName;
  // Respuestas: la de la tienda y la de la plataforma, cada una con su autor.
  const replies = [
    r.vendorReply && storeName ? { key: "tienda", who: storeName, label: "Respuesta del vendedor", text: r.vendorReply } : null,
    r.adminReply ? { key: "plataforma", who: siteName, label: "Respuesta de la plataforma", text: r.adminReply } : null,
  ].filter(Boolean);
  const body = r.comment ?? "";
  const long = body.length > (r.title ? 60 : 95);
  const slug = vendorSlug ?? r.vendor?.slug;

  // Qué es la reseña: de un producto de la tienda (con enlace a él) o de la tienda en general.
  const subtitle = showContext ? (
    r.product && slug && r.product.slug ? (
      <Link to={`/producto/${slug}/${r.product.slug}`} className="block truncate text-[12px] leading-4 text-on-surface-variant hover:text-tertiary-accent hover:underline">
        Producto · {r.product.name}
      </Link>
    ) : (
      <span className="block truncate text-[12px] leading-4 text-on-surface-variant">{r.product ? `Producto · ${r.product.name}` : "Reseña de la tienda"}</span>
    )
  ) : null;

  return (
    <article id={`resena-${r.id}`} className="relative flex h-[15rem] min-w-0 flex-col rounded-md border border-surface-container-high bg-surface-container-lowest p-4 shadow-[0_8px_22px_-14px_rgba(14,26,40,0.3)]">
      {photos.length > 0 && <PhotoStack images={photos} onOpen={onImageClick} />}
      <header className={`flex h-14 items-start gap-2.5 ${photos.length > 1 ? "pr-[5.75rem]" : photos.length === 1 ? "pr-[4rem]" : ""}`}>
        <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold ${toneFor(r.authorName)}`} aria-hidden="true">
          {initials(r.authorName)}
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="truncate font-display text-[15px] font-extrabold leading-5 text-on-surface">{r.authorName}</p>
          {subtitle}
        </div>
      </header>

      {r.rating ? (
        <div className="mt-1">
          <StarRating value={r.rating} size="h-4 w-4" />
        </div>
      ) : null}

      {/* El comentario, o las respuestas cuando se piden con el botón (ocupan el mismo lugar). */}
      <div className={`mt-1.5 min-h-0 flex-1 ${expanded || showReplies ? "overflow-y-auto" : "overflow-hidden"}`}>
        {showReplies ? (
          <div className="flex flex-col gap-2">
            {replies.map((rep) => (
              <div key={rep.key}>
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary-container text-[9.5px] font-extrabold text-white" aria-hidden="true">
                    {initials(rep.who)}
                  </span>
                  <p className="min-w-0 truncate text-[12.5px] font-bold text-on-surface">
                    {rep.who} <span className="font-normal text-outline">· {rep.label}</span>
                  </p>
                </div>
                <p className="mt-0.5 whitespace-pre-line break-words text-[13px] leading-[18px] text-on-surface">{rep.text}</p>
              </div>
            ))}
          </div>
        ) : (
          <>
            {r.title && <p title={r.title} className="truncate font-display text-[15px] font-extrabold leading-5 text-on-surface">{r.title}</p>}
            {body && <p className={`whitespace-pre-line break-words text-[13px] leading-[18px] text-on-surface-variant ${r.title ? "mt-0.5" : ""} ${expanded ? "" : r.title ? "line-clamp-2" : "line-clamp-3"}`}>{body}</p>}
          </>
        )}
      </div>

      {/* Cuándo se escribió. Todo comentario exige una sesión de cliente, por eso todos llevan "Cliente verificado". */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[12px] leading-4 text-on-surface-variant">
        <span>{timeAgo(r.createdAt)}</span>
        <span className="h-1 w-1 rounded-full bg-outline-variant" aria-hidden="true" />
        <span className="inline-flex items-center gap-1">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-verified text-white" aria-hidden="true">
            <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
          </span>
          Cliente verificado
        </span>
      </div>

      <div className="mt-1 flex min-h-8 items-center gap-1.5">
        {replies.length > 0 && (
          <button type="button" onClick={() => setShowReplies((v) => !v)} aria-pressed={showReplies} className="inline-flex min-h-8 flex-shrink-0 items-center gap-1 whitespace-nowrap rounded bg-surface-container px-2 text-[12.5px] font-semibold text-on-surface hover:bg-surface-container-high">
            <MessageCircle className="h-3.5 w-3.5 text-tertiary-accent" aria-hidden="true" />
            {showReplies ? (
              "Ver comentario"
            ) : (
              <>
                Respuestas <span className="text-tertiary-accent">({replies.length})</span>
              </>
            )}
          </button>
        )}
        {long && !showReplies && (
          <button type="button" onClick={() => setExpanded((v) => !v)} className="min-h-8 flex-shrink-0 whitespace-nowrap px-0.5 text-[12.5px] font-semibold text-tertiary-accent hover:underline">
            {expanded ? "Ver menos" : "Leer más"}
          </button>
        )}
        {canReport && (
          <button type="button" onClick={() => onReportClick?.(r)} className="ml-auto min-h-8 flex-shrink-0 whitespace-nowrap pl-0.5 text-[13px] font-bold text-tertiary-accent hover:underline">
            Reportar
          </button>
        )}
      </div>
    </article>
  );
}

/**
 * Las reseñas, una al lado de la otra, pasando de una en una con parada en cada tarjeta (se arrastran con el dedo o con las flechas).
 * En el celular la tarjeta activa queda centrada y se asoma un pedazo de la anterior y de la siguiente; en pantallas grandes se ven
 * varias completas a la vez, y cuántas caben depende del ancho.
 *
 * @param {object[]} reviews - reseñas (las de producto traen `product`)
 * @param {string} vendorName - nombre de la tienda, para el bloque de respuesta
 * @param {string} vendorSlug - para enlazar a cada producto reseñado
 * @param {boolean} showContext - muestra a qué se refiere cada reseña (producto o tienda), en la página de la tienda
 * @param {function} onImageClick - abre la foto ampliada
 * @param {string} currentUserId - quien está conectado: puede reportar comentarios ajenos
 * @param {function} onReportClick - callback(review) al tocar "Reportar"
 */
export function ReviewsList({ reviews, vendorName, vendorSlug, showContext = false, onImageClick, currentUserId, onReportClick }) {
  const reducedMotion = usePrefersReducedMotion();
  const [emblaRef, embla] = useEmblaCarousel({
    align: "center",
    containScroll: false,
    slidesToScroll: 1,
    skipSnaps: false,
    breakpoints: { "(min-width: 1024px)": { align: "start", containScroll: "trimSnaps" } },
  });
  const [index, setIndex] = useState(0);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const sync = useCallback(() => {
    if (!embla) return;
    setIndex(embla.selectedScrollSnap());
    setCanPrev(embla.canScrollPrev());
    setCanNext(embla.canScrollNext());
  }, [embla]);

  useEffect(() => {
    if (!embla) return undefined;
    sync();
    embla.on("select", sync).on("reInit", sync);
    return () => {
      embla.off("select", sync).off("reInit", sync);
    };
  }, [embla, sync]);

  // Avance automático: pasa a la siguiente cada 3 segundos y, al llegar a la última, vuelve a la primera. Se detiene mientras haya un dedo
  // (o el botón del ratón) sobre las reseñas, el cursor encima, o alguna reseña desplegada para leerla, y al soltar espera 3 segundos
  // completos antes de seguir. Con "reducir movimiento" activado en el dispositivo no avanza sola.
  const hold = useRef({ touching: false, hovering: false, reading: new Set() });
  const [paused, setPaused] = useState(false);
  const syncPause = useCallback(() => {
    const h = hold.current;
    setPaused(h.touching || h.hovering || h.reading.size > 0);
  }, []);
  const onReading = useCallback(
    (id, on) => {
      if (on) hold.current.reading.add(id);
      else hold.current.reading.delete(id);
      syncPause();
    },
    [syncPause]
  );
  const setTouching = (v) => {
    hold.current.touching = v;
    syncPause();
  };
  // Solo el ratón cuenta como "cursor encima": al tocar en el celular se simulan eventos de ratón que nunca terminan.
  const setHovering = (e, v) => {
    if (e.pointerType !== "mouse") return;
    hold.current.hovering = v;
    syncPause();
  };

  useEffect(() => {
    if (!embla || reducedMotion || paused) return undefined;
    const id = setInterval(() => {
      if (document.hidden) return;
      if (embla.canScrollNext()) embla.scrollNext();
      else embla.scrollTo(0);
    }, 3000);
    return () => clearInterval(id);
    // `index`: después de cada cambio (automático o a mano) el reloj empieza de nuevo, así cada reseña se ve 3 segundos completos.
  }, [embla, reducedMotion, paused, index]);

  const total = reviews?.length ?? 0;
  if (!total) {
    return <EmptyState icon={MessageSquareText} title="Todavía no hay reseñas" description="Sé el primero en compartir tu opinión." />;
  }
  const many = total > 1;

  return (
    <div>
      {many && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[13px] text-on-surface-variant" aria-live="polite">
            {index + 1} de {total}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => embla?.scrollPrev()} disabled={!canPrev} aria-label="Reseña anterior" className="flex h-11 w-11 items-center justify-center rounded-full border border-outline-variant text-on-surface hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent disabled:opacity-35">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => embla?.scrollNext()} disabled={!canNext} aria-label="Reseña siguiente" className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent disabled:opacity-35">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
      {/* En celular el carrusel llega de borde a borde de la pantalla para que se vean los pedazos de las tarjetas vecinas. */}
      <div className="-mx-4 overflow-hidden sm:-mx-6 lg:mx-0" ref={emblaRef} onPointerDown={() => setTouching(true)} onPointerUp={() => setTouching(false)} onPointerCancel={() => setTouching(false)} onPointerEnter={(e) => setHovering(e, true)} onPointerLeave={(e) => setHovering(e, false)} role="region" aria-roledescription="carrusel" aria-label="Reseñas de clientes">
        <div className="flex touch-pan-y py-2">
          {reviews.map((r, i) => (
            <div key={r.id} role="group" aria-roledescription="diapositiva" aria-label={`Reseña ${i + 1} de ${total}`} className="min-w-0 flex-none basis-[84%] px-1.5 sm:basis-[56%] md:basis-[44%] lg:basis-1/3 xl:basis-1/4">
              <ReviewCard r={r} vendorName={vendorName} vendorSlug={vendorSlug} showContext={showContext} onImageClick={onImageClick} currentUserId={currentUserId} onReportClick={onReportClick} onReading={onReading} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
