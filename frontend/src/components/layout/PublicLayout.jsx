import { Outlet, useLocation } from "react-router-dom";
import { Header } from "./Header.jsx";
import { Footer } from "./Footer.jsx";
import { CartDrawer } from "./CartDrawer.jsx";
import { CartConflictModal } from "../CartConflictModal.jsx";
import { AnnouncementPopup } from "../AnnouncementPopup.jsx";
import { TargetedOfferPopup } from "../TargetedOfferPopup.jsx";
import { useAuth } from "../../context/AuthContext.jsx";

export function PublicLayout() {
  // Bloque 166 (pedido explícito — "en la página donde se muestra el menú
  // escaneado del QR no debe mostrarse la barra de menú superior"): el
  // cliente que escanea el QR de su mesa nunca debería poder navegar a
  // buscar/carrito/registrarse desde ahí — es un flujo cerrado, propio de
  // esa mesa. El resto del layout (footer, CartDrawer, etc.) se queda
  // igual, solo se saca el Header.
  const { pathname } = useLocation();
  const isTableOrder = pathname.startsWith("/mesa/");
  // Bloque 194: /targeted-offers/me exige sesión — un visitante anónimo
  // nunca debe ni intentar la llamada (mismo criterio que cualquier otra
  // query gateada por `user` en el resto del sitio).
  const { user } = useAuth();

  return (
    <div className="flex min-h-dvh flex-col">
      {!isTableOrder && <Header />}
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <CartDrawer />
      <CartConflictModal />
      <AnnouncementPopup />
      {/* Bloque 194 (pedido explícito): ofertas dirigidas a un cliente
          logueado, como popup al entrar — mismo criterio de montaje global
          que AnnouncementPopup de arriba. Nunca en el flujo cerrado de
          "/mesa/..." (mismo motivo que el Header, arriba). */}
      {!isTableOrder && <TargetedOfferPopup enabled={!!user} />}
    </div>
  );
}

export default PublicLayout;
