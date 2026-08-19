import { useEffect, useState } from "react";
import { NavLink, Outlet, Link, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Package, ShoppingCart, UtensilsCrossed, ShieldCheck, Settings, MessageSquare, Menu, Star, UserCog, Tag, Percent, Gift, Ban, Zap, LogOut } from "lucide-react";
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

// Bloque 75 (pedido explícito, bug real reportado en vivo): pantalla única
// para las 2 formas en que una tienda queda inhabilitada — bloqueada a mano
// por un admin (Vendor.isBlocked, reversible con un clic desde
// AdminVendors.jsx) o suspendida sola por 90 días de inactividad
// (Vendor.status:"SUSPENDED", ver vendorLifecycle.job.js, solo reactivable a
// mano por un admin desde AdminSuspendedVendors.jsx). Antes de esto, un
// bloqueo manual no tenía NINGÚN aviso en el panel — el vendedor seguía
// viendo todo con normalidad, sin enterarse ni poder actuar. El vendedor
// SIGUE pudiendo entrar (no un 403 genérico) para enterarse del motivo real
// y contactar soporte — nunca ve ningún dato del panel real mientras dure.
function VendorAccessBlockedGate({ vendor, supportWhatsapp, onLogout }) {
  const isBlocked = vendor.isBlocked;
  const reason = isBlocked ? vendor.blockReason : vendor.suspensionReason;
  const dateLabel = fmtSuspendedDate(isBlocked ? null : vendor.suspendedAt);

  const waMessage = `Hola, soy ${vendor.companyName}. Mi tienda está ${isBlocked ? "bloqueada" : "suspendida"}${
    reason ? ` por este motivo: "${reason}"` : ""
  }. Quisiera más información y saber qué debo hacer para reactivarla.`;
  const supportHref = supportWhatsapp
    ? `https://wa.me/${supportWhatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(waMessage)}`
    : "/contacto";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-container p-4">
      <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-7 text-center shadow-lg">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-error/10">
          <Ban className="h-7 w-7 text-error" />
        </div>
        <h1 className="mb-2 text-title-lg font-bold text-on-surface">
          {isBlocked ? "Tu tienda está bloqueada" : "Tu tienda está pausada"}
        </h1>
        <p className="mb-1 text-[13.5px] leading-relaxed text-on-surface-variant">
          {reason ||
            (isBlocked
              ? "El equipo la bloqueó por incumplir alguna de las reglas de la plataforma."
              : "Se pausó automáticamente por inactividad prolongada en el panel de vendedor.")}
        </p>
        {dateLabel && <p className="mb-4 text-[12px] text-outline">Pausada el {dateLabel}.</p>}
        <p className="mb-6 text-[13px] leading-relaxed text-on-surface-variant">
          Tu tienda y tus productos no son visibles en el sitio mientras esté {isBlocked ? "bloqueada" : "pausada"}.
          Contáctanos para resolverlo — tus datos, pedidos y reseñas siguen intactos.
        </p>
        <div className="flex flex-col gap-2.5">
          <a
            href={supportHref}
            target={supportWhatsapp ? "_blank" : undefined}
            rel={supportWhatsapp ? "noreferrer" : undefined}
            className="rounded-xl bg-primary px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-primary/90"
          >
            Contactar soporte
          </a>
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
  const { siteName, logoUrl, supportWhatsapp } = usePlatformSettings();
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
      <div className="flex min-h-dvh items-center justify-center bg-surface-container">
        <Spinner />
      </div>
    );
  }

  // Un VENDOR autenticado sin tienda propia (o con error al cargarla) no
  // tiene nada que hacer acá — mismo destino que ProtectedRoute usaría.
  if (isError) return <Navigate to="/vendedor/ingresar" replace />;

  if (vendor?.status === "SUSPENDED" || vendor?.isBlocked) {
    return <VendorAccessBlockedGate vendor={vendor} supportWhatsapp={supportWhatsapp} onLogout={handleLogout} />;
  }

  const nav = NAV.filter((n) => !n.restaurantOnly || vendor?.isRestaurant);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 animate-overlay-in bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        // Bug real reportado en vivo (con captura de celular): `h-dvh` es una
        // unidad DINÁMICA — se recalcula en vivo mientras el navegador
        // oculta/muestra su barra de direcciones al hacer scroll, así que un
        // `fixed` con altura en dvh se veía "romper"/reacomodar a mitad de
        // gesto. En mobile (fixed) se saca la altura explícita del todo —
        // `inset-y-0` (top:0/bottom:0) ya alcanza para que el navegador la
        // calce exacto contra el viewport real, sin ningún valor que
        // recalcular en cada frame (geometría nativa, no CSS reactivo). En
        // desktop (`lg:sticky`) sí hace falta una altura explícita porque
        // sticky no la deriva solo de top/bottom — ahí no hay barra de
        // navegador que aparezca/desaparezca, así que `lg:h-dvh` es seguro.
        // Intento previo descartado (con capturas reales, pero resultó ser
        // un falso positivo): se probó poner el scroll en el `<aside>`
        // entero (logo + datos de tienda + menú + tarjeta juntos) pensando
        // que un wrapper interno anidado era frágil en navegadores reales —
        // pero la prueba que "confirmó" eso resultó estar midiendo esta
        // misma ventana de Chrome dejada en un viewport de prueba angosto
        // por error, no un bug real de layout. Con eso descartado, el
        // usuario confirmó en vivo que scrollear el `<aside>` entero SÍ es
        // un problema real y distinto: el logo y los datos de la tienda
        // (que deben quedar fijos arriba) se deslizaban junto con el menú.
        // Vuelve el wrapper interno (ver más abajo) — el `<aside>` ya NO
        // scrollea por sí mismo.
        className={`fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col bg-primary px-3.5 py-[22px] transition-transform duration-300 ease-out lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Link to="/" className="mb-2 flex flex-shrink-0 items-center gap-2.5 px-2">
          {logoUrl ? (
            <img src={logoUrl} alt={siteName} className="h-8 w-8 flex-shrink-0 rounded object-cover" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded bg-secondary-container font-display text-base font-extrabold text-primary">
              {siteName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="font-display text-lg font-bold text-white">{siteName}</span>
        </Link>

        <div className="mb-3 flex-shrink-0 border-b border-white/10 px-2 pb-4">
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

        {/* Historial de bugs reales reportados en vivo sobre este bloque
            nav+tarjeta — 3 intentos previos, cada uno resolvía uno y abría
            otro:
            (1) Sin `min-h-0` en el nav, un hijo flex nunca se encoge por
            debajo del alto de su propio contenido — con poco alto
            disponible (ventanas angostas, escalado de Windows) el nav se
            desbordaba del `<aside>` entero, cortando "Mi perfil" y la
            tarjeta sin ninguna forma de llegar a ellos con scroll.
            (2) Con `flex-1` en el nav (para que ocupe el espacio restante),
            en iOS Safari el viewport visible CRECE en vivo al deslizar (la
            barra de direcciones se colapsa) — el nav crecía de más y dejaba
            un hueco vacío entre "Mi perfil" y la tarjeta, variable según el
            estado de esa barra.
            (3) Sacar `flex-1` del nav resolvía el hueco de arriba, pero
            movía el problema: la tarjeta quedaba pegada justo debajo del
            nav SIN margen garantizado — probado con `mt-auto` (empuja la
            tarjeta al fondo real), pero cuando el espacio disponible era
            justo (frecuente en iOS Safari con la barra expandida, incluso
            recién cargada la página, sin haber scrolleado nada) el margen
            automático se reducía a 0 y la tarjeta quedaba pegada al nav —
            "se pega" el mismo síntoma reportado por el usuario, solo que la
            causa ahora era el margen colapsando en vez de la barra de
            direcciones.
            Solución final, con prioridad correcta: verificado en vivo (con
            captura real) que el intento anterior dejaba "Ver planes" cortado
            apenas cargaba la página, sin necesidad de ningún scroll previo
            — porque el nav "ganaba" el espacio disponible mostrando sus 11
            links completos y la tarjeta perdía, quedando cortada. El orden
            correcto es al revés: la tarjeta (el CTA de upsell) NUNCA debe
            cortarse — si algo tiene que ceder espacio y scrollear, es el
            menú, no la tarjeta. Logo y datos de tienda (arriba) llevan
            `flex-shrink-0` explícito — nunca ceden espacio. El scroll vive
            en el nav mismo (`min-h-0 overflow-y-auto`, SIN `flex-1` — no
            crece de más, ver bug #2 arriba) — es el único elemento sin
            `flex-shrink-0`, así que absorbe TODA la reducción cuando el
            espacio no alcanza, revelando el resto de sus links con su
            propia barra de scroll interna. El separador (`flex-1 min-h-3`)
            y la tarjeta (`flex-shrink-0`) nunca ceden ni un píxel — quedan
            siempre completos y visibles, sin importar qué tan poco espacio
            quede para el nav. */}
        <nav className="flex min-h-0 flex-col gap-[3px] overflow-y-auto">
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

        {!vendor?.isVerified && <div aria-hidden="true" className="min-h-3 flex-1" />}

        {/* Pedido explícito: llamado a la acción "glass" visible SOLO para
            tiendas todavía no verificadas — desaparece solo en cuanto
            vendor.isVerified pasa a true, sin lógica propia (mismo campo
            computado que ya usa el badge de arriba). Nunca muestra un monto
            acá — el precio real vive en /vendedor/verificacion, a donde
            lleva "Ver planes". Compacta a propósito (ícono en línea con el
            título, no arriba solo) para no restarle alto a la lista de
            secciones de arriba. */}
        {!vendor?.isVerified && (
          <Link
            to="/vendedor/verificacion"
            className="group flex flex-shrink-0 flex-col gap-1.5 overflow-hidden rounded-xl border border-white/15 bg-white/10 p-2.5 shadow-[0_4px_24px_rgba(0,0,0,0.18)] backdrop-blur-md transition-colors hover:bg-white/[0.15]"
          >
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white text-primary">
                <Zap className="h-3 w-3" fill="currentColor" strokeWidth={0} />
              </div>
              <span className="text-[12.5px] font-bold text-white">Mejora tu plan</span>
            </div>
            <p className="text-[10.5px] leading-[13px] text-white/70">
              Verifica tu tienda y desbloquea todo lo que Business tiene para hacerla crecer.
            </p>
            <span className="mt-0.5 flex items-center justify-center rounded-lg bg-secondary-container py-1.5 text-[11px] font-bold text-primary transition group-hover:brightness-95">
              Ver planes
            </span>
          </Link>
        )}
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
          <div className="flex items-center gap-1">
            <VendorNotificationBell />
            <button
              onClick={handleLogout}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
        <Outlet context={{ vendor }} />
      </main>
      <OffersAnnouncementPopup vendor={vendor} />
    </div>
  );
}
