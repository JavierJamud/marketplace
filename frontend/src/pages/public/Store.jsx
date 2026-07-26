import { useState, useEffect, useRef } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { MessageCircle, ShieldAlert, Share2, Heart, Check, ShieldCheck, Star, Tag, Clock, Camera, X as XIcon } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatPrice } from "../../lib/format.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { waLink } from "../../lib/whatsapp.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { VerifiedBadge } from "../../components/ui/VerifiedBadge.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { AddToCartControl } from "../../components/AddToCartControl.jsx";
import { PageLoader } from "../../components/ui/PageLoader.jsx";
import { Store as StoreIcon } from "lucide-react";
import { resolvePaymentMethod } from "../../lib/paymentMethods.js";
import { resolveCurrency } from "../../lib/currencies.js";
import { StoreChatWidget } from "../../components/StoreChatWidget.jsx";
import { StarRating } from "../../components/ui/StarRating.jsx";
import { RequestProductButton } from "../../components/RequestProductButton.jsx";
import { Lightbox } from "../../components/ui/Lightbox.jsx";

const MAX_REVIEW_IMAGES = 4;

function discountBadgeLabel(discountCode) {
  if (!discountCode) return "";
  return discountCode.type === "PERCENTAGE" ? `-${Number(discountCode.value)}%` : `-${Number(discountCode.value).toLocaleString("es-CU")} CUP`;
}

// Bloque 52: cuenta regresiva en vivo para ofertas de tienda por tiempo
// limitado — mismo criterio de "reloj que corre solo" que remainingLabel en
// VendorOffers.jsx/OffersSlider.jsx, recalculado 1 vez por minuto.
function useLiveCountdown(expiresAt) {
  const [label, setLabel] = useState(null);
  useEffect(() => {
    if (!expiresAt) {
      setLabel(null);
      return;
    }
    function compute() {
      const ms = new Date(expiresAt).getTime() - Date.now();
      if (ms <= 0) return "Vencida";
      const days = Math.floor(ms / 86400000);
      const hours = Math.floor((ms % 86400000) / 3600000);
      if (days >= 1) return `Vence en ${days}d ${hours}h`;
      const minutes = Math.floor((ms % 3600000) / 60000);
      return `Vence en ${hours}h ${minutes}m`;
    }
    setLabel(compute());
    const id = setInterval(() => setLabel(compute()), 60000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return label;
}

function StoreOfferCard({ offer, vendorName }) {
  const countdown = useLiveCountdown(offer.isLimitedTime ? offer.expiresAt : null);

  function handleCopyCode() {
    navigator.clipboard
      .writeText(offer.discountCode.code)
      .then(() => toast.success(`¡Código "${offer.discountCode.code}" copiado!`))
      .catch(() => toast.error("No se pudo copiar el código."));
  }

  return (
    <div className="overflow-hidden rounded-[22px] bg-surface-container-lowest shadow-[0_1px_3px_rgba(27,27,29,0.07),0_1px_2px_rgba(27,27,29,0.05)] transition-shadow hover:shadow-lg">
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-surface-container">
        <img src={imgUrl(offer.imageUrl)} alt={offer.title} className="h-full w-full object-cover" />
        <span className="absolute right-2.5 top-2.5 rounded-full bg-error px-2.5 py-1 text-[11px] font-bold text-white shadow">
          {discountBadgeLabel(offer.discountCode)}
        </span>
        {offer.isLimitedTime && countdown && (
          <span className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[10.5px] font-bold text-white">
            <Clock className="h-3 w-3" /> {countdown}
          </span>
        )}
      </div>
      <div className="p-4">
        <div className="mb-1 text-[14.5px] font-bold text-on-surface">{offer.title}</div>
        {offer.description && <p className="mb-3 text-[12.5px] leading-5 text-on-surface-variant">{offer.description}</p>}
        <button
          onClick={handleCopyCode}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-tertiary-accent/50 bg-tertiary-accent/[0.06] py-2.5 text-[13px] font-bold text-tertiary-accent hover:bg-tertiary-accent/10"
        >
          <Tag className="h-3.5 w-3.5" /> Código: {offer.discountCode.code} · {discountBadgeLabel(offer.discountCode)}
        </button>
      </div>
    </div>
  );
}

// Bloque 51: mismo criterio "...leer más" que ProductCard.jsx — acá no se
// reusa ese componente directamente porque estas dos grillas (disponibles /
// agotados) usan botones de acción distintos (AddToCartControl vs.
// RequestProductButton) y un tratamiento de imagen distinto (grayscale en
// agotados), así que se repite solo este pedacito. Estado propio por
// tarjeta: no se puede usar useState directo dentro de un .map().
function ExpandableDescription({ text }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  return (
    <div className="mb-1.5">
      <p className={`text-[12px] leading-4 text-outline ${expanded ? "" : "line-clamp-1"}`}>{text}</p>
      {text.length > 45 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] font-bold text-tertiary-accent hover:underline"
        >
          {expanded ? "leer menos" : "...leer más"}
        </button>
      )}
    </div>
  );
}

// Bloque 22: confirmación de "Compartir" más elaborada que un toast.success
// de una línea — ícono propio + título + instrucción, con cierre manual.
function showLinkCopiedToast() {
  toast.custom(
    (t) => (
      <div className={`flex max-w-sm items-start gap-3 rounded-lg border border-surface-container-high bg-surface-container-lowest p-4 shadow-lg ${t.visible ? "animate-fade-up" : "opacity-0"}`}>
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-verified/15">
          <Check className="h-5 w-5 text-verified-dark" />
        </span>
        <div className="flex-1">
          <div className="text-label-md font-bold text-on-surface">¡Enlace copiado!</div>
          <p className="mt-0.5 text-[12.5px] text-on-surface-variant">Pegalo donde quieras — WhatsApp, redes sociales o mensaje directo — para compartir esta tienda.</p>
        </div>
        <button onClick={() => toast.dismiss(t.id)} className="flex-shrink-0 text-outline hover:text-on-surface-variant">
          ✕
        </button>
      </div>
    ),
    { duration: 5000 }
  );
}

// Estadísticas claras (Bloque 22): promedio + desglose de 5→1 estrellas,
// calculado en el backend sobre reseñas reales (getVendorBySlug ->
// reviewStats) — nunca un número inventado.
function RatingBreakdown({ rating, stats }) {
  if (!stats || stats.total === 0) return null;
  return (
    <div className="mb-6 flex max-w-[720px] flex-col gap-5 rounded-md border border-surface-container-high bg-surface-container-lowest p-5 sm:flex-row sm:items-center">
      <div className="flex flex-shrink-0 flex-col items-center justify-center sm:w-[130px] sm:border-r sm:border-surface-container-high sm:pr-5">
        <div className="font-display text-3xl font-extrabold text-on-surface">{Number(rating).toFixed(1)}</div>
        <div className="my-1">
          <StarRating value={rating} size="h-4 w-4" />
        </div>
        <div className="text-label-sm text-outline">
          {stats.total} reseña{stats.total === 1 ? "" : "s"}
        </div>
      </div>
      <div className="flex-1 space-y-1.5">
        {[5, 4, 3, 2, 1].map((n) => {
          const count = stats.breakdown[n] ?? 0;
          const pct = stats.total ? Math.round((count / stats.total) * 100) : 0;
          return (
            <div key={n} className="flex items-center gap-2.5 text-[12px]">
              <span className="w-9 flex-shrink-0 font-semibold text-on-surface-variant">{n} ★</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container">
                <div className="h-full rounded-full bg-secondary-container" style={{ width: `${pct}%` }} />
              </div>
              <span className="w-6 flex-shrink-0 text-right text-outline">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" });
}

// Mismo umbral que LOW_STOCK_THRESHOLD en ProductCard.jsx/VendorProducts.jsx.
const LOW_STOCK_THRESHOLD = 3;

export default function Store() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { siteName } = usePlatformSettings();
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState("");
  const [commentRating, setCommentRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  // Bloque 52: fotos adjuntas al comentario — solo tiendas verificadas
  // (el selector ni se renderiza si no lo está, ver más abajo).
  const [reviewImages, setReviewImages] = useState([]); // File[]
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const trackedVisitRef = useRef(null);
  const reviewsRef = useRef(null);

  const { data, isLoading } = useQuery({
    queryKey: ["vendor", slug],
    queryFn: async () => (await api.get(`/vendors/${slug}`)).data.vendor,
  });

  // Bloque 22: se reusa la misma query que CustomerPanel.jsx (misma
  // queryKey) — favoritear una tienda desde acá y verla ya listada en el
  // panel (o al revés) no pide un segundo fetch, React Query comparte el
  // cache.
  const { data: favorites } = useQuery({
    queryKey: ["my-favorites"],
    queryFn: async () => (await api.get("/customers/me/favorites")).data.favorites,
    enabled: !!user,
  });
  const myFavorite = favorites?.find((f) => f.vendorId === data?.id);

  const toggleFavorite = useMutation({
    mutationFn: async () =>
      myFavorite
        ? (await api.delete(`/customers/me/favorites/${myFavorite.id}`)).data
        : (await api.post("/customers/me/favorites", { vendorId: data.id })).data,
    onSuccess: () => {
      toast.success(myFavorite ? "Se quitó de tus favoritos." : "¡Agregada a tus favoritos!");
      queryClient.invalidateQueries({ queryKey: ["my-favorites"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar tus favoritos."),
  });

  // Tracking mínimo para "clientes potenciales" del dashboard de vendedor —
  // solo clientes logueados, una vez por visita a la tienda, sin bloquear la
  // UI si falla.
  useEffect(() => {
    if (!data || user?.role !== "CUSTOMER" || trackedVisitRef.current === data.id) return;
    trackedVisitRef.current = data.id;
    api.post(`/vendors/${data.id}/engagement`, { type: "VISIT" }).catch(() => {});
  }, [data, user]);

  const { data: otherVendors } = useQuery({
    queryKey: ["other-vendors", slug],
    queryFn: async () => (await api.get("/vendors")).data.vendors,
    enabled: !!data,
  });

  const postComment = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("vendorId", data.id);
      form.append("comment", commentText.trim());
      if (commentRating) form.append("rating", String(commentRating));
      reviewImages.forEach((file) => form.append("images", file));
      return (await api.post("/reviews", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      setCommentText("");
      setCommentRating(0);
      setReviewImages([]);
      toast.success("¡Comentario publicado!");
      queryClient.invalidateQueries({ queryKey: ["vendor", slug] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo publicar el comentario."),
  });

  // Bloque 52: dejar una reseña (con o sin imagen) requiere estar logueado
  // como cliente — antes el input solo se deshabilitaba, ahora redirige a
  // /cuenta con retorno automático a esta misma tienda.
  function goToReviewLogin() {
    navigate(`/cuenta?next=${encodeURIComponent(`/tienda/${slug}#resenas`)}`);
  }

  function handleReviewImageSelect(e) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setReviewImages((prev) => {
      const next = [...prev, ...files].slice(0, MAX_REVIEW_IMAGES);
      if (prev.length + files.length > MAX_REVIEW_IMAGES) {
        toast.error(`Hasta ${MAX_REVIEW_IMAGES} fotos por reseña.`);
      }
      return next;
    });
  }

  function removeReviewImage(index) {
    setReviewImages((prev) => prev.filter((_, i) => i !== index));
  }

  function handleShare() {
    navigator.clipboard
      .writeText(window.location.href)
      .then(showLinkCopiedToast)
      .catch(() => toast.error("No se pudo copiar el enlace."));
  }

  // Si venimos de /cuenta?next=...#resenas tras loguearnos, llevar la vista
  // directo a la sección de comentarios.
  useEffect(() => {
    if (window.location.hash === "#resenas" && reviewsRef.current) {
      reviewsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [data]);

  if (isLoading) return <PageLoader label="Cargando tienda..." />;
  if (!data) {
    return (
      <div className="container-app py-14">
        <EmptyState
          icon={StoreIcon}
          title="Tienda no encontrada"
          description="Puede que el enlace esté vencido o la tienda ya no exista."
          action={
            <Link to="/tiendas" className="rounded bg-primary-container px-5 py-2.5 text-label-md font-bold text-white hover:brightness-95">
              Ver todas las tiendas →
            </Link>
          }
        />
      </div>
    );
  }

  const v = data;
  const location = v.locations?.[0];
  const locationLabel = location ? `${location.municipality?.name ?? ""}, ${location.province?.name}` : "Cuba";
  const joinedYear = new Date(v.createdAt).getFullYear();
  const firstTable = v.tables?.[0];
  // Bloque 23: la grilla principal solo muestra lo que se puede comprar ya
  // mismo — lo agotado se separa en "Próximamente disponibles" más abajo,
  // con botón "Solicitar" en vez de "Agregar al carrito".
  const availableProducts = v.products?.filter((p) => p.stock > 0) ?? [];
  const outOfStockProducts = v.products?.filter((p) => p.stock <= 0) ?? [];

  return (
    <div>
      {/* BANNER */}
      <div style={{ background: v.color ?? "#232F3E" }}>
        {/* Bloque 52 (fix de alineación): antes `items-end` alineaba el
            avatar contra el borde INFERIOR del bloque de texto entero — en
            mobile, donde la descripción + stats ocupan varias líneas, el
            avatar quedaba flotando lejos del título, con un hueco arriba que
            se veía "desagrupado". Ahora el avatar y el título van siempre
            juntos (items-center en su propia fila) sin importar cuánto texto
            haya debajo; los botones de acción pasan a su propia fila,
            apilados en mobile y alineados a la derecha desde `sm:`. */}
        <div className="container-app flex flex-col gap-5 py-8 sm:flex-row sm:items-start sm:justify-between sm:py-9">
          <div className="flex items-center gap-4">
            <div className="flex h-[72px] w-[72px] flex-shrink-0 items-center justify-center rounded-full border-[3px] border-white/50 bg-white/10 font-display text-3xl font-extrabold text-white sm:h-[88px] sm:w-[88px] sm:text-4xl">
              {v.companyName[0]}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-headline-lg-mobile text-white sm:text-headline-md">{v.companyName}</h1>
                {v.isVerified && <VerifiedBadge />}
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                    v.isOpenNow ? "bg-verified/20 text-white" : "bg-black/25 text-white/85"
                  }`}
                >
                  {v.isOpenNow ? "Abierto ahora" : "Cerrado ahora"}
                </span>
              </div>
              {v.description && <p className="mt-2 max-w-[560px] text-[13.5px] text-white/80">{v.description}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-x-[18px] gap-y-2 text-[13px] text-white/85">
                <StarRating value={Number(v.rating)} size="h-3.5 w-3.5" showValue />
                <span>{v.salesCount} ventas</span>
                <span>📍 {locationLabel}</span>
                <span>Desde {joinedYear}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2.5">
            <button
              onClick={handleShare}
              aria-label="Compartir tienda"
              title="Compartir tienda"
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
            >
              <Share2 className="h-[18px] w-[18px]" />
            </button>
            {user && (
              <button
                onClick={() => toggleFavorite.mutate()}
                disabled={toggleFavorite.isPending}
                aria-label={myFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
                title={myFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 disabled:opacity-60"
              >
                <Heart className={`h-[18px] w-[18px] ${myFavorite ? "fill-white" : "fill-none"}`} />
              </button>
            )}
            <a
              href={waLink(v.whatsapp, `Hola ${v.companyName}, tengo una consulta sobre sus productos.`)}
              target="_blank"
              rel="noreferrer"
              className="flex flex-1 items-center justify-center gap-2 rounded bg-[#25D366] px-5 py-3 text-label-md font-bold text-white sm:flex-initial"
            >
              <MessageCircle className="h-[18px] w-[18px]" /> Contactar
            </a>
          </div>
        </div>
      </div>

      {/* RESTAURANTE: menú QR */}
      {v.isRestaurant && firstTable && (
        <div className="container-app pt-5">
          <Link
            to={`/mesa/${firstTable.qrToken}`}
            className="flex items-center justify-between rounded-md border border-l-4 border-surface-container-high border-l-secondary-container bg-surface-container-lowest px-5 py-4"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">🍽️</span>
              <div>
                <div className="text-[14.5px] font-bold text-on-surface">Menú de mesa con QR</div>
                <div className="text-[12.5px] text-outline">Escanea el QR de tu mesa o mira el menú online</div>
              </div>
            </div>
            <span className="text-label-md font-bold text-tertiary-accent">Ver menú →</span>
          </Link>
        </div>
      )}

      {/* PRODUCTOS */}
      <div className="container-app pt-8">
        <h2 className="mb-5 font-display text-title-lg text-on-surface">Productos de {v.companyName}</h2>
        {availableProducts.length ? (
          <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
            {availableProducts.map((p) => (
              <div
                key={p.id}
                className="group overflow-hidden rounded-[26px] bg-surface-container-lowest shadow-[0_1px_3px_rgba(27,27,29,0.07),0_1px_2px_rgba(27,27,29,0.05)] transition-shadow hover:shadow-lg"
              >
                <Link to={`/producto/${v.slug}/${p.slug}`} className="block p-2.5 pb-0">
                  <div className="aspect-[12/7] w-full overflow-hidden rounded-[16px] border-2 border-dashed border-outline-variant bg-surface-container">
                    {p.images?.[0] ? (
                      <img src={imgUrl(p.images[0])} alt={p.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-label-sm text-outline">Sin foto</div>
                    )}
                  </div>
                </Link>
                <div className="p-3.5 pt-2.5">
                  <Link to={`/producto/${v.slug}/${p.slug}`} className="mb-1 block text-[13.5px] font-bold leading-[18px] text-on-surface">
                    {p.name}
                  </Link>
                  <ExpandableDescription text={p.description} />
                  {p.stock <= LOW_STOCK_THRESHOLD && (
                    <span className="mb-1.5 inline-block w-fit rounded-full bg-[#8a5100]/10 px-2 py-0.5 text-[10px] font-bold text-[#8a5100]">
                      ¡Últimas {p.stock} unidades!
                    </span>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] font-bold text-on-surface">{formatPrice(p.price, p.currency)}</span>
                    <AddToCartControl product={{ ...p, vendorId: v.id, vendor: v }} size="sm" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-body-md text-on-surface-variant">
            {outOfStockProducts.length
              ? "Todos los productos de esta tienda están agotados por ahora — mira “Próximamente disponibles” más abajo."
              : "Esta tienda todavía no publicó productos."}
          </p>
        )}
      </div>

      {/* PRÓXIMAMENTE DISPONIBLES (Bloque 23) — productos sin stock, con
          botón "Solicitar" en vez de "Agregar al carrito". */}
      {outOfStockProducts.length > 0 && (
        <div className="container-app pt-11">
          <h2 className="mb-1 font-display text-title-lg text-on-surface">Próximamente disponibles</h2>
          <p className="mb-5 text-label-sm text-outline">Sin stock por ahora — solicitalos y le avisamos a la tienda que te interesan.</p>
          <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
            {outOfStockProducts.map((p) => (
              <div
                key={p.id}
                className="overflow-hidden rounded-[26px] bg-surface-container-lowest shadow-[0_1px_3px_rgba(27,27,29,0.07),0_1px_2px_rgba(27,27,29,0.05)]"
              >
                <Link to={`/producto/${v.slug}/${p.slug}`} className="block p-2.5 pb-0">
                  <div className="relative aspect-[12/7] w-full overflow-hidden rounded-[16px] border-2 border-dashed border-outline-variant bg-surface-container">
                    {p.images?.[0] ? (
                      <img src={imgUrl(p.images[0])} alt={p.name} className="h-full w-full object-cover grayscale" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-label-sm text-outline">Sin foto</div>
                    )}
                    <span className="absolute left-2 top-2 rounded-full bg-[#ba1a1a] px-2.5 py-1 text-[10.5px] font-bold text-white shadow">
                      Sin stock
                    </span>
                  </div>
                </Link>
                <div className="p-3.5 pt-2.5">
                  <Link to={`/producto/${v.slug}/${p.slug}`} className="mb-1.5 block text-[13.5px] font-bold leading-[18px] text-on-surface">
                    {p.name}
                  </Link>
                  <ExpandableDescription text={p.description} />
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] font-bold text-on-surface">{formatPrice(p.price, p.currency)}</span>
                    <RequestProductButton productId={p.id} size="sm" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FORMAS DE PAGO (Bloque 14 — informativo, ZeuDin no procesa nada) */}
      {v.acceptedPaymentMethods?.length > 0 && (
        <div className="container-app pt-11">
          <h2 className="mb-1 font-display text-title-lg text-on-surface">Formas de pago que acepta esta tienda</h2>
          <p className="mb-4 flex items-start gap-1.5 text-label-sm text-outline">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-tertiary-accent" />
            Coordinas el pago directo con {v.companyName} — {siteName} no cobra ni interviene en la transacción.
          </p>
          <div className="flex flex-wrap gap-2.5">
            {v.acceptedPaymentMethods.map((methodId) => {
              const method = resolvePaymentMethod(methodId);
              const Icon = method.icon;
              return (
                <span
                  key={methodId}
                  className="flex items-center gap-1.5 rounded-full border border-surface-container-high bg-surface-container-lowest px-3.5 py-2 text-[12.5px] font-semibold text-on-surface-variant"
                >
                  <Icon className="h-3.5 w-3.5 text-tertiary-accent" /> {method.label}
                </span>
              );
            })}
          </div>
          {/* Bloque 47 (ver decisión B): informativo, mismo criterio que
              acceptedPaymentMethods de arriba — sin conversión real, los
              precios de catálogo siguen siempre en CUP. Solo se muestra si
              hay más de una moneda cargada (CUP solo es el caso trivial). */}
          {v.acceptedCurrencies?.length > 1 && (
            <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[12.5px] text-on-surface-variant">
              Acepta pagos en:
              {v.acceptedCurrencies.map((code) => {
                const currency = resolveCurrency(code);
                return (
                  <span key={code} className="inline-flex items-center gap-1 font-semibold text-on-surface">
                    <currency.icon className="h-3 w-3 text-tertiary-accent" /> {currency.label}
                  </span>
                );
              })}
            </p>
          )}
        </div>
      )}

      {/* PAÍSES DE ENTREGA (Bloque 19) — además de Cuba, a qué otros países
          declaró esta tienda que entrega. */}
      {v.deliveryCountries?.length > 0 && (
        <div className="container-app pt-11">
          <h2 className="mb-1 font-display text-title-lg text-on-surface">Países de entrega</h2>
          <p className="mb-4 text-label-sm text-outline">Además de Cuba, {v.companyName} declara que entrega a:</p>
          <div className="flex flex-wrap gap-2.5">
            {v.deliveryCountries.map((dc) => (
              <span
                key={dc.id}
                className="flex items-center gap-1.5 rounded-full border border-surface-container-high bg-surface-container-lowest px-3.5 py-2 text-[12.5px] font-semibold text-on-surface-variant"
              >
                🌎 {dc.country?.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* OFERTAS DE TIENDA (Bloque 52) — distinta de la sección "Ofertas" del
          Home: esta vive DENTRO de cada tienda, solo visible si tiene al
          menos una StoreOffer activa. */}
      {v.storeOffers?.length > 0 && (
        <div className="container-app pt-11">
          <h2 className="mb-1 font-display text-title-lg text-on-surface">Ofertas</h2>
          <p className="mb-5 text-label-sm text-outline">Descuentos exclusivos de {v.companyName} — aplica el código en el carrito.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {v.storeOffers.map((offer) => (
              <StoreOfferCard key={offer.id} offer={offer} vendorName={v.companyName} />
            ))}
          </div>
        </div>
      )}

      {/* COMENTARIOS */}
      <div ref={reviewsRef} id="resenas" className="container-app pt-11">
        <h2 className="mb-1 font-display text-title-lg text-on-surface">Comentarios de compradores</h2>
        <p className="mb-5 text-label-sm text-outline">Públicos y visibles para todos. Solo compradores registrados pueden comentar.</p>

        <RatingBreakdown rating={v.rating} stats={v.reviewStats} />

        <div className="mb-6 max-w-[720px] rounded-md border border-surface-container-high bg-surface-container-lowest p-4">
          {user && (
            <div className="mb-2.5 flex items-center gap-2.5">
              <span className="text-label-sm text-on-surface-variant">Tu calificación (opcional):</span>
              <div className="flex gap-0.5" onMouseLeave={() => setHoverRating(0)}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setCommentRating(n === commentRating ? 0 : n)} onMouseEnter={() => setHoverRating(n)}>
                    <Star
                      className={`h-5 w-5 ${
                        n <= (hoverRating || commentRating) ? "fill-secondary-container text-secondary-container" : "fill-none text-outline-variant"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2.5">
            <input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onFocus={() => {
                if (!user) goToReviewLogin();
              }}
              placeholder={user ? "Escribe un comentario..." : "Inicia sesión para comentar"}
              className="h-11 flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3.5 text-body-md outline-none"
            />
            <button
              onClick={() => {
                if (!user) return goToReviewLogin();
                if (commentText.trim()) postComment.mutate();
              }}
              disabled={(user && !commentText.trim()) || postComment.isPending}
              className="rounded bg-primary-container px-5 text-label-md font-bold text-white disabled:opacity-50"
            >
              Publicar
            </button>
          </div>

          {/* Bloque 52: fotos en la reseña — solo tiendas VERIFICADAS. En
              tiendas no verificadas el formulario sigue igual que antes, sin
              esta opción. */}
          {user && v.isVerified && (
            <div className="mt-3 border-t border-surface-container-high pt-3">
              <div className="flex flex-wrap items-center gap-2.5">
                {reviewImages.map((file, i) => (
                  <div key={i} className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border border-outline-variant">
                    <img src={URL.createObjectURL(file)} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeReviewImage(i)}
                      className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {reviewImages.length < MAX_REVIEW_IMAGES && (
                  <label className="flex h-14 w-14 flex-shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-outline-variant text-outline hover:bg-surface-container">
                    <Camera className="h-4 w-4" />
                    <span className="text-[9px] font-semibold">Foto</span>
                    <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={handleReviewImageSelect} />
                  </label>
                )}
              </div>
              <p className="mt-1.5 text-[11px] text-outline">Hasta {MAX_REVIEW_IMAGES} fotos reales tuyas del producto/pedido (opcional).</p>
            </div>
          )}
        </div>

        <div className="flex max-w-[720px] flex-col gap-3.5">
          {v.reviews?.length ? (
            v.reviews.map((c) => (
              <div key={c.id} className="rounded-md border border-surface-container-high bg-surface-container-lowest p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2.5">
                  <div className="h-[34px] w-[34px] rounded-full bg-surface-container-highest" />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-label-md font-bold text-on-surface">{c.authorName}</span>
                      {c.isVerifiedPurchase && (
                        <span className="flex items-center gap-1 rounded-full bg-verified/10 px-2 py-0.5 text-[10.5px] font-bold text-verified-dark">
                          <ShieldCheck className="h-3 w-3" /> Compra verificada
                        </span>
                      )}
                    </div>
                    <div className="text-[11.5px] text-outline">{formatDate(c.createdAt)}</div>
                  </div>
                  {c.rating && <StarRating value={c.rating} size="h-3.5 w-3.5" />}
                </div>
                <p className="text-[13.5px] leading-5 text-on-surface-variant">{c.comment}</p>

                {c.images?.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {c.images.map((img, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setLightboxSrc(imgUrl(img))}
                        className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-surface-container-high"
                      >
                        <img src={imgUrl(img)} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}

                {c.vendorReply && (
                  <div className="mt-3 rounded-md bg-surface-container p-3">
                    <div className="mb-1 text-[12px] font-bold text-tertiary-accent">Respuesta de {v.companyName}</div>
                    <p className="text-[13px] leading-5 text-on-surface-variant">{c.vendorReply}</p>
                  </div>
                )}
              </div>
            ))
          ) : (
            <p className="text-body-md text-on-surface-variant">Todavía no hay comentarios.</p>
          )}
        </div>
      </div>

      {/* OTRAS TIENDAS */}
      <div className="container-app py-11">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-title-lg text-on-surface">Otras tiendas</h2>
          <Link to="/tiendas" className="text-label-md font-semibold text-tertiary-accent">Ver todas →</Link>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {otherVendors?.filter((x) => x.id !== v.id).slice(0, 4).map((x) => (
            <Link key={x.id} to={`/tienda/${x.slug}`} className="flex items-center gap-3 rounded-md border border-surface-container-high bg-surface-container-lowest p-4">
              <div
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full font-display text-base font-bold text-white"
                style={{ background: x.color ?? "#232F3E" }}
              >
                {x.companyName[0]}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-bold text-on-surface">{x.companyName}</div>
                <div className="flex items-center gap-1.5 text-[11.5px] text-outline">
                  <StarRating value={Number(x.rating)} size="h-3 w-3" showValue />
                  <span>· {x._count?.products ?? 0} prod.</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Bloque 25: aiAvailable = Gemini o Groq activo/configurado en
          AdminIntegrations — sin ninguno de los dos, el widget ni se monta
          (en vez de mostrar un botón que solo lleva a un error). */}
      {v.isVerified && v.aiAvailable && <StoreChatWidget vendor={v} />}

      <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}
