import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import useEmblaCarousel from "embla-carousel-react";
import { BadgeCheck, ChevronLeft, ChevronRight, Flag, MessageCircle, MessageSquareText, Package, Store } from "lucide-react";
import { StarRating } from "./ui/StarRating.jsx";
import { EmptyState } from "./ui/EmptyState.jsx";
import { imgUrl } from "../lib/imgUrl.js";
import { timeAgo } from "../lib/relativeTime.js";
import { usePlatformSettings } from "../lib/usePlatformSettings.js";
import { usePrefersReducedMotion } from "../lib/useMediaQuery.js";

// Tarjeta de reseña. Se lee de arriba abajo como una conversación:
//  1. Quién la escribió: avatar, nombre y, en la misma línea, hace cuánto y que es compra verificada.
//  2. Qué calificó: las estrellas con la nota y, en la página de la tienda, el producto (o "la tienda") como etiqueta enlazada.
//  3. El comentario (título opcional y texto, recortado con "Leer más") y debajo las fotos que compartió.
//  4. Las respuestas de la tienda o de la plataforma, visibles en un recuadro suave (la primera abierta; si hay dos, se despliegan).
//  5. Abajo, discreto, "Reportar".
// Todas las tarjetas del carrusel miden lo mismo de alto (h-full): el pie queda alineado aunque los textos tengan distinto largo.

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

export function ReviewCard({ r, vendorName, vendorSlug, showContext = false, onImageClick, currentUserId, onReportClick, onReading }) {
  const { siteName } = usePlatformSettings();
  const [expanded, setExpanded] = useState(false);
  const [allReplies, setAllReplies] = useState(false);
  // "Reportar" lo ve cualquiera menos el autor del comentario. Sin sesión, tocarlo lleva a iniciar sesión (lo resuelve quien usa la tarjeta).
  const canReport = !(currentUserId && r.userId === currentUserId);
  // Con el texto o las respuestas desplegadas, el carrusel no debe pasar a otra reseña (se está leyendo).
  const reading = expanded || allReplies;
  useEffect(() => {
    onReading?.(r.id, reading);
    return () => onReading?.(r.id, false);
  }, [onReading, r.id, reading]);
  const photos = (r.images ?? []).slice(0, 2);
  const storeName = vendorName ?? r.vendor?.companyName;
  // Respuestas: la de la tienda y la de la plataforma, cada una con su autor.
  const replies = [
    r.vendorReply && storeName ? { key: "tienda", who: storeName, label: "Respuesta de la tienda", text: r.vendorReply } : null,
    r.adminReply ? { key: "plataforma", who: siteName, label: "Respuesta de la plataforma", text: r.adminReply } : null,
  ].filter(Boolean);
  const shownReplies = allReplies ? replies : replies.slice(0, 1);
  const body = r.comment ?? "";
  const long = body.length > 140;
  const slug = vendorSlug ?? r.vendor?.slug;

  // Sobre qué es la reseña: un producto de la tienda (con enlace a él) o la tienda en general.
  const about = showContext ? (
    r.product && slug && r.product.slug ? (
      <Link
        to={`/producto/${slug}/${r.product.slug}`}
        title={r.product.name}
        className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-surface-container px-2.5 py-1 text-[12px] font-semibold text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-2 focus-visible:outline-tertiary-accent"
      >
        <Package className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
        <span className="truncate">{r.product.name}</span>
      </Link>
    ) : (
      <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-surface-container px-2.5 py-1 text-[12px] font-semibold text-on-surface-variant">
        {r.product || r.productName ? <Package className="h-3 w-3 flex-shrink-0" aria-hidden="true" /> : <Store className="h-3 w-3 flex-shrink-0" aria-hidden="true" />}
        {/* Producto ya borrado: la reseña sigue contando para la tienda, con el nombre que tenía. */}
        <span className="truncate">{r.product ? r.product.name : r.productName ? `${r.productName} (ya no está a la venta)` : "Sobre la tienda"}</span>
      </span>
    )
  ) : null;

  return (
    <article id={`resena-${r.id}`} className="flex h-full min-w-0 flex-col rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5 shadow-[0_1px_2px_rgba(14,26,40,0.04),0_10px_28px_-18px_rgba(14,26,40,0.35)]">
      {/* 1. Quién */}
      <header className="flex items-center gap-3">
        <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-[14px] font-extrabold ${toneFor(r.authorName)}`} aria-hidden="true">
          {initials(r.authorName)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15.5px] font-extrabold leading-5 text-on-surface">{r.authorName}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] leading-4 text-on-surface-variant">
            <span>{timeAgo(r.createdAt)}</span>
            <span className="h-1 w-1 rounded-full bg-outline-variant" aria-hidden="true" />
            <span className="inline-flex items-center gap-1 font-semibold text-verified-dark">
              {/* Todo comentario exige sesión de cliente; "compra verificada" solo si compró en la tienda antes de comentar. */}
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> {r.isVerifiedPurchase ? "Compra verificada" : "Cliente verificado"}
            </span>
          </p>
        </div>
      </header>

      {/* 2. Qué calificó */}
      {(r.rating || about) && (
        <div className="mt-3.5 flex min-w-0 flex-wrap items-center gap-2">
          {r.rating ? (
            <span className="inline-flex flex-shrink-0 items-center gap-1.5">
              <StarRating value={r.rating} size="h-4 w-4" />
              <span className="text-[13px] font-bold text-on-surface">{Number(r.rating).toFixed(1)}</span>
            </span>
          ) : null}
          {about && <span className="min-w-0 max-w-full">{about}</span>}
        </div>
      )}

      {/* 3. El comentario y sus fotos */}
      <div className="mt-3 min-w-0 flex-1">
        {r.title && <p className="font-display text-[15px] font-extrabold leading-5 text-on-surface">{r.title}</p>}
        {body && (
          <p className={`whitespace-pre-line break-words text-[14px] leading-[21px] text-on-surface ${r.title ? "mt-1" : ""} ${expanded ? "" : "line-clamp-4"}`}>{body}</p>
        )}
        {long && (
          <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="mt-1 min-h-8 text-[13px] font-semibold text-tertiary-accent hover:underline">
            {expanded ? "Ver menos" : "Leer más"}
          </button>
        )}
        {photos.length > 0 && (
          <div className="mt-3 flex gap-2">
            {photos.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => onImageClick?.(imgUrl(src))}
                aria-label={`Ver la foto ${i + 1} de la reseña`}
                className="h-16 w-16 overflow-hidden rounded-xl bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-tertiary-accent"
              >
                <img src={imgUrl(src)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform hover:scale-105" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 4. Respuestas */}
      {replies.length > 0 && (
        <div className="mt-4 space-y-2">
          {shownReplies.map((rep) => (
            <div key={rep.key} className="rounded-xl bg-surface-container-low px-3.5 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary-container text-[10px] font-extrabold text-white" aria-hidden="true">
                  {initials(rep.who)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-bold leading-4 text-on-surface">{rep.who}</p>
                  <p className="text-[11.5px] leading-4 text-on-surface-variant">{rep.label}</p>
                </div>
              </div>
              <p className={`mt-1.5 whitespace-pre-line break-words text-[13px] leading-[19px] text-on-surface-variant ${allReplies ? "" : "line-clamp-3"}`}>{rep.text}</p>
            </div>
          ))}
          {(replies.length > 1 || replies.some((rep) => rep.text.length > 120)) && (
            <button type="button" onClick={() => setAllReplies((v) => !v)} aria-expanded={allReplies} className="inline-flex min-h-8 items-center gap-1 text-[12.5px] font-semibold text-tertiary-accent hover:underline">
              <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
              {allReplies ? "Ver menos" : replies.length > 1 ? `Ver las ${replies.length} respuestas` : "Ver respuesta completa"}
            </button>
          )}
        </div>
      )}

      {/* 5. Reportar: acción secundaria, sin competir con el comentario */}
      {canReport && (
        <div className="mt-4 flex justify-end border-t border-surface-container-high pt-2">
          <button type="button" onClick={() => onReportClick?.(r)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-semibold text-on-surface-variant hover:bg-surface-container hover:text-on-surface">
            <Flag className="h-3.5 w-3.5" aria-hidden="true" /> Reportar
          </button>
        </div>
      )}
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
      {/* En celular el carrusel llega de borde a borde de la pantalla para que se vean los pedazos de las tarjetas vecinas. En
          pantallas grandes, -mx-2 compensa el espacio entre tarjetas para que la primera quede alineada con el resto de la sección. */}
      <div className="-mx-4 overflow-hidden sm:-mx-6 lg:-mx-2" ref={emblaRef} onPointerDown={() => setTouching(true)} onPointerUp={() => setTouching(false)} onPointerCancel={() => setTouching(false)} onPointerEnter={(e) => setHovering(e, true)} onPointerLeave={(e) => setHovering(e, false)} role="region" aria-roledescription="carrusel" aria-label="Reseñas de clientes">
        <div className="flex touch-pan-y items-stretch py-2">
          {reviews.map((r, i) => (
            <div key={r.id} role="group" aria-roledescription="diapositiva" aria-label={`Reseña ${i + 1} de ${total}`} className="min-w-0 flex-none basis-[86%] px-2 sm:basis-[60%] md:basis-1/2 xl:basis-1/3">
              <ReviewCard r={r} vendorName={vendorName} vendorSlug={vendorSlug} showContext={showContext} onImageClick={onImageClick} currentUserId={currentUserId} onReportClick={onReportClick} onReading={onReading} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
