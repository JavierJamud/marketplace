import { useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, Percent, Store, ShieldCheck, Rocket } from "lucide-react";
import { api } from "../../lib/api.js";
import { useZone } from "../../context/LocationContext.jsx";
import { ProductCard } from "../../components/ProductCard.jsx";
import { VerifiedStoresSlider } from "../../components/VerifiedStoresSlider.jsx";
import { OffersSlider } from "../../components/OffersSlider.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { CategoryIcon } from "../../components/ui/CategoryIcon.jsx";
import { MarketplaceChatWidget } from "../../components/MarketplaceChatWidget.jsx";
import { HeroImageSlider } from "../../components/HeroImageSlider.jsx";
import vendorMockupImage from "../../assets/images/visualizacion_telefono.webp";
import vendorMockupImageMobile from "../../assets/images/hero-mobile-apps.webp";

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

function CategoryPill({ c }) {
  return (
    <Link
      to={`/tiendas?businessCategoryId=${c.id}`}
      className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-outline-variant bg-surface-container-lowest px-3 py-1.5 hover:border-primary-container"
    >
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-tertiary-accent/10">
        <CategoryIcon name={c.icon} className="h-3 w-3 text-tertiary-accent" />
      </span>
      <span className="text-label-sm text-on-surface-variant">{c.name}</span>
    </Link>
  );
}

// Bloque 126 (pedido explícito — "si las categorías caben perfectamente en
// el contenedor, no deben moverse; solo si no caben se desplazan en bucle
// infinito como ya está"): antes el marquee corría siempre, sin importar
// cuántas categorías hubiera — con solo 1-2 (como en modo de prueba), el
// contenido ya cabía entero y el movimiento constante no tenía sentido.
// Se mide el ancho NATURAL de la lista sin duplicar (vía una copia
// invisible fuera de flujo, siempre en una sola línea) contra el ancho real
// del contenedor, y solo se activa el modo marquee (duplicado + animación)
// si de verdad desborda — si no, se muestra la lista tal cual, estática,
// pudiendo envolver en varias líneas si hace falta.
function CategoryMarquee({ categories }) {
  const containerRef = useRef(null);
  const measureRef = useRef(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    function check() {
      // +1px de margen para no entrar en modo marquee por redondeos de
      // sub-pixel cuando el contenido calza justo al límite.
      setOverflowing(measure.scrollWidth > container.clientWidth + 1);
    }

    check();
    const ro = new ResizeObserver(check);
    ro.observe(container);
    return () => ro.disconnect();
  }, [categories]);

  const track = overflowing ? [...categories, ...categories] : categories;

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden"
      style={overflowing ? { WebkitMaskImage: EDGE_FADE_MASK, maskImage: EDGE_FADE_MASK } : undefined}
    >
      {/* Copia invisible, fuera de flujo, SIEMPRE en una sola línea — solo
          existe para medir el ancho real de las categorías sin duplicar;
          la lista visible de abajo, en modo estático, puede envolver en
          varias líneas, así que no serviría para medir si desborda.
          `invisible` (visibility:hidden), no `opacity-0`: además de no
          pintarse, saca sus <a> del orden de tabulación y de la lectura de
          lectores de pantalla — con opacity-0 seguirían siendo enlaces
          reales tocables por teclado, invisibles pero navegables, que es
          peor que no tenerlos. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="invisible pointer-events-none absolute left-0 top-0 flex w-max -translate-y-full gap-2.5"
      >
        {categories.map((c) => (
          <CategoryPill key={c.id} c={c} />
        ))}
      </div>

      <div
        className={
          overflowing
            ? "category-marquee-track flex w-max animate-marquee gap-2.5"
            : "flex flex-wrap justify-center gap-2.5"
        }
      >
        {track.map((c, i) => (
          <CategoryPill key={`${c.id}-${i}`} c={c} />
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
  // Bloque 96 (pedido explícito): heroImageUrl (1 sola) pasa a heroImages
  // (varias) — HeroImageSlider.jsx maneja el fundido cruzado automático y
  // los punticos de abajo cuando hay más de una.
  const heroImages = (settings?.heroImages ?? []).map((u) => `${api.defaults.baseURL}${u}`);

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
              Marketplace multi vendedor
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
                <Percent className="h-[18px] w-[18px] text-[#25D366]" />
                Sin comisiones por venta
              </div>
              <div className="flex items-center gap-2 text-[13px] text-white/70">
                <Store className="h-[18px] w-[18px] text-secondary-container" />
                Crea tu tienda gratis ahora
              </div>
            </div>
          </div>

          {/* Bloque 96 (pedido explícito): 1 imagen fija -> slider de varias.
              HeroImageSlider ya trae su propio marco (fundido cruzado entre
              imágenes, sin deformarse ni recortarse) y, si hay más de una,
              los punticos debajo — acá solo se le pasa la lista. Fondo
              transparente (Bloque 95): se ve el degradado de la sección
              detrás si la imagen no llena el recuadro entero. */}
          <HeroImageSlider images={heroImages} alt={settings?.siteName || "Baznova"} />
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
              <ProductCard key={p.id} product={p} trackSource="home" />
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
          tienda puntual (antes esta sección promocionaba sabor-criollo).
          Bloque 104 (bug real reportado en vivo, con captura: la imagen
          tapaba las tarjetas de producto de la sección de arriba): desde
          lg (Bloque 102/103 agranda la imagen a 320px de ancho/alto,
          bottom-0 dentro de una tarjeta de ~226px de alto) la imagen
          sobresale ~94px por ENCIMA del borde de la tarjeta — con el pt-11
          (44px) de siempre, eso alcanzaba a salirse de esta <section> por
          completo y meterse en la sección anterior. lg:pt-36 (144px, medido
          en vivo con Playwright contra el sobrante real de 94px + margen)
          le da lugar de sobra sin afectar mobile/sm/md (donde la imagen no
          sobresale del todo, ver Bloque 103 — el pt-11 de siempre les
          sigue alcanzando). */}
      <section className="container-app pt-11 lg:pt-36">
        {/* Bloque 130 (pedido explícito, con mockup de Photoshop): en
            pantallas grandes la tarjeta es UNA sola fila — texto a la
            izquierda, los 2 botones al lado, el teléfono a la derecha
            sobresaliendo por arriba del borde (para eso está el lg:pt-36
            de la <section>). Antes, con flex-wrap y pr-96, el área útil
            (~797px a 1280) no alcanzaba para texto (560) + gap (24) +
            botones (~257, y crece con el nombre del sitio: "SuperMarket"
            es más largo que "ZeuDin"): los botones caían a una 2ª fila,
            la tarjeta se estiraba a ~360px y el teléfono quedaba adentro
            en vez de asomar. Desde xl (1280px): flex-nowrap, el bloque de
            texto se encoge (min-w-0 + flex-1, tope 560) y los botones
            nunca (flex-shrink-0) — así el nombre del sitio nunca vuelve a
            romper la fila. Se eligió xl y no lg a propósito: medido en
            vivo, a 1024px la fila única dejaba el texto en 292px (título
            en 2 líneas, párrafo en 6) — apretado; entre 1024 y 1279 se
            deja el wrap de siempre (botones debajo, tarjeta alta), que a
            ese ancho se ve bien. lg:pr-[352px] = right-8 + w-80 de la
            imagen, justo lo que ocupa el teléfono (valor arbitrario a
            propósito: la escala de Tailwind salta de pr-80 a pr-96). */}
        <div className="relative flex flex-wrap items-center justify-between gap-6 rounded-xl bg-gradient-to-br from-primary to-primary-container p-9 pb-56 sm:pb-72 md:pb-9 md:pr-72 lg:pr-[352px] xl:flex-nowrap">
          {/* Bloque 106 (pedido explícito, con captura): en mobile/sm ya no
              es un recorte del mismo mockup de escritorio — es una imagen
              DISTINTA (hero-mobile-apps.webp, 3 teléfonos con capturas de
              una app, formato apaisado 709×532 a diferencia del mockup
              cuadrado de escritorio), pensada a propósito para verse bien
              angosta. Misma idea de fondo que el Bloque 103 (pegada a la
              base de la tarjeta, centrada horizontalmente) pero como el
              aspect-ratio es distinto, va en un <img> separado — se
              intentó forzar todo a una sola imagen con clases responsivas
              antes (Bloques 101-105) y esa fue la limitación real que pedía
              cambiar a una imagen dedicada para mobile en vez de solo
              reescalar la de escritorio. */}
          <img
            src={vendorMockupImageMobile}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-1/2 w-64 -translate-x-1/2 select-none drop-shadow-2xl sm:w-80 md:hidden"
          />
          {/* Bloque 103 (pedido explícito): la imagen de escritorio queda
              SIEMPRE con su borde inferior pegado a la línea de abajo de la
              tarjeta (bottom-0), creciendo hacia arriba desde ahí — nunca
              sobresale por debajo. Solo se muestra desde md (hidden por
              defecto, ver arriba la versión mobile dedicada del Bloque
              106). La tarjeta nunca lleva overflow-hidden (recortaría la
              parte de la imagen que sobresale por arriba del borde). */}
          <img
            src={vendorMockupImage}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 hidden select-none drop-shadow-2xl md:block md:right-4 md:w-64 lg:right-8 lg:w-80"
          />
          <div className="max-w-[560px] xl:min-w-0 xl:flex-1">
            <span className="mb-3.5 inline-flex items-center gap-1.5 rounded-full bg-secondary-container/15 px-3 py-1.5 text-label-sm font-bold text-secondary-container">
              🚀 PARA DUEÑOS DE NEGOCIO
            </span>
            <h3 className="mb-2 font-display text-2xl font-extrabold text-white">Abre tu tienda online gratis, hoy mismo</h3>
            <p className="text-body-md text-white/65">
              Catálogo propio, pedidos por WhatsApp o desde tu panel, menú con QR si eres restaurante. Sin costo de
              entrada en el Plan Regular — empieza a vender en minutos.
            </p>
          </div>
          {/* Bloque 102: botones apilados en columna (antes en fila) — mismo
              criterio del boceto, y deja más margen libre a la derecha para
              la imagen grande en desktop. Bloque 130: flex-shrink-0 — el
              texto es el que cede ancho, nunca los botones. */}
          <div className="flex flex-shrink-0 flex-col items-start gap-3">
            <Link
              to="/vendedor/ingresar?tab=registro"
              className="whitespace-nowrap rounded bg-secondary-container px-5 py-3.5 text-label-md text-on-secondary-container hover:brightness-95"
            >
              Crear mi tienda gratis
            </Link>
            <Link
              to="/tiendas"
              className="flex items-center gap-1.5 whitespace-nowrap rounded border-[1.5px] border-white/30 px-5 py-3.5 text-label-md text-white hover:bg-white/10"
            >
              <Rocket className="h-4 w-4" /> Ver tiendas en {settings?.siteName || "Baznova"}
            </Link>
          </div>
        </div>
      </section>

      {/* OFERTAS (Bloque 154) — duplicado explícito de la sección de arriba,
          debajo de "Abre tu tienda online gratis": mismas ofertas pero en
          orden invertido y deslizándose en sentido contrario (OffersSlider
          con reverse=true), para que se noten más y nunca coincidan con lo
          que muestra la sección de arriba en el mismo instante. */}
      {offers?.length > 0 && (
        <section className="container-app pt-11">
          <SectionHead title="Ofertas de la semana" subtitle="De tiendas verificadas y de la casa" />
          <OffersSlider offers={offers} reverse />
        </section>
      )}

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
              <Link to="/vendedor/ingresar?tab=registro" className="text-label-md font-semibold text-tertiary-accent hover:underline">
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
