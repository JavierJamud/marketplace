import { useEffect, Suspense } from "react";
import { lazyRetry } from "./lib/lazyRetry.js";
import { PageLoader } from "./components/ui/PageLoader.jsx";
import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { applySeo } from "./lib/seo.js";
import { isNoindexPath, isDynamicSeoPath, staticSeoFor } from "./lib/seoRoutes.js";

import { PublicLayout } from "./components/layout/PublicLayout.jsx";
import { RouteLoader } from "./components/layout/RouteLoader.jsx";
import { useCatalog } from "./lib/catalog.js";
import { PwaManager } from "./components/pwa/PwaManager.jsx";
import { VersionWatcher } from "./components/VersionWatcher.jsx";
import { ProtectedRoute } from "./components/ProtectedRoute.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import { usePlatformSettings } from "./lib/usePlatformSettings.js";
import { useMaintenance } from "./lib/useMaintenance.js";
import { MaintenanceScreen } from "./components/MaintenanceScreen.jsx";

// Público
import Home from "./pages/public/Home.jsx";
const Shop = lazyRetry(() => import("./pages/public/Shop.jsx"));
const Product = lazyRetry(() => import("./pages/public/Product.jsx"));
const Store = lazyRetry(() => import("./pages/public/Store.jsx"));
const Stores = lazyRetry(() => import("./pages/public/Stores.jsx"));
const QuickSaleListings = lazyRetry(() => import("./pages/public/QuickSaleListings.jsx"));
const QuickSaleDetail = lazyRetry(() => import("./pages/public/QuickSaleDetail.jsx"));
const Cart = lazyRetry(() => import("./pages/public/Cart.jsx"));
const SharedCart = lazyRetry(() => import("./pages/public/SharedCart.jsx"));
const Checkout = lazyRetry(() => import("./pages/public/Checkout.jsx"));
const Account = lazyRetry(() => import("./pages/public/Account.jsx"));
const TableOrder = lazyRetry(() => import("./pages/public/TableOrder.jsx"));
const Terms = lazyRetry(() => import("./pages/public/Terms.jsx"));
const Privacy = lazyRetry(() => import("./pages/public/Privacy.jsx"));
const Faq = lazyRetry(() => import("./pages/public/Faq.jsx"));
const Ayuda = lazyRetry(() => import("./pages/public/Ayuda.jsx"));
const Contacto = lazyRetry(() => import("./pages/public/Contacto.jsx"));
const OrderTracking = lazyRetry(() => import("./pages/public/OrderTracking.jsx"));
const EmailUnsubscribe = lazyRetry(() => import("./pages/public/EmailUnsubscribe.jsx"));
import NotFound from "./pages/public/NotFound.jsx";

// Cliente
const CustomerPanel = lazyRetry(() => import("./pages/customer/CustomerPanel.jsx"));

// Vendedor
const VendorLayout = lazyRetry(() => import("./pages/vendor/VendorLayout.jsx"));
const VendorDashboard = lazyRetry(() => import("./pages/vendor/VendorDashboard.jsx"));
const VendorProducts = lazyRetry(() => import("./pages/vendor/VendorProducts.jsx"));
const VendorStoreOffers = lazyRetry(() => import("./pages/vendor/VendorStoreOffers.jsx"));
const VendorOrders = lazyRetry(() => import("./pages/vendor/VendorOrders.jsx"));
const VendorCustomers = lazyRetry(() => import("./pages/vendor/VendorCustomers.jsx"));
const VendorLoyalty = lazyRetry(() => import("./pages/vendor/VendorLoyalty.jsx"));
const VendorSetupGuide = lazyRetry(() => import("./pages/vendor/VendorSetupGuide.jsx"));
const VendorPos = lazyRetry(() => import("./pages/vendor/VendorPos.jsx"));
const PosDisplay = lazyRetry(() => import("./pages/pos/PosDisplay.jsx"));
const PosBoard = lazyRetry(() => import("./pages/pos/PosBoard.jsx"));
const VendorTables = lazyRetry(() => import("./pages/vendor/VendorTables.jsx"));
const VendorVerification = lazyRetry(() => import("./pages/vendor/VendorVerification.jsx"));
const PagoManual = lazyRetry(() => import("./pages/vendor/PagoManual.jsx"));
const VendorChat = lazyRetry(() => import("./pages/vendor/VendorChat.jsx"));
const VendorReviews = lazyRetry(() => import("./pages/vendor/VendorReviews.jsx"));
const VendorSettings = lazyRetry(() => import("./pages/vendor/VendorSettings.jsx"));
const VendorProfile = lazyRetry(() => import("./pages/vendor/VendorProfile.jsx"));
const VendorFraudReports = lazyRetry(() => import("./pages/vendor/VendorFraudReports.jsx"));
const VendorManualSales = lazyRetry(() => import("./pages/vendor/VendorManualSales.jsx"));
const VendorUsers = lazyRetry(() => import("./pages/vendor/VendorUsers.jsx"));
const StaffProfile = lazyRetry(() => import("./pages/vendor/StaffProfile.jsx"));

// Admin
const AdminLayout = lazyRetry(() => import("./pages/admin/AdminLayout.jsx"));
const AdminDashboard = lazyRetry(() => import("./pages/admin/AdminDashboard.jsx"));
const AdminVendors = lazyRetry(() => import("./pages/admin/AdminVendors.jsx"));
const AdminSuspendedVendors = lazyRetry(() => import("./pages/admin/AdminSuspendedVendors.jsx"));
const AdminVendorManage = lazyRetry(() => import("./pages/admin/AdminVendorManage.jsx"));
const AdminDeletedVendors = lazyRetry(() => import("./pages/admin/AdminDeletedVendors.jsx"));
const AdminVerifications = lazyRetry(() => import("./pages/admin/AdminVerifications.jsx"));
const AdminCustomers = lazyRetry(() => import("./pages/admin/AdminCustomers.jsx"));
const AdminActivityLog = lazyRetry(() => import("./pages/admin/AdminActivityLog.jsx"));
const AdminSuggestions = lazyRetry(() => import("./pages/admin/AdminSuggestions.jsx"));
const AdminReviews = lazyRetry(() => import("./pages/admin/AdminReviews.jsx"));
const AdminCampaigns = lazyRetry(() => import("./pages/admin/AdminCampaigns.jsx"));
const AdminSubscriptions = lazyRetry(() => import("./pages/admin/AdminSubscriptions.jsx"));
const AdminAnnouncements = lazyRetry(() => import("./pages/admin/AdminAnnouncements.jsx"));
const AdminSettings = lazyRetry(() => import("./pages/admin/AdminSettings.jsx"));
const AdminAssistant = lazyRetry(() => import("./pages/admin/AdminAssistant.jsx"));
const AdminErrors = lazyRetry(() => import("./pages/admin/AdminErrors.jsx"));
const AdminChat = lazyRetry(() => import("./pages/admin/AdminChat.jsx"));
const AdminLocations = lazyRetry(() => import("./pages/admin/AdminLocations.jsx"));
const AdminAllCategories = lazyRetry(() => import("./pages/admin/AdminAllCategories.jsx"));
const AdminSupportCases = lazyRetry(() => import("./pages/admin/AdminSupportCases.jsx"));
const AdminProfile = lazyRetry(() => import("./pages/admin/AdminProfile.jsx"));
const AdminPages = lazyRetry(() => import("./pages/admin/AdminPages.jsx"));
const AdminFaq = lazyRetry(() => import("./pages/admin/AdminFaq.jsx"));
const AdminContacto = lazyRetry(() => import("./pages/admin/AdminContacto.jsx"));
const AdminAyuda = lazyRetry(() => import("./pages/admin/AdminAyuda.jsx"));
const AdminBranding = lazyRetry(() => import("./pages/admin/AdminBranding.jsx"));
const AdminOffers = lazyRetry(() => import("./pages/admin/AdminOffers.jsx"));
const AdminPartners = lazyRetry(() => import("./pages/admin/AdminPartners.jsx"));
const PartnerLayout = lazyRetry(() => import("./pages/partner/PartnerLayout.jsx"));
const PartnerDashboard = lazyRetry(() => import("./pages/partner/PartnerDashboard.jsx"));
const PartnerKeys = lazyRetry(() => import("./pages/partner/PartnerKeys.jsx"));
const PartnerMovements = lazyRetry(() => import("./pages/partner/PartnerMovements.jsx"));
const PartnerPlans = lazyRetry(() => import("./pages/partner/PartnerPlans.jsx"));
const PartnerAccount = lazyRetry(() => import("./pages/partner/PartnerAccount.jsx"));
const ApiSocios = lazyRetry(() => import("./pages/public/ApiSocios.jsx"));
const Plans = lazyRetry(() => import("./pages/public/Plans.jsx"));
const SolicitudSocio = lazyRetry(() => import("./pages/public/SolicitudSocio.jsx"));
import { capturePartnerRef } from "./lib/partnerRef.js";
const AdminDiscountCodes = lazyRetry(() => import("./pages/admin/AdminDiscountCodes.jsx"));
const AdminStoreOffers = lazyRetry(() => import("./pages/admin/AdminStoreOffers.jsx"));
const AdminProducts = lazyRetry(() => import("./pages/admin/AdminProducts.jsx"));
const AdminManualSales = lazyRetry(() => import("./pages/admin/AdminManualSales.jsx"));
const AdminCustomerListings = lazyRetry(() => import("./pages/admin/AdminCustomerListings.jsx"));
const AdminFraudReports = lazyRetry(() => import("./pages/admin/AdminFraudReports.jsx"));
const AdminRankingAnomalies = lazyRetry(() => import("./pages/admin/AdminRankingAnomalies.jsx"));

// Bloque 183 (pedido explícito — "esa foto saldrá en el perfil del
// usuario... podrá ver su foto con su nombre, su correo... y la sección a
// la que tiene acceso"): "Mi perfil" es la MISMA URL para dueño y usuario
// de sistema — el contenido de esa pantalla es lo único que cambia según
// quién esté logueado, así el link del NAV no necesita ninguna lógica
// especial (VendorLayout.jsx ya lo muestra igual para los 2 roles).
function VendorProfileRoute() {
  const { user } = useAuth();
  return user?.role === "VENDOR_STAFF" ? <StaffProfile /> : <VendorProfile />;
}

// Bloque 54 (pedido explícito — "el título de la página... vamos a dejarlo
// solo con el nombre de la empresa asignado por el admin y luego un |
// Marketplace"): antes el <title> de la pestaña era el string fijo de
// index.html ("Baznova — Marketplace multivendedor de Cuba"), nunca
// actualizado una vez que React montaba — si el admin cambiaba el nombre de
// la plataforma en Marca, la pestaña del navegador seguía diciendo
// "Baznova" para siempre. Acá arriba de todo (dentro de App, nunca en
// Header.jsx/Footer.jsx: esas viven solo en PublicLayout, y esto tiene que
// cubrir TAMBIÉN /admin y /vendedor, que usan layouts propios sin Header)
// para que se actualice en cualquier pantalla del sitio, apenas llega el
// nombre real desde /settings. El de index.html queda tal cual, como piso
// estático para el primer instante antes de que React monte.
function useRouteSeo() {
  const { siteName } = usePlatformSettings();
  const { pathname } = useLocation();
  useEffect(() => {
    // Tienda, producto y preguntas frecuentes arman su propio SEO con sus datos (ver Store.jsx, Product.jsx y Faq.jsx).
    if (isDynamicSeoPath(pathname) || pathname === "/faq") return;
    if (isNoindexPath(pathname)) {
      applySeo({ title: `${siteName} | Marketplace`, description: `${siteName}: marketplace de tiendas y restaurantes de Cuba.`, noindex: true });
      return;
    }
    const seo = staticSeoFor(pathname, siteName);
    applySeo(seo ?? { title: `${siteName} | Marketplace`, description: `${siteName}: marketplace de tiendas y restaurantes de Cuba.`, path: pathname });
  }, [pathname, siteName]);
}

// /vender?socio=CODIGO: guarda el código del socio de la API y sigue al registro de tienda.
function VenderRedirect() {
  capturePartnerRef();
  return <Navigate to="/vendedor/ingresar?tab=registro" replace />;
}

// Portada: con el modo mantenimiento de "solo la página principal" activo, los visitantes ven el aviso en su lugar (el admin ve el sitio
// de siempre). Las tiendas, los productos y sus enlaces no se tocan.
function HomeGate() {
  const { mode, message } = useMaintenance();
  const { user } = useAuth();
  if (mode === "HOME" && user?.role !== "ADMIN") return <MaintenanceScreen variant="home" message={message} />;
  return <Home />;
}

// Barra que ve solo el administrador mientras hay mantenimiento activo, para que no se le olvide que los visitantes no ven el sitio.
function AdminMaintenanceBar({ mode }) {
  return (
    <div role="status" className="fixed bottom-3 left-3 z-[60] flex max-w-[calc(100vw-24px)] items-center gap-2 rounded-full bg-secondary-container py-2 pl-4 pr-2 text-[12.5px] font-bold text-on-secondary-container shadow-lg">
      <span className="min-w-0 truncate">{mode === "FULL" ? "Mantenimiento activo: los visitantes no ven el sitio" : "Mantenimiento activo en la página principal"}</span>
      <Link to="/admin/configuracion" className="flex min-h-8 flex-shrink-0 items-center rounded-full bg-primary px-3 text-white hover:brightness-110">
        Ajustes
      </Link>
    </div>
  );
}

export default function App() {
  useRouteSeo();
  // Nombres de monedas y formas de pago (lib/catalog.js). Al cambiar en el admin, App se vuelve a pintar y con ella todas las
  // pantallas, así los precios y formas de pago muestran el nombre nuevo sin recargar.
  useCatalog();
  const { pathname: currentPath } = useLocation();
  const maintenance = useMaintenance();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const inAdminArea = currentPath.startsWith("/admin");
  // Todo el sitio en mantenimiento: los visitantes ven solo el aviso. El panel del admin (y el admin con sesión) sigue funcionando.
  const fullyBlocked = maintenance.mode === "FULL" && !isAdmin && !inAdminArea;
  // Avisa al logo de carga (index.html) que la primera pantalla ya se pintó y puede retirarse; espera a saber si hay mantenimiento
  // para no dejar ver el sitio un instante antes del aviso.
  useEffect(() => {
    if (!maintenance.ready) return;
    window.__appReady = true;
    window.dispatchEvent(new Event("app:ready"));
  }, [maintenance.ready]);
  if (fullyBlocked) return <MaintenanceScreen message={maintenance.message} />;
  return (
    <>
      <RouteLoader />
      <PwaManager />
      <VersionWatcher />
      <ErrorBoundary resetKey={currentPath}>
      {/* Las pantallas que no son de la portada (paneles, cuenta, pago, ayuda) se descargan solo cuando se abren:
          el primer ingreso al sitio baja mucho menos JavaScript. */}
      <Suspense fallback={<PageLoader />}>
      <Routes>
      {/* Sitio público (comprador + vendedor sin cuenta) */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomeGate />} />
        <Route path="/catalogo" element={<Shop />} />
        <Route path="/producto/:vendorSlug/:productSlug" element={<Product />} />
        <Route path="/tienda/:slug" element={<Store />} />
        <Route path="/tiendas" element={<Stores />} />
        <Route path="/ventas-rapidas" element={<QuickSaleListings />} />
        <Route path="/ventas-rapidas/:id" element={<QuickSaleDetail />} />
        <Route path="/carrito" element={<Cart />} />
        <Route path="/carrito-compartido/:id" element={<SharedCart />} />
        <Route path="/checkout" element={<Checkout />} />
        {/* El dueño de una tienda conserva su cuenta de cliente: sus compras, favoritos y venta rápida. */}
        <Route
          path="/cuenta/panel"
          element={
            <ProtectedRoute roles={["CUSTOMER", "VENDOR"]} redirectTo="/cuenta">
              <CustomerPanel />
            </ProtectedRoute>
          }
        />
        {/* Bloque 47 (pedido explícito — "eliminar el requisito de
            registrarse primero como cliente para crear una tienda"): /vender
            (VendorOnboarding.jsx) quedó obsoleto — exigía loguearse primero
            (bouncing a /cuenta, la pantalla de CLIENTE) antes de mostrar el
            formulario de tienda. El registro de vendedor ahora vive entero
            en /vendedor/ingresar (Account.jsx mode="vendor"): datos
            personales + datos de tienda en una sola pantalla, sin pasar
            nunca por el login de cliente. Se retira la ruta entera en vez de
            dejarla como redirect — no vale la pena mantener un componente
            muerto solo para eso. */}
        <Route path="/vender" element={<VenderRedirect />} />
        <Route path="/mesa/:qrToken" element={<TableOrder />} />
        <Route path="/terminos" element={<Terms />} />
        <Route path="/privacidad" element={<Privacy />} />
        <Route path="/faq" element={<Faq />} />
        <Route path="/ayuda" element={<Ayuda />} />
        <Route path="/contacto" element={<Contacto />} />
        <Route path="/rastrear-pedido" element={<OrderTracking />} />
        <Route path="/correos/baja" element={<EmailUnsubscribe />} />
        <Route path="/api-socios" element={<ApiSocios />} />
        <Route path="/planes" element={<Plans />} />
        <Route path="/socios/solicitar" element={<SolicitudSocio />} />
      </Route>

      {/* Bloque 20: /cuenta pasa a ser una pantalla propia de viewport
          completo (split marca + formulario, ver mock Account.dc.html) —
          sin el header/footer del sitio. */}
      <Route path="/cuenta" element={<Account />} />

      {/* Auditoría de seguridad: 3 URLs de entrada distintas por rol — mismo
          componente y mismo POST /auth/login de siempre (ver comentario en
          Account.jsx), solo cambia el copy y qué vistas ofrece cada una. */}
      <Route path="/vendedor/ingresar" element={<Account mode="vendor" />} />
      {/* Pantallas de la caja (enlace secreto del panel): a pantalla completa, sin cabecera ni pie del sitio. */}
      <Route path="/caja/pantalla/:token" element={<PosDisplay />} />
      <Route path="/caja/tablero/:token" element={<PosBoard />} />
      <Route path="/admin/ingresar" element={<Account mode="admin" />} />
      {/* Bloque 299: panel del socio de la API (rol PARTNER), con la misma estructura que los demás paneles. */}
      <Route path="/socio/ingresar" element={<Account mode="partner" />} />
      <Route
        path="/socio"
        element={
          <ProtectedRoute roles={["PARTNER"]} redirectTo="/socio/ingresar">
            <PartnerLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<PartnerDashboard />} />
        <Route path="llaves" element={<PartnerKeys />} />
        <Route path="planes" element={<PartnerPlans />} />
        <Route path="movimientos" element={<PartnerMovements />} />
        <Route path="cuenta" element={<PartnerAccount />} />
      </Route>

      {/* Panel de vendedor — Bloque 183 (pedido explícito): un usuario de
          sistema (VENDOR_STAFF) entra por esta MISMA puerta que el dueño —
          qué ve adentro (NAV filtrado + redirect de defensa en profundidad
          por sección) lo decide VendorLayout.jsx, nunca esto de acá. */}
      <Route
        path="/vendedor"
        element={
          <ProtectedRoute roles={["VENDOR", "VENDOR_STAFF"]} redirectTo="/vendedor/ingresar">
            <VendorLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<VendorDashboard />} />
        <Route path="productos" element={<VendorProducts />} />
        <Route path="ofertas" element={<Navigate to="/vendedor/ofertas-tienda" replace />} />
        {/* Bloque 232 (pedido explícito — fusión de "Ofertas de tienda" y
            "Códigos de descuento" en una sola sección con pestañas,
            VendorStoreOffers.jsx): la ruta /codigos-descuento se retira
            (sin alias) — mantenerla apuntando al mismo componente quedaría
            SIN el chequeo de permisos por sección de VendorLayout.jsx (ese
            chequeo busca la ruta actual dentro de NAV, y esta ya no tiene
            su propia entrada ahí), un hueco de acceso real para un usuario
            de sistema sin ninguna de las 2 secciones. */}
        <Route path="ofertas-tienda" element={<VendorStoreOffers />} />
        <Route path="pedidos" element={<VendorOrders />} />
        <Route path="clientes" element={<VendorCustomers />} />
        <Route path="puntos" element={<VendorLoyalty />} />
        <Route path="completar" element={<VendorSetupGuide />} />
        <Route path="caja" element={<VendorPos />} />
        <Route path="mesas" element={<VendorTables />} />
        <Route path="verificacion" element={<VendorVerification />} />
        <Route path="pago-manual" element={<PagoManual />} />
        <Route path="mensajes" element={<VendorChat />} />
        <Route path="resenas" element={<VendorReviews />} />
        <Route path="reportes" element={<VendorFraudReports />} />
        <Route path="ventas-manuales" element={<VendorManualSales />} />
        <Route path="asistente" element={<Navigate to="/vendedor" replace />} />
        <Route path="configuracion" element={<VendorSettings />} />
        {/* Bloque 183: gestión de usuarios de sistema — nunca delegable
            (VendorLayout.jsx la saca del NAV para un VENDOR_STAFF, y el
            propio componente vuelve a chequear el rol por las dudas). */}
        <Route path="usuarios" element={<VendorUsers />} />
        {/* Unificado en "verificacion" (verificación y plan eran dos páginas
            mostrando casi lo mismo) — se deja el redirect por si alguien
            tiene esta URL guardada. */}
        <Route path="suscripcion" element={<Navigate to="/vendedor/verificacion" replace />} />
        <Route path="perfil" element={<VendorProfileRoute />} />
      </Route>

      {/* Panel de administración ZeuDin */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute roles={["ADMIN"]} redirectTo="/admin/ingresar">
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<AdminDashboard />} />
        <Route path="tiendas" element={<AdminVendors />} />
        <Route path="tiendas/eliminadas" element={<AdminDeletedVendors />} />
        <Route path="tiendas/eliminadas/:id" element={<AdminDeletedVendors />} />
        <Route path="tiendas/:id" element={<AdminVendorManage />} />
        <Route path="tiendas-suspendidas" element={<AdminSuspendedVendors />} />
        <Route path="productos" element={<AdminProducts />} />
        <Route path="ventas-manuales" element={<AdminManualSales />} />
        <Route path="ventas-rapidas" element={<AdminCustomerListings />} />
        <Route path="reportes-fraude" element={<AdminFraudReports />} />
        <Route path="anomalias-ranking" element={<AdminRankingAnomalies />} />
        <Route path="verificaciones" element={<AdminVerifications />} />
        <Route path="clientes" element={<AdminCustomers />} />
        <Route path="actividad" element={<AdminActivityLog />} />
        <Route path="sugerencias" element={<AdminSuggestions />} />
        <Route path="comentarios" element={<AdminReviews />} />
        <Route path="mensajes" element={<AdminChat />} />
        <Route path="mensajes/:vendorId" element={<AdminChat />} />
        <Route path="campanas" element={<AdminCampaigns />} />
        <Route path="suscripciones" element={<AdminSubscriptions />} />
        <Route path="ofertas" element={<AdminOffers />} />
        <Route path="socios-api" element={<AdminPartners />} />
        <Route path="codigos-descuento" element={<AdminDiscountCodes />} />
        <Route path="ofertas-tienda" element={<AdminStoreOffers />} />
        <Route path="anuncios" element={<AdminAnnouncements />} />
        <Route path="integraciones" element={<Navigate to="/admin/configuracion?tab=integraciones" replace />} />
        <Route path="marca" element={<AdminBranding />} />
        <Route path="asistente" element={<AdminAssistant />} />
        {/* Bloque 259: el asistente pasó a ser un botón flotante; la ruta vieja redirige. */}
        <Route path="asistente-negocio" element={<Navigate to="/admin" replace />} />
        <Route path="errores" element={<AdminErrors />} />
        <Route path="ubicaciones" element={<AdminLocations />} />
        <Route path="categorias" element={<AdminAllCategories />} />
        <Route path="casos-soporte" element={<AdminSupportCases />} />
        {/* Las dos clases de categoría viven en una sola sección (AdminAllCategories.jsx). */}
        <Route path="categorias-producto" element={<Navigate to="/admin/categorias?tab=producto" replace />} />
        <Route path="paginas" element={<AdminPages />} />
        <Route path="preguntas-frecuentes" element={<AdminFaq />} />
        <Route path="contacto" element={<AdminContacto />} />
        <Route path="centro-ayuda" element={<AdminAyuda />} />
        <Route path="seguridad" element={<Navigate to="/admin/configuracion?tab=seguridad" replace />} />
        <Route path="configuracion" element={<AdminSettings />} />
        <Route path="perfil" element={<AdminProfile />} />
      </Route>

      {/* /index.html es la portada (Nginx ya redirige; esto cubre el servidor local y una página vieja guardada en caché). */}
      <Route path="/index.html" element={<Navigate to="/" replace />} />
      <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
      </ErrorBoundary>
      {isAdmin && maintenance.mode !== "OFF" && !inAdminArea && <AdminMaintenanceBar mode={maintenance.mode} />}
    </>
  );
}
