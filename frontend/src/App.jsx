import { useEffect, lazy, Suspense } from "react";
import { PageLoader } from "./components/ui/PageLoader.jsx";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { applySeo } from "./lib/seo.js";
import { isNoindexPath, isDynamicSeoPath, staticSeoFor } from "./lib/seoRoutes.js";

import { PublicLayout } from "./components/layout/PublicLayout.jsx";
import { RouteLoader } from "./components/layout/RouteLoader.jsx";
import { ProtectedRoute } from "./components/ProtectedRoute.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import { usePlatformSettings } from "./lib/usePlatformSettings.js";

// Público
import Home from "./pages/public/Home.jsx";
const Shop = lazy(() => import("./pages/public/Shop.jsx"));
const Product = lazy(() => import("./pages/public/Product.jsx"));
const Store = lazy(() => import("./pages/public/Store.jsx"));
const Stores = lazy(() => import("./pages/public/Stores.jsx"));
const QuickSaleListings = lazy(() => import("./pages/public/QuickSaleListings.jsx"));
const QuickSaleDetail = lazy(() => import("./pages/public/QuickSaleDetail.jsx"));
const Cart = lazy(() => import("./pages/public/Cart.jsx"));
const SharedCart = lazy(() => import("./pages/public/SharedCart.jsx"));
const Checkout = lazy(() => import("./pages/public/Checkout.jsx"));
const Account = lazy(() => import("./pages/public/Account.jsx"));
const TableOrder = lazy(() => import("./pages/public/TableOrder.jsx"));
const Terms = lazy(() => import("./pages/public/Terms.jsx"));
const Privacy = lazy(() => import("./pages/public/Privacy.jsx"));
const Faq = lazy(() => import("./pages/public/Faq.jsx"));
const Ayuda = lazy(() => import("./pages/public/Ayuda.jsx"));
const Contacto = lazy(() => import("./pages/public/Contacto.jsx"));
import NotFound from "./pages/public/NotFound.jsx";

// Cliente
const CustomerPanel = lazy(() => import("./pages/customer/CustomerPanel.jsx"));

// Vendedor
const VendorLayout = lazy(() => import("./pages/vendor/VendorLayout.jsx"));
const VendorDashboard = lazy(() => import("./pages/vendor/VendorDashboard.jsx"));
const VendorProducts = lazy(() => import("./pages/vendor/VendorProducts.jsx"));
const VendorStoreOffers = lazy(() => import("./pages/vendor/VendorStoreOffers.jsx"));
const VendorOrders = lazy(() => import("./pages/vendor/VendorOrders.jsx"));
const VendorTables = lazy(() => import("./pages/vendor/VendorTables.jsx"));
const VendorVerification = lazy(() => import("./pages/vendor/VendorVerification.jsx"));
const PagoManual = lazy(() => import("./pages/vendor/PagoManual.jsx"));
const VendorChat = lazy(() => import("./pages/vendor/VendorChat.jsx"));
const VendorReviews = lazy(() => import("./pages/vendor/VendorReviews.jsx"));
const VendorSettings = lazy(() => import("./pages/vendor/VendorSettings.jsx"));
const VendorProfile = lazy(() => import("./pages/vendor/VendorProfile.jsx"));
const VendorFraudReports = lazy(() => import("./pages/vendor/VendorFraudReports.jsx"));
const VendorManualSales = lazy(() => import("./pages/vendor/VendorManualSales.jsx"));
const VendorUsers = lazy(() => import("./pages/vendor/VendorUsers.jsx"));
const StaffProfile = lazy(() => import("./pages/vendor/StaffProfile.jsx"));

// Admin
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout.jsx"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard.jsx"));
const AdminVendors = lazy(() => import("./pages/admin/AdminVendors.jsx"));
const AdminSuspendedVendors = lazy(() => import("./pages/admin/AdminSuspendedVendors.jsx"));
const AdminVerifications = lazy(() => import("./pages/admin/AdminVerifications.jsx"));
const AdminCustomers = lazy(() => import("./pages/admin/AdminCustomers.jsx"));
const AdminActivityLog = lazy(() => import("./pages/admin/AdminActivityLog.jsx"));
const AdminSuggestions = lazy(() => import("./pages/admin/AdminSuggestions.jsx"));
const AdminReviews = lazy(() => import("./pages/admin/AdminReviews.jsx"));
const AdminCampaigns = lazy(() => import("./pages/admin/AdminCampaigns.jsx"));
const AdminSubscriptions = lazy(() => import("./pages/admin/AdminSubscriptions.jsx"));
const AdminAnnouncements = lazy(() => import("./pages/admin/AdminAnnouncements.jsx"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings.jsx"));
const AdminAssistant = lazy(() => import("./pages/admin/AdminAssistant.jsx"));
const AdminErrors = lazy(() => import("./pages/admin/AdminErrors.jsx"));
const AdminChat = lazy(() => import("./pages/admin/AdminChat.jsx"));
const AdminLocations = lazy(() => import("./pages/admin/AdminLocations.jsx"));
const AdminCategories = lazy(() => import("./pages/admin/AdminCategories.jsx"));
const AdminProfile = lazy(() => import("./pages/admin/AdminProfile.jsx"));
const AdminPages = lazy(() => import("./pages/admin/AdminPages.jsx"));
const AdminFaq = lazy(() => import("./pages/admin/AdminFaq.jsx"));
const AdminContacto = lazy(() => import("./pages/admin/AdminContacto.jsx"));
const AdminAyuda = lazy(() => import("./pages/admin/AdminAyuda.jsx"));
const AdminBranding = lazy(() => import("./pages/admin/AdminBranding.jsx"));
const AdminOffers = lazy(() => import("./pages/admin/AdminOffers.jsx"));
const AdminPartners = lazy(() => import("./pages/admin/AdminPartners.jsx"));
const PartnerLayout = lazy(() => import("./pages/partner/PartnerLayout.jsx"));
const PartnerDashboard = lazy(() => import("./pages/partner/PartnerDashboard.jsx"));
const PartnerKeys = lazy(() => import("./pages/partner/PartnerKeys.jsx"));
const PartnerMovements = lazy(() => import("./pages/partner/PartnerMovements.jsx"));
const PartnerPlans = lazy(() => import("./pages/partner/PartnerPlans.jsx"));
const PartnerAccount = lazy(() => import("./pages/partner/PartnerAccount.jsx"));
const ApiSocios = lazy(() => import("./pages/public/ApiSocios.jsx"));
const SolicitudSocio = lazy(() => import("./pages/public/SolicitudSocio.jsx"));
import { capturePartnerRef } from "./lib/partnerRef.js";
const AdminDiscountCodes = lazy(() => import("./pages/admin/AdminDiscountCodes.jsx"));
const AdminStoreOffers = lazy(() => import("./pages/admin/AdminStoreOffers.jsx"));
const AdminProducts = lazy(() => import("./pages/admin/AdminProducts.jsx"));
const AdminManualSales = lazy(() => import("./pages/admin/AdminManualSales.jsx"));
const AdminCustomerListings = lazy(() => import("./pages/admin/AdminCustomerListings.jsx"));
const AdminFraudReports = lazy(() => import("./pages/admin/AdminFraudReports.jsx"));
const AdminRankingAnomalies = lazy(() => import("./pages/admin/AdminRankingAnomalies.jsx"));

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

export default function App() {
  useRouteSeo();
  return (
    <>
      <RouteLoader />
      <ErrorBoundary>
      {/* Las pantallas que no son de la portada (paneles, cuenta, pago, ayuda) se descargan solo cuando se abren:
          el primer ingreso al sitio baja mucho menos JavaScript. */}
      <Suspense fallback={<PageLoader />}>
      <Routes>
      {/* Sitio público (comprador + vendedor sin cuenta) */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/catalogo" element={<Shop />} />
        <Route path="/producto/:vendorSlug/:productSlug" element={<Product />} />
        <Route path="/tienda/:slug" element={<Store />} />
        <Route path="/tiendas" element={<Stores />} />
        <Route path="/ventas-rapidas" element={<QuickSaleListings />} />
        <Route path="/ventas-rapidas/:id" element={<QuickSaleDetail />} />
        <Route path="/carrito" element={<Cart />} />
        <Route path="/carrito-compartido/:id" element={<SharedCart />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route
          path="/cuenta/panel"
          element={
            <ProtectedRoute roles={["CUSTOMER"]} redirectTo="/cuenta">
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
        <Route path="/api-socios" element={<ApiSocios />} />
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
        <Route path="categorias" element={<AdminCategories />} />
        <Route path="paginas" element={<AdminPages />} />
        <Route path="preguntas-frecuentes" element={<AdminFaq />} />
        <Route path="contacto" element={<AdminContacto />} />
        <Route path="centro-ayuda" element={<AdminAyuda />} />
        <Route path="seguridad" element={<Navigate to="/admin/configuracion?tab=seguridad" replace />} />
        <Route path="configuracion" element={<AdminSettings />} />
        <Route path="perfil" element={<AdminProfile />} />
      </Route>

      <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
      </ErrorBoundary>
    </>
  );
}
