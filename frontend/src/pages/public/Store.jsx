import { useState, useEffect, useRef } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { ShieldAlert, Star, Tag, Clock, Camera, Zap, X as XIcon } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatPrice } from "../../lib/format.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { describeReviewLimit } from "../../lib/reviewPolicy.js";
import { copyToClipboard } from "../../lib/clipboard.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { AddToCartControl } from "../../components/AddToCartControl.jsx";
import { PageLoader } from "../../components/ui/PageLoader.jsx";
import { Store as StoreIcon } from "lucide-react";
import { resolvePaymentMethod } from "../../lib/paymentMethods.js";
import { resolveCurrency } from "../../lib/currencies.js";
import { StoreChatWidget } from "../../components/StoreChatWidget.jsx";
import { StarRating } from "../../components/ui/StarRating.jsx";
import { ReviewsMarquee } from "../../components/ReviewsMarquee.jsx";
import { RequestProductButton } from "../../components/RequestProductButton.jsx";
import { Lightbox } from "../../components/ui/Lightbox.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
// Bloque 45 (pedido explícito — "en el lugar donde iba la imagen... pon el
// espacio para una imagen estática"): ahora que StoreOffer ya no tiene
// imagen propia (el vendedor no sube nada), este mismo dibujo fijo se
// muestra en TODAS las ofertas de TODAS las tiendas — es puramente
// decorativo, no representa el producto/servicio real de la oferta.
import ofertImage from "../../assets/images/ofert.webp";
// Bloque 166 (pedido explícito — banner de la tienda idéntico entre
// Store.jsx y TableOrder.jsx): extraído a un componente propio, reusado en
// ambos lugares — ver components/StoreHeaderBanner.jsx.
import { StoreHeaderBanner } from "../../components/StoreHeaderBanner.jsx";
// Bloque 209 (pedido explícito, con captura de referencia — solo para el
// menú digital, NO para el resto de la tienda): misma tarjeta horizontal
// que usa TableOrder.jsx, reusada acá únicamente en la pestaña "Menú del
// local" (menuProducts) — "Otros productos" y el resto de la página siguen
// con ProductGrid tal cual estaban.
import { DigitalMenuProductCard, DIGITAL_MENU_GRID_CLASS } from "../../components/DigitalMenuProductCard.jsx";

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

// Bloque 232 (pedido explícito, con imagen de referencia — "las ofertas
// dentro de las tiendas deben verse algo así como esta imagen"): la
// referencia muestra 4 cajitas DÍAS/HRS/MIN/SEG que corren en vivo —
// distinto de useLiveCountdown de arriba (un solo texto, recalculado cada
// minuto), acá se necesitan los 4 números por separado y con precisión de
// segundo real para que se sientan "vivos" como en la referencia.
function useLiveCountdownParts(expiresAt) {
  const [parts, setParts] = useState(null);
  useEffect(() => {
    if (!expiresAt) {
      setParts(null);
      return;
    }
    function compute() {
      const ms = new Date(expiresAt).getTime() - Date.now();
      if (ms <= 0) return null;
      return {
        days: Math.floor(ms / 86400000),
        hours: Math.floor((ms % 86400000) / 3600000),
        minutes: Math.floor((ms % 3600000) / 60000),
        seconds: Math.floor((ms % 60000) / 1000),
      };
    }
    setParts(compute());
    const id = setInterval(() => setParts(compute()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return parts;
}

// Bloque 231 (pedido explícito, con captura — "no se muestra toda la
// descripción y eso está mal, se debe poder ver toda la descripción o un
// botón para ver la oferta completa responsiva levantada en una ventana en
// medio con estilos modernos"): mismo shell de modal que ya usa el resto
// del panel (`fixed inset-0 ... bg-inverse-surface/40` + `rounded-2xl
// bg-surface-container-lowest`), no uno nuevo — la imagen y el botón de
// código se repiten tal cual la tarjeta, solo que acá la descripción nunca
// se recorta.
function StoreOfferDetailModal({ offer, onClose, onCopyCode }) {
  const countdown = useLiveCountdown(offer.isLimitedTime ? offer.expiresAt : null);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-surface-container-lowest shadow-xl">
        {/* Bloque 45 (pedido explícito — "elimina que a las ofertas dentro
            de la tienda se puedan agregar imágenes, no quiero imágenes en
            esas ofertas"): antes esta cabecera era una foto banner 16:9 con
            degradado encima para que el botón cerrar/badge se leyeran bien
            — sin imagen, es una fila normal. */}
        <div className="flex items-start justify-between gap-3 p-5 pb-0">
          <span className="rounded-full bg-error px-2.5 py-1 text-[11px] font-bold text-white">
            {discountBadgeLabel(offer.discountCode)}
          </span>
          <button onClick={onClose} aria-label="Cerrar" className="flex-shrink-0 rounded-full p-1.5 text-outline hover:bg-surface-container">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">
          <div className="font-display text-xl font-extrabold leading-tight text-on-surface">{offer.title}</div>
          {offer.isLimitedTime && countdown && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-bold text-error">
              <Clock className="h-3.5 w-3.5" /> {countdown}
            </div>
          )}
          {offer.description && <p className="mt-3 whitespace-pre-line text-[13.5px] leading-5 text-on-surface-variant">{offer.description}</p>}
          <button
            onClick={onCopyCode}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-tertiary-accent/10 py-3 text-[13px] font-bold text-tertiary-accent hover:bg-tertiary-accent/15"
          >
            <Tag className="h-4 w-4" /> Código: {offer.discountCode.code} · {discountBadgeLabel(offer.discountCode)}
          </button>
        </div>
      </div>
    </div>
  );
}

// Bloque 232 (pedido explícito, con imagen de referencia — "las ofertas
// dentro de las tiendas deben verse algo así como esta imagen"): banner
// horizontal (foto en caja blanca + título/precio a la izquierda, reloj de
// DÍAS/HRS/MIN/SEG a la derecha) en vez de la tarjeta vertical de antes.
// Tiene más sentido ahora que antes: desde que solo se puede mantener una
// oferta activa por tienda por default (Bloque 232, configurable por el
// admin), esta sección casi siempre muestra 1 sola — un banner ancho la
// jerarquiza mejor que una tarjeta angosta compitiendo en una grilla.
function CountdownBox({ value, label }) {
  return (
    <div className="flex h-14 w-14 flex-shrink-0 flex-col items-center justify-center rounded-xl bg-white/15 sm:h-16 sm:w-16">
      <span className="font-display text-lg font-extrabold text-white sm:text-xl">{String(value).padStart(2, "0")}</span>
      <span className="text-[8.5px] font-bold uppercase tracking-wide text-white/70">{label}</span>
    </div>
  );
}

function StoreOfferCard({ offer, vendorName }) {
  const countdownParts = useLiveCountdownParts(offer.isLimitedTime ? offer.expiresAt : null);
  const [detailOpen, setDetailOpen] = useState(false);

  function handleCopyCode(e) {
    e.stopPropagation();
    copyToClipboard(offer.discountCode.code)
      .then(() => toast.success(`¡Código "${offer.discountCode.code}" copiado!`))
      .catch(() => toast.error("No se pudo copiar el código."));
  }

  return (
    <>
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-primary-container p-4 shadow-lg sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
          {/* Bloque 232 (bug real encontrado en vivo — React advertía
              "<button> cannot appear as a descendant of <button>" en la
              consola): el botón de copiar código vive ADENTRO de esta área
              clickeable — un <button> real no puede anidar otro <button>
              (HTML inválido, comportamiento de click impredecible entre
              navegadores). div con role="button" cumple lo mismo
              (clickeable + accesible por teclado) sin esa restricción;
              handleCopyCode ya cortaba la propagación, así que el
              comportamiento visual no cambia en nada. */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setDetailOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setDetailOpen(true);
              }
            }}
            title="Ver oferta completa"
            className="flex flex-1 cursor-pointer items-center gap-3.5 text-left sm:gap-4"
          >
            <div className="flex h-[92px] w-[92px] flex-shrink-0 items-center justify-center sm:h-[112px] sm:w-[112px]">
              <img src={ofertImage} alt="" className="h-full w-full object-contain" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-white/70">
                <Zap className="h-3 w-3 fill-secondary text-secondary" /> Oferta de {vendorName}
              </div>
              <div className="mt-0.5 font-display text-[15px] font-extrabold leading-tight text-white sm:text-lg">{offer.title}</div>
              {offer.description && <p className="mt-0.5 line-clamp-1 text-[11.5px] text-white/75 sm:line-clamp-2">{offer.description}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-3 py-1 text-[11px] font-bold text-primary">Ver oferta</span>
                <span className="rounded-full bg-error px-2.5 py-1 text-[10.5px] font-bold text-white">{discountBadgeLabel(offer.discountCode)}</span>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="flex items-center gap-1 rounded-full border border-white/30 px-2.5 py-1 text-[10.5px] font-bold text-white/90 hover:bg-white/10"
                >
                  <Tag className="h-3 w-3" /> {offer.discountCode.code}
                </button>
              </div>
            </div>
          </div>

          {offer.isLimitedTime && countdownParts && (
            <div className="flex flex-shrink-0 items-center justify-center gap-2 border-t border-white/15 pt-3 sm:justify-end sm:border-t-0 sm:border-l sm:pl-5 sm:pt-0">
              <CountdownBox value={countdownParts.days} label="Días" />
              <CountdownBox value={countdownParts.hours} label="Hrs" />
              <CountdownBox value={countdownParts.minutes} label="Min" />
              <CountdownBox value={countdownParts.seconds} label="Seg" />
            </div>
          )}
        </div>
      </div>

      {detailOpen && <StoreOfferDetailModal offer={offer} onClose={() => setDetailOpen(false)} onCopyCode={handleCopyCode} />}
    </>
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

// Bloque 141 (pedido explícito): extraído de la sección "PRODUCTOS" de
// abajo (antes una sola grilla inline) para poder reusarla sin duplicar
// 30+ líneas de JSX cuando una tienda-restaurante separa su menú de su
// catálogo fijo en 2 secciones (ver más abajo, "Productos" splitea en
// menuProducts/catalogProducts cuando corresponde).
function ProductGrid({ products, vendor }) {
  return (
    <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
      {products.map((p) => (
        <div
          key={p.id}
          className="group overflow-hidden rounded-[26px] bg-surface-container-lowest shadow-[0_1px_3px_rgba(27,27,29,0.07),0_1px_2px_rgba(27,27,29,0.05)] transition-shadow hover:shadow-lg"
        >
          <Link to={`/producto/${vendor.slug}/${p.slug}`} className="block p-2.5 pb-0">
            <div className="aspect-[12/7] w-full overflow-hidden rounded-[16px] border-2 border-dashed border-outline-variant bg-surface-container">
              {p.images?.[0] ? (
                <img src={imgUrl(p.images[0])} alt={p.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-label-sm text-outline">Sin foto</div>
              )}
            </div>
          </Link>
          <div className="p-3.5 pt-2.5">
            <Link to={`/producto/${vendor.slug}/${p.slug}`} className="mb-1 block text-[13.5px] font-bold leading-[18px] text-on-surface">
              {p.name}
            </Link>
            <ExpandableDescription text={p.description} />
            {!p.unlimitedStock && p.stock <= LOW_STOCK_THRESHOLD && (
              <span className="mb-1.5 inline-block w-fit rounded-full bg-[#8a5100]/10 px-2 py-0.5 text-[10px] font-bold text-[#8a5100]">
                ¡Últimas {p.stock} unidades!
              </span>
            )}
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-bold text-on-surface">{formatPrice(p.price, p.currency)}</span>
              <AddToCartControl product={{ ...p, vendorId: vendor.id, vendor }} size="sm" />
            </div>
          </div>
        </div>
      ))}
    </div>
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

// Mismo umbral que LOW_STOCK_THRESHOLD en ProductCard.jsx/VendorProducts.jsx.
const LOW_STOCK_THRESHOLD = 3;

export default function Store() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { siteName, reviewDedupHours, maxReviewsPerStorePerPeriod } = usePlatformSettings();
  const queryClient = useQueryClient();
  // Bloque 208 (pedido explícito — "el menú no debe aparecer mezclado con
  // los productos de venta... debe aparecer un botón para cambiar de
  // sección"): antes ambas secciones se apilaban una debajo de la otra en
  // la misma página; ahora es un selector que muestra una sola a la vez.
  // Bloque 210 (pedido explícito — "el menú del local no debe ser visible a
  // la primera, primero deben verse los otros productos"): arranca en
  // "catalogo", no en "menu".
  const [catalogTab, setCatalogTab] = useState("catalogo");
  const [commentText, setCommentText] = useState("");
  const [commentRating, setCommentRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  // Bloque 52: fotos adjuntas al comentario — solo tiendas verificadas
  // (el selector ni se renderiza si no lo está, ver más abajo).
  const [reviewImages, setReviewImages] = useState([]); // File[]
  const [lightboxSrc, setLightboxSrc] = useState(null);
  // Bloque 69 (pedido explícito): reportar un comentario — desde la cuenta
  // de cualquier cliente logueado (nunca el propio, ver ReviewsMarquee.jsx).
  const [reportTarget, setReportTarget] = useState(null);
  const [reportReason, setReportReason] = useState("");
  const trackedVisitRef = useRef(null);
  const reviewsRef = useRef(null);

  const { data, isLoading } = useQuery({
    queryKey: ["vendor", slug],
    queryFn: async () => (await api.get(`/vendors/${slug}`)).data.vendor,
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

  // Bloque 69 (pedido explícito): reportar oculta la reseña de inmediato
  // server-side — el refetch de "vendor" hace que ya no vuelva a aparecer.
  const reportReview = useMutation({
    mutationFn: async () => (await api.post(`/reviews/${reportTarget.id}/report`, { reason: reportReason.trim() || undefined })).data,
    onSuccess: () => {
      toast.success("Comentario reportado — el equipo lo va a revisar.");
      setReportTarget(null);
      setReportReason("");
      queryClient.invalidateQueries({ queryKey: ["vendor", slug] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo reportar el comentario.");
      setReportTarget(null);
      setReportReason("");
    },
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

  // Bloque 137 (pedido explícito — "cuando se comparte el enlace de una
  // tienda, debe previsualizarse en ese link los datos e imágenes de ESA
  // tienda, y no lo del sitio web en general"): antes copiaba
  // window.location.href tal cual — el link real de la SPA, cuyo
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
  // Bloque 64 (regla de visibilidad, independiente de si está verificada):
  // la tienda existe pero no tiene ningún producto publicado — ni perfil
  // completo ni catálogo vacío con apariencia normal, un estado dedicado.
  if (data.hasPublishedProducts === false) {
    return (
      <div className="container-app py-14">
        <EmptyState
          icon={StoreIcon}
          title={`${data.companyName} aún no está disponible`}
          description="Esta tienda todavía no publicó ningún producto — vuelve a visitarla más adelante."
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
  // Bloque 23: la grilla principal solo muestra lo que se puede comprar ya
  // mismo — lo agotado se separa en "Próximamente disponibles" más abajo,
  // con botón "Solicitar" en vez de "Agregar al carrito".
  // Bloque 56: "disponible siempre" siempre cae en "disponibles", sin
  // importar lo que tenga guardado en `stock` (no se le lleva seguimiento).
  const availableProducts = v.products?.filter((p) => p.unlimitedStock || p.stock > 0) ?? [];
  const outOfStockProducts = v.products?.filter((p) => !p.unlimitedStock && p.stock <= 0) ?? [];

  // Bloque 141: menú del local (availableForTableMenu, el mismo flag que ya
  // filtra qué se ve al escanear el QR de mesa — ver getTableByToken,
  // tables.controller.js) vs. cualquier otro producto fijo/externo. Splitea
  // en 2 secciones SOLO si la tienda es restaurante Y de verdad tiene AMBAS
  // cosas — si tiene solo una, seguir con la grilla única de siempre evita
  // una sección vacía al lado de otra para la mayoría de las tiendas.
  const menuProducts = availableProducts.filter((p) => p.availableForTableMenu);
  const catalogProducts = availableProducts.filter((p) => !p.availableForTableMenu);
  const isRestaurantWithMixedCatalog = v.isRestaurant && menuProducts.length > 0 && catalogProducts.length > 0;

  return (
    <div>
      <StoreHeaderBanner vendor={v} />

      {/* HOJA DE CONTENIDO — esquinas superiores redondeadas (pedido
          explícito, con captura: "redondea más las esquinas" — 28px subió a
          40px), superpuesta sobre el "colchón" de color vacío que
          StoreHeaderBanner.jsx reserva de más al final de su último
          elemento visible (ver el comentario largo ahí — el colchón hereda
          el mismo fondo oscuro semitransparente de la franja de stats,
          para que no haya costura de color entre la franja y el colchón).
          -mt-10/rounded-t-[40px]: mismo valor en los 2 lados, siempre en
          sync — si uno cambia, el otro tiene que cambiar igual. Envuelve
          TODO el contenido de acá para abajo (Ofertas, Productos, Países de
          entrega, Comentarios, Otras tiendas) — un solo fondo, una sola
          curva, no una por sección. */}
      <div className="relative -mt-10 rounded-t-[40px] bg-background">
      {/* Bloque 66 (bug real reportado en vivo — fuga de seguridad): antes
          acá había un link directo a `/mesa/:qrToken` ("Menú de mesa con
          QR") — cualquier visitante de la tienda pública llegaba al pedido
          de mesa sin escanear ningún QR físico. Se quita del todo: el menú
          de mesa solo se alcanza escaneando el QR real o desde el panel del
          vendedor (VendorTables.jsx). El backend tampoco expone más
          `tables`/`qrToken` en este endpoint (ver getVendorBySlug). */}

      {/* OFERTAS DE TIENDA (Bloque 52, reubicada en Bloque 68 — pedido
          explícito: van ARRIBA de los productos, no abajo del todo) —
          distinta de la sección "Ofertas" del Home: esta vive DENTRO de
          cada tienda, solo visible si tiene al menos una StoreOffer activa. */}
      {v.storeOffers?.length > 0 && (
        <div className="container-app pt-8">
          <h2 className="mb-1 font-display text-title-lg text-on-surface">Ofertas</h2>
          <p className="mb-5 text-label-sm text-outline">Descuentos exclusivos de {v.companyName} — aplica el código en el carrito.</p>
          {/* Bloque 232: banners horizontales apilados, no una grilla — por
              default solo hay 1 oferta activa a la vez por tienda (el admin
              puede subir ese límite, ver AdminStoreOffers.jsx), así que un
              ancho completo la jerarquiza mejor que competir en columnas. */}
          <div className="flex flex-col gap-4">
            {v.storeOffers.map((offer) => (
              <StoreOfferCard key={offer.id} offer={offer} vendorName={v.companyName} />
            ))}
          </div>
        </div>
      )}

      {/* PRODUCTOS — Bloque 141/208 (pedido explícito: secciones distintas
          para el menú de mesa (availableForTableMenu) y el catálogo fijo,
          SIN mezclarlos — Bloque 208 lo pasa de 2 secciones apiladas a un
          selector, así el cliente ve una sola grilla a la vez. Solo aplica
          si la tienda es restaurante Y de verdad tiene una mezcla real de
          las 2 (si tiene nada más que una, sería un selector con una sola
          opción real — se muestra como antes, una sola grilla). */}
      {isRestaurantWithMixedCatalog ? (
        <div className="container-app pt-8">
          <div className="mb-5 inline-flex rounded-full border border-surface-container-high bg-surface-container-lowest p-1">
            {/* Bloque 210 (pedido explícito): "Otros productos" pasa a
                llamarse "Productos de la tienda", y va primero (izquierda) —
                "Menú del local" queda segundo (derecha). */}
            <button
              onClick={() => setCatalogTab("catalogo")}
              className={`rounded-full px-4 py-2 text-label-md font-bold transition-colors ${
                catalogTab === "catalogo" ? "bg-primary text-on-primary" : "text-on-surface-variant"
              }`}
            >
              Productos de la tienda
            </button>
            <button
              onClick={() => setCatalogTab("menu")}
              className={`rounded-full px-4 py-2 text-label-md font-bold transition-colors ${
                catalogTab === "menu" ? "bg-primary text-on-primary" : "text-on-surface-variant"
              }`}
            >
              Menú del local
            </button>
          </div>
          {catalogTab === "menu" ? (
            <>
              <p className="mb-5 text-label-sm text-outline">Para comer en el local o pedir por acá mismo.</p>
              <div className={DIGITAL_MENU_GRID_CLASS}>
                {menuProducts.map((p) => (
                  <DigitalMenuProductCard
                    key={p.id}
                    to={`/producto/${v.slug}/${p.slug}`}
                    image={p.images?.[0] ? imgUrl(p.images[0]) : null}
                    imageAlt={p.name}
                    name={p.name}
                    description={p.description}
                    rating={Number(p.rating)}
                    reviewCount={p.reviewCount}
                    badge={
                      !p.unlimitedStock && p.stock <= LOW_STOCK_THRESHOLD ? (
                        <span className="flex-shrink-0 rounded-full bg-[#8a5100]/10 px-2 py-0.5 text-[10px] font-bold text-[#8a5100]">
                          ¡Últimas {p.stock}!
                        </span>
                      ) : null
                    }
                    price={formatPrice(p.price, p.currency)}
                    oldPrice={p.oldPrice ? formatPrice(p.oldPrice, p.currency) : null}
                    discountPercent={p.oldPrice ? Math.round(100 - (Number(p.price) / Number(p.oldPrice)) * 100) : null}
                    action={
                      <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }} onMouseDown={(e) => e.stopPropagation()}>
                        <AddToCartControl product={{ ...p, vendorId: v.id, vendor: v }} size="sm" variant="circle" />
                      </div>
                    }
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="mb-5 text-label-sm text-outline">Catálogo aparte del menú del local.</p>
              <ProductGrid products={catalogProducts} vendor={v} />
            </>
          )}
        </div>
      ) : (
        <div className="container-app pt-8">
          <h2 className="mb-5 font-display text-title-lg text-on-surface">Productos de {v.companyName}</h2>
          {availableProducts.length ? (
            <ProductGrid products={availableProducts} vendor={v} />
          ) : (
            <p className="text-body-md text-on-surface-variant">
              {outOfStockProducts.length
                ? "Todos los productos de esta tienda están agotados por ahora — mira “Próximamente disponibles” más abajo."
                : "Esta tienda todavía no publicó productos."}
            </p>
          )}
        </div>
      )}

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

      {/* COMENTARIOS */}
      <div ref={reviewsRef} id="resenas" className="container-app pt-11">
        <h2 className="mb-1 font-display text-title-lg text-on-surface">Comentarios de compradores</h2>
        <p className="mb-5 text-label-sm text-outline">
          Públicos y visibles para todos. Solo compradores registrados pueden comentar —{" "}
          {describeReviewLimit(reviewDedupHours, maxReviewsPerStorePerPeriod, "tienda")}.
        </p>

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
              className="h-11 min-w-0 flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3.5 text-body-md outline-none"
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

        <ReviewsMarquee
          reviews={v.reviews}
          vendorName={v.companyName}
          onImageClick={(src) => setLightboxSrc(src)}
          currentUserId={user?.id}
          onReportClick={(review) => setReportTarget(review)}
        />
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
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11.5px] text-outline">
                  <StarRating value={Number(x.rating)} size="h-3 w-3" showValue />
                  <span>· {x._count?.products ?? 0} prod.</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
      </div>

      {/* Bloque 25: aiAvailable = Gemini o Groq activo/configurado en
          AdminIntegrations — sin ninguno de los dos, el widget ni se monta
          (en vez de mostrar un botón que solo lleva a un error). */}
      {v.isVerified && v.aiAvailable && <StoreChatWidget vendor={v} />}

      <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />

      <ConfirmModal
        open={!!reportTarget}
        title="¿Reportar este comentario?"
        message={`El equipo de ${siteName} lo revisa antes de decidir — mientras tanto deja de mostrarse.`}
        confirmLabel={reportReview.isPending ? "Reportando..." : "Reportar"}
        danger
        onConfirm={() => reportReview.mutate()}
        onCancel={() => {
          setReportTarget(null);
          setReportReason("");
        }}
      >
        <textarea
          value={reportReason}
          onChange={(e) => setReportReason(e.target.value)}
          placeholder="Motivo (opcional)..."
          rows={3}
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent"
        />
      </ConfirmModal>
    </div>
  );
}
