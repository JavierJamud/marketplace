import { Link } from "react-router-dom";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";

export function Footer() {
  const { siteName, logoUrl } = usePlatformSettings();
  return (
    <footer className="rounded-t-[28px] bg-primary">
      <div className="container-app grid gap-8 py-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="mb-4 flex items-center gap-2.5">
            {logoUrl ? (
              <img src={logoUrl} alt={siteName} className="h-[34px] w-[34px] flex-shrink-0 rounded object-cover" />
            ) : (
              <div className="flex h-[34px] w-[34px] items-center justify-center rounded bg-secondary-container font-display text-lg font-extrabold text-primary">
                {siteName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="font-display text-lg font-bold text-white">{siteName}</span>
          </div>
          <p className="max-w-[280px] text-[13.5px] leading-[21px] text-white/50">
            Marketplace multivendedor de Cuba. Compra local, pide por WhatsApp, vende sin comisiones.
          </p>
        </div>
        <div>
          <div className="mb-4 text-label-md font-bold text-white">Comprar</div>
          <div className="flex flex-col gap-2.5 text-[13.5px] text-white/55">
            <Link to="/catalogo" className="hover:text-white">Catálogo</Link>
            <Link to="/tiendas" className="hover:text-white">Tiendas</Link>
            <Link to="/tiendas?isRestaurant=true" className="hover:text-white">Menú QR restaurantes</Link>
          </div>
        </div>
        <div>
          <div className="mb-4 text-label-md font-bold text-white">Vender</div>
          <div className="flex flex-col gap-2.5 text-[13.5px] text-white/55">
            <Link to="/vendedor/ingresar?tab=registro" className="hover:text-white">Registrarse gratis</Link>
            <Link to="/vendedor/ingresar?tab=registro" className="hover:text-white">Planes y verificación</Link>
          </div>
        </div>
        {/* Bloque 48 (pedido explícito): sin ningún link a /admin ni /vendedor
            — un footer público de cara al cliente no lleva accesos a
            paneles internos. Pasa a ser "Ayuda y legal" con las 5 páginas
            (las 3 de siempre + Centro de ayuda/Contacto, nuevas). */}
        <div>
          <div className="mb-4 text-label-md font-bold text-white">Ayuda y legal</div>
          <div className="flex flex-col gap-2.5 text-[13.5px] text-white/55">
            <Link to="/faq" className="hover:text-white">Preguntas frecuentes</Link>
            <Link to="/ayuda" className="hover:text-white">Centro de ayuda</Link>
            <Link to="/contacto" className="hover:text-white">Contacto</Link>
            <Link to="/terminos" className="hover:text-white">Términos y condiciones</Link>
            <Link to="/privacidad" className="hover:text-white">Política de privacidad</Link>
          </div>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="container-app py-5 text-[12.5px] text-white/40">
          © {new Date().getFullYear()} {siteName}. Marketplace multivendedor · Cuba.
        </div>
      </div>
    </footer>
  );
}
