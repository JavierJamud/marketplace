// examples/Home.jsx
// -----------------------------------------------------------------------------
// Página Home traducida del mockup Home.dc.html a TU stack.
// Patrón "de oro": replicá este estilo para las demás páginas.
//
// Destino en tu repo: frontend/src/pages/public/Home.jsx
// (el header/footer los pone PublicLayout — acá va solo el contenido de la ruta "/").
//
// NOTAS DE INTEGRACIÓN:
// - Los datos (featured, vendors, testimonials) acá van hardcodeados como ejemplo.
//   En tu repo, reemplazá por useQuery(...) contra lib/api.js.
// - ProductCard / StoreCard: usá TUS componentes (components/ProductCard.jsx, etc.).
//   Acá se muestran inline para que se vea el diseño objetivo; sustituilos.
// - Íconos: lucide-react. Moneda: respetá tu formato real (es-CU / CUP).
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Truck, ShieldCheck, RotateCcw, Headphones,
  Star, ShoppingCart,
} from "lucide-react";

const TRUST = [
  { Icon: Truck, title: "Envío rápido", sub: "A todo el país" },
  { Icon: ShieldCheck, title: "Pagos seguros", sub: "100% protegidos" },
  { Icon: RotateCcw, title: "Devoluciones", sub: "30 días sin cargo" },
  { Icon: Headphones, title: "Soporte 24/7", sub: "Siempre disponible" },
];

const CATEGORIES = ["Tecnología", "Moda", "Hogar", "Deportes", "Belleza", "Accesorios"];

const FEATURED = [
  { id: "p1", name: "Auriculares NovaSound Pro", vendor: "NovaTek", price: 89900, oldPrice: 119900, reviews: 128, badge: "Nuevo", badgeClass: "bg-[#337475]" },
  { id: "p2", name: "Smartwatch Orbit X3", vendor: "NovaTek", price: 149900, oldPrice: null, reviews: 96, badge: "Bestseller", badgeClass: "bg-primary-container" },
  { id: "p3", name: 'Laptop AirLine 14"', vendor: "NovaTek", price: 899900, oldPrice: 999900, reviews: 76, badge: "-10%", badgeClass: "bg-error" },
  { id: "p4", name: "Campera Urban Bomber", vendor: "Urban Wear", price: 45900, oldPrice: 62900, reviews: 64, badge: "-27%", badgeClass: "bg-error" },
];

const VENDORS = [
  { slug: "novatek", name: "NovaTek", category: "Tecnología", rating: 4.8, sales: 3200, initial: "N", color: "#232F3E" },
  { slug: "urbanwear", name: "Urban Wear", category: "Moda", rating: 4.6, sales: 1850, initial: "U", color: "#337475" },
  { slug: "casanova", name: "Casa Nova", category: "Hogar", rating: 4.9, sales: 980, initial: "C", color: "#8A5100" },
  { slug: "bellapiel", name: "Bella Piel", category: "Belleza", rating: 4.5, sales: 640, initial: "B", color: "#643900" },
];

const TESTIMONIALS = [
  { name: "Camila R.", location: "CDMX, México", text: "Compré en tres tiendas distintas y todo llegó junto y a tiempo. La plataforma es súper clara." },
  { name: "Diego M.", location: "Bogotá, Colombia", text: "Como vendedor, el panel me permite gestionar pedidos de forma muy simple. Recomendado." },
  { name: "Valentina S.", location: "Buenos Aires, Argentina", text: "Excelente variedad de vendedores y precios. El seguimiento del pedido es muy transparente." },
];

// Respetá TU formato de moneda real (ProductCard usa es-CU / CUP).
const fmt = (n) => "$" + n.toLocaleString("es-AR");

function useCountdown(startSeconds = 44) {
  const [s, setS] = useState(startSeconds);
  useEffect(() => {
    const t = setInterval(() => setS((x) => (x + 599) % 600), 1000);
    return () => clearInterval(t);
  }, []);
  return [
    { val: "02", label: "Días" },
    { val: "14", label: "Horas" },
    { val: String(Math.floor(s / 60)).padStart(2, "0"), label: "Min" },
    { val: String(s % 60).padStart(2, "0"), label: "Seg" },
  ];
}

function SectionHead({ title, to, cta = "Ver todo →" }) {
  return (
    <div className="mb-7 flex items-center justify-between">
      <h2 className="text-headline-md font-bold text-on-surface">{title}</h2>
      {to && (
        <Link to={to} className="text-label-md text-[#337475] hover:text-secondary-container">
          {cta}
        </Link>
      )}
    </div>
  );
}

export default function Home() {
  const countdown = useCountdown();

  return (
    <>
      {/* HERO */}
      <section className="bg-gradient-to-b from-primary-container to-primary">
        <div className="container-app grid grid-cols-1 items-center gap-14 py-16 lg:grid-cols-2">
          <div>
            <span className="mb-5 inline-block rounded-full bg-secondary-container/15 px-3.5 py-1.5 text-label-sm font-bold tracking-wide text-secondary-container">
              MÁS DE 300 VENDEDORES VERIFICADOS
            </span>
            <h1 className="mb-5 font-display text-display-lg text-white">
              Todo lo que buscás,<br />
              de <span className="text-secondary-container">miles</span> de vendedores.
            </h1>
            <p className="mb-8 max-w-[480px] text-body-lg text-white/70">
              Tecnología, moda, hogar y más — en un solo marketplace con pagos
              seguros y envíos rastreables de punta a punta.
            </p>
            <div className="mb-9 flex gap-3.5">
              <Link
                to="/catalogo"
                className="flex items-center gap-2 rounded bg-secondary-container px-6 py-3.5 text-label-md text-white hover:brightness-105"
              >
                Explorar catálogo <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/tiendas"
                className="rounded border-[1.5px] border-white/30 px-6 py-3.5 text-label-md text-white hover:bg-white/10"
              >
                Ver tiendas
              </Link>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex">
                <span className="-mr-2.5 h-8 w-8 rounded-full border-2 border-primary-container bg-[#61A0A1]" />
                <span className="-mr-2.5 h-8 w-8 rounded-full border-2 border-primary-container bg-secondary-container" />
                <span className="h-8 w-8 rounded-full border-2 border-primary-container bg-[#8A97A9]" />
              </div>
              <span className="text-label-sm text-white/65">
                <strong className="text-white">50K+</strong> clientes felices
              </span>
            </div>
          </div>

          {/* Imagen del hero: en tu repo, <img src={heroUrl} .../> */}
          <div className="relative h-[420px]">
            <div className="h-full w-full rounded-xl bg-white/10" />
            <div className="absolute right-[-14px] top-5 flex items-center gap-2.5 rounded-md bg-white px-4 py-3 shadow-lg">
              <span className="flex h-9 w-9 items-center justify-center rounded bg-[#61A0A1]/15">
                <Truck className="h-[18px] w-[18px] text-[#337475]" />
              </span>
              <div>
                <div className="text-label-sm font-bold text-on-surface">Envío en 24-48h</div>
                <div className="text-[11px] text-on-surface-variant">A todo el país</div>
              </div>
            </div>
            <div className="absolute bottom-5 left-[-14px] flex items-center gap-2.5 rounded-md bg-white px-4 py-3 shadow-lg">
              <span className="flex h-9 w-9 items-center justify-center rounded bg-secondary-container/12">
                <ShieldCheck className="h-[18px] w-[18px] text-secondary" />
              </span>
              <div>
                <div className="text-label-sm font-bold text-on-surface">Pagos 100% seguros</div>
                <div className="text-[11px] text-on-surface-variant">Compra protegida</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST BAR */}
      <section className="border-b border-surface-container-high bg-surface-container-lowest">
        <div className="container-app grid grid-cols-2 gap-4 py-5 md:grid-cols-4">
          {TRUST.map(({ Icon, title, sub }) => (
            <div key={title} className="flex items-center gap-3">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/[0.06]">
                <Icon className="h-[18px] w-[18px] text-primary-container" />
              </span>
              <div>
                <div className="text-label-md text-on-surface">{title}</div>
                <div className="text-label-sm text-outline">{sub}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CATEGORÍAS */}
      <section className="container-app pt-14">
        <SectionHead title="Explorá por categoría" to="/catalogo" cta="Ver todas →" />
        <div className="flex gap-2.5 overflow-x-auto pb-1.5">
          {CATEGORIES.map((c) => (
            <Link
              key={c}
              to="/catalogo"
              className="flex-shrink-0 rounded-full border border-outline-variant bg-surface-container-lowest px-[18px] py-2.5 text-label-md text-on-surface-variant hover:border-primary-container"
            >
              {c}
            </Link>
          ))}
        </div>
      </section>

      {/* PRODUCTOS DESTACADOS — en tu repo: {featured.map(p => <ProductCard product={p}/>)} */}
      <section className="container-app pt-14">
        <SectionHead title="Productos destacados" to="/catalogo" />
        <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
          {FEATURED.map((p) => (
            <div key={p.id} className="overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest shadow-sm">
              <Link to={`/producto/${p.vendor}/${p.id}`} className="relative block">
                <span className={`absolute left-3 top-3 z-10 rounded-full px-2.5 py-1 text-[11px] font-bold text-white ${p.badgeClass}`}>
                  {p.badge}
                </span>
                <div className="h-[200px] w-full bg-surface-container" />
              </Link>
              <div className="p-4">
                <span className="text-[11px] font-bold text-[#337475]">{p.vendor}</span>
                <Link to={`/producto/${p.vendor}/${p.id}`} className="mt-1 block text-body-md font-semibold text-on-surface">
                  {p.name}
                </Link>
                <div className="mb-2.5 mt-1 flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 fill-secondary-container text-secondary-container" />
                  <span className="text-label-sm text-outline">({p.reviews})</span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-base font-bold text-on-surface">{fmt(p.price)}</span>
                    {p.oldPrice && (
                      <span className="ml-1.5 text-label-sm text-outline line-through">{fmt(p.oldPrice)}</span>
                    )}
                  </div>
                  <button className="flex h-9 w-9 items-center justify-center rounded bg-secondary-container text-white hover:brightness-105">
                    <ShoppingCart className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* OFERTA RELÁMPAGO */}
      <section className="container-app pt-14">
        <div className="flex flex-wrap items-center justify-between gap-6 rounded-xl bg-gradient-to-br from-primary to-primary-container p-10">
          <div>
            <span className="mb-3.5 inline-flex items-center gap-1.5 rounded-full bg-secondary-container/15 px-3 py-1 text-label-sm font-bold text-secondary-container">
              ⚡ OFERTA RELÁMPAGO
            </span>
            <h3 className="mb-2 font-display text-3xl font-extrabold text-white">Hasta 40% OFF esta semana</h3>
            <p className="text-body-md text-white/65">Tiempo limitado en productos seleccionados de todas las tiendas.</p>
          </div>
          <div className="flex items-center gap-6">
            {countdown.map((c) => (
              <div key={c.label} className="text-center">
                <div className="flex h-14 w-[60px] items-center justify-center rounded-md bg-white/10 font-display text-2xl font-bold text-white">
                  {c.val}
                </div>
                <div className="mt-1.5 text-[11px] text-white/55">{c.label}</div>
              </div>
            ))}
            <Link to="/catalogo" className="whitespace-nowrap rounded bg-secondary-container px-6 py-3.5 text-label-md text-white hover:brightness-105">
              Ver ofertas
            </Link>
          </div>
        </div>
      </section>

      {/* TIENDAS DESTACADAS — en tu repo: {vendors.map(v => <StoreCard vendor={v}/>)} */}
      <section className="container-app pt-14">
        <SectionHead title="Tiendas destacadas" to="/tiendas" cta="Ver todas →" />
        <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
          {VENDORS.map((v) => (
            <Link key={v.slug} to={`/tienda/${v.slug}`} className="flex flex-col overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest shadow-sm">
              <div className="relative h-[150px] w-full" style={{ background: v.color }}>
                <div className="absolute inset-0 bg-gradient-to-t from-primary/85 via-primary/20 to-transparent" />
                <div className="absolute bottom-3 left-3.5 right-3.5 flex items-center gap-3">
                  <span className="flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center rounded-full border-[2.5px] border-white font-display text-lg font-bold text-white" style={{ background: v.color }}>
                    {v.initial}
                  </span>
                  <div>
                    <div className="text-label-md font-bold text-white drop-shadow">{v.name}</div>
                    <div className="text-label-sm text-white/85 drop-shadow">{v.category}</div>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2.5 p-4">
                <div className="flex items-center gap-3.5 text-label-sm text-outline">
                  <span className="font-bold text-secondary-container">★ {v.rating}</span>
                  <span>{v.sales} ventas</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between border-t border-surface-container pt-3">
                  <span className="text-label-md text-[#337475]">Ver tienda</span>
                  <ArrowRight className="h-4 w-4 text-[#337475]" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* TESTIMONIOS */}
      <section className="container-app pt-14">
        <h2 className="mb-7 text-center text-headline-md font-bold text-on-surface">Lo que dicen nuestros clientes</h2>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <div key={t.name} className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
              <div className="mb-3 flex gap-0.5 text-secondary-container">
                {[...Array(5)].map((_, i) => <Star key={i} className="h-3.5 w-3.5 fill-current" />)}
              </div>
              <p className="mb-4 text-body-md text-on-surface-variant">&ldquo;{t.text}&rdquo;</p>
              <div className="flex items-center gap-2.5">
                <span className="h-9 w-9 rounded-full bg-surface-container-highest" />
                <div>
                  <div className="text-label-md text-on-surface">{t.name}</div>
                  <div className="text-label-sm text-outline">{t.location}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* NEWSLETTER */}
      <section className="container-app py-14">
        <div className="flex flex-wrap items-center justify-between gap-6 rounded-xl bg-primary-container p-10">
          <div>
            <h3 className="mb-1.5 font-display text-2xl font-bold text-white">Sumate a la comunidad Apex</h3>
            <p className="text-body-md text-white/60">Ofertas exclusivas y novedades de vendedores, directo a tu correo.</p>
          </div>
          <form className="flex gap-2.5" onSubmit={(e) => e.preventDefault()}>
            <input
              type="email"
              placeholder="tu@email.com"
              className="h-[46px] w-[260px] rounded border-none px-4 text-body-md outline-none"
            />
            <button className="h-[46px] rounded bg-secondary-container px-6 text-label-md text-white hover:brightness-105">
              Suscribirme
            </button>
          </form>
        </div>
      </section>
    </>
  );
}
