import { useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Flag, MessageSquareText, MessageSquareReply, Store as StoreIcon } from "lucide-react";
import { StarRating } from "./ui/StarRating.jsx";
import { EmptyState } from "./ui/EmptyState.jsx";
import { imgUrl, thumbUrl } from "../lib/imgUrl.js";
import { usePlatformSettings } from "../lib/usePlatformSettings.js";

// Tarjetas de reseña, iguales en la portada, las tiendas y los productos. Hay dos formas según la reseña:
// - con foto: tarjeta ALTA, con la foto arriba que se difumina hacia el blanco y, encima de ese degradado, el autor, las estrellas y
//   el comentario;
// - sin foto: tarjeta CORTA. Las cortas se agrupan de dos en dos, una sobre otra, y ocupan lo mismo que una alta (ver packReviews),
//   así las filas y las vueltas del carrusel quedan parejas.
const PAGE_SIZE = 9;
const LONG_COMMENT = 120;

function initials(name) {
  return (name ?? "?")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-CU", { day: "numeric", month: "short", ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
}

// Primera frase como titular (si hay más de una y es corta) y el resto como texto, como en el diseño de referencia. Con una sola
// frase todo queda como texto, sin inventar un titular.
function splitComment(text) {
  const m = String(text ?? "").match(/^(.{8,90}?[.!?])\s+([\s\S]+)$/);
  return m ? { title: m[1], body: m[2] } : { title: null, body: String(text ?? "") };
}

// Pastilla con a qué se refiere la reseña: el producto (con enlace a él) y la tienda, o la tienda en general. Se muestra donde hay
// mezcla (página de la tienda y portada); en la página de un producto todas son de ese producto y no hace falta repetirlo.
function ContextPill({ r, vendorSlug, onPhoto }) {
  const storeName = r.vendor?.companyName;
  const thumb = r.product ? thumbUrl(r.product.images?.[0]) : null;
  const cls = `flex max-w-full items-center gap-2 rounded-full py-1 pl-1 pr-3 ${onPhoto ? "bg-surface-container-lowest shadow-md" : "bg-surface-container"}`;
  const inner = (
    <>
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-high text-outline">
        {thumb ? <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" /> : <StoreIcon className="h-3.5 w-3.5" aria-hidden="true" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-bold leading-[14px] text-on-surface">{r.product ? r.product.name : "Tienda"}</span>
        {storeName && <span className="block truncate text-[10.5px] leading-3 text-outline">{storeName}</span>}
      </span>
    </>
  );
  return r.product && vendorSlug && r.product.slug ? (
    <Link to={`/producto/${vendorSlug}/${r.product.slug}`} className={`${cls} hover:brightness-95`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function ReviewCard({ r, vendorName, vendorSlug, showContext = false, showStore = false, onImageClick, currentUserId, onReportClick }) {
  const { siteName } = usePlatformSettings();
  const [expanded, setExpanded] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const canReport = currentUserId && r.userId && r.userId !== currentUserId;
  const cover = r.images?.[0] ? imgUrl(r.images[0]) : null;
  const morePhotos = (r.images ?? []).slice(1, 4);
  const pillSlug = vendorSlug ?? r.vendor?.slug;
  const responder = r.repliedByAdmin ? siteName : (vendorName ?? r.vendor?.companyName);
  const { title, body } = splitComment(r.comment);
  const long = body.length > LONG_COMMENT;
  const pill = showContext || showStore ? <ContextPill r={r} vendorSlug={pillSlug} onPhoto={!!cover} /> : null;

  const author = (
    <div className="flex items-center gap-2.5">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-tertiary-accent text-[13px] font-extrabold text-white" aria-hidden="true">
        {initials(r.authorName)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-bold leading-[17px] text-on-surface">{r.authorName}</p>
        <p className="flex items-center gap-1 truncate text-[11.5px] leading-[15px] text-outline">
          {r.isVerifiedPurchase && (
            <>
              <ShieldCheck className="h-3 w-3 flex-shrink-0 text-verified-dark" aria-hidden="true" />
              <span className="flex-shrink-0 font-semibold text-verified-dark">Compra verificada</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span className="truncate">{formatDate(r.createdAt)}</span>
        </p>
      </div>
      {canReport && (
        <button type="button" onClick={() => onReportClick?.(r)} aria-label="Reportar este comentario" className="-mr-2 flex h-11 w-9 flex-shrink-0 items-center justify-center rounded-full text-outline hover:text-error">
          <Flag className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  const text = (
    <div className="min-w-0">
      {title && <p className="font-display text-[16px] font-extrabold leading-[21px] text-on-surface">{title}</p>}
      {body && (
        <>
          <p className={`whitespace-pre-line break-words text-[13px] leading-[19px] text-on-surface-variant ${title ? "mt-1" : ""} ${expanded ? "" : cover ? "line-clamp-4" : "line-clamp-3"}`}>{body}</p>
          {long && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-0.5 min-h-7 text-[12px] font-semibold text-tertiary-accent hover:underline">
              {expanded ? "Ver menos" : "Leer más"}
            </button>
          )}
        </>
      )}
    </div>
  );

  const extras = (
    <>
      {morePhotos.length > 0 && (
        <div className="flex gap-1.5">
          {morePhotos.map((src, i) => (
            <button key={src} type="button" onClick={() => onImageClick?.(imgUrl(src))} aria-label={`Ver foto ${i + 2} de la reseña`} className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-tertiary-accent">
              <img src={imgUrl(src)} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {/* La respuesta no ocupa lugar hasta que se pide: un botón pequeño la muestra y la oculta. */}
      {r.vendorReply && responder && (
        <div>
          <button type="button" onClick={() => setReplyOpen((v) => !v)} aria-expanded={replyOpen} className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-surface-container px-3 text-[12px] font-semibold text-tertiary-accent hover:bg-surface-container-high">
            <MessageSquareReply className="h-3.5 w-3.5" aria-hidden="true" />
            {replyOpen ? "Ocultar respuesta" : "Ver respuesta"}
          </button>
          {replyOpen && (
            <div className="mt-2 rounded-xl bg-surface-container px-3 py-2">
              <p className="text-[11.5px] font-bold text-tertiary-accent">Respuesta de {responder}</p>
              <p className="whitespace-pre-line break-words text-[12.5px] leading-[18px] text-on-surface-variant">{r.vendorReply}</p>
            </div>
          )}
        </div>
      )}
    </>
  );

  if (cover) {
    return (
      <article className="relative flex h-full min-h-[27rem] min-w-0 flex-col overflow-hidden rounded-3xl bg-surface-container-lowest shadow-[0_8px_24px_-8px_rgba(14,26,40,0.25)]">
        {/* La foto ocupa todo lo que no usa el texto y se difumina hacia el blanco; el texto la solapa un poco por abajo. */}
        <div className="relative min-h-[13rem] flex-1">
          <button type="button" onClick={() => onImageClick?.(cover)} aria-label="Ver la foto de la reseña" className="absolute inset-0 bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-tertiary-accent">
            <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
            <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-transparent from-35% via-surface-container-lowest/60 to-surface-container-lowest" />
          </button>
          {pill && <div className="pointer-events-none relative flex max-w-[92%] p-3 [&>*]:pointer-events-auto">{pill}</div>}
        </div>
        <div className="relative z-10 -mt-12 flex flex-col gap-2.5 p-4 pt-0">
          {author}
          {r.rating ? <StarRating value={r.rating} size="h-4 w-4" /> : null}
          {text}
          {extras}
        </div>
      </article>
    );
  }

  return (
    <article className="relative flex h-full min-w-0 flex-col gap-2.5 overflow-hidden rounded-3xl bg-surface-container-lowest p-4 shadow-[0_8px_24px_-8px_rgba(14,26,40,0.25)]">
      {(pill || r.rating) && (
        <div className="flex items-start justify-between gap-2">
          {r.rating ? <StarRating value={r.rating} size="h-4 w-4" /> : <span />}
          {pill && <div className="flex min-w-0 max-w-[68%] justify-end">{pill}</div>}
        </div>
      )}
      {text}
      {extras}
      <div className="mt-auto pt-1">{author}</div>
    </article>
  );
}

// Reúne las reseñas en "celdas": una con foto es una celda sola (alta); las que no tienen foto se juntan de dos en dos (una sobre otra),
// de modo que cada celda ocupa aproximadamente la misma altura. Mantiene el orden de llegada.
export function packReviews(reviews) {
  const cells = [];
  let pending = [];
  for (const r of reviews) {
    if (r.images?.length) {
      cells.push({ key: r.id, items: [r] });
    } else {
      pending.push(r);
      if (pending.length === 2) {
        cells.push({ key: pending.map((x) => x.id).join("+"), items: pending });
        pending = [];
      }
    }
  }
  if (pending.length) cells.push({ key: pending[0].id, items: pending });
  return cells;
}

// Una celda: una tarjeta alta con foto, o dos cortas apiladas que se reparten la altura.
export function ReviewCell({ cell, ...cardProps }) {
  if (cell.items.length === 1 && cell.items[0].images?.length) return <ReviewCard r={cell.items[0]} {...cardProps} />;
  return (
    <div className="flex h-full flex-col gap-3">
      {cell.items.map((r) => (
        <div key={r.id} className="flex-1">
          <ReviewCard r={r} {...cardProps} />
        </div>
      ))}
    </div>
  );
}

/**
 * @param {object[]} reviews - reseñas (las de producto traen `product`)
 * @param {string} vendorName - nombre de la tienda, para el bloque de respuesta
 * @param {string} vendorSlug - para enlazar a cada producto reseñado
 * @param {boolean} showContext - muestra a qué se refiere cada reseña (producto o tienda), en la página de la tienda
 * @param {function} onImageClick - abre la foto ampliada
 * @param {string} currentUserId - quien está conectado: puede reportar comentarios ajenos
 * @param {function} onReportClick - callback(review) al tocar "Reportar"
 */
export function ReviewsList({ reviews, vendorName, vendorSlug, showContext = false, onImageClick, currentUserId, onReportClick }) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  if (!reviews?.length) {
    return <EmptyState icon={MessageSquareText} title="Todavía no hay reseñas" description="Sé el primero en compartir tu opinión." />;
  }
  const cells = packReviews(reviews.slice(0, visible));
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        {cells.map((cell) => (
          <ReviewCell key={cell.key} cell={cell} vendorName={vendorName} vendorSlug={vendorSlug} showContext={showContext} onImageClick={onImageClick} currentUserId={currentUserId} onReportClick={onReportClick} />
        ))}
      </div>
      {reviews.length > visible && (
        <div className="mt-5 flex justify-center">
          <button type="button" onClick={() => setVisible((n) => n + PAGE_SIZE)} className="min-h-11 rounded-xl border-[1.5px] border-tertiary-accent px-6 text-label-md font-semibold text-tertiary-accent hover:bg-tertiary-accent/10">
            Ver más reseñas ({reviews.length - visible})
          </button>
        </div>
      )}
    </div>
  );
}
