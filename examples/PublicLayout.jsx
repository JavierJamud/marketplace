// examples/PublicLayout.jsx
// -----------------------------------------------------------------------------
// Header navy sticky + footer compartidos por TODAS las pantallas públicas.
// Traducido de los mockups .dc.html a TU stack: Tailwind (tokens de tu config) +
// react-router-dom (<Link>) + useCart() (badge del carrito).
//
// Ubicación destino en tu repo: frontend/src/components/layout/PublicLayout.jsx
// (ya envuelve las rutas públicas en App.jsx via <Route element={<PublicLayout/>}>).
// -----------------------------------------------------------------------------
import { Link, NavLink, Outlet } from "react-router-dom";
import { Search, User, ShoppingCart } from "lucide-react";
import { useCart } from "../../context/CartContext.jsx";

const NAV = [
  { to: "/", label: "Inicio", end: true },
  { to: "/catalogo", label: "Catálogo" },
  { to: "/tiendas", label: "Tiendas" },
  { to: "/cuenta/panel", label: "Mi Cuenta" },
];

function Logo() {
  return (
    <Link to="/" className="flex flex-shrink-0 items-center gap-2.5">
      <div className="flex h-[34px] w-[34px] items-center justify-center rounded bg-secondary-container font-display text-lg font-extrabold text-primary">
        A
      </div>
      <span className="font-display text-xl font-bold tracking-tight text-white">
        Apex<span className="text-secondary-container">Market</span>
      </span>
    </Link>
  );
}

function Header() {
  const { items } = useCart();
  const count = items.reduce((a, i) => a + i.quantity, 0);

  return (
    <header className="sticky top-0 z-50 bg-primary-container shadow-[0_2px_12px_rgba(0,0,0,0.12)]">
      <div className="container-app flex h-[76px] items-center gap-7">
        <Logo />

        <nav className="flex flex-shrink-0 items-center gap-6">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `text-label-md ${isActive ? "text-white" : "text-white/75 hover:text-white"}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        {/* Buscador */}
        <div className="flex h-10 flex-1 items-center gap-2 rounded bg-white/10 px-3.5">
          <Search className="h-4 w-4 text-white/60" />
          <input
            placeholder="Buscar productos, tiendas o categorías..."
            className="w-full border-none bg-transparent text-label-sm text-white outline-none placeholder:text-white/50"
          />
        </div>

        <div className="flex flex-shrink-0 items-center gap-[18px]">
          <Link to="/cuenta" className="text-white/85 hover:text-white">
            <User className="h-5 w-5" />
          </Link>
          <Link to="/carrito" className="relative text-white/90 hover:text-white">
            <ShoppingCart className="h-[22px] w-[22px]" />
            {count > 0 && (
              <span className="absolute -right-2.5 -top-2 flex h-[17px] w-[17px] items-center justify-center rounded-full bg-secondary-container text-[10px] font-bold text-white">
                {count}
              </span>
            )}
          </Link>
          <Link
            to="/vender"
            className="whitespace-nowrap rounded border border-white/35 px-4 py-2.5 text-label-md text-white hover:bg-white/10"
          >
            Vender en Apex
          </Link>
        </div>
      </div>
    </header>
  );
}

// Footer corto — el usado en la mayoría de las páginas (Home tiene el completo,
// que podés armar aparte cuando implementes esa página).
function Footer() {
  return (
    <footer className="bg-primary">
      <div className="container-app flex flex-wrap items-center justify-between gap-4 py-10">
        <span className="text-label-sm text-white/40">
          © 2026 Apex Market. Todos los derechos reservados.
        </span>
        <div className="flex gap-6">
          <Link to="/" className="text-label-sm text-white/55 hover:text-white">Inicio</Link>
          <Link to="/tiendas" className="text-label-sm text-white/55 hover:text-white">Tiendas</Link>
          <Link to="/cuenta/panel" className="text-label-sm text-white/55 hover:text-white">Mi cuenta</Link>
        </div>
      </div>
    </footer>
  );
}

export function PublicLayout() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <Outlet />
      <Footer />
    </div>
  );
}

export default PublicLayout;
