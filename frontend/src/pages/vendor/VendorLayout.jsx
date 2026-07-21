import { useEffect, useState } from "react";
import { NavLink, Outlet, Link, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Package, ShoppingCart, UtensilsCrossed, ShieldCheck, Settings, MessageSquare, Menu, Star } from "lucide-react";
import { api } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { VerifiedBadge } from "../../components/ui/VerifiedBadge.jsx";
import { Spinner } from "../../components/ui/Spinner.jsx";
import { VendorNotificationBell } from "../../components/vendor/VendorNotificationBell.jsx";

const NAV = [
  { to: "/vendedor", label: "Resumen", icon: LayoutDashboard, end: true },
  { to: "/vendedor/productos", label: "Productos", icon: Package },
  { to: "/vendedor/pedidos", label: "Pedidos", icon: ShoppingCart },
  { to: "/vendedor/mesas", label: "Mesas / QR", icon: UtensilsCrossed, restaurantOnly: true },
  { to: "/vendedor/verificacion", label: "Verificación", icon: ShieldCheck },
  { to: "/vendedor/mensajes", label: "Mensajes", icon: MessageSquare },
  { to: "/vendedor/resenas", label: "Reseñas", icon: Star },
  { to: "/vendedor/configuracion", label: "Configuración", icon: Settings },
];

export default function VendorLayout() {
  const { user, loading: authLoading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Bloque 20: el drawer mobile se cierra solo al navegar a otra sección —
  // sin esto quedaba abierto tapando la pantalla nueva.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  function handleLogout() {
    // Antes este link ("Volver al sitio") solo navegaba sin borrar el token
    // — la sesión anterior quedaba viva y volvía a entrar sola.
    logout();
    navigate("/", { replace: true });
  }

  const { data: vendor, isLoading: vendorLoading, isError } = useQuery({
    queryKey: ["my-vendor"],
    queryFn: async () => (await api.get("/vendors/me")).data.vendor,
    enabled: !!user,
    retry: false,
  });

  if (authLoading || (user && vendorLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-container">
        <Spinner />
      </div>
    );
  }

  // Guard: solo vendedores autenticados con tienda propia entran al panel.
  if (!user || isError) return <Navigate to="/cuenta" replace />;

  const nav = NAV.filter((n) => !n.restaurantOnly || vendor?.isRestaurant);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 animate-overlay-in bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-[248px] flex-col bg-primary px-3.5 py-[22px] transition-transform duration-300 ease-out lg:sticky lg:top-0 lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Link to="/" className="mb-2 flex items-center gap-2.5 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-secondary-container font-display text-base font-extrabold text-primary">Z</div>
          <span className="font-display text-lg font-bold text-white">
            Zeu<span className="text-secondary-container">Din</span>
          </span>
        </Link>

        <div className="mb-3 border-b border-white/10 px-2 pb-4">
          <div className="mt-3 flex items-center gap-2">
            <div className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px] bg-primary-container font-display text-sm font-bold text-white">
              {vendor?.companyName?.[0]}
            </div>
            <div>
              <div className="flex items-center gap-1">
                <span className="text-label-md font-bold text-white">{vendor?.companyName}</span>
                {vendor?.isVerified && <VerifiedBadge size="sm" />}
              </div>
              <div className="text-[11px] font-semibold text-secondary-container">
                {vendor?.isRestaurant ? "Restaurante · " : ""}
                Plan {vendor?.planType === "BUSINESS" ? "Business" : "Regular"}
              </div>
            </div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-[3px] overflow-y-auto">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-[11px] rounded px-3 py-2.5 text-[13.5px] font-semibold ${
                  isActive ? "bg-secondary-container text-primary" : "text-white/70 hover:bg-white/5 hover:text-white"
                }`
              }
            >
              <Icon className="h-[17px] w-[17px]" />
              {label}
            </NavLink>
          ))}
        </nav>

        <button onClick={handleLogout} className="flex items-center gap-2.5 rounded px-3 py-2.5 text-left text-[13px] font-semibold text-white/55 hover:text-white/85">
          Cerrar sesión
        </button>
      </aside>
      <main className="bg-surface-container px-4 py-6 lg:px-[38px] lg:py-[30px]">
        <div className="mb-4 flex items-center justify-between lg:justify-end">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high lg:hidden"
            aria-label="Abrir menú"
          >
            <Menu className="h-5 w-5" />
          </button>
          <VendorNotificationBell />
        </div>
        <Outlet context={{ vendor }} />
      </main>
    </div>
  );
}
