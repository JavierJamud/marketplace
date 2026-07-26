import { Link } from "react-router-dom";
import { ShoppingBag, Store, Wallet, UserCircle, UtensilsCrossed, ShieldCheck, ArrowRight } from "lucide-react";
import { useStaticPage } from "../../lib/useStaticPage.js";

const CATEGORIES = [
  {
    icon: ShoppingBag,
    title: "Comprar",
    description: "Cómo hacer un pedido, coordinar el pago y seguir el estado de tu compra.",
    to: "/faq?tab=customer",
  },
  {
    icon: Store,
    title: "Vender",
    description: "Registrar tu tienda, publicar productos y elegir tu plan.",
    to: "/faq?tab=vendor",
  },
  {
    icon: Wallet,
    title: "Pagos y envíos",
    description: "Cómo se coordina el pago y la entrega directo con cada tienda.",
    to: "/faq?tab=customer",
  },
  {
    icon: UserCircle,
    title: "Mi cuenta",
    description: "Datos de tu perfil, contraseña y verificación en dos pasos.",
    to: "/cuenta",
  },
  {
    icon: UtensilsCrossed,
    title: "Restaurantes y mesas",
    description: "Menú con QR por mesa, cómo recibir y gestionar los pedidos.",
    to: "/faq?tab=vendor",
  },
  {
    icon: ShieldCheck,
    title: "Seguridad",
    description: "Badge de tienda verificada, cuentas y buenas prácticas.",
    to: "/contacto",
  },
];

// Bloque 48: nueva página (sumada a Términos/Privacidad/FAQ del Bloque 17)
// — un punto de entrada por categoría antes de llegar al detalle de FAQ,
// con salida a Contacto si ninguna categoría resuelve la duda.
export default function Ayuda() {
  const { htmlContent } = useStaticPage("ayuda");

  if (htmlContent) {
    return (
      <div className="container-app max-w-[960px] py-14">
        <div className="prose-static" dangerouslySetInnerHTML={{ __html: htmlContent }} />
      </div>
    );
  }

  return (
    <div className="container-app max-w-[960px] py-14">
      <p className="mb-1.5 text-label-sm font-semibold uppercase tracking-wide text-tertiary-accent">Ayuda</p>
      <h1 className="mb-2 font-display text-headline-lg-mobile text-on-surface md:text-headline-lg">Centro de ayuda</h1>
      <p className="mb-10 text-body-md text-on-surface-variant">Elige el tema que te interesa.</p>

      <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CATEGORIES.map((c) => (
          <Link
            key={c.title}
            to={c.to}
            className="flex flex-col gap-3 rounded-lg border border-surface-container-high bg-surface-container-lowest p-5 transition-shadow hover:shadow-md"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-tertiary-accent/10">
              <c.icon className="h-5 w-5 text-tertiary-accent" />
            </span>
            <div>
              <div className="mb-1 text-[15px] font-bold text-on-surface">{c.title}</div>
              <p className="text-[13px] leading-5 text-on-surface-variant">{c.description}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-gradient-to-br from-primary to-primary-container p-7">
        <div>
          <h2 className="mb-1 font-display text-xl font-extrabold text-white">¿No encontraste lo que buscabas?</h2>
          <p className="text-body-md text-white/70">Escribinos y te respondemos directo.</p>
        </div>
        <Link
          to="/contacto"
          className="flex flex-shrink-0 items-center gap-2 whitespace-nowrap rounded bg-secondary-container px-5 py-3 text-label-md text-on-secondary-container hover:brightness-95"
        >
          Ir a Contacto <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
