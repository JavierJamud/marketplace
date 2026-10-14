import { useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Flag, MessageSquareText, Package, Store as StoreIcon } from "lucide-react";
import { StarRating } from "./ui/StarRating.jsx";
import { EmptyState } from "./ui/EmptyState.jsx";
import { imgUrl, thumbUrl } from "../lib/imgUrl.js";

// Tarjeta de reseña y lista de reseñas. La misma tarjeta se usa en la página de un producto, en la de una tienda y en la portada,
// así que se ve igual en todas partes. Es estrecha (cabe 1 por fila en celular, 2 en tableta, 3 y 4 en escritorio) y no
// deja de mostrar nada: autor, fecha, estrellas, compra verificada, a qué se refiere (producto o tienda), el texto, las fotos y la
// respuesta de la tienda.
const PAGE_SIZE = 8;
const LONG_COMMENT = 110;

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
  return new Date(iso).toLocaleDateString("es-CU", { day: "numeric", month: "short", year: "numeric" });
}

// De qué trata la reseña: de un producto de la tienda (con enlace a ese producto) o de la tienda en general. Se muestra donde hay
// mezcla (página de la tienda y portada); en la página de un producto todas son de ese producto y no hace falta repetirlo.
function Context({ r, vendorSlug }) {
  if (r.product) {
    const thumb = thumbUrl(r.product.images?.[0]);
    const chip = (
      <>
        {thumb ? <img src={thumb} alt="" loading="lazy" className="h-4 w-4 flex-shrink-0 rounded object-cover" /> : <Package className="h-3 w-3 flex-shrink-0" aria-hidden="true" />}
        <span className="min-w-0 truncate">
          Reseña de producto · <strong className="font-bold">{r.product.name}</strong>
        </span>
      </>
    );
    const cls = "inline-flex max-w-full items-center gap-1.5 rounded-full bg-secondary-container/25 px-2 py-0.5 text-[11px] font-semibold text-on-secondary-container";
    return vendorSlug && r.product.slug ? (
      <Link to={`/producto/${vendorSlug}/${r.product.slug}`} className={`${cls} hover:bg-secondary-container/40`}>
        {chip}
      </Link>
    ) : (
      <span className={cls}>{chip}</span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-tertiary-accent/10 px-2 py-0.5 text-[11px] font-semibold text-tertiary-accent">
      <StoreIcon className="h-3 w-3" aria-hidden="true" /> Reseña de la tienda
    </span>
  );
}

export function ReviewCard({ r, vendorName, vendorSlug, showContext = false, showStore = false, onImageClick, currentUserId, onReportClick }) {
  const [expanded, setExpanded] = useState(false);
  const canReport = currentUserId && r.userId && r.userId !== currentUserId;
  const long = (r.comment?.length ?? 0) > LONG_COMMENT;
  // La primera foto va al lado derecho, detrás del contenido y difuminada hacia la izquierda: así la tarjeta no crece hacia abajo
  // por la foto. Las demás (hasta 3) quedan como miniaturas pequeñas debajo del texto.
  const cover = r.images?.[0] ? imgUrl(r.images[0]) : null;
  const morePhotos = (r.images ?? []).slice(1, 4);
  const storeSlug = vendorSlug ?? r.vendor?.slug;
  const storeName = r.vendor?.companyName;

  const reportButton = canReport && (
    <button
      type="button"
      onClick={() => onReportClick?.(r)}
      aria-label="Reportar este comentario"
      className={
        cover
          ? "absolute right-1.5 top-1.5 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-surface-container-lowest/90 text-outline shadow-sm hover:text-error"
          : "-mr-2 flex h-11 w-9 flex-shrink-0 items-center justify-center rounded-full text-outline hover:text-error"
      }
    >
      <Flag className="h-3.5 w-3.5" />
    </button>
  );

  return (
    <article className="relative h-full min-w-0 overflow-hidden rounded-2xl border border-surface-container-high bg-surface-container-lowest shadow-[0_1px_3px_rgba(27,27,29,0.06)]">
      {cover && (
        <button
          type="button"
          onClick={() => onImageClick?.(cover)}
          aria-label="Ver la foto de la reseña"
          className="absolute inset-y-0 right-0 z-0 w-[56%] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-tertiary-accent"
        >
          <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
          <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-surface-container-lowest from-5% via-surface-container-lowest/75 to-transparent" />
        </button>
      )}
      {cover && reportButton}

      <div className={`relative z-10 flex h-full flex-col gap-2.5 p-3.5 ${cover ? "pr-[34%]" : ""}`}>
        <header className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary-container text-[12px] font-extrabold text-white" aria-hidden="true">
            {initials(r.authorName)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-bold leading-4 text-on-surface">{r.authorName}</p>
            <p className="text-[11px] text-outline">{formatDate(r.createdAt)}</p>
          </div>
          {!cover && r.rating ? <StarRating value={r.rating} size="h-3.5 w-3.5" /> : null}
          {!cover && reportButton}
        </header>
        {cover && r.rating ? <StarRating value={r.rating} size="h-3.5 w-3.5" /> : null}

        {(showContext || r.isVerifiedPurchase) && (
          <div className="flex flex-wrap items-center gap-1">
            {showContext && <Context r={r} vendorSlug={storeSlug} />}
            {r.isVerifiedPurchase && (
              <span className="inline-flex items-center gap-1 rounded-full bg-verified/10 px-2 py-0.5 text-[11px] font-bold text-verified-dark">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Compra verificada
              </span>
            )}
          </div>
        )}

        {r.comment && (
          <div>
            <p className={`whitespace-pre-line break-words text-[13px] leading-[19px] text-on-surface-variant ${expanded ? "" : "line-clamp-3"}`}>{r.comment}</p>
            {long && (
              <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-0.5 min-h-7 text-[12px] font-semibold text-tertiary-accent hover:underline">
                {expanded ? "Ver menos" : "Leer más"}
              </button>
            )}
          </div>
        )}

        {morePhotos.length > 0 && (
          <div className="flex gap-1.5">
            {morePhotos.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => onImageClick?.(imgUrl(src))}
                aria-label={`Ver foto ${i + 2} de la reseña`}
                className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-tertiary-accent"
              >
                <img src={imgUrl(src)} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}

        {r.vendorReply && (vendorName || storeName) && (
          <div className="rounded-xl bg-surface-container px-3 py-2">
            <p className="text-[11.5px] font-bold text-tertiary-accent">Respuesta de {vendorName ?? storeName}</p>
            <p className="line-clamp-3 whitespace-pre-line break-words text-[12.5px] leading-[18px] text-on-surface-variant">{r.vendorReply}</p>
          </div>
        )}

        {showStore && storeName && storeSlug && (
          <Link to={`/tienda/${storeSlug}`} className="mt-auto inline-flex min-h-8 items-center gap-1.5 border-t border-surface-container-high pt-2 text-[12px] font-semibold text-on-surface-variant hover:text-tertiary-accent">
            <StoreIcon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            <span className="truncate">{storeName}</span>
          </Link>
        )}
      </div>
    </article>
  );
}

/**
 * @param {object[]} reviews - reseñas (las de producto traen `product`)
 * @param {string} vendorName - nombre de la tienda, para el bloque de respuesta
 * @param {string} vendorSlug - para enlazar a cada producto reseñado
 * @param {boolean} showContext - marca cada tarjeta como "Producto · X" o "Reseña de la tienda" (página de tienda)
 * @param {function} onImageClick - abre la foto ampliada
 * @param {string} currentUserId - quien está conectado: puede reportar comentarios ajenos
 * @param {function} onReportClick - callback(review) al tocar "Reportar"
 */
export function ReviewsList({ reviews, vendorName, vendorSlug, showContext = false, onImageClick, currentUserId, onReportClick }) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  if (!reviews?.length) {
    return <EmptyState icon={MessageSquareText} title="Todavía no hay reseñas" description="Sé el primero en compartir tu opinión." />;
  }
  const shown = reviews.slice(0, visible);
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((r) => (
          <ReviewCard key={r.id} r={r} vendorName={vendorName} vendorSlug={vendorSlug} showContext={showContext} onImageClick={onImageClick} currentUserId={currentUserId} onReportClick={onReportClick} />
        ))}
      </div>
      {reviews.length > visible && (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={() => setVisible((n) => n + PAGE_SIZE)}
            className="min-h-11 rounded-xl border-[1.5px] border-tertiary-accent px-6 text-label-md font-semibold text-tertiary-accent hover:bg-tertiary-accent/10"
          >
            Ver más reseñas ({reviews.length - visible})
          </button>
        </div>
      )}
    </div>
  );
}
