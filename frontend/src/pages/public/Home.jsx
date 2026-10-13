import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PlusCircle, ShieldCheck, Store } from "lucide-react";
import { api } from "../../lib/api.js";
import { useZone } from "../../context/LocationContext.jsx";
import { ProductCard, PRODUCT_GRID_CLASS } from "../../components/ProductCard.jsx";
import { VerifiedStoresSlider } from "../../components/VerifiedStoresSlider.jsx";
import { OffersSlider } from "../../components/OffersSlider.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { CategoryIcon } from "../../components/ui/CategoryIcon.jsx";
import { MarketplaceChatGate } from "../../components/MarketplaceChatGate.jsx";
import { HeroImageSlider } from "../../components/HeroImageSlider.jsx";
import { TrendingSearches } from "../../components/TrendingSearches.jsx";
import { QuickSaleCard } from "../../components/QuickSaleCard.jsx";
import { ZoneChip } from "../../components/ZonePicker.jsx";
import { AutoCarouselLazy as AutoCarousel } from "../../components/AutoCarouselLazy.jsx";

import { useMediaQuery, usePrefersReducedMotion } from "../../lib/useMediaQuery.js";
import vendorMockupImage from "../../assets/images/visualizacion_telefono.webp";
import vendorMockupImageMobile from "../../assets/images/hero-mobile-apps.webp";

// Bloque 248 (auditoría 004 de la página principal, pedido explícito del
// dueño: "revisa cada punto visual de estructura y posición; se usará más en
// celular"). Orden pensado para los dos públicos de la página, de lo que más
// busca el visitante a lo que más necesita el negocio:
//   1. Hero compacto (en celular sin el slider de imágenes y con un solo botón).
//   2. Categorías: fila que se desliza con el dedo, ya visible en la primera pantalla.
//   3. Ofertas de la semana, UNA sola vez (antes estaban repetidas).
//   4. Destacados: 8 en celular y más en pantallas grandes, con enlace al catálogo.
//   5. Abre tu tienda: tarjeta compacta, con restaurantes y comercios.
//   6. Tiendas verificadas (Bloque 251: debajo de "Abre tu tienda", a pedido del dueño).

// Bloque 48: marquee continuo de una sola dirección para pantallas medianas y
// grandes. La lista se duplica una vez: con la animación yendo de 0% a -50%
// del track, el último frame es idéntico al primero y el reinicio nunca se
// nota. El fade en los bordes es un mask-image (no hay utilidad de Tailwind).
const EDGE_FADE_MASK = "linear-gradient(to right, transparent 0, black 40px, black calc(100% - 40px), transparent 100%)";

function CategoryPill({ c }) {
  return (
    <Link
      to={`/tiendas?businessCategoryId=${c.id}`}
      className="flex min-h-11 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-outline-variant bg-surface-container-lowest px-3.5 hover:border-primary-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
    >
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-tertiary-accent/10">
        <CategoryIcon name={c.icon} className="h-3 w-3 text-tertiary-accent" />
      </span>
      <span className="text-label-sm text-on-surface-variant">{c.name}</span>
    </Link>
  );
}

// Bloque 126: si las categorías caben en el contenedor no se mueven; solo si
// desbordan se activa el marquee. Se mide el ancho NATURAL de la lista (copia
// invisible en una sola línea) contra el del contenedor.
// Bloque 248 (auditoría 004, hallazgo 9): si el sistema pide reducir el
// movimiento NO hay animación: es una fila que se desliza con el dedo.
function CategoryMarquee({ categories }) {
  const containerRef = useRef(null);
  const measureRef = useRef(null);
  const [overflowing, setOverflowing] = useState(false);
  // Duración de una vuelta según el largo real de la lista: velocidad fija y lenta (unos 14 px por segundo) para dar
  // tiempo a leer, sin importar cuántas categorías haya.
  const [loopSeconds, setLoopSeconds] = useState(100);
  const reducedMotion = usePrefersReducedMotion();
  // Bloque 254 (pedido explícito): también en celular las categorías se mueven
  // solas (el Bloque 248 las había dejado fijas, solo deslizables con el dedo).
  // Mantener el dedo sobre la fila la pausa (ver .category-marquee-track:active).
  const swipeRow = reducedMotion;

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;
    function check() {
      // +1px de margen para no entrar en modo marquee por redondeos de sub-pixel.
      setOverflowing(measure.scrollWidth > container.clientWidth + 1);
      setLoopSeconds(Math.max(100, Math.round(measure.scrollWidth / 14)));
    }
    check();
    const ro = new ResizeObserver(check);
    ro.observe(container);
    return () => ro.disconnect();
  }, [categories, swipeRow]);

  if (swipeRow) {
    return (
      <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-gutter sm:px-gutter [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max snap-x gap-2.5">
          {categories.map((c) => (
            <CategoryPill key={c.id} c={c} />
          ))}
        </div>
      </div>
    );
  }

  const track = overflowing ? [...categories, ...categories] : categories;

  return (
    <div ref={containerRef} className="relative overflow-hidden" style={overflowing ? { WebkitMaskImage: EDGE_FADE_MASK, maskImage: EDGE_FADE_MASK } : undefined}>
      {/* Copia invisible, fuera de flujo, SIEMPRE en una sola línea: solo sirve
          para medir. `invisible` (visibility:hidden) y no opacity-0, para que
          sus enlaces no entren en el orden de tabulación ni en lectores de
          pantalla. */}
      <div ref={measureRef} aria-hidden="true" className="invisible pointer-events-none absolute left-0 top-0 flex w-max -translate-y-full gap-2.5">
        {categories.map((c) => (
          <CategoryPill key={c.id} c={c} />
        ))}
      </div>
      <div className={overflowing ? "category-marquee-track flex w-max animate-marquee gap-2.5" : "flex flex-wrap justify-center gap-2.5"} style={overflowing ? { animationDuration: `${loopSeconds}s` } : undefined}>
        {track.map((c, i) => (
          <CategoryPill key={`${c.id}-${i}`} c={c} />
        ))}
      </div>
    </div>
  );
}

// Bloque 248 (hallazgos 2, 11 y 17): título más chico en celular para que no
// se parta en dos líneas, enlace con área táctil de 44px, y la flecha solo en
// "Ver todo" (ir a otra página con sentido), no en cada botón.
function SectionHead({ title, subtitle, to, cta = "Ver todo →" }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 md:mb-6">
      <div className="min-w-0">
        <h2 className="font-display text-[20px] font-bold leading-7 text-on-surface md:text-headline-lg">{title}</h2>
        {subtitle && <p className="mt-0.5 text-label-sm text-on-surface-variant">{subtitle}</p>}
      </div>
      {to && (
        <Link to={to} className="flex min-h-11 flex-shrink-0 items-center text-label-md font-semibold text-tertiary-accent hover:underline">
          {cta}
        </Link>
      )}
    </div>
  );
}

// Cuántos destacados se ven según el ancho (la grilla pasa de 2 a 5 columnas):
// 8 en celular (4 filas completas), 9 desde sm (3 columnas), 12 desde md (4
// columnas) y 20 desde lg (5 columnas), siempre filas completas.
function featuredVisibility(index) {
  if (index < 8) return "contents";
  if (index < 9) return "hidden sm:contents";
  if (index < 12) return "hidden md:contents";
  return "hidden lg:contents";
}

export default function Home() {
  const { zoneParams, zoneKey, zoneName, hasZoneFilter, loading: zoneLoading } = useZone();
  // Bloque 252: el slider de imágenes del hero va a la derecha en escritorio y,
  // en celular, debajo del párrafo. Se monta uno solo según el ancho (no dos
  // con uno oculto: duplicarían el autoplay y la carga de imágenes).
  const isLargeScreen = useMediaQuery("(min-width: 1024px)");

  const { data: businessCategories, status: categoriesStatus } = useQuery({
    queryKey: ["business-categories"],
    queryFn: async () => (await api.get("/business-categories")).data.categories,
  });

  // Solo se muestran los tipos de negocio que ya tienen al menos una tienda visible, y nunca dos con el mismo nombre.
  // Sin tiendas no hay ninguno; cuando se registra la primera, aparece el tipo de negocio que eligió.
  const homeCategories = useMemo(() => {
    const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    const seen = new Set();
    return (businessCategories ?? []).filter((c) => {
      if (!(c.vendorCount > 0)) return false;
      const key = fold(c.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [businessCategories]);

  // Ventas rápidas: anuncios de clientes sin tienda. Se muestran los más recientes y siempre hay un acceso para publicar el tuyo.
  const { data: quickSales } = useQuery({
    queryKey: ["home-quick-sales", zoneKey],
    queryFn: async () => (await api.get("/customer-listings", { params: { limit: 8, ...zoneParams } })).data.listings,
    enabled: !zoneLoading,
    staleTime: 60 * 1000,
  });
  const quickSaleSlides = useMemo(() => [...(quickSales ?? []), { id: "cta", cta: true }], [quickSales]);

  const { data: featured } = useQuery({
    queryKey: ["home-featured", zoneKey],
    queryFn: async () => (await api.get("/search", { params: zoneParams })).data.products,
    enabled: !zoneLoading,
  });

  const { data: verifiedVendors } = useQuery({
    queryKey: ["home-verified-vendors", zoneKey],
    queryFn: async () => (await api.get("/vendors", { params: { isVerified: true, ...zoneParams } })).data.vendors,
    enabled: !zoneLoading,
  });

  // Bloque 50: sin fallback de "no hay ofertas": si vuelve vacío, la sección
  // entera no se monta, a diferencia de Destacados/Tiendas verificadas que
  // sí muestran un EmptyState.
  const { data: offers, status: offersStatus } = useQuery({
    queryKey: ["home-active-offers"],
    queryFn: async () => (await api.get("/offers/active")).data.offers,
  });

  const { data: settings, status: settingsStatus } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  // Imágenes del Hero que sube el admin (HeroImageSlider hace el fundido entre ellas).
  const heroImages = (settings?.heroImages ?? []).map((u) => `${api.defaults.baseURL}${u}`);
  // Sin que nada salte al cargar (Google lo mide como "cambios de diseño"): mientras llegan los ajustes se reserva el lugar
  // del slider, y las secciones de abajo se pintan cuando ya se sabe si hay categorías y ofertas.
  const settingsLoading = settingsStatus === "pending";
  const showHeroSlot = settingsLoading || heroImages.length > 0;
  const belowHeroReady = categoriesStatus !== "pending" && offersStatus !== "pending";

  return (
    <>
      <div>
        {/* HERO — esquinas inferiores redondeadas, mismo radio que el footer.
            -mt-[76px] + pt-[76px] (misma altura que Header.jsx): el fondo se
            estira hacia arriba, detrás del header flotante, y el contenido
            queda en su sitio. bg-primary sólido, el mismo color que el footer.
            Bloque 248 (hallazgos 1, 7, 11 y 19): en celular ocupa poco más de
            media pantalla (sin pastilla, sin slider de imágenes, un solo botón
            principal y sin flecha). Le habla al comprador; lo de los
            vendedores vive en su propia tarjeta más abajo. */}
        <section className="-mt-[76px] rounded-b-[28px] bg-primary pt-[76px]">
          <div className={`container-app grid grid-cols-1 items-center gap-6 py-6 lg:gap-12 lg:py-8 ${showHeroSlot ? "lg:grid-cols-[1.05fr_1fr]" : ""}`}>
            <div>
              <h1 className="mb-3 font-display text-headline-lg text-white md:mb-4 md:text-display-lg">
                Compra cerca de ti, a <span className="text-secondary-container">vendedores</span> de tu provincia.
              </h1>
              <p className="mb-6 max-w-[500px] text-body-lg text-white/75 md:mb-7">
                Productos, comida y servicios de tiendas locales. Pide directo por WhatsApp, paga contra entrega o por transferencia.
              </p>
              {/* Bloque 252 (pedido explícito): en celular las imágenes del slider
                  van justo debajo del texto del hero (en la auditoría 004 se
                  habían ocultado ahí por altura; el dueño las quiere visibles). */}
              {!isLargeScreen && showHeroSlot && (
                <div className="mb-6">
                  {settingsLoading ? (
                    <div className="h-[268px] sm:h-[348px]" aria-hidden="true" />
                  ) : (
                    <HeroImageSlider images={heroImages} alt={settings?.siteName || "Baznova"} heightClass="h-[220px] sm:h-[300px]" />
                  )}
                </div>
              )}
              {/* Bloque 255 (pedido explícito): el radio de los botones es el mismo de las
                  esquinas de su sección (28px en el hero, el de la tarjeta en "Abre tu tienda").
                  Bloque 253: en celular los dos botones van uno
                  al lado del otro. El principal ocupa el espacio que sobra y el
                  secundario mide lo que su texto. */}
              <div className="flex gap-2.5 sm:gap-3.5">
                <Link
                  to="/catalogo"
                  className="flex min-h-11 flex-1 items-center justify-center whitespace-nowrap rounded-[28px] bg-secondary-container px-2 py-3 text-center text-[13px] font-semibold text-on-secondary-container hover:brightness-95 sm:flex-none sm:px-6 sm:text-label-md sm:font-normal"
                >
                  {hasZoneFilter ? `Explorar en ${zoneName}` : "Explorar todo el catálogo"}
                </Link>
                <Link
                  to="/tiendas"
                  className="flex min-h-11 flex-shrink-0 items-center justify-center whitespace-nowrap rounded-[28px] border-[1.5px] border-white/30 px-3.5 py-3 text-[13px] font-semibold text-white hover:bg-white/10 sm:px-6 sm:text-label-md sm:font-normal"
                >
                  Ver tiendas
                </Link>
              </div>
            </div>

            {isLargeScreen && showHeroSlot && (settingsLoading ? <div className="h-[368px] lg:h-[388px]" aria-hidden="true" /> : <HeroImageSlider images={heroImages} alt={settings?.siteName || "Baznova"} />)}
          </div>
        </section>

        {/* Dónde compra el visitante: todo lo de esta página (y del catálogo y las tiendas) se limita a ese lugar. */}
        <section className="container-app pt-5" aria-label="Lugar de compra">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <ZoneChip />
            <span className="text-[12.5px] text-on-surface-variant">
              {hasZoneFilter ? "Ves solo lo que hay en ese lugar." : "Elige tu país, provincia o municipio para ver solo lo de tu zona."}
            </span>
          </div>
        </section>

        {belowHeroReady ? (
          <>
        {/* CATEGORÍAS (en realidad es tipo de negocio de la tienda: filtra
            TIENDAS por rubro, ver Stores.jsx). */}
        {homeCategories.length > 0 && (
          <section className="container-app pt-8 md:pt-11">
            <SectionHead title="Explora por categoría" to="/tiendas" />
            <CategoryMarquee categories={homeCategories} />
          </section>
        )}

        {/* OFERTAS (Bloque 50): render condicional total; sin ofertas activas
            la sección ni se monta. Bloque 248: una sola vez (el Bloque 154 la
            había duplicado debajo de "Abre tu tienda", y se veía como un error). */}
        {offers?.length > 0 && (
          <section className="container-app cv-auto pt-8 md:pt-11">
            <SectionHead title="Ofertas de la semana" subtitle="De tiendas verificadas y de la casa" />
            <OffersSlider offers={offers} />
          </section>
        )}

        {/* PRODUCTOS DESTACADOS */}
        <section className="container-app cv-auto pt-8 md:pt-11">
          <SectionHead
            title={hasZoneFilter ? `Destacados en ${zoneName}` : "Destacados en toda Cuba"}
            subtitle={hasZoneFilter ? "De tiendas verificadas cerca de ti" : "De tiendas verificadas en todo el país"}
          />
          {featured?.length ? (
            <>
              {/* Bloque 248 (hallazgo 15): 20 destacados en celular eran 3333px de
                  grilla, casi 4 pantallas antes de llegar a las tiendas o a la
                  invitación para negocios. Nunca se rellena con nada inventado
                  si hay menos disponibles. */}
              <div className={PRODUCT_GRID_CLASS}>
                {featured.slice(0, 20).map((p, i) => (
                  <div key={p.id} className={featuredVisibility(i)}>
                    <ProductCard product={p} trackSource="home" />
                  </div>
                ))}
              </div>
              {/* Bloque 251 (pedido explícito): el botón con contenedor, fondo y
                  borde se veía mal en celular. Ahora es una frase que explica a
                  dónde lleva y un enlace de texto, centrados, que se adaptan a
                  cualquier ancho. */}
              <div className="mt-6 flex flex-col items-center gap-0.5 px-2 text-center">
                <p className="max-w-[460px] text-body-md text-on-surface-variant">
                  Esto es una selección. En el catálogo hay más productos de tiendas {hasZoneFilter ? `en ${zoneName}` : "de toda Cuba"}.
                </p>
                <Link to="/catalogo" className="flex min-h-11 items-center text-label-md font-semibold text-tertiary-accent hover:underline">
                  Ver todo el catálogo →
                </Link>
              </div>
            </>
          ) : (
            <EmptyState
              title="Todavía no hay productos en tu zona"
              description="Prueba explorando el catálogo completo o cambia de provincia arriba."
              action={
                <Link to="/catalogo" className="text-label-md font-semibold text-tertiary-accent hover:underline">
                  Ver catálogo completo
                </Link>
              }
            />
          )}
        </section>

        {/* VENTA RÁPIDA: anuncios de clientes (sin tienda). Los compradores los contactan directo por WhatsApp. */}
        <section className="container-app cv-auto pt-8 md:pt-11" aria-labelledby="venta-rapida-home">
          <div className="mb-4 flex items-center justify-between gap-3 md:mb-6">
            <div className="min-w-0">
              <h2 id="venta-rapida-home" className="font-display text-[20px] font-bold leading-7 text-on-surface md:text-headline-lg">Venta rápida entre clientes</h2>
              <p className="mt-0.5 text-label-sm text-on-surface-variant">Anuncios de personas como tú. Contáctalas directo por WhatsApp.</p>
            </div>
            {quickSales?.length > 0 && (
              <Link to="/ventas-rapidas" className="flex min-h-11 flex-shrink-0 items-center text-label-md font-semibold text-tertiary-accent hover:underline">Ver todo →</Link>
            )}
          </div>
          {quickSales?.length > 0 ? (
            // Pasa de un anuncio a la vez, sin fin, y también se desliza con el dedo. La última tarjeta invita a publicar.
            <div className="-mx-1.5">
              <AutoCarousel
                items={quickSaleSlides}
                getKey={(l) => l.id}
                renderItem={(l) =>
                  l.cta ? (
                    <Link to="/cuenta/panel?tab=quick-sale" className="flex h-full min-h-[200px] flex-col items-center justify-center gap-1.5 rounded-[22px] border-2 border-dashed border-outline-variant p-5 text-center">
                      <span className="text-[14px] font-bold text-on-surface">¿Vendes algo?</span>
                      <span className="text-[12.5px] text-on-surface-variant">Publica tu anuncio gratis</span>
                    </Link>
                  ) : (
                    <QuickSaleCard listing={l} />
                  )
                }
                itemClassName="basis-[72%] px-1.5 sm:basis-1/3 lg:basis-1/4"
                align="start"
                delay={3500}
                minSlides={8}
                label="Venta rápida entre clientes"
              />
            </div>
          ) : (
            <Link to="/cuenta/panel?tab=quick-sale" className="block rounded-2xl border-2 border-dashed border-outline-variant p-6 text-center">
              <span className="block text-[15px] font-bold text-on-surface">Todavía no hay anuncios de venta rápida</span>
              <span className="mt-1 block text-[13px] text-on-surface-variant">Publica el primero: es gratis y se contacta por WhatsApp.</span>
            </Link>
          )}
        </section>

        {/* ABRE TU TIENDA: recluta vendedores, no promociona una tienda
            puntual. Bloque 248 (hallazgos 8, 10, 12 y 19): sin pastilla con
            emoji, sin el mockup de 3 teléfonos en celular (reservaba ~224px
            solo para una imagen decorativa), icono de tienda en vez de cohete,
            y con mención explícita a restaurantes (menú con QR) y comercios.
            En escritorio se mantiene la tarjeta de una fila con el teléfono
            asomando por arriba (Bloques 102 a 130: lg:pt-36 de la sección y
            lg:pr-[352px] de la tarjeta reservan ese lugar). */}
        <section className="container-app cv-auto py-8 md:py-11 lg:pt-36">
          <div className="relative flex flex-wrap items-center justify-between gap-6 rounded-xl bg-gradient-to-br from-primary to-primary-container p-6 md:p-9 md:pr-72 lg:pr-[352px] xl:flex-nowrap">
            <img
              src={vendorMockupImage}
              alt=""
              aria-hidden="true"
              width={640}
              height={640}
              loading="lazy"
              decoding="async"
              className="pointer-events-none absolute bottom-0 hidden select-none drop-shadow-2xl md:right-4 md:block md:w-64 lg:right-8 lg:w-80"
            />
            <div className="max-w-[560px] xl:min-w-0 xl:flex-1">
              <h3 className="mb-2 font-display text-2xl font-extrabold text-white">Abre tu tienda online gratis, hoy mismo</h3>
              <p className="text-body-md text-white/80">
                Para tiendas, restaurantes y comercios. Catálogo propio, pedidos por WhatsApp o desde tu panel y menú con QR si tienes un restaurante.
                Sin comisiones por venta y sin costo de entrada en el Plan Regular. Empieza a vender en minutos.
              </p>
            </div>
            <div className="flex w-full flex-shrink-0 flex-col items-stretch gap-3 sm:w-auto sm:items-start">
              <Link
                to="/vendedor/ingresar?tab=registro"
                className="flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-secondary-container px-5 py-3 text-label-md text-on-secondary-container hover:brightness-95"
              >
                <PlusCircle className="h-4 w-4" aria-hidden="true" /> Crear mi tienda gratis
              </Link>
              <Link
                to="/tiendas"
                className="flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border-[1.5px] border-white/30 px-5 py-3 text-label-md text-white hover:bg-white/10"
              >
                <Store className="h-4 w-4" aria-hidden="true" /> Ver tiendas en {settings?.siteName || "Baznova"}
              </Link>
            </div>
            {/* Bloque 254 (pedido explícito): en celular la tarjeta vuelve a
                mostrar su imagen. Va DENTRO del flujo, debajo de los botones y
                pegada al borde inferior de la tarjeta (-mb-6 anula el relleno),
                en vez del relleno fijo de ~224px que reservaba el Bloque 106. */}
            <div className="-mx-3 -mb-6 flex w-[calc(100%+1.5rem)] justify-center md:hidden">
              <img src={vendorMockupImageMobile} alt="" aria-hidden="true" width={920} height={518} loading="lazy" decoding="async" className="pointer-events-none h-auto w-full max-w-[460px] select-none drop-shadow-2xl" />
            </div>
          </div>
        </section>
        {/* TIENDAS VERIFICADAS: Bloque 251 (pedido explícito), debajo de "Abre tu
            tienda". Desplazamiento infinito en una sola dirección, sin botón de
            pausa. Máximo 12 (Bloque 17); mismo orden que GET
            /vendors?isVerified=true (más recientes primero). */}
        <section className="container-app cv-auto pb-10 md:pb-14">
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
                  Crear mi tienda
                </Link>
              }
            />
          )}
        </section>

        <TrendingSearches />
          </>
        ) : (
          <div className="min-h-[100vh]" aria-hidden="true" />
        )}
      </div>
      {/* Bloque 52: apagable desde el admin (Marca de la plataforma). Default
          true si el settings todavía no cargó, para no hacerlo parpadear.
          Bloque 238: además, oculto automáticamente si las IA están caídas
          (chatbotAvailable, estado cacheado cada 2 min en segundo plano). */}
      <MarketplaceChatGate />
    </>
  );
}
