import { useEffect, useRef, useState } from "react";
import { shippingLabel } from "../../lib/shipping.js";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Minus, Plus, ShoppingCart, MapPin, ShieldAlert, CheckCircle2, Star, Camera, Clock, Globe2, MessageCircle, Tag, TrendingUp, Truck, X as XIcon } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatPrice } from "../../lib/format.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { describeReviewLimit } from "../../lib/reviewPolicy.js";
import { resolveUnitPrice, calcSavings, buildPriceTierRanges } from "../../lib/pricing.js";
import { useCart } from "../../context/CartContext.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { VerifiedBadge } from "../../components/ui/VerifiedBadge.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { Skeleton, SkeletonGroup } from "../../components/ui/Skeleton.jsx";
import { checkoutChoices, checkoutLabel } from "../../lib/catalog.js";
import { PackageSearch } from "lucide-react";
import { GatedStoreChat } from "../../components/GatedStoreChat.jsx";
import { ProductCard, PRODUCT_GRID_CLASS } from "../../components/ProductCard.jsx";
import { StarRating } from "../../components/ui/StarRating.jsx";
import { RequestProductButton } from "../../components/RequestProductButton.jsx";
import { ReviewsList } from "../../components/ReviewsList.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { ReportFraudModal } from "../../components/ReportFraudModal.jsx";
import { Lightbox } from "../../components/ui/Lightbox.jsx";
import { useSeo } from "../../lib/seo.js";
import { productSeo } from "../../lib/seoBuilders.js";

// Bloque 69 (pedido explícito): "los productos también pueden llevar
// reseñas" — mismas fotos que Store.jsx (solo tiendas verificadas).
const MAX_REVIEW_IMAGES = 2;

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

export default function Product() {
  const { vendorSlug, productSlug } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addItem, updateQuantity, items } = useCart();
  const { user } = useAuth();
  const { siteName, reviewDedupHours, maxReviewsPerProductPerPeriod } = usePlatformSettings();
  const [qty, setQty] = useState(1);
  // Texto que se está escribiendo en el campo de cantidad (null = no se está escribiendo).
  const [qtyDraft, setQtyDraft] = useState(null);
  const [added, setAdded] = useState(false);
  const [selectedImage, setSelectedImage] = useState(0);
  const [prevImage, setPrevImage] = useState(null);
  const [fading, setFading] = useState(false);
  const [selectedSize, setSelectedSize] = useState(null);
  // Bloque 69 (pedido explícito): reseña propia del PRODUCTO — mismo patrón
  // que Store.jsx (comentario general de la tienda), acá con `productId`
  // sumado al payload para que quede ligada a esta ficha puntual.
  const [commentText, setCommentText] = useState("");
  const [commentTitle, setCommentTitle] = useState("");
  const [commentRating, setCommentRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [reviewImages, setReviewImages] = useState([]);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);
  const [reportReason, setReportReason] = useState("");
  // Feature B (pedido explícito): reportar ESTE producto por fraude —
  // distinto de reportTarget/reportReason de arriba (eso es reportar un
  // comentario de reseña, no el producto en sí).
  const [reportFraudOpen, setReportFraudOpen] = useState(false);
  const autoplayRef = useRef(null);
  const fadeTimerRef = useRef(null);
  const reviewsRef = useRef(null);

  const { data, isLoading } = useQuery({
    queryKey: ["product", vendorSlug, productSlug],
    queryFn: async () => (await api.get(`/products/${vendorSlug}/${productSlug}`)).data,
    // El stock de la ficha tiene que ser el real: con los 5 minutos de caché general, un producto que otra persona acababa
    // de agotar seguía mostrando unidades. Se vuelve a pedir cada 30 s con la pestaña a la vista y al volver a ella; el
    // selector de cantidad ya se ajusta solo si baja (ver remainingStock).
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  // Enlace anterior de la tienda: la dirección pasa al enlace actual (mismo criterio que Store.jsx).
  const currentVendorSlug = data?.product?.vendor?.slug;
  useEffect(() => {
    if (currentVendorSlug && currentVendorSlug !== vendorSlug) navigate(`/producto/${currentVendorSlug}/${productSlug}${window.location.search}${window.location.hash}`, { replace: true });
  }, [currentVendorSlug, vendorSlug, productSlug, navigate]);

  // Reinicia la miniatura seleccionada al navegar a otro producto (ej. desde
  // "También te puede interesar") — la ruta cambia pero el componente no se
  // remonta, así que el índice viejo podía apuntar a otra foto. La talla
  // seleccionada también se reinicia — no tiene sentido arrastrarla de un
  // producto a otro.
  useEffect(() => {
    setSelectedImage(0);
    setSelectedSize(null);
  }, [data?.product?.id]);

  // Mirar un producto cuenta como visita a la tienda (recordatorio de puntos u ofertas a los 3 días, si no compra).
  const productVendorId = data?.product?.vendorId;
  useEffect(() => {
    if (!productVendorId || user?.role !== "CUSTOMER") return;
    api.post("/loyalty/visits", { vendorId: productVendorId }).catch(() => {});
  }, [productVendorId, user?.role]);

  // Bloque 98 (pedido explícito): señales reales para el algoritmo de
  // "Destacados" (ver backend/src/lib/productRanking.js) — vista real
  // (dedupeada por sessionStorage: recargar la misma ficha en la misma
  // pestaña no infla el contador) y tiempo de permanencia. El efecto va con
  // `data?.product?.id` como dependencia (no un mount vacío []) porque
  // "También te puede interesar" navega a otro producto SIN desmontar este
  // componente (mismo patrón que el useEffect de arriba) — así se dispara
  // una vez por producto real, no una vez por vida del componente.
  useEffect(() => {
    const productId = data?.product?.id;
    if (!productId) return;

    const viewedKey = `zeudin_viewed_${productId}`;
    if (!sessionStorage.getItem(viewedKey)) {
      sessionStorage.setItem(viewedKey, "1");
      api.post(`/products/${productId}/track-view`).catch(() => {});
    }

    let mountTime = Date.now();
    function flushDwell() {
      const ms = Date.now() - mountTime;
      mountTime = Date.now();
      if (ms < 500) return; // rebote casi instantáneo, no cuenta como visita real
      const blob = new Blob([JSON.stringify({ ms })], { type: "application/json" });
      navigator.sendBeacon(`${api.defaults.baseURL}/products/${productId}/track-dwell`, blob);
    }
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") flushDwell();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flushDwell);

    return () => {
      flushDwell();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flushDwell);
    };
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
      if (commentTitle.trim()) form.append("title", commentTitle.trim());
      form.append("comment", commentText.trim());
      if (commentRating) form.append("rating", String(commentRating));
      reviewImages.forEach((file) => form.append("images", file));
      return (await api.post("/reviews", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      setCommentText("");
      setCommentTitle("");
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
  const remainingStock = product ? Math.max(0, stockForSelection ?? Infinity) : Infinity;
  // La cantidad del control es la que queda en el carrito: si ya hay unidades de este producto (y talla), arranca en esa cifra y el
  // botón solo ofrece "Actualizar carrito" cuando la cambias. Así no se duplican líneas ni se suman unidades por error.
  const qtyChanged = cartQuantity > 0 && qty !== cartQuantity;

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

  useEffect(() => {
    setQty(cartQuantity > 0 ? Math.min(cartQuantity, remainingStock || cartQuantity) : 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, selectedSize, cartQuantity]);

  // Bloque 69 (mismo criterio que Store.jsx): si venimos de /cuenta?next=...
  // #resenas tras loguearnos para reseñar, llevar la vista directo ahí.
  useEffect(() => {
    if (window.location.hash === "#resenas" && reviewsRef.current) {
      reviewsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [data]);

  useSeo(productSeo(product, siteName), [product?.id, siteName]);

  if (isLoading) return <ProductDetailSkeleton />;

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
  // Bloque 254: líneas de información real bajo el botón de compra.
  const store = product.storeInfo;
  const stockText = product.unlimitedStock
    ? "Siempre disponible"
    : hasSizes
    ? selectedSize
      ? stockForSelection > 0
        ? `${stockForSelection} ${stockForSelection === 1 ? "unidad disponible" : "unidades disponibles"} en talla ${selectedSize}`
        : "Sin stock en esta talla"
      : "Elige una talla para ver cuántas hay"
    : product.stock > 0
    ? `${product.stock} ${product.stock === 1 ? "unidad disponible" : "unidades disponibles"}`
    : "Sin stock por ahora";
  const orderText =
    v.orderDestination === "PANEL"
      ? "Pides desde esta página y llega directo a la tienda"
      : "Pides desde esta página y llega directo a la tienda. Si quieres, también se lo envías por WhatsApp";
  const areas = store?.serviceAreas ?? [];
  const areasText = areas.length > 3 ? `${areas.slice(0, 3).join(", ")} y ${areas.length - 3} más` : areas.join(", ");
  const infoRows = [
    { key: "stock", Icon: CheckCircle2, text: stockText },
    // Envío vigente: el de la tienda manda sobre el del producto (ver lib/shipping.js).
    { key: "shipping", Icon: Truck, text: shippingLabel(product, v).text },
    product.salesCount > 0 && { key: "sales", Icon: TrendingUp, text: `${product.salesCount} ${product.salesCount === 1 ? "vendido" : "vendidos"}` },
    store?.isOpenNow === true && { key: "open", Icon: Clock, text: "Tienda abierta ahora" },
    store?.isOpenNow === false && { key: "closed", Icon: Clock, text: store.nextOpenLabel ? `Tienda cerrada ahora. ${store.nextOpenLabel}` : "Tienda cerrada ahora" },
    areas.length > 0 && { key: "areas", Icon: MapPin, text: `Atiende en ${areasText}` },
    store?.deliveryCountries?.length > 0 && { key: "intl", Icon: Globe2, text: `También entrega en ${store.deliveryCountries.join(", ")}` },
    { key: "order", Icon: MessageCircle, text: orderText },
    product.category?.name && { key: "cat", Icon: Tag, text: `Categoría: ${product.category.name}` },
  ].filter(Boolean);
  function handleAddToCart() {
    if (hasSizes && !selectedSize) {
      toast.error("Elige una talla primero.");
      return;
    }
    // Bug real reportado en vivo (con captura, mismo bug que
    // AddToCartControl.jsx): este toast salía siempre, incluso cuando
    // `addItem` solo abrió CartConflictModal sin agregar nada de verdad
    // (carrito con otra tienda) — el toast de éxito solo sale si `addItem`
    // confirma que agregó de verdad.
    if (cartQuantity > 0) {
      if (qty === cartQuantity) return;
      updateQuantity(product.id, qty, hasSizes ? selectedSize : null);
      toast.success("Carrito actualizado", `${qty} × ${product.name}`, { icon: "cart" });
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
      return;
    }
    const result = addItem(
      {
        id: product.id,
        name: product.name,
        // Bloque 147: mismo campo que ya usa AddToCartControl.jsx/SharedCart
        // — sin esto, el carrito nunca podía mostrar la foto ni linkear a
        // la ficha del producto (bug real reportado en vivo).
        image: product.images?.[0] ?? null,
        slug: product.slug ?? null,
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
    if (result.conflict) return;
    toast.success("Agregado al carrito", `${Math.min(qty, remainingStock)} × ${product.name}`, { icon: "cart" });
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
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <Link to={`/tienda/${v.slug}`} className="inline-flex items-center gap-1.5 text-label-md font-bold text-tertiary-accent">
              {v.companyName}
              {v.isVerified && <VerifiedBadge size="sm" />}
            </Link>
            {/* Pedido explícito: solo visible para clientes logueados —
                antes se mostraba siempre y redirigía a login al click, ahora
                directamente no aparece si no hay sesión de cliente. */}
            {user?.role === "CUSTOMER" && (
              <button
                onClick={() => setReportFraudOpen(true)}
                className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-outline hover:text-error"
              >
                <ShieldAlert className="h-3.5 w-3.5" /> Reportar estafa
              </button>
            )}
          </div>
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
            {/* Bug real reportado en vivo (con captura): "table" es un valor
                interno del enum `paymentMethods` (products.controller.js)
                que quedó de datos de siembra viejos — no es un método de
                pago real que el vendedor pueda elegir hoy (el pedido por
                mesa/QR es un campo aparte, `availableForTableMenu`, ver
                VendorProducts.jsx) ni algo que el cliente entienda al
                leerlo tal cual. Se filtra en vez de traducirlo — no
                corresponde mostrarlo como si fuera un método de pago. */}
            {(store?.checkoutPaymentOptions?.length ? store.checkoutPaymentOptions : checkoutChoices().map((o) => o.id)).filter((id) => checkoutChoices().some((o) => o.id === id)).map((id) => (
              <span key={id} className="rounded-full bg-surface-container px-3 py-1.5 text-[12px] font-semibold text-on-surface-variant">
                {checkoutLabel(id)}
              </span>
            ))}
            {/* Pedido explícito: en vez de dejar ese espacio con el valor
                crudo/confuso de arriba, un producto sin stock real muestra
                acá mismo una pastilla "Agotado" — mismo criterio de color
                que el badge "Sin stock" de ProductCard.jsx. */}
            {!product.unlimitedStock && product.stock === 0 && (
              <span className="rounded-full bg-error/10 px-3 py-1.5 text-[12px] font-bold text-error">Agotado</span>
            )}
          </div>

          {/* Bloque 68 (pedido explícito): antes acá había un atajo directo a
              wa.me que saltaba el carrito/checkout entero (para vendedores
              con orderDestination !== "PANEL") — el cliente podía pedir sin
              completar ningún dato. Ahora el cliente siempre pasa por
              "Agregar al carrito" → checkout con formulario obligatorio; el
              destino elegido por la tienda solo cambia qué se le ofrece
              DESPUÉS de confirmar el pedido (ver Checkout.jsx). */}
          {/* Bug real reportado en vivo (con captura): el stepper se mostraba
              SIEMPRE, incluso sin stock real disponible — y el botón "-"
              tenía un piso de `Math.max(1, q - 1)` que nunca lo dejaba bajar
              de 1, así que un producto sin stock mostraba "1" para siempre.
              Sin stock, el botón de abajo pasa a "Solicitar este producto"
              (RequestProductButton), que no usa ninguna cantidad — el
              stepper no tiene sentido ahí, así que se oculta del todo en vez
              de mostrar un número que no representa nada real. */}
          {!product.unlimitedStock && product.stock === 0 ? (
            <RequestProductButton productId={product.id} alreadyRequested={product.alreadyRequested} />
          ) : (
            <div
              className={`mb-2 flex h-12 w-full items-stretch overflow-hidden rounded-full border ${
                cartQuantity > 0 && !qtyChanged ? "border-tertiary-accent/40 bg-tertiary-accent/10" : "border-transparent bg-secondary-container"
              } ${hasSizes && !selectedSize ? "opacity-60" : ""}`}
            >
              {remainingStock > 0 && (!hasSizes || selectedSize) && (
                <div className="flex flex-shrink-0 items-center border-r border-black/10">
                  <button
                    type="button"
                    aria-label="Menos unidades"
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    disabled={qty <= 1}
                    className="flex h-full w-11 items-center justify-center text-on-secondary-container disabled:opacity-40"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-label="Cantidad"
                    value={qtyDraft ?? String(qty)}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                      setQtyDraft(digits);
                      const n = Number(digits);
                      if (n >= 1) setQty(Math.min(n, remainingStock || 1));
                    }}
                    onBlur={() => {
                      // Al terminar de escribir se respeta el stock real disponible de esta selección (talla incluida).
                      const n = Number(qtyDraft);
                      if (qtyDraft !== null && n > remainingStock && Number.isFinite(remainingStock)) toast.error(`Solo hay ${remainingStock} ${remainingStock === 1 ? "unidad disponible" : "unidades disponibles"}.`);
                      setQty(Math.max(1, Math.min(n || 1, remainingStock || 1)));
                      setQtyDraft(null);
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
                    className="h-full w-12 bg-transparent text-center text-[15px] font-bold text-on-secondary-container outline-none"
                  />
                  <button
                    type="button"
                    aria-label="Más unidades"
                    onClick={() => setQty((q) => Math.min(q + 1, remainingStock || 1))}
                    disabled={qty >= remainingStock}
                    className="flex h-full w-11 items-center justify-center text-on-secondary-container disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={handleAddToCart}
                disabled={hasSizes ? !selectedSize || remainingStock === 0 : remainingStock === 0}
                className="flex min-w-0 flex-1 items-center justify-center gap-2 px-3 text-label-md font-bold text-on-secondary-container hover:brightness-95 disabled:cursor-not-allowed"
              >
                <ShoppingCart className="h-[18px] w-[18px] flex-shrink-0" />
                <span className="truncate">
                  {hasSizes && !selectedSize ? "Elige una talla" : remainingStock === 0 ? "Sin stock disponible" : qtyChanged ? "Actualizar carrito" : cartQuantity > 0 ? "En tu carrito" : "Agregar al carrito"}
                </span>
              </button>
            </div>
          )}
          {cartQuantity > 0 && cartQuantity >= remainingStock && remainingStock > 0 && (
            <p className="mb-2 text-center text-[12.5px] font-semibold text-tertiary-accent">
              Tienes en el carrito todo lo disponible.
            </p>
          )}
          {added && (
            <div className="rounded bg-tertiary-accent/10 px-3.5 py-2.5 text-[13.5px] font-semibold text-tertiary-accent">
              ✓ Agregado al carrito
            </div>
          )}

          {/* Bloque 254 (pedido explícito): antes esta zona era texto fijo ("Entrega
              en <primera ubicación>", "Coordinas pago con el vendedor") y el código
              de barras, que ya no se usa en el panel del vendedor. Ahora son datos
              reales que ayudan a decidir: cuánto hay, cuántos se vendieron, si la
              tienda está abierta, dónde atiende, a qué países entrega y cómo se hace
              el pedido. Cada línea aparece solo si el dato existe. */}
          <ul className="mt-5 grid grid-cols-1 gap-3 border-t border-surface-container-high pt-5 sm:grid-cols-2">
            {infoRows.map(({ key, Icon, text }) => (
              <li key={key} className="flex items-start gap-2.5 text-[13px] leading-5 text-on-surface-variant">
                <Icon className="mt-0.5 h-[17px] w-[17px] flex-shrink-0 text-tertiary-accent" aria-hidden="true" /> <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* RESEÑAS (Bloque 69, pedido explícito: "los productos también
          pueden llevar reseñas" — antes esta sección era de solo lectura,
          sin ningún formulario para publicar una nueva). Mismo patrón que
          Store.jsx, con `productId` sumado al payload. */}
      <section ref={reviewsRef} id="resenas" className="container-app pb-16 pt-14 sm:pb-20">
        <h2 className="mb-1 font-display text-title-lg text-on-surface">Reseñas de clientes</h2>
        <p className="mb-5 text-label-sm text-outline">
          Públicas y visibles para todos. Solo compradores registrados pueden reseñar —{" "}
          {describeReviewLimit(reviewDedupHours, maxReviewsPerProductPerPeriod, "producto")}.
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
          {user && (
            <input
              value={commentTitle}
              onChange={(e) => setCommentTitle(e.target.value.slice(0, 40))}
              maxLength={40}
              placeholder="Título corto (opcional)"
              aria-label="Título de tu comentario (opcional)"
              className="mb-2.5 h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3.5 text-body-md outline-none"
            />
          )}
          <div className="flex gap-2.5">
            <input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onFocus={() => {
                if (!user) goToReviewLogin();
              }}
              placeholder={user ? "Escribe una reseña de este producto..." : "Inicia sesión para reseñar"}
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

        <ReviewsList
          reviews={product.reviews}
          vendorName={v?.companyName}
          onImageClick={(src) => setLightboxSrc(src)}
          currentUserId={user?.id}
          onReportClick={(review) => (user ? setReportTarget(review) : goToReviewLogin())}
        />
      </section>

      {/* RELACIONADOS */}
      {related?.length > 0 && (
        <section className="container-app py-14">
          <h2 className="mb-6 font-display text-title-lg text-on-surface">También te puede interesar</h2>
          <div className={PRODUCT_GRID_CLASS}>
            {related.map((p) => (
              <ProductCard key={p.id} product={p} trackSource="catalog" />
            ))}
          </div>
        </section>
      )}

      {/* Bloque 25: mismo gate que Store.jsx — sin Gemini/Groq activo el
          widget ni se monta. */}
      {v.isVerified && v.aiAvailable && <GatedStoreChat vendor={v} />}

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

      <ReportFraudModal
        open={reportFraudOpen}
        onClose={() => setReportFraudOpen(false)}
        targetField="productId"
        targetId={product.id}
        targetLabel={`el producto "${product.name}"`}
      />
    </div>
  );
}

// Esqueleto de la ficha: misma ruta de migas, misma grilla (galería de 600px a la izquierda en escritorio) y el panel de compra
// con tienda, nombre, valoración, precio, descripción, opciones y botones, en el orden en que aparecen al cargar.
function ProductDetailSkeleton() {
  return (
    <SkeletonGroup label="Cargando producto">
      <div className="container-app pt-6" aria-hidden="true">
        <Skeleton width={220} height={12} />
      </div>
      <section className="container-app grid grid-cols-1 gap-8 pt-6 lg:grid-cols-[600px_1fr] lg:gap-11" aria-hidden="true">
        <div className="mx-auto w-full max-w-[600px] lg:mx-0">
          <div className="mb-3 aspect-[7/4] w-full">
            <Skeleton height="100%" borderRadius={12} containerClassName="block h-full leading-none" />
          </div>
          <div className="flex gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} width={64} height={64} borderRadius={10} />
            ))}
          </div>
        </div>
        <div className="min-w-0">
          <Skeleton width="35%" height={13} className="mb-2.5" />
          <Skeleton height={30} />
          <Skeleton width="60%" height={30} className="mb-2.5" />
          <Skeleton width="45%" height={14} className="mb-5" />
          <Skeleton width={160} height={34} className="mb-4" />
          <Skeleton count={3} height={14} />
          <Skeleton width="70%" height={14} className="mb-5" />
          <div className="mb-5 flex gap-2">
            <Skeleton width={90} height={34} borderRadius={999} />
            <Skeleton width={110} height={34} borderRadius={999} />
          </div>
          <Skeleton height={48} borderRadius={12} className="mb-3" />
          <Skeleton height={48} borderRadius={12} />
        </div>
      </section>
    </SkeletonGroup>
  );
}
