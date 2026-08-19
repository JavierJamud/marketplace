import { ShieldCheck, Flag, MessageSquareText } from "lucide-react";
import { StarRating } from "./ui/StarRating.jsx";
import { EmptyState } from "./ui/EmptyState.jsx";
import { api } from "../lib/api.js";

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

const PALETTE = ["#6366f1", "#ec4899", "#14b8a6", "#f59e0b", "#8b5cf6", "#10b981"];

function avatarColor(name) {
  return PALETTE[(name?.charCodeAt(0) ?? 0) % PALETTE.length];
}

function initials(name) {
  return (name ?? "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("es-CU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Bloque 69 (pedido explícito): "Reportar" — solo a otro usuario logueado
// que no sea el propio autor (nunca puedes reportar tu propio comentario).
// Un comentario reportado se oculta de inmediato server-side, así que no
// hace falta un estado "ya reportado" acá: en cuanto se reporta, desaparece
// de esta lista en el próximo refetch (ver invalidateQueries del llamador).
//
// Bloque 74 (pedido explícito, rediseño): antes la foto adjunta era una
// franja angosta pegada al costado del texto (fácil de subestimar, casi
// invisible en mobile) — pasa a ser una tarjeta vertical de secciones
// apiladas (cabecera / insignia / comentario / foto / respuesta), cada una
// con su propio espacio, y la foto como una miniatura ancha y clara, nunca
// un flaco borde lateral. Se muestra SIEMPRE que la reseña tenga una,
// en cualquier tamaño de pantalla — solo cambia de tamaño, nunca de
// visibilidad.
function ReviewCard({ r, vendorName, onImageClick, currentUserId, onReportClick }) {
  const firstImage = r.images?.[0] ? imgUrl(r.images[0]) : null;
  const color = avatarColor(r.authorName);
  const canReport = currentUserId && r.userId && r.userId !== currentUserId;

  return (
    <div className="group relative flex w-[230px] flex-shrink-0 flex-col gap-2.5 overflow-hidden rounded-2xl border border-surface-container-high bg-surface-container-lowest p-3.5 shadow-[0_2px_12px_rgba(0,0,0,0.06)] transition-shadow hover:shadow-[0_4px_20px_rgba(0,0,0,0.10)] sm:w-[270px] sm:p-4 md:w-[300px]">
      {canReport && (
        <button
          type="button"
          onClick={() => onReportClick?.(r)}
          title="Reportar comentario"
          className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-surface-container-lowest/90 text-outline opacity-0 shadow-sm transition-opacity hover:text-error group-hover:opacity-100"
        >
          <Flag className="h-3 w-3" />
        </button>
      )}

      {/* Cabecera */}
      <div className="flex items-center gap-2">
        <div
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10.5px] font-extrabold text-white shadow-sm sm:h-8 sm:w-8 sm:text-[11px]"
          style={{ background: `linear-gradient(135deg, ${color}dd, ${color}88)` }}
        >
          {initials(r.authorName)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-bold text-on-surface">{r.authorName}</p>
          <p className="text-[10px] text-outline">{formatDate(r.createdAt)}</p>
        </div>
        {r.rating && <StarRating value={r.rating} size="h-2.5 w-2.5" />}
      </div>

      {/* Badge compra verificada */}
      {r.isVerifiedPurchase && (
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-verified/10 px-2 py-0.5 text-[9.5px] font-bold text-verified-dark">
          <ShieldCheck className="h-2.5 w-2.5" /> Compra verificada
        </span>
      )}

      {/* Comentario */}
      {r.comment && (
        <p className="line-clamp-3 text-[12.5px] italic leading-[18px] text-on-surface-variant">"{r.comment}"</p>
      )}

      {/* Foto adjunta — miniatura ancha y clara, siempre visible si existe */}
      {firstImage && (
        <button
          type="button"
          onClick={() => onImageClick?.(firstImage)}
          className="block h-24 w-full flex-shrink-0 overflow-hidden rounded-xl focus:outline-none sm:h-28"
        >
          <img src={firstImage} alt="" className="h-full w-full object-cover" />
        </button>
      )}

      {/* Respuesta del vendedor */}
      {r.vendorReply && vendorName && (
        <div className="rounded-xl border border-tertiary-accent/15 bg-tertiary-accent/5 p-2.5">
          <p className="mb-0.5 text-[10px] font-bold text-tertiary-accent">· {vendorName}</p>
          <p className="line-clamp-2 text-[11px] leading-4 text-on-surface-variant">{r.vendorReply}</p>
        </div>
      )}
    </div>
  );
}

/**
 * ReviewsMarquee
 * @param {object[]} reviews  - Array de reseñas
 * @param {string}   vendorName - Nombre del vendedor (para respuestas)
 * @param {function} onImageClick - Callback para abrir lightbox
 * @param {string}   currentUserId - Bloque 69: id del usuario logueado (si hay) — gatea el botón "Reportar"
 * @param {function} onReportClick - Bloque 69: callback(review) al tocar "Reportar" — el padre decide el modal/mutación
 */
export function ReviewsMarquee({ reviews, vendorName, onImageClick, currentUserId, onReportClick }) {
  // Pedido explícito (con captura): el texto suelto sin ningún contenedor se
  // veía poco cuidado — se reemplaza por el mismo `EmptyState` (borde
  // punteado + ícono + título) que ya usa el resto del sitio para listas
  // vacías, en vez de un párrafo de texto plano flotando en la página.
  if (!reviews?.length) {
    return <EmptyState icon={MessageSquareText} title="Todavía no hay reseñas" description="Sé el primero en compartir tu opinión." />;
  }

  // Bug real corregido: con <4 reseñas se triplicaba el contenido
  // ([...reviews x3]) pero el keyframe `marquee` siempre anima 0% -> -50%
  // (pensado para EXACTAMENTE 2 copias, ver tailwind.config.js) — con 3
  // copias, -50% cae a mitad de la 2ª copia en vez de justo al final de la
  // 1ª, así que el reinicio del keyframe saltaba a un frame visualmente
  // distinto ("vuelve al inicio" que reportó el usuario). Duplicar SIEMPRE
  // exactamente una vez (2 copias totales) es lo que hace que -50% caiga
  // justo en el borde entre copias — ahí el reinicio es invisible, sin
  // importar cuántas reseñas haya.
  const items = [...reviews, ...reviews];

  // Velocidad: ~30s por cada 4 cards — escala linealmente con la cantidad.
  const durationSecs = Math.max(20, items.length * 7);

  return (
    <div className="overflow-hidden" style={{ maskImage: "linear-gradient(to right, transparent, black 5%, black 95%, transparent)" }}>
      <div
        className="flex items-start gap-3 will-change-transform sm:gap-4"
        style={{
          animation: `marquee ${durationSecs}s linear infinite`,
          width: "max-content",
        }}
        // Pausa al hover — igual que el marquee de categorías
        onMouseEnter={(e) => (e.currentTarget.style.animationPlayState = "paused")}
        onMouseLeave={(e) => (e.currentTarget.style.animationPlayState = "running")}
      >
        {items.map((r, i) => (
          <ReviewCard
            key={`${r.id}-${i}`}
            r={r}
            vendorName={vendorName}
            onImageClick={onImageClick}
            currentUserId={currentUserId}
            onReportClick={onReportClick}
          />
        ))}
      </div>
    </div>
  );
}
