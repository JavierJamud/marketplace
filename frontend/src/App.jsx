import { Routes, Route, Navigate } from "react-router-dom";

import { PublicLayout } from "./components/layout/PublicLayout.jsx";
import { RouteLoader } from "./components/layout/RouteLoader.jsx";
import { ProtectedRoute } from "./components/ProtectedRoute.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { useAuth } from "./context/AuthContext.jsx";

// Público
import Home from "./pages/public/Home.jsx";
import Shop from "./pages/public/Shop.jsx";
import Product from "./pages/public/Product.jsx";
import Store from "./pages/public/Store.jsx";
import Stores from "./pages/public/Stores.jsx";
import QuickSaleListings from "./pages/public/QuickSaleListings.jsx";
import QuickSaleDetail from "./pages/public/QuickSaleDetail.jsx";
import Cart from "./pages/public/Cart.jsx";
import SharedCart from "./pages/public/SharedCart.jsx";
import Checkout from "./pages/public/Checkout.jsx";
import Account from "./pages/public/Account.jsx";
import VendorOnboarding from "./pages/public/VendorOnboarding.jsx";
import TableOrder from "./pages/public/TableOrder.jsx";
import Terms from "./pages/public/Terms.jsx";
import Privacy from "./pages/public/Privacy.jsx";
import Faq from "./pages/public/Faq.jsx";
import Ayuda from "./pages/public/Ayuda.jsx";
import Contacto from "./pages/public/Contacto.jsx";
import NotFound from "./pages/public/NotFound.jsx";

// Cliente
import CustomerPanel from "./pages/customer/CustomerPanel.jsx";

// Vendedor
import VendorLayout from "./pages/vendor/VendorLayout.jsx";
import VendorDashboard from "./pages/vendor/VendorDashboard.jsx";
import VendorProducts from "./pages/vendor/VendorProducts.jsx";
import VendorOffers from "./pages/vendor/VendorOffers.jsx";
import VendorStoreOffers from "./pages/vendor/VendorStoreOffers.jsx";
import VendorOrders from "./pages/vendor/VendorOrders.jsx";
import VendorTables from "./pages/vendor/VendorTables.jsx";
import VendorVerification from "./pages/vendor/VendorVerification.jsx";
import PagoManual from "./pages/vendor/PagoManual.jsx";
import VendorChat from "./pages/vendor/VendorChat.jsx";
import VendorReviews from "./pages/vendor/VendorReviews.jsx";
import VendorSettings from "./pages/vendor/VendorSettings.jsx";
import VendorProfile from "./pages/vendor/VendorProfile.jsx";
import VendorFraudReports from "./pages/vendor/VendorFraudReports.jsx";
import VendorManualSales from "./pages/vendor/VendorManualSales.jsx";
import VendorUsers from "./pages/vendor/VendorUsers.jsx";
import StaffProfile from "./pages/vendor/StaffProfile.jsx";

// Admin
import AdminLayout from "./pages/admin/AdminLayout.jsx";
import AdminDashboard from "./pages/admin/AdminDashboard.jsx";
import AdminVendors from "./pages/admin/AdminVendors.jsx";
import AdminSuspendedVendors from "./pages/admin/AdminSuspendedVendors.jsx";
import AdminVerifications from "./pages/admin/AdminVerifications.jsx";
import AdminCustomers from "./pages/admin/AdminCustomers.jsx";
import AdminActivityLog from "./pages/admin/AdminActivityLog.jsx";
import AdminSuggestions from "./pages/admin/AdminSuggestions.jsx";
import AdminReviews from "./pages/admin/AdminReviews.jsx";
import AdminCampaigns from "./pages/admin/AdminCampaigns.jsx";
import AdminSubscriptions from "./pages/admin/AdminSubscriptions.jsx";
import AdminAnnouncements from "./pages/admin/AdminAnnouncements.jsx";
import AdminIntegrations from "./pages/admin/AdminIntegrations.jsx";
import AdminAssistant from "./pages/admin/AdminAssistant.jsx";
import AdminErrors from "./pages/admin/AdminErrors.jsx";
import AdminChat from "./pages/admin/AdminChat.jsx";
import AdminLocations from "./pages/admin/AdminLocations.jsx";
import AdminCategories from "./pages/admin/AdminCategories.jsx";
import AdminProfile from "./pages/admin/AdminProfile.jsx";
import AdminPages from "./pages/admin/AdminPages.jsx";
import AdminFaq from "./pages/admin/AdminFaq.jsx";
import AdminContacto from "./pages/admin/AdminContacto.jsx";
import AdminAyuda from "./pages/admin/AdminAyuda.jsx";
import AdminBranding from "./pages/admin/AdminBranding.jsx";
import AdminOffers from "./pages/admin/AdminOffers.jsx";
import AdminDiscountCodes from "./pages/admin/AdminDiscountCodes.jsx";
import AdminStoreOffers from "./pages/admin/AdminStoreOffers.jsx";
import AdminProducts from "./pages/admin/AdminProducts.jsx";
import AdminManualSales from "./pages/admin/AdminManualSales.jsx";
import AdminCustomerListings from "./pages/admin/AdminCustomerListings.jsx";
import AdminFraudReports from "./pages/admin/AdminFraudReports.jsx";
import AdminRankingAnomalies from "./pages/admin/AdminRankingAnomalies.jsx";

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

export default function App() {
  return (
    <>
      <RouteLoader />
      <ErrorBoundary>
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
        <Route path="/vender" element={<VendorOnboarding />} />
        <Route path="/mesa/:qrToken" element={<TableOrder />} />
        <Route path="/terminos" element={<Terms />} />
        <Route path="/privacidad" element={<Privacy />} />
        <Route path="/faq" element={<Faq />} />
        <Route path="/ayuda" element={<Ayuda />} />
        <Route path="/contacto" element={<Contacto />} />
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
        <Route path="ofertas" element={<VendorOffers />} />
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
        <Route path="codigos-descuento" element={<AdminDiscountCodes />} />
        <Route path="ofertas-tienda" element={<AdminStoreOffers />} />
        <Route path="anuncios" element={<AdminAnnouncements />} />
        <Route path="integraciones" element={<AdminIntegrations />} />
        <Route path="marca" element={<AdminBranding />} />
        <Route path="asistente" element={<AdminAssistant />} />
        <Route path="errores" element={<AdminErrors />} />
        <Route path="ubicaciones" element={<AdminLocations />} />
        <Route path="categorias" element={<AdminCategories />} />
        <Route path="paginas" element={<AdminPages />} />
        <Route path="preguntas-frecuentes" element={<AdminFaq />} />
        <Route path="contacto" element={<AdminContacto />} />
        <Route path="centro-ayuda" element={<AdminAyuda />} />
        <Route path="perfil" element={<AdminProfile />} />
      </Route>

      <Route path="*" element={<NotFound />} />
      </Routes>
      </ErrorBoundary>
    </>
  );
}
