import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Minus, Plus, MessageCircle, ShoppingCart, MapPin, ShieldCheck, ScanBarcode, CheckCircle2 } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatPrice } from "../../lib/format.js";
import { waLink } from "../../lib/whatsapp.js";
import { useCart } from "../../context/CartContext.jsx";
import { VerifiedBadge } from "../../components/ui/VerifiedBadge.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { PageLoader } from "../../components/ui/PageLoader.jsx";
import { PackageSearch } from "lucide-react";
import { StoreChatWidget } from "../../components/StoreChatWidget.jsx";
import { StarRating } from "../../components/ui/StarRating.jsx";
import { RequestProductButton } from "../../components/RequestProductButton.jsx";

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

const PAY_LABELS = { whatsapp: "WhatsApp", cod: "Contra entrega", prepaid: "Transferencia CUP" };

export default function Product() {
  const { vendorSlug, productSlug } = useParams();
  const { addItem, items } = useCart();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedSize, setSelectedSize] = useState(null);

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

  if (isLoading) return <PageLoader label="Cargando producto..." />;

  if (!data?.product) {
    return (
      <div className="container-app py-14">
        <EmptyState icon={PackageSearch} title="Producto no encontrado" />
      </div>
    );
  }

  const { product, related } = data;
  const v = product.vendor;
  const hasSizes = product.sizes?.length > 0;
  // Bloque 52: con tallas, el stock real es el de la talla elegida (0 antes
  // de elegir ninguna) — sin tallas, sigue siendo Product.stock tal cual.
  const stockForSelection = hasSizes ? Number(product.sizeStock?.[selectedSize] ?? 0) : product.stock;
  const cartQuantity = items.find((i) => i.productId === product.id && i.size === (hasSizes ? selectedSize : null))?.quantity ?? 0;
  // Techo real: lo que ya tienes en el carrito cuenta contra el stock total,
  // así no se puede acumular más de lo disponible entre pantallas distintas.
  const remainingStock = Math.max(0, (stockForSelection ?? Infinity) - cartQuantity);
  const location = v.locations?.[0];
  const locationLabel = location ? `${location.municipality?.name ?? location.province?.name}` : "Cuba";
  const discount = product.oldPrice ? Math.round(100 - (Number(product.price) / Number(product.oldPrice)) * 100) : null;
  const stockLabel = hasSizes
    ? (selectedSize ? (stockForSelection > 0 ? (stockForSelection < 12 ? `Últimas ${stockForSelection} unidades` : "Disponible") : "Sin stock") : "Elige una talla")
    : product.stock > 0
    ? (product.stock < 12 ? `Últimas ${product.stock} unidades` : "Disponible")
    : "Sin stock";
  const waText = `Hola ${v.companyName}, quiero pedir: ${qty}× ${product.name}${selectedSize ? ` (talla ${selectedSize})` : ""} (${formatPrice(product.price, product.currency)} c/u). ¿Disponible?`;
  // Si el vendedor eligió recibir pedidos por su panel, no se ofrece el atajo
  // directo de WhatsApp — el cliente pasa por "Agregar al carrito" + checkout.
  const wantsPanel = v.orderDestination === "PANEL";

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
        currency: product.currency,
        stock: stockForSelection,
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

      <section className="container-app grid grid-cols-1 gap-11 pt-6 lg:grid-cols-2">
        {/* GALERÍA */}
        <div>
          <div className="mb-3 h-[420px] w-full overflow-hidden rounded-lg bg-surface-container">
            {product.images?.length ? (
              <img src={imgUrl(product.images[selectedImage] ?? product.images[0])} alt={product.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-label-sm text-outline">Sin fotos todavía</div>
            )}
          </div>
          {product.images?.length > 1 && (
            <div className="grid grid-cols-4 gap-2.5">
              {product.images.map((url, i) => (
                <button
                  key={url}
                  onClick={() => setSelectedImage(i)}
                  className={`h-[76px] w-full overflow-hidden rounded-md border-2 ${i === selectedImage ? "border-tertiary-accent" : "border-transparent"}`}
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
          <div className="mb-5 flex items-baseline gap-3">
            <span className="font-display text-3xl font-extrabold text-on-surface">{formatPrice(product.price, product.currency)}</span>
            {product.oldPrice && (
              <>
                <span className="text-[17px] text-outline line-through">{formatPrice(product.oldPrice, product.currency)}</span>
                <span className="rounded-full bg-error/10 px-2.5 py-1 text-[12px] font-bold text-error">-{discount}%</span>
              </>
            )}
          </div>
          {product.description && <p className="mb-5 text-[14.5px] leading-[23px] text-on-surface-variant">{product.description}</p>}

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
            {!wantsPanel && (
              <a
                href={waLink(v.whatsapp, waText)}
                target="_blank"
                rel="noreferrer"
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded bg-[#25D366] text-label-md font-bold text-white"
              >
                <MessageCircle className="h-[19px] w-[19px]" /> Pedir por WhatsApp
              </a>
            )}
          </div>
          {product.stock === 0 ? (
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

      {/* RESEÑAS */}
      <section className="container-app pt-14">
        <h2 className="mb-6 font-display text-title-lg text-on-surface">Reseñas de clientes</h2>
        {product.reviews?.length ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {product.reviews.map((r) => (
              <div key={r.id} className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-5">
                <div className="mb-2.5">
                  <StarRating value={r.rating} size="h-3.5 w-3.5" />
                </div>
                <p className="mb-3 text-[13.5px] leading-5 text-on-surface-variant">&ldquo;{r.comment}&rdquo;</p>
                <div className="text-label-md font-bold text-on-surface">{r.authorName}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-body-md text-on-surface-variant">Todavía no hay reseñas para este producto.</p>
        )}
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
                <div className="h-40 w-full overflow-hidden bg-surface-container">
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
    </div>
  );
}
