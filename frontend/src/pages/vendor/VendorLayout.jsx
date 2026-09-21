import { useEffect, useState } from "react";
import { NavLink, Outlet, Link, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Package, ShoppingCart, UtensilsCrossed, ShieldCheck, ShieldAlert, Settings, MessageSquare, Menu, Star, UserCog, Tag, Gift, Ban, Zap, LogOut, Users, Wallet } from "lucide-react";
import { api } from "../../lib/api.js";
import { useAuth, loginPathFor } from "../../context/AuthContext.jsx";
import { VerifiedBadge } from "../../components/ui/VerifiedBadge.jsx";
import { Spinner } from "../../components/ui/Spinner.jsx";
import { VendorNotificationBell } from "../../components/vendor/VendorNotificationBell.jsx";
import { OffersAnnouncementPopup } from "../../components/vendor/OffersAnnouncementPopup.jsx";
import { NewOrderPopup } from "../../components/vendor/NewOrderPopup.jsx";
import { NewRegularOrderPopup } from "../../components/vendor/NewRegularOrderPopup.jsx";
import { StaleOrderAlert } from "../../components/vendor/StaleOrderAlert.jsx";
import { TargetedOfferPopup } from "../../components/TargetedOfferPopup.jsx";
import { VendorSearchBar } from "../../components/vendor/VendorSearchBar.jsx";
import { AudioUnlockBanner } from "../../components/vendor/AudioUnlockBanner.jsx";
import { unlockAudioOnFirstInteraction } from "../../lib/orderNotificationSound.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { AccountPendingDeletionNotice, deletionScheduledFor } from "../../components/AccountPendingDeletionNotice.jsx";

// Bloque 183 (pedido explícito — "saldrán siempre todas las secciones que
// están en el panel de vendedor, para que el vendedor pueda asignar... el
// usuario solo va a tener acceso a la sección que se le dio"): `section`
// es la MISMA clave que allowedSections (VendorStaff) y que
// requireVendorAccess() del backend — es lo que decide si un usuario de
// sistema (VENDOR_STAFF) ve/puede entrar a cada link. `ownerOnly` (sin
// `section`) son las que NUNCA se delegan (identidad del negocio, pagos,
// legal, gestión de usuarios) — ver el comentario largo en
// lib/vendorSections.js sobre por qué estas quedan afuera.
const NAV = [
  // Bloque 194 (pedido explícito — "que podemos cambiarla por el nombre
  // Dashboard, tanto en vendedores como en admin"): solo cambia la
  // ETIQUETA visible — `section: "resumen"` se queda igual a propósito,
  // es la clave estable que ya usa requireVendorAccess("resumen") del
  // backend y VENDOR_SECTIONS del frontend; cambiarla ahí rompería el
  // sistema de permisos por sección de usuarios de sistema sin ninguna
  // necesidad real (el usuario solo pidió el nombre visible).
  { to: "/vendedor", label: "Dashboard", icon: LayoutDashboard, end: true, section: "resumen" },
  { to: "/vendedor/productos", label: "Productos", icon: Package, section: "productos" },
  { to: "/vendedor/ofertas", label: "Ofertas", icon: Tag, section: "ofertas" },
  // Bloque 232 (pedido explícito — "la sección en el panel del vendedor de
  // crear código de oferta y crear oferta dentro de la tienda pueden estar
  // fusionadas y en una misma sección"): antes 2 links/secciones aparte
  // (codigos-descuento, ofertas-tienda) — ahora 1 solo link con pestañas
  // adentro (VendorStoreOffers.jsx). `anySection` (nuevo, solo lo usa esta
  // entrada) en vez de `section`: un usuario de sistema con CUALQUIERA de
  // las 2 secciones ya asignadas de antes (VendorStaff.allowedSections no
  // cambió, sigue guardando las 2 claves por separado) puede seguir
  // entrando acá — la página adentro decide qué pestaña(s) mostrarle según
  // cuál(es) tenga de verdad (ver mySections en el Outlet context).
  { to: "/vendedor/ofertas-tienda", label: "Ofertas y códigos", icon: Gift, anySection: ["ofertas-tienda", "codigos-descuento"] },
  { to: "/vendedor/pedidos", label: "Pedidos", icon: ShoppingCart, section: "pedidos" },
  { to: "/vendedor/mesas", label: "Mesas / QR", icon: UtensilsCrossed, restaurantOnly: true, section: "mesas" },
  { to: "/vendedor/verificacion", label: "Verificación y plan", icon: ShieldCheck, ownerOnly: true },
  { to: "/vendedor/mensajes", label: "Mensajes", icon: MessageSquare, section: "mensajes" },
  { to: "/vendedor/resenas", label: "Reseñas", icon: Star, section: "resenas" },
  // Feature B (pedido explícito): badge propio (fraudReportsPendingCount)
  // — cuenta lo que necesita SU respuesta (EVIDENCE_REQUESTED y sin
  // evidenceSentAt todavía), no todo lo que le pasó alguna vez.
  { to: "/vendedor/reportes", label: "Reportes de fraude", icon: ShieldAlert, badge: true, section: "reportes" },
  // Bloque 202 (pedido explícito — "no será una sección visible en el
  // panel del... dueño, será una sección que se habilita sola cuando un
  // usuario de venta tiene productos asignados"): `staffOnly` es nuevo —
  // NINGÚN otro ítem de este array lo usa. El dueño/admin nunca ve este
  // link (ver el filtro más abajo); un usuario de sistema lo ve solo si
  // además `staffProfile.hasAssignedProducts` es true.
  { to: "/vendedor/ventas-manuales", label: "Productos Asignados", icon: Wallet, section: "ventas-manuales", staffOnly: true },
  { to: "/vendedor/configuracion", label: "Configuración", icon: Settings, ownerOnly: true },
  // Bloque 183: gestión de usuarios de sistema — nunca delegable, ni
  // siquiera a otro usuario de sistema.
  { to: "/vendedor/usuarios", label: "Usuarios", icon: Users, ownerOnly: true },
  // Sin `section` ni `ownerOnly` a propósito: "Mi perfil" siempre se ve
  // para los 2 roles — el contenido cambia solo (ver VendorProfileRoute,
  // App.jsx), nunca el acceso al link.
  { to: "/vendedor/perfil", label: "Mi perfil", icon: UserCog },
];

// Bloque 183: rutas que existen pero NO están en el NAV de arriba (se
// llega por un link interno, ej. "Pagar ahora" desde Verificación) — igual
// de owner-only que su sección padre, así que un usuario de sistema nunca
// debe poder entrar ni siquiera pegando la URL a mano.
const OWNER_ONLY_EXTRA_PATHS = ["/vendedor/pago-manual"];

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

  // Bloque 168 (bug real reportado en vivo — "no suena cuando entran [los
  // pedidos]"): el aviso de sonido de NewOrderPopup.jsx llega por un poll de
  // fondo, sin ningún click justo en ese instante — un AudioContext nace
  // suspendido hasta el primer gesto real del usuario en la página. Esto
  // desbloquea con el primer click/tecla/touch en CUALQUIER parte del
  // panel (por ejemplo, el vendedor tocando un link del menú al entrar),
  // para el resto de la sesión.
  useEffect(() => {
    unlockAudioOnFirstInteraction();
  }, []);

  // Bloque 60: logout() ahora avisa al backend para revocar la sesión de
  // verdad (antes solo borraba el token del lado del cliente). El destino
  // pasa a ser el login de vendedor (antes iba siempre a "/", incluso acá).
  async function handleLogout() {
    await logout();
    navigate(loginPathFor(location.pathname), { replace: true });
  }

  // Bloque 144 (bug real reportado en vivo — "el admin aprobó la solicitud,
  // pero al entrar al panel del vendedor y actualizar la página, seguía
  // mostrando 'en revisión'"): el caché persistido de React Query (Bloque
  // 136, staleTime de 5min global) es justo lo que causaba esto —
  // verificationStatus/planType de esta misma query alimentan el badge y
  // el resto del panel, y si se los vuelve a pedir dentro de esos 5
  // minutos de la última vez (típico: el vendedor ya tenía el panel
  // abierto/visitado antes de que el admin aprobara), React Query los
  // daba por "frescos" y ni siquiera intentaba un refetch de fondo al
  // montar de nuevo, ni con un F5 real (el caché persistido se hidrata
  // ANTES que cualquier fetch). `refetchOnMount:"always"` fuerza un
  // pedido real cada vez que este layout monta, sin importar qué tan
  // fresco esté el caché — el resto del sitio sigue beneficiándose del
  // caché de 5min de siempre, esto es una excepción puntual para el único
  // dato cuyo desfase de minutos realmente confunde (¿ya me aprobaron o
  // no?, ¿tengo el badge o no?).
  const { data: vendor, isLoading: vendorLoading, isError } = useQuery({
    queryKey: ["my-vendor"],
    queryFn: async () => (await api.get("/vendors/me")).data.vendor,
    enabled: !!user,
    retry: false,
    refetchOnMount: "always",
  });
  // Bloque 222: mismo criterio que resolveVendorImg (VendorProfile.jsx) —
  // el logo puede ser un archivo subido (path relativo al backend) o un
  // link externo pegado a mano (ya viene absoluto).
  const vendorLogoUrl = vendor?.logoUrl ? (/^https?:\/\//.test(vendor.logoUrl) ? vendor.logoUrl : `${api.defaults.baseURL}${vendor.logoUrl}`) : null;

  // Bloque 183: solo se pide para un usuario de sistema — es de donde sale
  // `allowedSections` (VendorStaff, no vive en Vendor) para filtrar el NAV
  // y bloquear rutas fuera de su sección por URL directa.
  // Bloque 187 (bug real reportado en vivo, con captura — "edité un usuario
  // desde el panel y le di más acceso a secciones... y en el panel del
  // usuario no me sale nada, aun cuando debería salir en tiempo real"):
  // MISMO bug que Bloque 144 ya había resuelto para `my-vendor` (el
  // staleTime global de 5min de queryClient.js, sumado a que el caché de
  // React Query se persiste en localStorage — ver ese archivo — hace que ni
  // siquiera un F5 completo dispare un refetch real dentro de esa ventana),
  // pero nunca se aplicó acá. Sin `refetchOnMount`, recargar la página del
  // usuario de sistema seguía pintando las secciones/permisos VIEJOS que
  // ya tenía guardados en el celular/navegador. `refetchInterval` es la
  // otra mitad — "en tiempo real" de verdad: si el vendedor le cambia el
  // acceso mientras ese usuario sigue con el panel ABIERTO (sin recargar
  // nada), el cambio le llega solo, sin que tenga que cerrar sesión.
  const isStaff = user?.role === "VENDOR_STAFF";
  const { data: staffProfile } = useQuery({
    queryKey: ["my-staff-profile"],
    queryFn: async () => (await api.get("/vendor-staff/me/profile")).data,
    enabled: !!user && isStaff,
    refetchOnMount: "always",
    // Bloque 201 (bug real reportado en vivo — "no hay buena conexión entre
    // las secciones... recuerda todos los cambios realizados se mostrarán
    // en tiempo real siempre"): 30s bajó a 10s — un usuario recién editado
    // (nueva sección, nuevo tipo) tiene que verlo llegar rápido mientras
    // sigue con el panel abierto, sin tener que cerrar sesión ni recargar.
    refetchInterval: 10000,
  });

  // Feature B: cuántos reportes de fraude siguen esperando SU respuesta —
  // no hay endpoint de conteo dedicado (a diferencia de errorCount en
  // AdminLayout.jsx), se reusa la misma lista que consume VendorFraudReports.jsx.
  const { data: myFraudReports } = useQuery({
    queryKey: ["my-fraud-reports"],
    queryFn: async () => (await api.get("/reports/me/list")).data.reports,
    enabled: !!user,
    refetchInterval: 20000,
  });
  const fraudReportsPendingCount = (myFraudReports ?? []).filter((r) => r.status === "EVIDENCE_REQUESTED" && !r.evidenceSentAt).length;

  // Bloque 183: se espera también a staffProfile antes de decidir nada —
  // sin esto, un usuario de sistema vería el NAV completo (sin filtrar)
  // por un instante mientras esa segunda consulta todavía está en camino.
  if (vendorLoading || (isStaff && !staffProfile)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-container">
        <Spinner />
      </div>
    );
  }

  // Un VENDOR autenticado sin tienda propia (o con error al cargarla) no
  // tiene nada que hacer acá — mismo destino que ProtectedRoute usaría.
  if (isError) return <Navigate to="/vendedor/ingresar" replace />;

  // Bloque 211 (pedido explícito — auto-eliminación de cuenta, 30 días de
  // gracia): va ANTES del gate de isBlocked/SUSPENDED de siempre — cuando el
  // dueño pide su propia baja, Vendor.isBlocked también queda true (ver
  // auth.controller.js), así que este chequeo tiene que ganarle a ese de
  // abajo para mostrar el aviso correcto (con botón de reactivar) en vez del
  // genérico de "tienda bloqueada".
  if (user?.deletionRequestedAt) {
    return <AccountPendingDeletionNotice scheduledFor={deletionScheduledFor(user.deletionRequestedAt)} canReactivate onLogout={handleLogout} />;
  }
  // El dueño pidió la baja pero quien entró es otro (personal viendo el
  // panel de una tienda que se está por ir) — solo informa, no reactiva.
  if (vendor?.deletionRequestedAt) {
    return (
      <AccountPendingDeletionNotice
        scheduledFor={deletionScheduledFor(vendor.deletionRequestedAt)}
        canReactivate={false}
        storeMode
        onLogout={handleLogout}
      />
    );
  }

  if (vendor?.status === "SUSPENDED" || vendor?.isBlocked) {
    return <VendorAccessBlockedGate vendor={vendor} supportWhatsapp={supportWhatsapp} onLogout={handleLogout} />;
  }

  const mySections = staffProfile?.allowedSections ?? null;
  const nav = NAV.filter((n) => !n.restaurantOnly || vendor?.isRestaurant)
    // Bloque 202: "Productos Asignados" nunca para el dueño/admin, y para
    // un usuario de sistema solo si ya tiene algo asignado — se filtra
    // ANTES del resto (aplica igual a ambos roles, a diferencia de todo lo
    // demás de acá que solo recorta para isStaff).
    .filter((n) => !n.staffOnly || (isStaff && staffProfile?.hasAssignedProducts))
    .filter((n) => {
      if (!isStaff) return true; // Dueño/admin: sin recorte, comportamiento de siempre.
      if (n.ownerOnly) return false; // Nunca delegable — ver el comentario largo arriba de NAV.
      if (n.anySection) return n.anySection.some((s) => mySections.includes(s));
      return !n.section || mySections.includes(n.section);
    });

  // Bloque 183 (defensa en profundidad — "las demás secciones él no las
  // verá"): ocultar el link del NAV no alcanza solo, cualquiera puede
  // escribir la URL a mano. Si un usuario de sistema cae en una ruta fuera
  // de lo que tiene asignado (owner-only o una sección que no le dieron),
  // se lo manda a la primera sección real que sí tiene — "Mi perfil" solo
  // si no tiene NINGUNA (caso raro: se le sacaron todas las secciones).
  if (isStaff) {
    const isOwnerOnlyExtra = OWNER_ONLY_EXTRA_PATHS.some((p) => location.pathname.startsWith(p));
    const currentNavItem = NAV.find((n) => n.to === location.pathname);
    const blocked =
      isOwnerOnlyExtra ||
      currentNavItem?.ownerOnly ||
      (currentNavItem?.staffOnly && !staffProfile?.hasAssignedProducts) ||
      (currentNavItem?.section && !mySections.includes(currentNavItem.section)) ||
      (currentNavItem?.anySection && !currentNavItem.anySection.some((s) => mySections.includes(s)));
    if (blocked) {
      const fallback = nav.find((n) => n.section) ?? nav.find((n) => n.to === "/vendedor/perfil");
      return <Navigate to={fallback?.to ?? "/vendedor/perfil"} replace />;
    }
  }

  return (
    // Bloque 220 (pedido explícito, con imagen de referencia de un dashboard
    // fintech — "quiero que rediseñes los paneles... estructura como la de
    // la imagen"): el sidebar pasa de ir pegado al borde a ser una tarjeta
    // FLOTANTE (margen + esquinas redondeadas + sombra propia) sobre un
    // fondo gris parejo, igual que el "lienzo" de la referencia — pero SIN
    // tocar ninguna de las clases de mobile (fixed/inset-y-0/translate-x)
    // documentadas más abajo, que ya resuelven 3 bugs reales de Safari
    // iOS/iPad. Confirmado con el usuario: el menú se queda con texto (no
    // solo íconos como en la imagen) — con ~15 secciones, íconos solos
    // obligarían a adivinar qué es cada uno.
    <div className="min-h-dvh bg-surface-container lg:grid lg:grid-cols-[248px_1fr] lg:gap-4 lg:p-4">
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
        // recalcular en cada frame (geometría nativa, no CSS reactivo).
        // Bloque 179 (bug real reportado en vivo, con captura de iPad —
        // "deslizo la sección hacia abajo y se sube la barra lateral,
        // dejando ese espacio en blanco debajo"): el razonamiento anterior
        // de que "en desktop (lg:sticky) no hay barra de navegador que
        // aparezca/desaparezca, así que lg:h-dvh es seguro" resultó falso
        // para un caso real: un iPad en horizontal (o cualquier tablet
        // ancha) cruza el breakpoint `lg` — entra al layout de escritorio —
        // pero sigue siendo Safari de iPadOS, que SÍ tiene su propia barra
        // de pestañas/herramientas que se colapsa sola al hacer scroll,
        // igual que en mobile. `lg:h-dvh` sobre un elemento `sticky` se
        // recalculaba a mitad del gesto de scroll — el mismo bug de arriba,
        // solo que en la rama que se había asumido seguro. `lg:h-screen`
        // usa una altura que el navegador fija UNA sola vez (no se
        // recalcula en cada frame mientras la barra de Safari se
        // colapsa/expande) — elimina la fuente del glitch sin perder el
        // "alto explícito" que sticky sigue necesitando para que el nav
        // interno sepa cuándo scrollear en vez de empujar la tarjeta.
        // `svh` (small viewport height) en vez de `screen`/`vh` a propósito
        // — por spec es SIEMPRE el tamaño más chico (con la barra de Safari
        // visible), garantizado a no recalcularse nunca durante un scroll;
        // `vh`/`h-screen` históricamente tuvo comportamiento inconsistente
        // entre navegadores mobile justo en este escenario.
        className={`fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col bg-primary px-3.5 py-[22px] transition-transform duration-300 ease-out lg:sticky lg:top-4 lg:h-[calc(100svh-32px)] lg:translate-x-0 lg:rounded-3xl lg:shadow-[0_20px_50px_-20px_rgba(14,26,40,0.4)] ${
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
            {/* Bloque 222 (bug real reportado en vivo — "si la tienda ya
                tiene un logo... no se muestra en la esquina superior
                izquierda, eso no está conectado correctamente"): este
                cuadro solo pintaba la inicial del nombre, sin importar si
                vendor.logoUrl ya existía — mismo helper de resolución de
                URL relativa/absoluta que usa VendorProfile.jsx. */}
            <div className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[9px] bg-primary-container font-display text-sm font-bold text-white">
              {vendorLogoUrl ? (
                <img src={vendorLogoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                vendor?.companyName?.[0]
              )}
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
          {nav.map(({ to, label, icon: Icon, end, badge }) => (
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
              <span className="flex-1">{label}</span>
              {badge && fraudReportsPendingCount > 0 && (
                <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-white">
                  {fraudReportsPendingCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Bloque 183: el upsell de "Mejora tu plan" es una decisión de
            negocio/pago del DUEÑO — nunca se le muestra a un usuario de
            sistema, que ni siquiera puede entrar a Verificación y plan
            para actuar sobre esto. */}
        {!vendor?.isVerified && !isStaff && <div aria-hidden="true" className="min-h-3 flex-1" />}

        {/* Pedido explícito: llamado a la acción "glass" visible SOLO para
            tiendas todavía no verificadas — desaparece solo en cuanto
            vendor.isVerified pasa a true, sin lógica propia (mismo campo
            computado que ya usa el badge de arriba). Nunca muestra un monto
            acá — el precio real vive en /vendedor/verificacion, a donde
            lleva "Ver planes". Compacta a propósito (ícono en línea con el
            título, no arriba solo) para no restarle alto a la lista de
            secciones de arriba. */}
        {!vendor?.isVerified && !isStaff && (
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
      <main className="px-4 py-6 lg:px-[38px] lg:py-[30px]">
        {/* Bloque 233 (pedido explícito, con captura — "esta barra siempre
            debe aparecer fija en el panel de vendedores para fácil acceso a
            su uso"): antes se iba con el resto del contenido al hacer
            scroll — el buscador global y la campanita son justo lo que más
            sentido tiene tener a mano sin importar cuánto se haya bajado en
            una lista larga (Productos, Pedidos, etc). `sticky top-0`
            respecto al scroll de la página; z-index por encima del
            contenido normal pero por debajo del overlay del sidebar móvil
            (z-40, ver más arriba) y de los popups globales (z-50+). */}
        <div className="sticky top-0 z-30 mb-5 flex items-center gap-3 rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_24px_-12px_rgba(15,23,42,0.1)] lg:px-5">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high lg:hidden"
            aria-label="Abrir menú"
          >
            <Menu className="h-5 w-5" />
          </button>
          {/* Bloque 175 (pedido explícito): buscador global del panel —
              pedidos, clientes (por nombre/teléfono en sus pedidos),
              productos y secciones/configuraciones. Montado acá (no dentro
              de una sección puntual) para que esté disponible sin importar
              en qué parte del panel esté el vendedor, igual que el badge de
              notificaciones de al lado. */}
          <div className="flex-1 lg:max-w-[420px]">
            {/* Bloque 185 (bug real reportado en vivo — "si el usuario
                escribe productos se muestra como resultado de búsqueda la
                sección Productos, eso no puede pasar"): mySections es null
                para dueño/admin (sin recorte); un array para un usuario de
                sistema — VendorSearchBar filtra secciones/resultados con
                esto, nunca solo ocultando el link del NAV. */}
            <VendorSearchBar vendor={vendor} staffSections={isStaff ? mySections : null} />
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
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
        <AudioUnlockBanner
          vendor={vendor}
          enabled={!isStaff || (!!mySections?.includes("pedidos") && !!staffProfile?.receivesOrderNotifications)}
        />
        {/* Bloque 185: `sectionPermissions` (null para dueño/admin — sin
            restricción de nivel) viaja a cada página hija para que pueda
            ocultar/deshabilitar sus propios botones de escritura cuando el
            usuario de sistema solo tiene "view" en esa sección — el
            servidor ya lo rechaza igual (requireVendorWrite), esto es
            además para no mostrar un botón que va a fallar. */}
        {/* Bloque 232 (pedido explícito — fusión de "Ofertas de tienda" y
            "Códigos de descuento" en una sola sección con pestañas):
            VendorStoreOffers.jsx necesita saber qué secciones tiene
            realmente el usuario de sistema (no solo el nivel view/manage de
            las que ya tiene) para decidir qué pestaña(s) mostrarle — antes
            ninguna página hija recibía `mySections`, solo VendorLayout lo
            usaba para su propio NAV. */}
        <Outlet context={{ vendor, isStaff, staffSectionPermissions: staffProfile?.sectionPermissions ?? null, mySections }} />
      </main>
      {/* Bloque 183: nudge de marketing (crear una oferta) — decisión del
          dueño, nunca se le muestra a un usuario de sistema. */}
      {!isStaff && <OffersAnnouncementPopup vendor={vendor} />}
      {/* Bloque 164: montado a nivel de layout (como el de arriba) — así
          suena y aparece sin importar en qué sección del panel esté el
          vendedor, no solo dentro de "Pedidos". Bloque 183: un usuario de
          sistema SIN la sección "pedidos" asignada no debe recibir este
          aviso — no tiene ninguna acción real que pueda hacer con él (el
          endpoint que lo alimenta ya se lo negaría igual). Bloque 205
          (pedido explícito — "los que no lo tengan habilitado no recibirán
          las notificaciones en pantalla para nuevos pedidos"): además de
          tener la sección, el usuario tiene que tener
          receivesOrderNotifications prendido — un mesero lo trae prendido
          por default, un agente de ventas no, salvo que el dueño lo
          habilite a mano (ver VendorUsers.jsx). El dueño/admin nunca pasa
          por este chequeo (siempre reciben el aviso). */}
      <NewOrderPopup
        vendor={vendor}
        enabled={!isStaff || (!!mySections?.includes("pedidos") && !!staffProfile?.receivesOrderNotifications)}
        staffSectionPermissions={isStaff ? staffProfile?.sectionPermissions ?? null : null}
      />
      {/* Bloque 231 (bug real reportado en vivo — "cuando entra un pedido
          nuevo el panel de vendedor no suena ni muestra la notificación"):
          mismo criterio de montaje/gate que NewOrderPopup de arriba, pero
          para pedidos NORMALES (no de mesa) — antes esa mitad no tenía
          ningún aviso, para NINGUNA tienda, no solo restaurantes. */}
      <NewRegularOrderPopup
        vendor={vendor}
        enabled={!isStaff || (!!mySections?.includes("pedidos") && !!staffProfile?.receivesOrderNotifications)}
        staffSectionPermissions={isStaff ? staffProfile?.sectionPermissions ?? null : null}
      />
      {/* Bloque 188: mismo criterio de montaje/gate que NewOrderPopup —
          global al panel, solo restaurantes, solo si el usuario de sistema
          tiene la sección "pedidos" Y receivesOrderNotifications. Nunca
          compiten por el mismo pedido a la vez (ver el comentario largo en
          StaleOrderAlert.jsx). */}
      <StaleOrderAlert
        vendor={vendor}
        enabled={!isStaff || (!!mySections?.includes("pedidos") && !!staffProfile?.receivesOrderNotifications)}
        staffSectionPermissions={isStaff ? staffProfile?.sectionPermissions ?? null : null}
      />
      {/* Bloque 194 (pedido explícito): ofertas dirigidas a un vendedor (o a
          la tienda de un usuario de sistema — VENDOR_STAFF ve las de su
          empleador, ver el comentario largo en targetedOffers.controller.js)
          como popup al entrar al panel. Mismo z-index que NewOrderPopup/
          StaleOrderAlert de arriba — en el caso raro de coincidir con uno de
          esos 2, no truena (el último montado queda arriba en el DOM), solo
          se superponen visualmente. `enabled` espera a que vendor/user ya
          hayan cargado (mismo criterio que NewOrderPopup/StaleOrderAlert,
          que ya vienen recibiendo `vendor` solo cuando existe). */}
      <TargetedOfferPopup enabled={!!vendor && !!user} />
    </div>
  );
}
