import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { ShoppingCart, User, LogOut } from "lucide-react";
import { useCart } from "../../context/CartContext.jsx";
import { useAuth, loginPathFor } from "../../context/AuthContext.jsx";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { SearchBar } from "./SearchBar.jsx";

function Logo() {
  const { siteName, logoUrl } = usePlatformSettings();
  return (
    <Link to="/" aria-label={siteName} className="flex h-11 min-w-11 flex-shrink-0 items-center justify-center gap-2.5">
      {logoUrl ? (
        <img src={logoUrl} alt={siteName} className="h-[34px] w-[34px] flex-shrink-0 rounded object-cover" />
      ) : (
        <div className="flex h-[34px] w-[34px] items-center justify-center rounded bg-secondary-container font-display text-lg font-extrabold text-primary">
          {siteName.charAt(0).toUpperCase()}
        </div>
      )}
      <span className="hidden font-display text-xl font-bold tracking-tight text-white sm:inline">{siteName}</span>
    </Link>
  );
}

// Dropdown de cuenta: antes el ícono era un simple <Link>, sin ninguna forma
// de cerrar sesión visible para clientes (vendedor/admin tenían un link
// "Salir" que tampoco borraba el token — ver AdminLayout/VendorLayout). Este
// menú cubre a los 3 roles con logout real (borra accessToken/refreshToken).
function AccountMenu({ user, accountHref, panelLabel }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // Bloque 46 (pedido explícito — "vamos a eliminar el botón de vender
  // gratis... lo que haremos es mejorar el botón de iniciar sesión, lo
  // encerraremos en un contenedor y le daremos color con el ícono que ya
  // tiene"): antes era un ícono suelto sin texto ni fondo — mismo
  // tratamiento visual que tenía "Vender gratis" (que ocupaba este mismo
  // lugar de CTA principal del header), reusado acá en vez de inventar un
  // estilo nuevo.
  if (!user) {
    return (
      <Link
        to="/cuenta"
        aria-label="Iniciar sesión o crear cuenta"
        className="flex h-11 min-w-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-secondary-container px-3 text-[13px] font-bold text-on-secondary-container hover:brightness-95 sm:px-4"
      >
        <User className="h-4 w-4" />
        <span className="hidden sm:inline">Iniciar sesión</span>
      </Link>
    );
  }

  // Bloque 60: logout() ahora avisa al backend para revocar la sesión de
  // verdad (antes solo borraba el token del lado del cliente).
  async function handleLogout() {
    await logout();
    setOpen(false);
    navigate(loginPathFor(location.pathname), { replace: true });
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Mi cuenta"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-2xl text-white/85 transition-colors hover:bg-white/15 hover:text-white"
      >
        <User className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+10px)] w-56 rounded-md border border-surface-container-high bg-surface-container-lowest py-1.5 shadow-lg">
          <div className="border-b border-surface-container px-3.5 py-2.5">
            <div className="truncate text-[13px] font-semibold text-on-surface">{user.fullName ?? user.email}</div>
            <div className="truncate text-[11.5px] text-outline">{user.email}</div>
          </div>
          <Link
            to={accountHref}
            onClick={() => setOpen(false)}
            className="block px-3.5 py-2.5 text-[13px] font-semibold text-on-surface-variant hover:bg-surface-container"
          >
            {panelLabel}
          </Link>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] font-semibold text-error hover:bg-error/5"
          >
            <LogOut className="h-3.5 w-3.5" /> Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}

// Bloque 239 (pedido explícito — "la barra de menú flotante, con bordes
// redondeados y un estilo glass"): el <header> sigue siendo sticky y sigue
// reservando sus 76px reales en el flujo (Home.jsx:194 estira el hero detrás
// con -mt-[76px]/pt-[76px], Shop.jsx:127 y Checkout.jsx:579 cuelgan sus
// sticky de esa altura) — por eso NO se toca ninguno de esos offsets. Lo que
// flota es la píldora de adentro: 8px de aire arriba y 60px de alto.
// Único elemento con blur de toda la barra (dosis de vidrio: 1 elemento,
// mismo criterio que VendorLayout.jsx:505). Arriba del todo en el Home la
// píldora es un velo claro (bg-white/10) sobre el hero navy, donde el blur
// no tiene nada que desenfocar; en cuanto hay contenido claro debajo
// (scroll en el Home, o cualquier otra página) pasa a bg-primary/75: texto
// blanco sobre esa mezcla mide más de 6:1 aun sobre blanco puro (R-25).
const HEADER_SCROLL_THRESHOLD = 8;

export function Header() {
  const { items, bump, openCart } = useCart();
  const { user } = useAuth();
  const location = useLocation();
  const count = items.reduce((a, i) => a + i.quantity, 0);

  // Bloque 250: las páginas que arrancan con un fondo oscuro o de color detrás
  // del menú (la Home y la página de una tienda, cuyo banner sube hasta arriba)
  // muestran el cristal más transparente mientras se está arriba del todo.
  const darkTop = location.pathname === "/" || location.pathname.startsWith("/tienda/");
  const [scrolled, setScrolled] = useState(!darkTop);

  useEffect(() => {
    if (!darkTop) {
      setScrolled(true);
      return;
    }
    setScrolled(window.scrollY > HEADER_SCROLL_THRESHOLD);
    function onScroll() {
      setScrolled(window.scrollY > HEADER_SCROLL_THRESHOLD);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [darkTop]);

  const atTop = darkTop && !scrolled;

  const accountHref = !user ? "/cuenta" : user.role === "ADMIN" ? "/admin" : user.role === "VENDOR" ? "/vendedor" : "/cuenta/panel";
  const panelLabel = user?.role === "ADMIN" ? "Panel de administración" : user?.role === "VENDOR" ? "Panel de vendedor" : "Mi cuenta";

  return (
    <header className="pointer-events-none sticky top-0 z-50 h-[76px]">
      <div className="container-app pt-2">
        <div
          data-top={atTop}
          className="liquid-glass pointer-events-auto flex h-[60px] items-center gap-2 px-3 sm:gap-3 sm:px-4 lg:gap-[22px]"
        >
          <Logo />

          <SearchBar />

          <div className="flex flex-shrink-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={openCart}
              aria-label="Ver carrito"
              className="relative flex h-11 w-11 items-center justify-center rounded-2xl text-white/90 transition-colors hover:bg-white/15 hover:text-white"
            >
              <ShoppingCart key={bump} className="h-[22px] w-[22px] animate-cart-bump" />
              {count > 0 && (
                <span
                  key={`badge-${bump}`}
                  className="absolute right-0.5 top-0.5 flex h-[17px] min-w-[17px] animate-badge-pop items-center justify-center rounded-full bg-secondary-container px-1 text-[10px] font-bold text-white"
                >
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </button>
            <AccountMenu user={user} accountHref={accountHref} panelLabel={panelLabel} />
          </div>
        </div>
      </div>
    </header>
  );
}
