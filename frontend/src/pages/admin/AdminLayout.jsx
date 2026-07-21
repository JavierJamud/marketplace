import { useEffect, useState } from "react";
import { NavLink, Outlet, Link, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Store, ShieldCheck, Users, Megaphone, Plug, MessageSquare, MessageCircle, Globe2, Tags, Menu, Star, Bot, AlertTriangle } from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import { Spinner } from "../../components/ui/Spinner.jsx";
import { api } from "../../lib/api.js";

const NAV = [
  { to: "/admin", label: "Resumen", icon: LayoutDashboard, end: true },
  { to: "/admin/tiendas", label: "Tiendas", icon: Store },
  { to: "/admin/verificaciones", label: "Verificaciones", icon: ShieldCheck },
  { to: "/admin/clientes", label: "Clientes", icon: Users },
  { to: "/admin/sugerencias", label: "Sugerencias", icon: MessageSquare },
  { to: "/admin/comentarios", label: "Comentarios", icon: Star },
  { to: "/admin/mensajes", label: "Mensajes", icon: MessageCircle },
  { to: "/admin/campanas", label: "Campañas", icon: Megaphone },
  { to: "/admin/integraciones", label: "Integraciones", icon: Plug },
  { to: "/admin/asistente", label: "Asistente del marketplace", icon: Bot },
  // Bloque 33: badge propio (errorCount) en vez de "notifications" — ver
  // el useQuery de abajo y el render del badge en el map de NAV.
  { to: "/admin/errores", label: "Errores", icon: AlertTriangle, badge: "errorCount" },
  { to: "/admin/ubicaciones", label: "Países y provincias", icon: Globe2 },
  { to: "/admin/categorias", label: "Categorías de negocio", icon: Tags },
];

export default function AdminLayout() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Bloque 33: cuántos ErrorLog quedan sin resolver — mismo patrón de
  // polling que VendorNotificationBell.jsx (Bloque 16), pero acá no hay
  // dropdown ni "marcar visto al abrir": un error solo deja de contar
  // cuando el admin lo marca "Resuelto" a mano en AdminErrors.jsx.
  const { data: errorCountData } = useQuery({
    queryKey: ["admin-errors-unresolved-count"],
    queryFn: async () => (await api.get("/admin/errors/unresolved-count")).data,
    enabled: !!user && user.role === "ADMIN",
    refetchInterval: 20000,
  });
  const errorCount = errorCountData?.count ?? 0;

  // Bloque 20: el drawer mobile se cierra solo al navegar a otra sección —
  // sin esto quedaba abierto tapando la pantalla nueva.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  function handleLogout() {
    // Bug conocido: este link antes solo redirigía a Home sin borrar el
    // token — la sesión anterior quedaba viva en localStorage y volvía a
    // entrar sola. logout() borra accessToken/refreshToken y resetea el user.
    logout();
    navigate("/", { replace: true });
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-container">
        <Spinner />
      </div>
    );
  }

  // Guard: rol admin estrictamente separado de vendedor/cliente.
  if (!user || user.role !== "ADMIN") return <Navigate to="/cuenta" replace />;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 animate-overlay-in bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-[248px] flex-col bg-tertiary px-3.5 py-[22px] transition-transform duration-300 ease-out lg:sticky lg:top-0 lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Link to="/" className="mb-1.5 flex items-center gap-2.5 px-2">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-tertiary-accent-light font-display text-base font-extrabold text-tertiary">
            Z
          </div>
          <div>
            <div className="font-display text-base font-bold leading-none text-white">ZeuDin</div>
            <div className="text-[10px] font-semibold tracking-widest text-tertiary-accent-light">ADMIN</div>
          </div>
        </Link>
        <nav className="mt-[18px] flex flex-1 flex-col gap-[3px] overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon, end, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-[11px] rounded px-3 py-2.5 text-[13.5px] font-semibold ${
                  isActive ? "bg-tertiary-accent-light text-tertiary" : "text-white/70 hover:bg-white/5 hover:text-white"
                }`
              }
            >
              <Icon className="h-[17px] w-[17px]" />
              <span className="flex-1">{label}</span>
              {badge === "errorCount" && errorCount > 0 && (
                <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-white">
                  {errorCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <button onClick={handleLogout} className="flex items-center gap-2.5 rounded px-3 py-2.5 text-left text-[13px] font-semibold text-white/50 hover:text-white/80">
          Salir del panel
        </button>
      </aside>

      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-surface-container-high bg-surface-container-lowest px-4 py-3 lg:hidden">
        <button
          onClick={() => setSidebarOpen(true)}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container"
          aria-label="Abrir menú"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="font-display text-sm font-bold text-on-surface">Panel admin</span>
      </div>

      <main className="bg-surface-container px-4 py-6 lg:px-[38px] lg:py-[30px]">
        <Outlet />
      </main>
    </div>
  );
}
