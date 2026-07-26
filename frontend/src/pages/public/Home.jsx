import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, MapPin, MessageCircle, Store, ShieldCheck, Rocket } from "lucide-react";
import { api } from "../../lib/api.js";
import { useZone } from "../../context/LocationContext.jsx";
import { ProductCard } from "../../components/ProductCard.jsx";
import { VerifiedStoresSlider } from "../../components/VerifiedStoresSlider.jsx";
import { OffersSlider } from "../../components/OffersSlider.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { CategoryIcon } from "../../components/ui/CategoryIcon.jsx";
import { MarketplaceChatWidget } from "../../components/MarketplaceChatWidget.jsx";

// Bloque 48 (reemplaza el Embla-con-flechas del Bloque 47 — pedido
// explícito del dueño del negocio: puramente decorativo, sin ningún
// control manual): marquee continuo de una sola dirección. La lista se
// duplica una vez — con la animación en loop yendo de 0% a -50% del ancho
// del track duplicado, el frame final es visualmente idéntico al inicial,
// así que el reinicio del keyframe nunca se nota (nunca "vuelve atrás").
// El fade en los bordes es un mask-image — no hay utilidad de Tailwind
// para esto, así que va como estilo inline en vez de forzarlo a una clase.
const EDGE_FADE_MASK =
  "linear-gradient(to right, transparent 0, black 40px, black calc(100% - 40px), transparent 100%)";

function CategoryMarquee({ categories }) {
  const track = [...categories, ...categories];

  return (
    <div
      className="overflow-hidden"
      style={{ WebkitMaskImage: EDGE_FADE_MASK, maskImage: EDGE_FADE_MASK }}
    >
      <div className="category-marquee-track flex w-max animate-marquee gap-2.5">
        {track.map((c, i) => (
          <Link
            key={`${c.id}-${i}`}
            to={`/tiendas?businessCategoryId=${c.id}`}
            className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-outline-variant bg-surface-container-lowest px-3 py-1.5 hover:border-primary-container"
          >
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-tertiary-accent/10">
              <CategoryIcon name={c.icon} className="h-3 w-3 text-tertiary-accent" />
            </span>
            <span className="text-label-sm text-on-surface-variant">{c.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// Bloque 16: la comparación de planes Regular/Business se sacó del Home —
// ya no es un gancho de marketing en la home pública. Ahora vive solo dentro
// del panel de vendedor (ver VendorVerification.jsx), como algo que el
// vendedor explora si quiere, no como algo que ve un visitante anónimo.
function SectionHead({ eyebrow, title, subtitle, to, cta = "Ver todo →" }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        {eyebrow}
        <h2 className="font-display text-headline-lg-mobile text-on-surface md:text-headline-lg">{title}</h2>
        {subtitle && <p className="mt-1 text-label-sm text-outline">{subtitle}</p>}
      </div>
      {to && (
        <Link to={to} className="flex-shrink-0 text-label-md font-semibold text-tertiary-accent hover:underline">
          {cta}
        </Link>
      )}
    </div>
  );
}

export default function Home() {
  const { provinceId, provinceName, hasProvinceFilter, loading: zoneLoading } = useZone();

  // Bloque 20: la sección de categorías de PRODUCTO (7 pills fijas) se sacó
  // del Home — quedó solo esta, la de tipo de negocio de la tienda, ahora
  // bajo el título "Explorá por categoría".
  const { data: businessCategories } = useQuery({
    queryKey: ["business-categories"],
    queryFn: async () => (await api.get("/business-categories")).data.categories,
  });

  const { data: featured } = useQuery({
    queryKey: ["home-featured", provinceId],
    queryFn: async () => (await api.get("/search", { params: { provinceId: provinceId || undefined } })).data.products,
    enabled: !zoneLoading,
  });

  const { data: verifiedVendors } = useQuery({
    queryKey: ["home-verified-vendors", provinceId],
    queryFn: async () => (await api.get("/vendors", { params: { isVerified: true, provinceId: provinceId || undefined } })).data.vendors,
    enabled: !zoneLoading,
  });

  // Bloque 50: sin fallback de "no hay ofertas" — si vuelve vacío, la
  // sección entera no se monta (ver el render condicional más abajo), a
  // diferencia de Destacados/Tiendas verificadas que sí muestran un EmptyState.
  const { data: offers } = useQuery({
    queryKey: ["home-active-offers"],
    queryFn: async () => (await api.get("/offers/active")).data.offers,
  });

  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  const heroImageUrl = settings?.heroImageUrl ? `${api.defaults.baseURL}${settings.heroImageUrl}` : null;

  return (
    <>
    <div>
      {/* HERO — esquinas inferiores redondeadas (Bloque 20), mismo radio que
          el footer (rounded-t-[28px] en Footer.jsx) para que la curva de
          inicio y la de cierre de página usen la misma inclinación. */}
      <section className="rounded-b-[28px] bg-gradient-to-b from-primary-container to-primary">
        <div className="container-app grid grid-cols-1 items-center gap-10 py-14 lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:py-16">
          <div>
            <span className="mb-5 inline-flex items-center gap-1.5 rounded-full bg-secondary-container/15 px-3.5 py-1.5 text-label-sm font-bold tracking-wide text-secondary-container">
              🇨🇺 HECHO PARA CUBA · 16 PROVINCIAS
            </span>
            <h1 className="mb-4 font-display text-headline-lg text-white md:text-display-lg">
              Compra y vende cerca tuyo, de <span className="text-secondary-container">vendedores</span> de tu provincia.
            </h1>
            <p className="mb-7 max-w-[500px] text-body-lg text-white/70">
              Productos, comida y servicios de tiendas locales. Pide directo por WhatsApp, paga contra entrega o por
              transferencia. Sin comisiones para el vendedor.
            </p>
            <div className="mb-8 flex flex-wrap gap-3.5">
              <Link
                to="/catalogo"
                className="flex items-center gap-2 rounded bg-secondary-container px-6 py-3.5 text-label-md text-on-secondary-container hover:brightness-95"
              >
                {hasProvinceFilter ? `Explorar en ${provinceName}` : "Explorar todo el catálogo"} <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/tiendas"
                className="rounded border-[1.5px] border-white/30 px-6 py-3.5 text-label-md text-white hover:bg-white/10"
              >
                Ver tiendas
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2 text-[13px] text-white/70">
                <MessageCircle className="h-[18px] w-[18px] text-[#25D366]" />
                Pedido por WhatsApp
              </div>
              <div className="flex items-center gap-2 text-[13px] text-white/70">
                <Store className="h-[18px] w-[18px] text-secondary-container" />
                Registro gratis para vendedores
              </div>
            </div>
          </div>

          <div className="relative h-[320px] lg:h-[400px]">
            {heroImageUrl ? (
              <img src={heroImageUrl} alt={settings?.siteName || "ZeuDin"} className="h-full w-full rounded-xl object-cover" />
            ) : (
              <div className="h-full w-full rounded-xl bg-white/10" />
            )}
            <div className="absolute right-0 top-5 flex items-center gap-2.5 rounded-md bg-white px-4 py-3 shadow-lg lg:-right-3.5">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-[#128C7E]/15">
                <MessageCircle className="h-[18px] w-[18px] text-[#128C7E]" />
              </span>
              <div>
                <div className="text-label-sm font-bold text-on-surface">Pide por WhatsApp</div>
                <div className="text-[11px] text-on-surface-variant">Respuesta directa</div>
              </div>
            </div>
            <div className="absolute bottom-5 left-0 flex items-center gap-2.5 rounded-md bg-white px-4 py-3 shadow-lg lg:-left-3.5">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-secondary-container/12">
                <MapPin className="h-[18px] w-[18px] text-secondary" />
              </span>
              <div>
                <div className="text-label-sm font-bold text-on-surface">Filtrado por tu zona</div>
                <div className="text-[11px] text-on-surface-variant">Provincia y municipio</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CATEGORÍAS (Bloque 18: en realidad es tipo de negocio de la tienda,
          filtra TIENDAS por rubro — ver Stores.jsx). Bloque 20: se sacó la
          sección vieja de categorías de PRODUCTO (7 pills fijas) y esta —
          antes titulada "Explorá por tipo de negocio" — pasó a quedarse con
          el título "Explorá por categoría" y a mostrarse en marquee continuo
          (son 49, no entraban cómodas en un scroll horizontal manual). */}
      {businessCategories?.length > 0 && (
        <section className="container-app pt-11">
          <SectionHead title="Explorá por categoría" to="/tiendas" />
          <CategoryMarquee categories={businessCategories} />
        </section>
      )}

      {/* OFERTAS (Bloque 50) — render condicional total: sin ofertas
          activas, la sección ni se monta (nada de placeholder/skeleton
          permanente, pedido explícito del bloque). */}
      {offers?.length > 0 && (
        <section className="container-app pt-11">
          <SectionHead title="Ofertas de la semana" subtitle="De tiendas verificadas y de la casa" />
          <OffersSlider offers={offers} />
        </section>
      )}

      {/* PRODUCTOS DESTACADOS */}
      <section className="container-app pt-11">
        <SectionHead
          title={hasProvinceFilter ? `Destacados en ${provinceName}` : "Destacados en toda Cuba"}
          subtitle={hasProvinceFilter ? "De tiendas verificadas cerca tuyo" : "De tiendas verificadas en todo el país"}
          to="/catalogo"
          cta="Ver catálogo →"
        />
        {featured?.length ? (
          // Bloque 50 (pedido explícito: el grid fijo de 2 columnas del
          // Bloque 48 se veía igual de "vacío" en pantalla grande que en
          // mobile — acá se agregan más columnas a medida que crece el
          // viewport, con tarjetas más chicas y un grid más moderno/denso,
          // sin tocar mobile (sigue en 2). Tope sube de 10 a 20 — nunca se
          // rellena con nada inventado si hay menos disponibles.
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 md:grid-cols-4 lg:grid-cols-5">
            {featured.slice(0, 20).map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Todavía no hay productos en tu zona"
            description="Prueba explorando el catálogo completo o cambia de provincia arriba."
            action={
              <Link to="/catalogo" className="text-label-md font-semibold text-tertiary-accent hover:underline">
                Ver catálogo completo →
              </Link>
            }
          />
        )}
      </section>

      {/* PUBLICIDAD DEL MARKETPLACE — recluta vendedores, no promociona una
          tienda puntual (antes esta sección promocionaba sabor-criollo). */}
      <section className="container-app pt-11">
        <div className="flex flex-wrap items-center justify-between gap-6 rounded-xl bg-gradient-to-br from-primary to-primary-container p-9">
          <div className="max-w-[560px]">
            <span className="mb-3.5 inline-flex items-center gap-1.5 rounded-full bg-secondary-container/15 px-3 py-1.5 text-label-sm font-bold text-secondary-container">
              🚀 PARA DUEÑOS DE NEGOCIO
            </span>
            <h3 className="mb-2 font-display text-2xl font-extrabold text-white">Abre tu tienda online gratis, hoy mismo</h3>
            <p className="text-body-md text-white/65">
              Catálogo propio, pedidos por WhatsApp o desde tu panel, menú con QR si eres restaurante. Sin costo de
              entrada en el Plan Regular — empieza a vender en minutos.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/cuenta?tab=vendedor"
              className="whitespace-nowrap rounded bg-secondary-container px-5 py-3.5 text-label-md text-on-secondary-container hover:brightness-95"
            >
              Crear mi tienda gratis
            </Link>
            <Link
              to="/tiendas"
              className="flex items-center gap-1.5 whitespace-nowrap rounded border-[1.5px] border-white/30 px-5 py-3.5 text-label-md text-white hover:bg-white/10"
            >
              <Rocket className="h-4 w-4" /> Ver tiendas en {settings?.siteName || "ZeuDin"}
            </Link>
          </div>
        </div>
      </section>

      {/* TIENDAS VERIFICADAS — slider de 2 bloques, máximo 12 tiendas
          (Bloque 17). Criterio de selección: mismo orden que ya devuelve
          GET /vendors?isVerified=true (más recientemente verificadas/creadas
          primero) — no hay un flag de "destacada por admin" separado en el
          schema, así que se documenta este como el criterio usado. */}
      <section className="container-app py-11">
        <SectionHead title="Tiendas verificadas" to="/tiendas" />
        {verifiedVendors?.length ? (
          <VerifiedStoresSlider stores={verifiedVendors.slice(0, 12)} />
        ) : (
          <EmptyState
            icon={ShieldCheck}
            title="Todavía no hay tiendas verificadas en tu zona"
            description="Sé el primero en verificarte con el Plan Business."
            action={
              <Link to="/vender" className="text-label-md font-semibold text-tertiary-accent hover:underline">
                Crear mi tienda →
              </Link>
            }
          />
        )}
      </section>
    </div>
    {/* Bloque 52: apagable desde el admin (Marca de la plataforma) — antes
        se montaba siempre, sin condición. Default true si el settings
        todavía no cargó, para no hacerlo parpadear apagado un instante. */}
    {(settings?.showChatWidget ?? true) && <MarketplaceChatWidget />}
    </>
  );
}
