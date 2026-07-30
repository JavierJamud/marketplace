import { useEffect, useState } from "react";
import { NavLink, Outlet, Link, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Package, ShoppingCart, UtensilsCrossed, ShieldCheck, Settings, MessageSquare, Menu, Star, UserCog, Tag, Percent, Gift, Ban } from "lucide-react";
import { api } from "../../lib/api.js";
import { useAuth, loginPathFor } from "../../context/AuthContext.jsx";
import { VerifiedBadge } from "../../components/ui/VerifiedBadge.jsx";
import { Spinner } from "../../components/ui/Spinner.jsx";
import { VendorNotificationBell } from "../../components/vendor/VendorNotificationBell.jsx";
import { OffersAnnouncementPopup } from "../../components/vendor/OffersAnnouncementPopup.jsx";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";

const NAV = [
  { to: "/vendedor", label: "Resumen", icon: LayoutDashboard, end: true },
  { to: "/vendedor/productos", label: "Productos", icon: Package },
  { to: "/vendedor/ofertas", label: "Ofertas", icon: Tag },
  { to: "/vendedor/codigos-descuento", label: "Códigos de descuento", icon: Percent },
  { to: "/vendedor/ofertas-tienda", label: "Ofertas de tienda", icon: Gift },
  { to: "/vendedor/pedidos", label: "Pedidos", icon: ShoppingCart },
  { to: "/vendedor/mesas", label: "Mesas / QR", icon: UtensilsCrossed, restaurantOnly: true },
  { to: "/vendedor/verificacion", label: "Verificación y plan", icon: ShieldCheck },
  { to: "/vendedor/mensajes", label: "Mensajes", icon: MessageSquare },
  { to: "/vendedor/resenas", label: "Reseñas", icon: Star },
  { to: "/vendedor/configuracion", label: "Configuración", icon: Settings },
  { to: "/vendedor/perfil", label: "Mi perfil", icon: UserCog },
];

function fmtSuspendedDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "long", year: "numeric" });
}

// Bloque 62: tienda suspendida automáticamente por 90 días sin acceso (ver
// vendorLifecycle.job.js) — a diferencia de isBlocked (el admin puede
// desbloquear con un clic desde AdminVendors.jsx), acá SOLO un admin puede
// reactivarla a mano con un motivo (AdminSuspendedVendors.jsx). El vendedor
// sigue pudiendo entrar a esta pantalla (no un 403 genérico) para enterarse
// de por qué y saber qué hacer, pero no ve ningún dato del panel real.
function VendorSuspendedGate({ vendor, onLogout }) {
  const suspendedOn = fmtSuspendedDate(vendor.suspendedAt);
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-container p-4">
      <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-7 text-center shadow-lg">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-error/10">
          <Ban className="h-7 w-7 text-error" />
        </div>
        <h1 className="mb-2 text-title-lg font-bold text-on-surface">Tu tienda está pausada</h1>
        <p className="mb-1 text-[13.5px] leading-relaxed text-on-surface-variant">
          {vendor.suspensionReason || "Se pausó automáticamente por inactividad prolongada en el panel de vendedor."}
        </p>
        {suspendedOn && <p className="mb-4 text-[12px] text-outline">Pausada el {suspendedOn}.</p>}
        <p className="mb-6 text-[13px] leading-relaxed text-on-surface-variant">
          Tu tienda y tus productos no son visibles en el sitio mientras esté pausada. Contáctanos para reactivarla — tus
          datos, pedidos y reseñas siguen intactos.
        </p>
        <div className="flex flex-col gap-2.5">
          <Link
            to="/contacto"
            className="rounded-xl bg-primary px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-primary/90"
          >
            Contactar soporte
          </Link>
          <button
            onClick={onLogout}
            className="rounded-xl border border-outline-variant px-5 py-2.5 text-[13px] font-semibold text-on-surface transition hover:bg-surface-variant"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VendorLayout() {
  // Bloque 60: la sesión/rol ya se validó un nivel arriba (ver
  // ProtectedRoute en App.jsx) — acá solo hace falta `user` para pedir la
  // tienda propia, nunca hay que volver a chequear si hay sesión.
  const { user, logout } = useAuth();
  const { siteName, logoUrl } = usePlatformSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Bloque 20: el drawer mobile se cierra solo al navegar a otra sección —
  // sin esto quedaba abierto tapando la pantalla nueva.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Bloque 60: logout() ahora avisa al backend para revocar la sesión de
  // verdad (antes solo borraba el token del lado del cliente). El destino
  // pasa a ser el login de vendedor (antes iba siempre a "/", incluso acá).
  async function handleLogout() {
    await logout();
    navigate(loginPathFor(location.pathname), { replace: true });
  }

  const { data: vendor, isLoading: vendorLoading, isError } = useQuery({
    queryKey: ["my-vendor"],
    queryFn: async () => (await api.get("/vendors/me")).data.vendor,
    enabled: !!user,
    retry: false,
  });

  if (vendorLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-container">
        <Spinner />
      </div>
    );
  }

  // Un VENDOR autenticado sin tienda propia (o con error al cargarla) no
  // tiene nada que hacer acá — mismo destino que ProtectedRoute usaría.
  if (isError) return <Navigate to="/vendedor/ingresar" replace />;

  if (vendor?.status === "SUSPENDED") {
    return <VendorSuspendedGate vendor={vendor} onLogout={handleLogout} />;
  }

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
          {logoUrl ? (
            <img src={logoUrl} alt={siteName} className="h-8 w-8 flex-shrink-0 rounded object-cover" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded bg-secondary-container font-display text-base font-extrabold text-primary">
              {siteName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="font-display text-lg font-bold text-white">{siteName}</span>
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
      <OffersAnnouncementPopup vendor={vendor} />
    </div>
  );
}
