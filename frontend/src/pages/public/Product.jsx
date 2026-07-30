import { useEffect, useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Minus, Plus, ShoppingCart, MapPin, ShieldCheck, ScanBarcode, CheckCircle2, Star, Camera, X as XIcon } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatPrice } from "../../lib/format.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { resolveUnitPrice, calcSavings, buildPriceTierRanges } from "../../lib/pricing.js";
import { useCart } from "../../context/CartContext.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { VerifiedBadge } from "../../components/ui/VerifiedBadge.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { PageLoader } from "../../components/ui/PageLoader.jsx";
import { PackageSearch } from "lucide-react";
import { StoreChatWidget } from "../../components/StoreChatWidget.jsx";
import { StarRating } from "../../components/ui/StarRating.jsx";
import { RequestProductButton } from "../../components/RequestProductButton.jsx";
import { ReviewsMarquee } from "../../components/ReviewsMarquee.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { Lightbox } from "../../components/ui/Lightbox.jsx";

// Bloque 69 (pedido explícito): "los productos también pueden llevar
// reseñas" — mismas fotos que Store.jsx (solo tiendas verificadas).
const MAX_REVIEW_IMAGES = 4;

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

const PAY_LABELS = { whatsapp: "WhatsApp", cod: "Contra entrega", prepaid: "Transferencia CUP" };

export default function Product() {
  const { vendorSlug, productSlug } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addItem, items } = useCart();
  const { user } = useAuth();
  const { siteName } = usePlatformSettings();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [selectedImage, setSelectedImage] = useState(0);
  const [prevImage, setPrevImage] = useState(null);
  const [fading, setFading] = useState(false);
  const [selectedSize, setSelectedSize] = useState(null);
  // Bloque 69 (pedido explícito): reseña propia del PRODUCTO — mismo patrón
  // que Store.jsx (comentario general de la tienda), acá con `productId`
  // sumado al payload para que quede ligada a esta ficha puntual.
  const [commentText, setCommentText] = useState("");
  const [commentRating, setCommentRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [reviewImages, setReviewImages] = useState([]);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);
  const [reportReason, setReportReason] = useState("");
  const autoplayRef = useRef(null);
  const fadeTimerRef = useRef(null);
  const reviewsRef = useRef(null);

  const { data, isLoading } = useQuery({
    queryKey: ["product", vendorSlug, productSlug],
    queryFn: async () => (await api.get(`/products/${vendorSlug}/${productSlug}`)).data,
  });

  // Reinicia la miniatura seleccionada al navegar a otro producto (ej. desde
  // "También te puede interesar") — la ruta cambia pero el componente no se
  // remonta, así que el índice viejo podía apuntar a otra foto. La talla
  // seleccionada también se reinicia — no tiene sentido arrastrarla de un
  // producto a otro.
  useEffect(() => {
    setSelectedImage(0);
    setSelectedSize(null);
  }, [data?.product?.id]);

  // Helper para cambiar imagen con crossfade suave.
  function changeImage(nextIdx) {
    if (nextIdx === selectedImage) return;
    clearTimeout(fadeTimerRef.current);
    setPrevImage(selectedImage);
    setSelectedImage(nextIdx);
    setFading(true);
    fadeTimerRef.current = setTimeout(() => {
      setPrevImage(null);
      setFading(false);
    }, 700);
  }

  // Auto-rotación de imágenes cada 5s: usa data?.product porque product
  // se declara más abajo (evita ReferenceError).
  useEffect(() => {
    const imgs = data?.product?.images;
    if (!imgs?.length || imgs.length <= 1) return;
    autoplayRef.current = setInterval(() => {
      setSelectedImage((prev) => {
        const next = (prev + 1) % imgs.length;
        clearTimeout(fadeTimerRef.current);
        setPrevImage(prev);
        setFading(true);
        fadeTimerRef.current = setTimeout(() => {
          setPrevImage(null);
          setFading(false);
        }, 700);
        return next;
      });
    }, 5000);
    return () => {
      clearInterval(autoplayRef.current);
      clearTimeout(fadeTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.product?.id, data?.product?.images?.length]);

  // Bloque 69 (pedido explícito): reseña del PRODUCTO — mismo mecanismo que
  // Store.jsx (comentario de tienda), con `productId` sumado. Definida acá
  // (antes de los `return` de loading/404) porque un hook no puede quedar
  // del lado de un return condicional; el mutationFn cierra sobre `data` en
  // el momento real del click, cuando ya está cargado.
  const postComment = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("vendorId", data.product.vendorId);
      form.append("productId", data.product.id);
      form.append("comment", commentText.trim());
      if (commentRating) form.append("rating", String(commentRating));
      reviewImages.forEach((file) => form.append("images", file));
      return (await api.post("/reviews", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      setCommentText("");
      setCommentRating(0);
      setReviewImages([]);
      toast.success("¡Reseña publicada!");
      queryClient.invalidateQueries({ queryKey: ["product", vendorSlug, productSlug] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo publicar la reseña."),
  });

  const reportReview = useMutation({
    mutationFn: async () => (await api.post(`/reviews/${reportTarget.id}/report`, { reason: reportReason.trim() || undefined })).data,
    onSuccess: () => {
      toast.success("Comentario reportado — el equipo lo va a revisar.");
      setReportTarget(null);
      setReportReason("");
      queryClient.invalidateQueries({ queryKey: ["product", vendorSlug, productSlug] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo reportar el comentario.");
      setReportTarget(null);
      setReportReason("");
    },
  });

  // Bloque 52 (criterio de Store.jsx, reusado acá): dejar una reseña
  // requiere estar logueado como cliente — redirige a /cuenta con retorno
  // automático a esta misma ficha de producto.
  function goToReviewLogin() {
    navigate(`/cuenta?next=${encodeURIComponent(`/producto/${vendorSlug}/${productSlug}#resenas`)}`);
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

  // Bloque 57 (bug reportado en vivo): estos valores se calculan ACÁ (antes
  // de los `return` de loading/404, no más abajo como antes) para poder
  // re-verificar `qty` contra el stock disponible cada vez que cambia la
  // talla elegida — antes quedaban más abajo, después de esos `return`, así
  // que no se podían usar como dependencia de un useEffect (violaría las
  // reglas de hooks: un hook no puede quedar del lado de un return
  // condicional). `product` puede ser undefined mientras isLoading, de ahí
  // el `?.` en cada paso.
  const product = data?.product;
  const hasSizes = product?.sizes?.length > 0;
  // Bloque 56: "disponible siempre" (mutuamente excluyente con tallas) —
  // nunca hay techo real de stock para este producto.
  const stockForSelection = product?.unlimitedStock
    ? Infinity
    : hasSizes
    ? Number(product?.sizeStock?.[selectedSize] ?? 0)
    : product?.stock;
  const cartQuantity = product ? items.find((i) => i.productId === product.id && i.size === (hasSizes ? selectedSize : null))?.quantity ?? 0 : 0;
  // Techo real: lo que ya tienes en el carrito cuenta contra el stock total,
  // así no se puede acumular más de lo disponible entre pantallas distintas.
  const remainingStock = product ? Math.max(0, (stockForSelection ?? Infinity) - cartQuantity) : Infinity;

  // Bug real reportado en vivo: el cliente ponía cantidad 2 con una talla que
  // tenía 2+ en stock, cambiaba a otra talla con solo 1 disponible, y el
  // stepper se quedaba mostrando 2 — ni "Agregar al carrito" ni "Pedir por
  // WhatsApp" volvían a chequear la cantidad contra el nuevo stock hasta que
  // el cliente tocara el stepper a mano. Se re-verifica acá cada vez que
  // cambia el stock disponible (talla elegida, u otro tab que ya sumó algo
  // al carrito de este producto).
  useEffect(() => {
    if (remainingStock > 0 && qty > remainingStock) setQty(remainingStock);
  }, [remainingStock]);

  // Bloque 69 (mismo criterio que Store.jsx): si venimos de /cuenta?next=...
  // #resenas tras loguearnos para reseñar, llevar la vista directo ahí.
  useEffect(() => {
    if (window.location.hash === "#resenas" && reviewsRef.current) {
      reviewsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [data]);

  if (isLoading) return <PageLoader label="Cargando producto..." />;

  if (!data?.product) {
    return (
      <div className="container-app py-14">
        <EmptyState icon={PackageSearch} title="Producto no encontrado" />
      </div>
    );
  }

  const { related } = data;
  const v = product.vendor;
  const location = v.locations?.[0];
  const locationLabel = location ? `${location.municipality?.name ?? location.province?.name}` : "Cuba";
  const discount = product.oldPrice ? Math.round(100 - (Number(product.price) / Number(product.oldPrice)) * 100) : null;
  // Bloque 55: precios por cantidad (mayoreo) — opcional, solo si el
  // vendedor cargó tramos. El precio unitario mostrado ya refleja la
  // cantidad elegida (qty), y el "ahorro" compara contra pagar todo al
  // precio de 1 sola unidad.
  const hasPriceTiers = product.priceTiers?.length > 0;
  const unitPrice = hasPriceTiers ? resolveUnitPrice(product.price, product.priceTiers, qty) : Number(product.price);
  const tierSavings = hasPriceTiers ? calcSavings(product.price, product.priceTiers, qty) : 0;
  const tierRanges = hasPriceTiers ? buildPriceTierRanges(product.price, product.priceTiers) : [];
  const stockLabel = product.unlimitedStock
    ? "Disponible"
    : hasSizes
    ? (selectedSize ? (stockForSelection > 0 ? (stockForSelection < 12 ? `Últimas ${stockForSelection} unidades` : "Disponible") : "Sin stock") : "Elige una talla")
    : product.stock > 0
    ? (product.stock < 12 ? `Últimas ${product.stock} unidades` : "Disponible")
    : "Sin stock";
  function handleAddToCart() {
    if (hasSizes && !selectedSize) {
      toast.error("Elige una talla primero.");
      return;
    }
    addItem(
      {
        id: product.id,
        name: product.name,
        price: Number(product.price),
        priceTiers: product.priceTiers ?? [],
        currency: product.currency,
        // Bloque 56: `null` (no un número) le dice a CartContext que no hay
        // techo real que respetar — Infinity no sobrevive un JSON.stringify.
        stock: product.unlimitedStock ? null : stockForSelection,
        size: hasSizes ? selectedSize : null,
        vendorId: product.vendorId,
        vendorName: v.companyName,
        vendorSlug: v.slug,
        vendorColor: v.color,
        vendorVerified: v.isVerified,
        vendorWhatsapp: v.whatsapp,
      },
      Math.min(qty, remainingStock)
    );
    toast.success("Agregado al carrito ✓");
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  }

  return (
    <div>
      <div className="container-app pt-6">
        <div className="text-label-sm text-outline">
          <Link to="/" className="text-outline hover:text-primary-container">Inicio</Link> /{" "}
          <Link to="/catalogo" className="text-outline hover:text-primary-container">Catálogo</Link> /{" "}
          <span className="text-on-surface">{product.name}</span>
        </div>
      </div>

      {/* Bloque 54 (fix de tamaño): antes `lg:grid-cols-2` partía la sección
          50/50 — en pantallas grandes eso hacía que la foto (aspect-square)
          creciera hasta ~650px, dominando la mitad de la pantalla. Un
          marketplace prolijo (Amazon, Etsy, etc.) mantiene la galería en un
          ancho moderado y fijo, dándole el espacio sobrante al panel de
          compra — acá se tapea en 420px en vez de escalar con el viewport. */}
      <section className="container-app grid grid-cols-1 gap-8 pt-6 lg:grid-cols-[600px_1fr] lg:gap-11">
        {/* GALERÍA */}
        <div className="mx-auto w-full max-w-[600px] lg:mx-0">
          {/* Galería con crossfade real: dos imágenes apiladas, la anterior
              hace fade-out mientras la nueva hace fade-in. */}
          <div className="relative mb-3 aspect-[7/4] w-full overflow-hidden rounded-xl bg-surface-container shadow-md">
            {product.images?.length ? (
              <>
                {/* Imagen anterior (sale con fade-out) */}
                {prevImage !== null && fading && (
                  <img
                    key={`prev-${prevImage}`}
                    src={imgUrl(product.images[prevImage])}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                    style={{ animation: "imgFadeOut 0.7s ease forwards" }}
                  />
                )}
                {/* Imagen actual (entra con fade-in) */}
                <img
                  key={`cur-${selectedImage}`}
                  src={imgUrl(product.images[selectedImage])}
                  alt={product.name}
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{ animation: "imgFadeIn 0.7s ease forwards" }}
                />
              </>
            ) : (
              <div className="flex h-full w-full items-center justify-center text-label-sm text-outline">Sin fotos todavía</div>
            )}
            {/* Indicador de puntos */}
            {product.images?.length > 1 && (
              <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 gap-1.5">
                {product.images.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      clearInterval(autoplayRef.current);
                      changeImage(i);
                      autoplayRef.current = setInterval(() => {
                        setSelectedImage((prev) => {
                          const next = (prev + 1) % product.images.length;
                          clearTimeout(fadeTimerRef.current);
                          setPrevImage(prev);
                          setFading(true);
                          fadeTimerRef.current = setTimeout(() => { setPrevImage(null); setFading(false); }, 700);
                          return next;
                        });
                      }, 5000);
                    }}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      i === selectedImage ? "w-5 bg-white" : "w-1.5 bg-white/50"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
          {product.images?.length > 1 && (
            <div className="grid grid-cols-4 gap-2.5">
              {product.images.map((url, i) => (
                <button
                  key={url}
                  onClick={() => {
                    clearInterval(autoplayRef.current);
                    changeImage(i);
                    autoplayRef.current = setInterval(() => {
                      setSelectedImage((prev) => {
                        const next = (prev + 1) % product.images.length;
                        clearTimeout(fadeTimerRef.current);
                        setPrevImage(prev);
                        setFading(true);
                        fadeTimerRef.current = setTimeout(() => { setPrevImage(null); setFading(false); }, 700);
                        return next;
                      });
                    }, 5000);
                  }}
                  className={`aspect-[7/4] w-full overflow-hidden rounded-md border-2 transition-all duration-300 ${
                    i === selectedImage ? "border-tertiary-accent opacity-100 scale-[1.04]" : "border-transparent opacity-55 hover:opacity-85"
                  }`}
                >
                  <img src={imgUrl(url)} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* PANEL DE COMPRA */}
        <div>
          <Link to={`/tienda/${v.slug}`} className="mb-2.5 inline-flex items-center gap-1.5 text-label-md font-bold text-tertiary-accent">
            {v.companyName}
            {v.isVerified && <VerifiedBadge size="sm" />}
          </Link>
          <h1 className="mb-2.5 font-display text-headline-lg-mobile text-on-surface md:text-headline-lg">{product.name}</h1>
          <div className="mb-5 flex flex-wrap items-center gap-2.5">
            <StarRating value={product.rating ?? 0} size="h-3.5 w-3.5" showValue />
            <span className="text-label-sm text-outline">{product.reviewCount} reseñas</span>
            <span className="text-label-sm font-semibold text-tertiary-accent">· {stockLabel}</span>
            <span className="text-[12px] text-outline">· {locationLabel}</span>
          </div>
          <div className="mb-1.5 flex items-baseline gap-3">
            <span className="font-display text-3xl font-extrabold text-on-surface">{formatPrice(unitPrice, product.currency)}</span>
            {product.oldPrice && !hasPriceTiers && (
              <>
                <span className="text-[17px] text-outline line-through">{formatPrice(product.oldPrice, product.currency)}</span>
                <span className="rounded-full bg-error/10 px-2.5 py-1 text-[12px] font-bold text-error">-{discount}%</span>
              </>
            )}
            {hasPriceTiers && <span className="text-[13px] text-outline">c/u</span>}
          </div>
          {tierSavings > 0 && (
            <p className="mb-3.5 inline-flex w-fit items-center gap-1.5 rounded-full bg-tertiary-accent/10 px-3 py-1 text-[12.5px] font-bold text-tertiary-accent">
              Ahorras {formatPrice(tierSavings, product.currency)} comprando {qty} unidades
            </p>
          )}
          {product.description && <p className="mb-5 text-[14.5px] leading-[23px] text-on-surface-variant">{product.description}</p>}

          {hasPriceTiers && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-outline">Precio por cant.:</span>
              {tierRanges.map((t) => {
                const isActive = Number(t.price) === Number(unitPrice);
                return (
                  <span
                    key={t.range}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold transition-all ${
                      isActive
                        ? "bg-tertiary-accent text-white shadow-sm"
                        : "bg-surface-container text-on-surface-variant"
                    }`}
                  >
                    <span className={`text-[10px] font-normal ${isActive ? "text-white/80" : "text-outline"}`}>{t.range}u</span>
                    {formatPrice(t.price, product.currency)}
                  </span>
                );
              })}
            </div>
          )}

          {hasSizes && (
            <div className="mb-5">
              <span className="mb-1.5 block text-label-md font-semibold text-on-surface">Talla</span>
              <div className="flex flex-wrap gap-2">
                {product.sizes.map((s) => {
                  const stockForSize = Number(product.sizeStock?.[s] ?? 0);
                  return (
                    <button
                      key={s}
                      type="button"
                      disabled={stockForSize === 0}
                      onClick={() => setSelectedSize(s)}
                      className={`rounded-full border-2 px-4 py-1.5 text-[13px] font-bold transition-colors ${
                        selectedSize === s
                          ? "border-tertiary-accent bg-tertiary-accent/10 text-tertiary-accent"
                          : stockForSize === 0
                          ? "cursor-not-allowed border-outline-variant text-outline/40 line-through"
                          : "border-outline-variant text-on-surface-variant"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mb-5 flex flex-wrap gap-2">
            {(product.paymentMethods ?? []).map((m) => (
              <span key={m} className="rounded-full bg-surface-container px-3 py-1.5 text-[12px] font-semibold text-on-surface-variant">
                {PAY_LABELS[m] ?? m}
              </span>
            ))}
          </div>

          {/* Bloque 68 (pedido explícito): antes acá había un atajo directo a
              wa.me que saltaba el carrito/checkout entero (para vendedores
              con orderDestination !== "PANEL") — el cliente podía pedir sin
              completar ningún dato. Ahora el cliente siempre pasa por
              "Agregar al carrito" → checkout con formulario obligatorio; el
              destino elegido por la tienda solo cambia qué se le ofrece
              DESPUÉS de confirmar el pedido (ver Checkout.jsx). */}
          <div className="mb-3.5 flex items-center gap-3.5">
            <div className="flex items-center rounded border border-outline-variant">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="flex h-[46px] w-10 items-center justify-center text-lg text-on-surface">
                <Minus className="h-4 w-4" />
              </button>
              <div className="w-[42px] text-center text-title-lg font-semibold">{qty}</div>
              <button
                onClick={() => setQty((q) => Math.min(q + 1, remainingStock || 1))}
                disabled={qty >= remainingStock}
                className={`flex h-[46px] w-10 items-center justify-center text-lg ${qty >= remainingStock ? "cursor-not-allowed text-outline/40" : "text-on-surface"}`}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
          {!product.unlimitedStock && product.stock === 0 ? (
            <RequestProductButton productId={product.id} />
          ) : (
            <button
              onClick={handleAddToCart}
              disabled={hasSizes ? !selectedSize || remainingStock === 0 : remainingStock === 0}
              className="mb-2 flex h-12 w-full items-center justify-center gap-2 rounded bg-secondary-container text-label-md font-bold text-on-secondary-container hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShoppingCart className="h-[18px] w-[18px]" />{" "}
              {hasSizes && !selectedSize ? "Elige una talla" : remainingStock === 0 ? "Sin stock disponible" : "Agregar al carrito"}
            </button>
          )}
          {cartQuantity > 0 && (
            <p className="mb-2 text-center text-[12.5px] font-semibold text-tertiary-accent">
              🛒 Ya tienes {cartQuantity} en tu carrito
              {remainingStock === 0 && product.stock > 0 && " · alcanzaste el máximo disponible"}
            </p>
          )}
          {added && (
            <div className="rounded bg-tertiary-accent/10 px-3.5 py-2.5 text-[13.5px] font-semibold text-tertiary-accent">
              ✓ Agregado al carrito
            </div>
          )}

          <div className="mt-5 grid grid-cols-1 gap-3 border-t border-surface-container-high pt-5 sm:grid-cols-2">
            <div className="flex items-center gap-2.5 text-[13px] text-on-surface-variant">
              <MapPin className="h-[17px] w-[17px] text-tertiary-accent" /> Entrega en {locationLabel}
            </div>
            <div className="flex items-center gap-2.5 text-[13px] text-on-surface-variant">
              <ShieldCheck className="h-[17px] w-[17px] text-tertiary-accent" /> Coordinas pago con el vendedor
            </div>
            {product.barcode && (
              <div className="flex items-center gap-2.5 text-[13px] text-on-surface-variant">
                <ScanBarcode className="h-[17px] w-[17px] text-tertiary-accent" /> Código: {product.barcode}
              </div>
            )}
            <div className="flex items-center gap-2.5 text-[13px] text-on-surface-variant">
              <CheckCircle2 className="h-[17px] w-[17px] text-tertiary-accent" /> {stockLabel}
            </div>
          </div>
        </div>
      </section>

      {/* RESEÑAS (Bloque 69, pedido explícito: "los productos también
          pueden llevar reseñas" — antes esta sección era de solo lectura,
          sin ningún formulario para publicar una nueva). Mismo patrón que
          Store.jsx, con `productId` sumado al payload. */}
      <section ref={reviewsRef} id="resenas" className="container-app pt-14">
        <h2 className="mb-1 font-display text-title-lg text-on-surface">Reseñas de clientes</h2>
        <p className="mb-5 text-label-sm text-outline">
          Públicas y visibles para todos. Solo compradores registrados pueden reseñar — 1 comentario por día por tienda.
        </p>

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
              placeholder={user ? "Escribe una reseña de este producto..." : "Inicia sesión para reseñar"}
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

          {/* Bloque 52 (criterio de Store.jsx): fotos solo en tiendas verificadas. */}
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
          reviews={product.reviews}
          vendorName={v?.companyName}
          onImageClick={(src) => setLightboxSrc(src)}
          currentUserId={user?.id}
          onReportClick={(review) => setReportTarget(review)}
        />
      </section>

      {/* RELACIONADOS */}
      {related?.length > 0 && (
        <section className="container-app py-14">
          <h2 className="mb-6 font-display text-title-lg text-on-surface">También te puede interesar</h2>
          <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
            {related.map((p) => (
              <Link
                key={p.id}
                to={`/producto/${p.vendor.slug}/${p.slug}`}
                className="block overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest shadow-sm"
              >
                <div className="aspect-[12/7] w-full overflow-hidden bg-surface-container">
                  {p.images?.[0] ? (
                    <img src={imgUrl(p.images[0])} alt={p.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-label-sm text-outline">Sin foto</div>
                  )}
                </div>
                <div className="p-3.5">
                  <div className="mb-1.5 text-[13.5px] font-semibold text-on-surface">{p.name}</div>
                  <div className="text-[15px] font-bold text-on-surface">{formatPrice(p.price, p.currency)}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Bloque 25: mismo gate que Store.jsx — sin Gemini/Groq activo el
          widget ni se monta. */}
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
