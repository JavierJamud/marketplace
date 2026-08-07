import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { ShoppingCart, User, LogOut, Store } from "lucide-react";
import { useCart } from "../../context/CartContext.jsx";
import { useAuth, loginPathFor } from "../../context/AuthContext.jsx";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { SearchBar } from "./SearchBar.jsx";

function Logo() {
  const { siteName, logoUrl } = usePlatformSettings();
  return (
    <Link to="/" className="flex flex-shrink-0 items-center gap-2.5">
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
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  if (!user) {
    return (
      <Link to="/cuenta" aria-label="Iniciar sesión o crear cuenta" className="flex items-center text-white/85 hover:text-white">
        <User className="h-5 w-5" />
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
      <button onClick={() => setOpen((o) => !o)} aria-label="Mi cuenta" className="flex items-center text-white/85 hover:text-white">
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

export function Header() {
  const { items, bump, openCart } = useCart();
  const { user } = useAuth();
  const count = items.reduce((a, i) => a + i.quantity, 0);

  const accountHref = !user ? "/cuenta" : user.role === "ADMIN" ? "/admin" : user.role === "VENDOR" ? "/vendedor" : "/cuenta/panel";
  const panelLabel = user?.role === "ADMIN" ? "Panel de administración" : user?.role === "VENDOR" ? "Panel de vendedor" : "Mi cuenta";

  return (
    <header className="sticky top-0 z-50 bg-primary-container shadow-[0_2px_12px_rgba(0,0,0,0.12)]">
      <div className="container-app flex h-[76px] items-center gap-4 lg:gap-[22px]">
        <Logo />

        <SearchBar />

        <div className="flex flex-shrink-0 items-center gap-4">
          <button
            type="button"
            onClick={openCart}
            aria-label="Ver carrito"
            className="relative flex items-center text-white/90 hover:text-white"
          >
            <ShoppingCart key={bump} className="h-[22px] w-[22px] animate-cart-bump" />
            {count > 0 && (
              <span
                key={`badge-${bump}`}
                className="absolute -right-2.5 -top-2 flex h-[17px] w-[17px] animate-badge-pop items-center justify-center rounded-full bg-secondary-container text-[10px] font-bold text-white"
              >
                {count}
              </span>
            )}
          </button>
          <AccountMenu user={user} accountHref={accountHref} panelLabel={panelLabel} />
          <Link
            to="/vender"
            aria-label="Vender gratis"
            className="flex items-center gap-1.5 whitespace-nowrap rounded bg-secondary-container px-2.5 py-2.5 text-[13px] font-bold text-on-secondary-container hover:brightness-95 sm:px-4"
          >
            <Store className="h-4 w-4 sm:hidden" />
            <span className="hidden sm:inline">Vender gratis</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
