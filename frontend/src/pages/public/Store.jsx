import { useState, useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { MessageCircle, ShieldAlert, Share2, Heart, Check, ShieldCheck, Star } from "lucide-react";
import { api } from "../../lib/api.js";
import { waLink } from "../../lib/whatsapp.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { VerifiedBadge } from "../../components/ui/VerifiedBadge.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { AddToCartControl } from "../../components/AddToCartControl.jsx";
import { PageLoader } from "../../components/ui/PageLoader.jsx";
import { Store as StoreIcon } from "lucide-react";
import { resolvePaymentMethod } from "../../lib/paymentMethods.js";
import { StoreChatWidget } from "../../components/StoreChatWidget.jsx";
import { StarRating } from "../../components/ui/StarRating.jsx";
import { RequestProductButton } from "../../components/RequestProductButton.jsx";

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

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

function imgUrl(path) {
  return `${api.defaults.baseURL}${path}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" });
}

export default function Store() {
  const { slug } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState("");
  const [commentRating, setCommentRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const trackedVisitRef = useRef(null);

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
    mutationFn: async () =>
      (
        await api.post("/reviews", {
          vendorId: data.id,
          comment: commentText.trim(),
          rating: commentRating || undefined,
        })
      ).data,
    onSuccess: () => {
      setCommentText("");
      setCommentRating(0);
      toast.success("¡Comentario publicado!");
      queryClient.invalidateQueries({ queryKey: ["vendor", slug] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo publicar el comentario."),
  });

  function handleShare() {
    navigator.clipboard
      .writeText(window.location.href)
      .then(showLinkCopiedToast)
      .catch(() => toast.error("No se pudo copiar el enlace."));
  }

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
        <div className="container-app flex flex-wrap items-end gap-5 py-9">
          <div className="flex h-[88px] w-[88px] flex-shrink-0 items-center justify-center rounded-full border-[3px] border-white/50 bg-white/10 font-display text-4xl font-extrabold text-white">
            {v.companyName[0]}
          </div>
          <div className="min-w-[220px] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-headline-md text-white">{v.companyName}</h1>
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
          <div className="flex flex-shrink-0 items-center gap-2.5">
            <button
              onClick={handleShare}
              aria-label="Compartir tienda"
              title="Compartir tienda"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
            >
              <Share2 className="h-[18px] w-[18px]" />
            </button>
            {user && (
              <button
                onClick={() => toggleFavorite.mutate()}
                disabled={toggleFavorite.isPending}
                aria-label={myFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
                title={myFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 disabled:opacity-60"
              >
                <Heart className={`h-[18px] w-[18px] ${myFavorite ? "fill-white" : "fill-none"}`} />
              </button>
            )}
            <a
              href={waLink(v.whatsapp, `Hola ${v.companyName}, tengo una consulta sobre sus productos.`)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded bg-[#25D366] px-5 py-3 text-label-md font-bold text-white"
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
                <div className="text-[12.5px] text-outline">Escaneá el QR de tu mesa o mirá el menú online</div>
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
              <div key={p.id} className="overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest shadow-sm">
                <Link to={`/producto/${v.slug}/${p.slug}`} className="block">
                  <div className="h-40 w-full overflow-hidden bg-surface-container">
                    {p.images?.[0] ? (
                      <img src={imgUrl(p.images[0])} alt={p.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-label-sm text-outline">Sin foto</div>
                    )}
                  </div>
                </Link>
                <div className="p-3.5">
                  <Link to={`/producto/${v.slug}/${p.slug}`} className="mb-1.5 block text-[13.5px] font-semibold leading-[18px] text-on-surface">
                    {p.name}
                  </Link>
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] font-bold text-on-surface">{fmtCUP(p.price)}</span>
                    <AddToCartControl product={{ ...p, vendorId: v.id, vendor: v }} size="sm" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-body-md text-on-surface-variant">
            {outOfStockProducts.length
              ? "Todos los productos de esta tienda están agotados por ahora — mirá “Próximamente disponibles” más abajo."
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
              <div key={p.id} className="overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest shadow-sm">
                <Link to={`/producto/${v.slug}/${p.slug}`} className="relative block">
                  <div className="h-40 w-full overflow-hidden bg-surface-container">
                    {p.images?.[0] ? (
                      <img src={imgUrl(p.images[0])} alt={p.name} className="h-full w-full object-cover grayscale" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-label-sm text-outline">Sin foto</div>
                    )}
                  </div>
                  <span className="absolute left-2 top-2 rounded-full bg-[#ba1a1a] px-2.5 py-1 text-[10.5px] font-bold text-white shadow">
                    Sin stock
                  </span>
                </Link>
                <div className="p-3.5">
                  <Link to={`/producto/${v.slug}/${p.slug}`} className="mb-1.5 block text-[13.5px] font-semibold leading-[18px] text-on-surface">
                    {p.name}
                  </Link>
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] font-bold text-on-surface">{fmtCUP(p.price)}</span>
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
            Coordinás el pago directo con {v.companyName} — ZeuDin no cobra ni interviene en la transacción.
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
      <div className="container-app pt-11">
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
              placeholder={user ? "Escribí un comentario..." : "Iniciá sesión para comentar"}
              disabled={!user}
              className="h-11 flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3.5 text-body-md outline-none disabled:opacity-60"
            />
            <button
              onClick={() => commentText.trim() && postComment.mutate()}
              disabled={!user || !commentText.trim() || postComment.isPending}
              className="rounded bg-primary-container px-5 text-label-md font-bold text-white disabled:opacity-50"
            >
              Publicar
            </button>
          </div>
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
    </div>
  );
}
