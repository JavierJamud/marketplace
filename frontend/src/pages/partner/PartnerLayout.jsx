import { useEffect, useState } from "react";
import { NavLink, Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, KeyRound, Activity, BookOpen, UserCog, Menu, LogOut, Store } from "lucide-react";
import { useAuth, loginPathFor } from "../../context/AuthContext.jsx";
import { api } from "../../lib/api.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";

// Bloque 299 (pedido explícito — "los paneles de los socios mantienen la estructura del sitio y de los
// paneles de Baznova"): mismo armazón que los paneles del admin y del vendedor (tarjeta lateral flotante,
// barra superior en tarjeta, contenido a la derecha). Solo cambia el menú: es el panel del socio de la API.
const NAV = [
  { to: "/socio", label: "Resumen", icon: LayoutDashboard, end: true },
  { to: "/socio/llaves", label: "Llaves y cuotas", icon: KeyRound },
  { to: "/socio/movimientos", label: "Movimientos", icon: Activity },
  { to: "/socio/cuenta", label: "Mi cuenta", icon: UserCog },
];

export default function PartnerLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { siteName, logoUrl } = usePlatformSettings();
  const { data } = useQuery({ queryKey: ["partner-portal-me", user?.id], queryFn: async () => (await api.get("/partner-portal/me")).data, enabled: !!user });

  useEffect(() => setSidebarOpen(false), [location.pathname]);

  async function handleLogout() {
    await logout();
    navigate(loginPathFor(location.pathname), { replace: true });
  }

  return (
    <div className="min-h-dvh bg-surface-container lg:grid lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-4 lg:p-4">
      {sidebarOpen && <div className="fixed inset-0 z-40 animate-overlay-in bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col bg-tertiary px-3.5 py-[22px] transition-transform duration-300 ease-out lg:sticky lg:top-4 lg:h-[calc(100dvh-32px)] lg:translate-x-0 lg:rounded-3xl lg:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.35)] ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Link to="/" className="mb-1.5 flex items-center gap-2.5 px-2">
          {logoUrl ? (
            <img src={logoUrl} alt={siteName} className="h-8 w-8 flex-shrink-0 rounded object-cover" />
          ) : (
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-tertiary-accent-light font-display text-base font-extrabold text-tertiary">{siteName.charAt(0).toUpperCase()}</div>
          )}
          <div>
            <div className="font-display text-base font-bold leading-none text-white">{siteName}</div>
            <div className="text-[10px] font-semibold tracking-widest text-tertiary-accent-light">SOCIO</div>
          </div>
        </Link>
        <nav className="mt-[18px] flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `flex min-h-11 items-center gap-[11px] rounded px-3 py-2.5 text-[13.5px] font-semibold ${isActive ? "bg-tertiary-accent-light text-tertiary" : "text-white/70 hover:bg-white/5 hover:text-white"}`}
            >
              <Icon className="h-[17px] w-[17px]" />
              <span className="flex-1">{label}</span>
            </NavLink>
          ))}
          <a href={data?.docsUrl ?? "/api-socios"} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center gap-[11px] rounded px-3 py-2.5 text-[13.5px] font-semibold text-white/70 hover:bg-white/5 hover:text-white">
            <BookOpen className="h-[17px] w-[17px]" />
            <span className="flex-1">Documentación</span>
          </a>
        </nav>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col overflow-x-clip px-4 py-6 lg:px-[38px] lg:py-4">
        <div className="sticky top-2 z-30 mb-5 flex items-center gap-3 rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest px-4 py-2.5 shadow-sm lg:top-4">
          <button onClick={() => setSidebarOpen(true)} className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container lg:hidden" aria-label="Abrir menú">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 items-center gap-2 text-[13.5px] text-on-surface-variant">
            <Store className="h-4 w-4 flex-shrink-0 text-tertiary-accent" aria-hidden="true" />
            <span className="truncate font-semibold text-on-surface">{data?.partner?.name ?? "Panel del socio"}</span>
            {data?.partner?.status === "SUSPENDED" && <span className="rounded-full bg-error/10 px-2 py-0.5 text-[11px] font-bold text-error">Suspendido</span>}
          </div>
          <div className="flex-1" />
          <button onClick={handleLogout} className="flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container" aria-label="Cerrar sesión" title="Cerrar sesión">
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
