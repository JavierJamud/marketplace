import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { PageLoader } from "../ui/PageLoader.jsx";
import { Header } from "./Header.jsx";
import { Footer } from "./Footer.jsx";
import { CartDrawer } from "./CartDrawer.jsx";
import { CartConflictModal } from "../CartConflictModal.jsx";
import { AnnouncementPopup } from "../AnnouncementPopup.jsx";
import { TargetedOfferPopup } from "../TargetedOfferPopup.jsx";
import { ZoneWelcome } from "../ZoneWelcome.jsx";
import { BackTopButton } from "./BackTopButton.jsx";
import { useFlow } from "../../context/FlowContext.jsx";
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
  // Los avisos del sitio esperan a que el lugar esté resuelto y las cookies aceptadas (ver FlowContext).
  const { canShowPopups } = useFlow();

  return (
    <div className="flex min-h-dvh flex-col">
      {!isTableOrder && <Header />}
      <main className="flex-1">
        {/* Las pantallas se descargan al abrirse: mientras llega una, el encabezado y el pie siguen en su lugar. */}
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
      <CartDrawer />
      <CartConflictModal />
      {canShowPopups && <AnnouncementPopup />}
      {/* Bloque 194 (pedido explícito): ofertas dirigidas a un cliente
          logueado, como popup al entrar — mismo criterio de montaje global
          que AnnouncementPopup de arriba. Nunca en el flujo cerrado de
          "/mesa/..." (mismo motivo que el Header, arriba). */}
      {!isTableOrder && canShowPopups && <TargetedOfferPopup enabled={!!user} />}
      {!isTableOrder && <ZoneWelcome />}
      {/* Atrás o subir, según dónde esté la persona en la página. Nunca en "/mesa/..." (flujo cerrado de la mesa). */}
      {!isTableOrder && <BackTopButton />}
    </div>
  );
}

export default PublicLayout;
