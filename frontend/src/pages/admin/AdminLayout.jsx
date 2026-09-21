import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Store, ShieldCheck, ShieldAlert, Users, Megaphone, Plug, MessageSquare, MessageCircle, Globe2, Tags, Menu, Star, Bot, AlertTriangle, CreditCard, Image, UserCog, Search, Bell, X, FileText, Tag, Package, HelpCircle, Mail, LifeBuoy, Percent, Gift, Ban, Activity, LogOut, Zap, Wallet, Radar } from "lucide-react";
import { useAuth, loginPathFor } from "../../context/AuthContext.jsx";
import { api } from "../../lib/api.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";

const NAV = [
  // Bloque 194 (pedido explícito — "cambiarla por el nombre Dashboard,
  // tanto en vendedores como en admin").
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/tiendas", label: "Tiendas", icon: Store },
  { to: "/admin/tiendas-suspendidas", label: "Tiendas suspendidas", icon: Ban },
  { to: "/admin/productos", label: "Productos", icon: Package },
  { to: "/admin/ventas-rapidas", label: "Venta rápida", icon: Zap },
  // Feature B (pedido explícito): badge propio (fraudReportsCount), mismo
  // criterio que "Errores" (errorCount) más abajo.
  { to: "/admin/reportes-fraude", label: "Reportes de fraude", icon: ShieldAlert, badge: "fraudReportsCount" },
  // Bloque 229 (Fase 2 del blindaje del ranking): badge propio
  // (rankingAnomaliesCount), mismo criterio que "Reportes de fraude" arriba.
  { to: "/admin/anomalias-ranking", label: "Anomalías del ranking", icon: Radar, badge: "rankingAnomaliesCount" },
  { to: "/admin/verificaciones", label: "Verificaciones", icon: ShieldCheck },
  { to: "/admin/clientes", label: "Clientes", icon: Users },
  { to: "/admin/ventas-manuales", label: "Agentes de Ventas", icon: Wallet },
  // Bloque 70 (pedido explícito): récord de todo lo que hacen vendedores y
  // clientes en sus paneles + gráfica de uso por día/semana/mes.
  { to: "/admin/actividad", label: "Actividad", icon: Activity },
  { to: "/admin/sugerencias", label: "Sugerencias", icon: MessageSquare },
  { to: "/admin/comentarios", label: "Comentarios", icon: Star },
  { to: "/admin/mensajes", label: "Mensajes", icon: MessageCircle },
  { to: "/admin/campanas", label: "Campañas", icon: Megaphone },
  { to: "/admin/suscripciones", label: "Suscripciones", icon: CreditCard },
  { to: "/admin/ofertas", label: "Ofertas", icon: Tag },
  // Auditoría de seguridad: antes no había ninguna supervisión de admin
  // sobre esto (Bloque 52) — ver discountCodes.controller.js/storeOffers.controller.js.
  { to: "/admin/codigos-descuento", label: "Códigos de descuento", icon: Percent },
  { to: "/admin/ofertas-tienda", label: "Ofertas de tienda", icon: Gift },
  { to: "/admin/anuncios", label: "Anuncios", icon: Image },
  { to: "/admin/integraciones", label: "Integraciones", icon: Plug },
  { to: "/admin/asistente", label: "Asistente del marketplace", icon: Bot },
  // Bloque 33: badge propio (errorCount) en vez de "notifications" — ver
  // el useQuery de abajo y el render del badge en el map de NAV.
  { to: "/admin/errores", label: "Errores", icon: AlertTriangle, badge: "errorCount" },
  { to: "/admin/ubicaciones", label: "Países y provincias", icon: Globe2 },
  { to: "/admin/categorias", label: "Categorías de negocio", icon: Tags },
  // Bloque 53: "Páginas" quedó solo para Términos/Privacidad — FAQ, Contacto
  // y Centro de ayuda pasaron a tener su propia entrada de menú.
  { to: "/admin/paginas", label: "Términos y privacidad", icon: FileText },
  { to: "/admin/preguntas-frecuentes", label: "Preguntas frecuentes", icon: HelpCircle },
  { to: "/admin/contacto", label: "Contacto", icon: Mail },
  { to: "/admin/centro-ayuda", label: "Centro de ayuda", icon: LifeBuoy },
  { to: "/admin/perfil", label: "Mi perfil", icon: UserCog },
];

// Bloque 47: barra fija de búsqueda + notificaciones — visible en desktop y
// mobile por igual (reemplaza el header que antes solo existía en mobile).
function SearchAndNotifications({ onOpenSidebar, onLogout }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const searchRef = useRef(null);
  const notifRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data: results } = useQuery({
    queryKey: ["admin-search", debouncedQ],
    queryFn: async () => (await api.get("/admin/search", { params: { q: debouncedQ } })).data,
    enabled: debouncedQ.length >= 2,
  });

  const { data: notifications } = useQuery({
    queryKey: ["admin-notifications"],
    queryFn: async () => (await api.get("/admin/notifications")).data,
    refetchInterval: 20000,
  });

  useEffect(() => {
    function onClickOutside(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function goTo(to) {
    setSearchOpen(false);
    setQ("");
    navigate(to);
  }

  const hasResults = results && (results.vendors.length || results.customers.length || results.orders.length);
  const notifTotal = notifications?.total ?? 0;

  return (
    <div className="sticky top-4 z-30 mb-5 flex items-center gap-3 rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_24px_-12px_rgba(15,23,42,0.1)] lg:px-5">
      <button
        onClick={onOpenSidebar}
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container lg:hidden"
        aria-label="Abrir menú"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div ref={searchRef} className="relative flex-1 max-w-[420px]">
        <div className="flex h-10 items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-3.5">
          <Search className="h-4 w-4 flex-shrink-0 text-outline" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            placeholder="Buscar tienda, cliente o pedido..."
            className="w-full border-none bg-transparent text-[13px] outline-none"
          />
          {q && (
            <button onClick={() => setQ("")} className="flex-shrink-0 text-outline hover:text-on-surface">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {searchOpen && debouncedQ.length >= 2 && (
          <div className="absolute z-10 mt-1.5 w-full overflow-hidden rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
            {!hasResults && <p className="p-3.5 text-[12.5px] text-outline">Sin resultados para "{debouncedQ}".</p>}
            {results?.vendors.length > 0 && (
              <div className="border-b border-surface-container py-1.5">
                <div className="px-3.5 py-1 text-[10.5px] font-bold uppercase tracking-wide text-outline">Tiendas</div>
                {results.vendors.map((r) => (
                  <button key={r.id} onClick={() => goTo(r.to)} className="block w-full px-3.5 py-2 text-left text-[13px] hover:bg-surface-container">
                    {r.label}
                  </button>
                ))}
              </div>
            )}
            {results?.customers.length > 0 && (
              <div className="border-b border-surface-container py-1.5">
                <div className="px-3.5 py-1 text-[10.5px] font-bold uppercase tracking-wide text-outline">Clientes</div>
                {results.customers.map((r) => (
                  <button key={r.id} onClick={() => goTo(r.to)} className="block w-full px-3.5 py-2 text-left text-[13px] hover:bg-surface-container">
                    {r.label}
                  </button>
                ))}
              </div>
            )}
            {results?.orders.length > 0 && (
              <div className="py-1.5">
                <div className="px-3.5 py-1 text-[10.5px] font-bold uppercase tracking-wide text-outline">Pedidos</div>
                {results.orders.map((r) => (
                  <button key={r.id} onClick={() => goTo(r.to)} className="block w-full px-3.5 py-2 text-left text-[13px] hover:bg-surface-container">
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex flex-shrink-0 items-center gap-1">
        <div ref={notifRef} className="relative">
          <button
            onClick={() => setNotifOpen((o) => !o)}
            className="relative flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container"
            aria-label="Notificaciones"
          >
            <Bell className="h-[18px] w-[18px]" />
            {notifTotal > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-error px-1 text-[9.5px] font-bold text-white">
                {notifTotal > 99 ? "99+" : notifTotal}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 z-10 mt-1.5 w-[300px] overflow-hidden rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
              <div className="border-b border-surface-container-high px-3.5 py-2.5 text-[12.5px] font-bold text-on-surface">Notificaciones</div>
              <div className="max-h-[360px] overflow-y-auto">
                {!notifications?.items?.length && <p className="p-3.5 text-[12.5px] text-outline">No hay nada pendiente.</p>}
                {notifications?.items?.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      setNotifOpen(false);
                      navigate(n.to);
                    }}
                    className="block w-full border-b border-surface-container px-3.5 py-2.5 text-left text-[12.5px] last:border-b-0 hover:bg-surface-container"
                  >
                    {n.text}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bloque 76 (pedido explícito): mismo lugar/criterio que el panel
            de vendedor — al lado de la campanita, fuera del sidebar. */}
        <button
          onClick={onLogout}
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container"
        >
          <LogOut className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  );
}

export default function AdminLayout() {
  // Bloque 60: la sesión/rol ya se validó un nivel arriba (ver
  // ProtectedRoute en App.jsx) — nunca hay que volver a chequear acá.
  const { user, logout } = useAuth();
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

  // Feature B: cuántos reportes de fraude siguen sin resolver (PENDING +
  // EVIDENCE_REQUESTED) — mismo patrón de polling que errorCount de arriba.
  const { data: fraudReportsCountData } = useQuery({
    queryKey: ["admin-fraud-reports-count"],
    queryFn: async () => (await api.get("/admin/reports/pending-count")).data,
    enabled: !!user && user.role === "ADMIN",
    refetchInterval: 20000,
  });
  const fraudReportsCount = fraudReportsCountData?.count ?? 0;

  // Bloque 229: mismo patrón de polling que fraudReportsCount de arriba.
  const { data: rankingAnomaliesCountData } = useQuery({
    queryKey: ["admin-ranking-anomalies-count"],
    queryFn: async () => (await api.get("/admin/ranking-anomalies/pending-count")).data,
    enabled: !!user && user.role === "ADMIN",
    refetchInterval: 20000,
  });
  const rankingAnomaliesCount = rankingAnomaliesCountData?.count ?? 0;
  const { siteName, logoUrl } = usePlatformSettings();

  // Bloque 20: el drawer mobile se cierra solo al navegar a otra sección —
  // sin esto quedaba abierto tapando la pantalla nueva.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Bloque 60: logout() ahora avisa al backend para revocar la sesión de
  // verdad (antes solo borraba el token del lado del cliente). El destino
  // pasa a ser el login de admin (antes iba siempre a "/", incluso acá).
  async function handleLogout() {
    await logout();
    navigate(loginPathFor(location.pathname), { replace: true });
  }

  return (
    // Bloque 220 (pedido explícito, con imagen de referencia — "rediseña
    // los paneles... estructura como la de la imagen"): mismo criterio que
    // VendorLayout.jsx — el sidebar pasa a ser una tarjeta flotante (margen +
    // esquinas redondeadas + sombra) sobre un fondo gris parejo, sin tocar
    // ninguna clase de mobile (fixed/inset-y-0/translate-x).
    <div className="min-h-dvh bg-surface-container lg:grid lg:grid-cols-[248px_1fr] lg:gap-4 lg:p-4">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 animate-overlay-in bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        // Ver nota igual en VendorLayout.jsx: `h-dvh` en un `fixed` se
        // recalcula en vivo mientras el navegador oculta/muestra su barra de
        // direcciones al hacer scroll (bug real reportado en vivo) — en
        // mobile se saca del todo, `inset-y-0` alcanza sin recalcular nada;
        // en desktop (`lg:sticky`) sí hace falta explícita.
        // Ver misma nota en VendorLayout.jsx: se probó mover el scroll al
        // `<aside>` entero pensando que el `overflow-y-auto` del nav era
        // frágil anidado en un sticky/dvh — resultó ser un falso positivo
        // (una ventana de prueba dejada en tamaño de celular por error, no
        // un bug real). El scroll vuelve al nav — el logo de arriba queda
        // fijo, solo el nav se desliza internamente cuando hace falta.
        className={`fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col bg-tertiary px-3.5 py-[22px] transition-transform duration-300 ease-out lg:sticky lg:top-4 lg:h-[calc(100dvh-32px)] lg:translate-x-0 lg:rounded-3xl lg:shadow-[0_20px_50px_-20px_rgba(0,29,30,0.4)] ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Link to="/" className="mb-1.5 flex items-center gap-2.5 px-2">
          {logoUrl ? (
            <img src={logoUrl} alt={siteName} className="h-8 w-8 flex-shrink-0 rounded object-cover" />
          ) : (
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-tertiary-accent-light font-display text-base font-extrabold text-tertiary">
              {siteName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div className="font-display text-base font-bold leading-none text-white">{siteName}</div>
            <div className="text-[10px] font-semibold tracking-widest text-tertiary-accent-light">ADMIN</div>
          </div>
        </Link>
        {/* Bugs reales reportados en vivo (ver misma nota en
            VendorLayout.jsx): (1) sin `min-h-0` este nav nunca se encoge por
            debajo de su propio alto de contenido, así que `overflow-y-auto`
            quedaba sin efecto y el nav (acá, 22 links) se desbordaba del
            aside en vez de scrollear internamente cuando el alto real
            disponible era menor. (2) `flex-1` además dejaba CRECER al nav
            más allá de su contenido cuando sobraba espacio (en mobile, al
            colapsarse la barra de direcciones de Safari durante el scroll),
            dejando un hueco vacío antes de cualquier contenido fijo debajo.
            Sin `flex-1` (un hijo flex ya es `flex:0 1 auto` por default) el
            nav nunca crece de más. (3) El propio `overflow-y-auto` de este
            nav, anidado dentro del `<aside>` sticky/dvh — se creyó frágil
            en navegadores reales, pero era un falso positivo (ver nota en
            `className` del `<aside>`). El scroll vuelve al nav — el logo de
            arriba queda fijo, solo el nav se desliza internamente. */}
        <nav className="mt-[18px] flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto">
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
              {badge === "fraudReportsCount" && fraudReportsCount > 0 && (
                <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-white">
                  {fraudReportsCount}
                </span>
              )}
              {badge === "rankingAnomaliesCount" && rankingAnomaliesCount > 0 && (
                <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-white">
                  {rankingAnomaliesCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Bloque 220: header y contenido comparten el MISMO padding horizontal
          (antes el header iba pegado al borde del todo mientras el contenido
          de abajo quedaba indentado 38px — dos alineaciones distintas una
          debajo de la otra, se veía "cortado"). Ahora los dos viven dentro
          del mismo contenedor con padding, así el borde de la tarjeta del
          header queda exactamente alineado con las tarjetas del dashboard. */}
      <div className="flex min-h-dvh flex-1 flex-col px-4 py-6 lg:px-[38px] lg:py-4">
        <SearchAndNotifications onOpenSidebar={() => setSidebarOpen(true)} onLogout={handleLogout} />
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
