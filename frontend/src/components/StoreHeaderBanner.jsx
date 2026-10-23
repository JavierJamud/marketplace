import { useState } from "react";
import { vendorZoneLabel } from "../lib/zoneLabel.js";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatPrice } from "../lib/format.js";
import { StoreSocialLinks } from "./SocialLinks.jsx";
import { Share2, MessageCircle, ShieldAlert, Heart, MapPin, Package, CalendarDays, Truck } from "lucide-react";
import toast from "../lib/toast.jsx";
import { api } from "../lib/api.js";
import { copyToClipboard } from "../lib/clipboard.js";
import { waLink } from "../lib/whatsapp.js";
import { resolvePaymentMethod } from "../lib/catalog.js";
import { useAuth } from "../context/AuthContext.jsx";
import { VerifiedBadge } from "./ui/VerifiedBadge.jsx";
import { CategoryIcon } from "./ui/CategoryIcon.jsx";
import { StarRating } from "./ui/StarRating.jsx";
import { ReportFraudModal } from "./ReportFraudModal.jsx";
import { BannerIcons } from "./BannerIcons.jsx";

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

function showLinkCopiedToast() {
  toast.success(
    "¡Enlace copiado!",
    "Pégalo donde quieras (WhatsApp, redes sociales o mensaje directo) para compartir esta tienda.",
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
export function StoreHeaderBanner({ vendor: v, tableLabel, minimal = false, underHeader = true }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reportFraudOpen, setReportFraudOpen] = useState(false);
  // Reseñas con estrellas visibles: el desglose de la página de la tienda o, si no viene, el contador guardado.
  const reviewTotal = v.reviewStats?.total ?? v.reviewCount ?? 0;

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
    // El enlace público de la tienda. La vista previa (imagen, título) para WhatsApp o Facebook la pone el servidor: Nginx
    // les entrega /api/og/tienda/... a esos bots cuando abren esta misma dirección, así que no hace falta compartir aquella.
    copyToClipboard(`${window.location.origin}/tienda/${encodeURIComponent(v.slug)}`)
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

  // Todos los municipios donde presta servicio, no solo el primero (antes una tienda de varios municipios mostraba uno solo).
  const locationLabel = vendorZoneLabel(v.locations) || "Cuba";
  // El sello va pegado a la última palabra del nombre: así nunca queda solo en otra línea ni flotando a la derecha.
  const nameWords = v.companyName.trim().split(/\s+/);
  const nameLast = nameWords.pop();
  const joinedYear = new Date(v.createdAt).getFullYear();

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
      {/* Bloque 249 (pedido explícito — "la barra de menú no debe verse sobre un
          fondo blanco: sube el color del banner hasta arriba de la pantalla,
          por debajo de la barra de menú"): el menú es una píldora flotante que
          ocupa un hueco de 76px arriba (ver Header.jsx). Con -mt-[76px] el
          fondo del banner se estira hacia ese hueco y pt-[76px] devuelve el
          contenido a su lugar de siempre (misma técnica del hero del Home).
          `underHeader={false}` en /mesa/*, donde el menú no se monta. */}
      <div
        className={`relative overflow-hidden ${underHeader ? "-mt-[76px] pt-[76px]" : ""}`}
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
        <BannerIcons vendor={v} />
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
        <div className={`container-app relative flex flex-col gap-4 pt-5 sm:flex-row sm:items-start sm:justify-between sm:pt-6 ${minimal ? "pb-[60px]" : "pb-5"}`}>
          {/* Logo delante del nombre en una sola fila y la descripción debajo a todo el ancho: en el celular el logo ya no
              queda centrado contra un bloque de texto largo. */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3.5 sm:gap-5">
              <div className="relative h-[68px] w-[68px] flex-shrink-0 sm:h-[92px] sm:w-[92px]">
                <span
                  className="flex h-full w-full items-center justify-center overflow-hidden rounded-full font-display text-[28px] font-extrabold text-white shadow-xl ring-2 ring-white/30 sm:text-[40px]"
                  style={{ background: v.logoUrl ? "#fff" : v.color ?? "rgba(255,255,255,0.12)" }}
                >
                  {v.logoUrl ? <img src={imgUrl(v.logoUrl)} alt={`Logo de ${v.companyName}`} className="h-full w-full object-cover" /> : v.companyName[0]}
                </span>
                <span
                  title={v.isOpenNow ? "Abierto ahora" : "Cerrado ahora"}
                  className={`absolute bottom-0.5 right-0.5 h-4 w-4 rounded-full border-[2.5px] border-white shadow sm:bottom-1.5 sm:right-1.5 ${
                    v.isOpenNow ? "bg-verified" : "bg-outline"
                  }`}
                />
              </div>

              <div className="min-w-0 flex-1">
                <h1 className="break-words font-display text-[21px] font-extrabold leading-tight text-white sm:text-[26px]">
                  {nameWords.length > 0 && <>{nameWords.join(" ")} </>}
                  <span className="whitespace-nowrap">
                    {nameLast}
                    {v.isVerified && <VerifiedBadge size="md" className="ml-1.5 align-[-0.15em] sm:h-6 sm:w-6" />}
                  </span>
                </h1>

              {/* Sello a la vista (más claro que el ícono solo) · estado · categoría · mesa */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:gap-2">
                {/* Rubro de la tienda con su ícono, en la pastilla blanca (antes decía "Tienda verificada"; el sello ya va junto
                    al nombre). */}
                {v.businessCategory?.name && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-[11px] font-extrabold text-primary shadow-sm">
                    <CategoryIcon name={v.businessCategory.icon} className="h-3.5 w-3.5 text-tertiary-accent" />
                    {v.businessCategory.name}
                  </span>
                )}
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                    v.isOpenNow ? "bg-verified/20 text-[#7dffb0]" : "bg-white/10 text-white/90"
                  }`}
                >
                  {v.isOpenNow ? "Abierto ahora" : v.nextOpenLabel || "Cerrado ahora"}
                </span>
                {v.category?.name && (
                  <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-white/90">
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
              </div>
            </div>

            {/* Descripción en un bloque con el mismo fondo que la franja de datos de abajo (bg-black/25), redondeado como el
                resto de las tarjetas del sitio. */}
            {v.description && (
              <div className="mt-3 max-w-[680px] rounded-2xl bg-black/25 px-4 py-3 sm:ml-[112px]">
                {/* El recorte va en el texto, no en la caja: con el relleno en el mismo elemento asomaba media cuarta línea. */}
                <p className="line-clamp-3 text-[13px] leading-relaxed text-white/90">{v.description}</p>
              </div>
            )}
            {/* Redes de la tienda: solo las que la tienda puso (ver SocialLinks.jsx). */}
            <StoreSocialLinks links={v.socialLinks} storeName={v.companyName} className="mt-2 -ml-1 sm:ml-[108px]" />
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
                className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-5 py-2.5 text-label-md font-bold text-primary shadow-md transition-all hover:brightness-105 hover:shadow-lg active:scale-95"
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
              {/* Promedio real de las reseñas visibles; sin reseñas no se muestran estrellas (antes salía 5.0 sin ninguna). */}
              <div className="flex items-center gap-1.5">
                {reviewTotal > 0 ? (
                  <>
                    <StarRating value={Number(v.rating)} size="h-3.5 w-3.5" showValue className="text-white" />
                    <span className="text-[12px] text-white/90">
                      ({reviewTotal} reseña{reviewTotal === 1 ? "" : "s"})
                    </span>
                  </>
                ) : (
                  <span className="text-[12.5px] text-white/75">Sin reseñas todavía</span>
                )}
              </div>

              {/* Sin separadores verticales: al pasar a otra línea en el celular quedaban sueltos al inicio. */}
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-white/75">
                <Package className="h-3.5 w-3.5 text-white/60" aria-hidden="true" />
                <span className="font-bold text-white">{v.products?.length ?? 0}</span>
                producto{(v.products?.length ?? 0) === 1 ? "" : "s"}
              </span>

              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-white/75">
                <MapPin className="h-3.5 w-3.5 text-white/60" aria-hidden="true" />
                {locationLabel}
              </span>

              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-white/75">
                <CalendarDays className="h-3.5 w-3.5 text-white/60" aria-hidden="true" />
                Desde <span className="font-bold text-white">{joinedYear}</span>
              </span>

              {/* Envío de toda la tienda (si lo tiene): manda sobre el de cada producto, ver lib/shipping.js. */}
              {v.storeShippingMode && (
                <span className="inline-flex items-center gap-1.5 text-[12.5px] text-white/75">
                  <Truck className="h-3.5 w-3.5 text-white/60" aria-hidden="true" />
                  {v.storeShippingMode === "FIXED" ? (
                    <>
                      Envío{" "}
                      <span className="font-bold text-white">
                        {Number(v.storeShippingLocal) === Number(v.storeShippingOther)
                          ? formatPrice(v.storeShippingLocal, v.storeShippingCurrency)
                          : `desde ${formatPrice(Math.min(Number(v.storeShippingLocal), Number(v.storeShippingOther)), v.storeShippingCurrency)}`}
                      </span>{" "}
                      por pedido
                    </>
                  ) : (
                    "Envío a coordinar"
                  )}
                </span>
              )}

              {v.acceptedPaymentMethods?.length > 0 && (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {v.acceptedPaymentMethods.map((methodId) => {
                      const method = resolvePaymentMethod(methodId);
                      const Icon = method.icon;
                      return (
                        <span
                          key={methodId}
                          className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/90"
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
