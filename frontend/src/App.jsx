import { Routes, Route, Navigate } from "react-router-dom";

import { PublicLayout } from "./components/layout/PublicLayout.jsx";
import { RouteLoader } from "./components/layout/RouteLoader.jsx";

// Público
import Home from "./pages/public/Home.jsx";
import Shop from "./pages/public/Shop.jsx";
import Product from "./pages/public/Product.jsx";
import Store from "./pages/public/Store.jsx";
import Stores from "./pages/public/Stores.jsx";
import Cart from "./pages/public/Cart.jsx";
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
import VendorOrders from "./pages/vendor/VendorOrders.jsx";
import VendorTables from "./pages/vendor/VendorTables.jsx";
import VendorVerification from "./pages/vendor/VendorVerification.jsx";
import VendorChat from "./pages/vendor/VendorChat.jsx";
import VendorReviews from "./pages/vendor/VendorReviews.jsx";
import VendorSettings from "./pages/vendor/VendorSettings.jsx";
import VendorProfile from "./pages/vendor/VendorProfile.jsx";

// Admin
import AdminLayout from "./pages/admin/AdminLayout.jsx";
import AdminDashboard from "./pages/admin/AdminDashboard.jsx";
import AdminVendors from "./pages/admin/AdminVendors.jsx";
import AdminVerifications from "./pages/admin/AdminVerifications.jsx";
import AdminCustomers from "./pages/admin/AdminCustomers.jsx";
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
import AdminBranding from "./pages/admin/AdminBranding.jsx";
import AdminOffers from "./pages/admin/AdminOffers.jsx";
import AdminProducts from "./pages/admin/AdminProducts.jsx";

export default function App() {
  return (
    <>
      <RouteLoader />
      <Routes>
      {/* Sitio público (comprador + vendedor sin cuenta) */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/catalogo" element={<Shop />} />
        <Route path="/producto/:vendorSlug/:productSlug" element={<Product />} />
        <Route path="/tienda/:slug" element={<Store />} />
        <Route path="/tiendas" element={<Stores />} />
        <Route path="/carrito" element={<Cart />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/cuenta/panel" element={<CustomerPanel />} />
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

      {/* Panel de vendedor */}
      <Route path="/vendedor" element={<VendorLayout />}>
        <Route index element={<VendorDashboard />} />
        <Route path="productos" element={<VendorProducts />} />
        <Route path="ofertas" element={<VendorOffers />} />
        <Route path="pedidos" element={<VendorOrders />} />
        <Route path="mesas" element={<VendorTables />} />
        <Route path="verificacion" element={<VendorVerification />} />
        <Route path="mensajes" element={<VendorChat />} />
        <Route path="resenas" element={<VendorReviews />} />
        <Route path="configuracion" element={<VendorSettings />} />
        {/* Unificado en "verificacion" (verificación y plan eran dos páginas
            mostrando casi lo mismo) — se deja el redirect por si alguien
            tiene esta URL guardada. */}
        <Route path="suscripcion" element={<Navigate to="/vendedor/verificacion" replace />} />
        <Route path="perfil" element={<VendorProfile />} />
      </Route>

      {/* Panel de administración ZeuDin */}
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />
        <Route path="tiendas" element={<AdminVendors />} />
        <Route path="productos" element={<AdminProducts />} />
        <Route path="verificaciones" element={<AdminVerifications />} />
        <Route path="clientes" element={<AdminCustomers />} />
        <Route path="sugerencias" element={<AdminSuggestions />} />
        <Route path="comentarios" element={<AdminReviews />} />
        <Route path="mensajes" element={<AdminChat />} />
        <Route path="mensajes/:vendorId" element={<AdminChat />} />
        <Route path="campanas" element={<AdminCampaigns />} />
        <Route path="suscripciones" element={<AdminSubscriptions />} />
        <Route path="ofertas" element={<AdminOffers />} />
        <Route path="anuncios" element={<AdminAnnouncements />} />
        <Route path="integraciones" element={<AdminIntegrations />} />
        <Route path="marca" element={<AdminBranding />} />
        <Route path="asistente" element={<AdminAssistant />} />
        <Route path="errores" element={<AdminErrors />} />
        <Route path="ubicaciones" element={<AdminLocations />} />
        <Route path="categorias" element={<AdminCategories />} />
        <Route path="paginas" element={<AdminPages />} />
        <Route path="perfil" element={<AdminProfile />} />
      </Route>

      <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}
