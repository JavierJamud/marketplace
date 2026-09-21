import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Share2, MessageCircle, ShieldAlert, Heart } from "lucide-react";
import toast from "../lib/toast.jsx";
import { api } from "../lib/api.js";
import { copyToClipboard } from "../lib/clipboard.js";
import { waLink } from "../lib/whatsapp.js";
import { resolvePaymentMethod } from "../lib/paymentMethods.js";
import { useAuth } from "../context/AuthContext.jsx";
import { VerifiedBadge } from "./ui/VerifiedBadge.jsx";
import { StarRating } from "./ui/StarRating.jsx";
import { ReportFraudModal } from "./ReportFraudModal.jsx";
import { getBannerIconPattern } from "../lib/vendorBannerIcons.js";

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

function showLinkCopiedToast() {
  toast.success(
    "¡Enlace copiado!",
    "Pegalo donde quieras — WhatsApp, redes sociales o mensaje directo — para compartir esta tienda.",
    { icon: "link" }
  );
}

// Bloque 166 (pedido explícito — "en la página donde se muestra el menú
// escaneado del QR... la sección que pone los datos de la tienda debe ser
// idéntico al que se ve en la tienda de la página principal, solo que lleva
// agregado qué mesa es"): extraído tal cual de Store.jsx (antes vivía solo
// ahí, inline) para que TableOrder.jsx pueda usar el mismo banner byte a
// byte, en vez de reimplementar/aproximar el diseño en un segundo lugar que
// con el tiempo se hubiera desincronizado del original. `vendor` tiene que
// ser el mismo objeto enriquecido que devuelve GET /vendors/:slug (rating,
// reviewStats, isOpenNow, locations, etc. ya calculados del lado del
// backend) — TableOrder.jsx pide ese mismo endpoint con el slug que ya le
// da getTableByToken, así el banner es de verdad el mismo dato, no una
// aproximación. `tableLabel` es la única adición nueva sobre el original:
// un badge más en la fila de sub-badges, mismo estilo que "Restaurante".
// Bloque 170 (pedido explícito, con captura — "esto será lo único que se
// mostrará como barra superior cuando se escanee el QR"): revierte la
// paridad total del Bloque 166 — en la mesa, el cliente ya está físicamente
// ahí, así que compartir la tienda/reportarla/agregarla a favoritos/
// contactarla por WhatsApp y la franja de stats (rating, cantidad de
// productos, ubicación, desde cuándo, métodos de pago) no aportan nada,
// solo alargan la pantalla. `minimal` corta el banner a la zona de
// identidad únicamente (avatar, nombre, insignias, descripción) — Store.jsx
// sigue usando la versión completa de siempre, sin este prop.
export function StoreHeaderBanner({ vendor: v, tableLabel, minimal = false }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reportFraudOpen, setReportFraudOpen] = useState(false);

  const { data: favorites } = useQuery({
    queryKey: ["my-favorites"],
    queryFn: async () => (await api.get("/customers/me/favorites")).data.favorites,
    enabled: !!user && !minimal,
  });
  const myFavorite = favorites?.find((f) => f.vendorId === v?.id);

  const toggleFavorite = useMutation({
    mutationFn: async () =>
      myFavorite
        ? (await api.delete(`/customers/me/favorites/${myFavorite.id}`)).data
        : (await api.post("/customers/me/favorites", { vendorId: v.id })).data,
    onSuccess: () => {
      toast.success(myFavorite ? "Se quitó de tus favoritos." : "¡Agregada a tus favoritos!");
      queryClient.invalidateQueries({ queryKey: ["my-favorites"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar tus favoritos."),
  });

  function handleShare() {
    copyToClipboard(`${api.defaults.baseURL}/og/tienda/${v.slug}`)
      .then(showLinkCopiedToast)
      .catch(() => toast.error("No se pudo copiar el enlace."));
  }

  // Bloque 208 (pedido explícito — "el botón del corazón... siempre esté
  // visible, solo que si el cliente no está logeado lo enviará a crear una
  // cuenta o logearse"): antes el botón entero desaparecía sin sesión.
  function handleFavoriteClick() {
    if (!user) {
      navigate("/cuenta");
      return;
    }
    toggleFavorite.mutate();
  }

  const location = v.locations?.[0];
  const locationLabel = location ? `${location.municipality?.name ?? ""}, ${location.province?.name}` : "Cuba";
  const joinedYear = new Date(v.createdAt).getFullYear();
  // Bloque 207: patrón fijo por tienda (mismo id -> mismo patrón siempre),
  // nunca recalculado al azar en cada render.
  const iconPattern = useMemo(() => getBannerIconPattern(v), [v.id, v.isRestaurant, v.businessCategory?.slug]);

  return (
    <>
      {/* BANNER PROFESIONAL — a todo el ancho de la pantalla, esquinas
          cuadradas (pedido explícito, con captura de referencia — "al revés
          la parte de la información de la tienda o banner tendrá los bordes
          cuadrados y la sección que le sigue es la que tendrá los bordes
          superiores redondeados y se mostrará por encima del borde inferior
          del banner"): revierte el `rounded-b-[28px]` de antes — ahora la
          curva vive del lado de la sección de abajo (ver el div "hoja" que
          envuelve el contenido en Store.jsx/TableOrder.jsx, superpuesto con
          margen negativo), no acá.
          Bug real reportado en vivo — "no se ven las esquinas redondeadas":
          el radio SÍ estaba aplicado (confirmado con getComputedStyle), pero
          era imperceptible porque no había ningún color detrás de la curva
          para hacer contraste — el fondo de la página (bg-background) es
          CASI IDÉNTICO al bg-background de la propia hoja, así que la
          esquina redondeada "recortaba" contra un fondo del mismo color,
          invisible a simple vista. El colchón de color vacío que resuelve
          esto (mismo tamaño que rounded-t-[40px] en la hoja de abajo, ver
          Store.jsx/TableOrder.jsx) vive en el ÚLTIMO elemento visible de
          este banner, no en este contenedor raíz — 2ª vuelta, bug real
          reportado en vivo con captura: un `pb-10` acá en el contenedor
          raíz dejaba el colchón pintado solo con el degradado BASE, sin el
          `bg-black/25` que oscurece la franja de stats — se notaba una
          "costura"/salto de color entre la franja (oscura) y el colchón
          (degradado puro, más claro). Por eso el padding extra se aplica
          condicionalmente más abajo: en la franja de stats cuando existe
          (hereda su bg-black/25, sin costura), o en la zona superior cuando
          `minimal` la oculta (ahí no hay ninguna capa oscura de por medio,
          así que el degradado puro ya es continuo). Sin container-app
          envolviendo la sección entera — PublicLayout.jsx no le agrega
          padding a <main>, así que la sección llega sola hasta los bordes
          reales del viewport. container-app se corre adentro, solo en las
          2 franjas con contenido real, para que el texto siga alineado con
          el resto de la página. */}
      <div
        className="relative overflow-hidden"
        style={{
          background: `linear-gradient(150deg, ${v.color ?? "#232F3E"} 0%, ${v.color ? v.color + "dd" : "#1a2632"} 55%, #111827 100%)`,
        }}
      >
        {/* Bloque 207 (pedido explícito — "degradado con iconos de formas
            dentro... en diferentes posiciones y rotaciones, casi
            transparentes, llenando todo el contenedor"): reemplaza la foto
            de portada (retirada del panel de vendedor) por íconos de
            lucide-react (la misma librería de toda la app) temáticos al
            rubro de la tienda, ver vendorBannerIcons.js. */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {iconPattern.map(({ key, Icon, top, left, size, rotate, opacity, strokeWidth }) => (
            <Icon
              key={key}
              strokeWidth={strokeWidth}
              className="absolute text-white"
              style={{ top, left, width: size, height: size, transform: `translate(-50%, -50%) rotate(${rotate}deg)`, opacity }}
            />
          ))}
        </div>
        {/* Círculo decorativo de fondo — profundidad */}
        <div
          className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full opacity-10"
          style={{ background: "radial-gradient(circle, #ffffff 0%, transparent 70%)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-10 -left-10 h-48 w-48 rounded-full opacity-[0.07]"
          style={{ background: "radial-gradient(circle, #ffffff 0%, transparent 70%)" }}
        />

        {/* ── ZONA SUPERIOR: avatar + nombre + acciones ── */}
        {/* `minimal` (TableOrder.jsx) nunca muestra la franja de stats de
            abajo — el colchón para la curva de la hoja (ver el comentario
            largo más arriba) tiene que vivir acá en ese caso, como
            pb extra sobre el degradado base (sin ninguna capa oscura de
            por medio, así que no hay costura de color posible). */}
        <div className={`container-app relative flex flex-col gap-5 pt-5 sm:flex-row sm:items-center sm:justify-between sm:pt-6 ${minimal ? "pb-[60px]" : "pb-5"}`}>
          {/* Avatar + info de tienda */}
          <div className="flex items-center gap-4 sm:gap-5">
            <div
              className="relative flex h-[76px] w-[76px] flex-shrink-0 items-center justify-center rounded-full font-display text-[32px] font-extrabold text-white shadow-xl ring-1 ring-white/20 sm:h-[92px] sm:w-[92px] sm:text-[40px]"
              style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(8px)" }}
            >
              <span className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-full">
                {v.logoUrl ? (
                  <img src={imgUrl(v.logoUrl)} alt={v.companyName} className="h-full w-full object-cover" />
                ) : (
                  v.companyName[0]
                )}
              </span>
              <span
                className={`absolute bottom-0.5 right-0.5 h-4 w-4 rounded-full border-2 border-white shadow ${
                  v.isOpenNow ? "bg-verified" : "bg-outline"
                }`}
              />
            </div>

            {/* Nombre, categoría, descripción */}
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-1.5">
                <h1 className="font-display text-[22px] font-extrabold leading-tight text-white sm:text-[26px]">
                  {v.companyName}
                </h1>
                {v.isVerified && (
                  <span className="mt-0.5 flex-shrink-0 self-start">
                    <VerifiedBadge size="md" />
                  </span>
                )}
              </div>

              {/* Sub-badges: estado · categoría · mesa */}
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                    v.isOpenNow ? "bg-verified/20 text-verified-light" : "bg-white/10 text-white/60"
                  }`}
                >
                  {v.isOpenNow ? "Abierto ahora" : v.nextOpenLabel || "Cerrado ahora"}
                </span>
                {v.category?.name && (
                  <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-white/80">
                    {v.category.name}
                  </span>
                )}
                {v.isRestaurant && (
                  <span className="inline-flex items-center rounded-full bg-secondary-container/30 px-2.5 py-0.5 text-[11px] font-semibold text-secondary-container">
                    Restaurante
                  </span>
                )}
                {tableLabel && (
                  <span className="inline-flex items-center rounded-full bg-secondary-container/30 px-2.5 py-0.5 text-[11px] font-semibold text-secondary-container">
                    {tableLabel}
                  </span>
                )}
              </div>

              {/* Descripción */}
              {v.description && (
                <p className="mt-2 line-clamp-2 max-w-[500px] text-[13px] leading-relaxed text-white/65">{v.description}</p>
              )}
            </div>
          </div>

          {/* Botones de acción — alineados a la derecha */}
          {!minimal && (
            <div className="flex flex-shrink-0 items-center gap-2 sm:self-start sm:pt-1">
              <button
                onClick={handleShare}
                aria-label="Compartir tienda"
                title="Compartir tienda"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur-sm transition-colors hover:bg-white/20"
              >
                <Share2 className="h-[18px] w-[18px]" />
              </button>
              {user?.role === "CUSTOMER" && (
                <button
                  onClick={() => setReportFraudOpen(true)}
                  aria-label="Reportar estafa"
                  title="Reportar estafa"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur-sm transition-colors hover:bg-error/80 hover:text-white"
                >
                  <ShieldAlert className="h-[18px] w-[18px]" />
                </button>
              )}
              <button
                onClick={handleFavoriteClick}
                disabled={toggleFavorite.isPending}
                aria-label={myFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
                title={myFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
                className={`flex h-10 w-10 items-center justify-center rounded-full backdrop-blur-sm transition-colors disabled:opacity-60 ${
                  myFavorite ? "bg-white/20 text-white" : "bg-white/10 text-white/80 hover:bg-white/20"
                }`}
              >
                <Heart className={`h-[18px] w-[18px] ${myFavorite ? "fill-white" : "fill-none"}`} />
              </button>
              <a
                href={waLink(v.whatsapp, `Hola ${v.companyName}, tengo una consulta sobre sus productos.`)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-5 py-2.5 text-label-md font-bold text-white shadow-md transition-all hover:brightness-105 hover:shadow-lg active:scale-95"
              >
                <MessageCircle className="h-[17px] w-[17px]" />
                Contactar
              </a>
            </div>
          )}
        </div>

        {/* ── FRANJA INFERIOR: stats sobre fondo oscuro semitransparente ──
            pb-[52px] (14px propios + 40px de colchón) en vez de py-3.5:
            este bg-black/25 se extiende hasta cubrir todo el colchón de la
            curva de abajo, para que no haya costura de color entre la
            franja y el colchón (ver el comentario largo más arriba). */}
        {!minimal && (
          <div className="relative border-t border-white/10 bg-black/25 pb-[52px] pt-3.5">
            <div className="container-app flex flex-wrap items-center gap-x-5 gap-y-2.5">
              {/* Rating */}
              <div className="flex items-center gap-1.5">
                <StarRating value={Number(v.rating)} size="h-3.5 w-3.5" showValue className="text-white" />
                {v.reviewStats?.total > 0 && (
                  <span className="text-[12px] text-white/50">
                    ({v.reviewStats.total} reseña{v.reviewStats.total === 1 ? "" : "s"})
                  </span>
                )}
              </div>

              <span className="h-3.5 w-px bg-white/15" />

              {/* Productos */}
              <span className="text-[12.5px] text-white/70">
                <span className="font-bold text-white">{v.products?.length ?? 0}</span>{" "}
                producto{(v.products?.length ?? 0) === 1 ? "" : "s"}
              </span>

              <span className="h-3.5 w-px bg-white/15" />

              {/* Ubicación */}
              <span className="text-[12.5px] text-white/70">📍 {locationLabel}</span>

              <span className="h-3.5 w-px bg-white/15" />

              {/* Año */}
              <span className="text-[12.5px] text-white/70">
                Desde <span className="font-bold text-white">{joinedYear}</span>
              </span>

              {v.acceptedPaymentMethods?.length > 0 && (
                <>
                  <span className="h-3.5 w-px bg-white/15" />
                  <div className="flex flex-wrap items-center gap-1.5">
                    {v.acceptedPaymentMethods.map((methodId) => {
                      const method = resolvePaymentMethod(methodId);
                      const Icon = method.icon;
                      return (
                        <span
                          key={methodId}
                          className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/75"
                        >
                          <Icon className="h-2.5 w-2.5" />
                          {method.label}
                        </span>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {!minimal && (
        <ReportFraudModal
          open={reportFraudOpen}
          onClose={() => setReportFraudOpen(false)}
          targetField="vendorId"
          targetId={v.id}
          targetLabel={`la tienda "${v.companyName}"`}
        />
      )}
    </>
  );
}
