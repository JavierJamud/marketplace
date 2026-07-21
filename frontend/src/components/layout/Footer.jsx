import { Link } from "react-router-dom";

export function Footer() {
  return (
    <footer className="rounded-t-[28px] bg-primary">
      <div className="container-app grid gap-8 py-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex h-[34px] w-[34px] items-center justify-center rounded bg-secondary-container font-display text-lg font-extrabold text-primary">
              Z
            </div>
            <span className="font-display text-lg font-bold text-white">
              Zeu<span className="text-secondary-container">Din</span>
            </span>
          </div>
          <p className="max-w-[280px] text-[13.5px] leading-[21px] text-white/50">
            Marketplace multivendedor de Cuba. Comprá local, pedí por WhatsApp, vendé sin comisiones.
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
            <Link to="/vender" className="hover:text-white">Registrarse gratis</Link>
            <Link to="/vendedor" className="hover:text-white">Panel de vendedor</Link>
            <Link to="/vender" className="hover:text-white">Planes y verificación</Link>
          </div>
        </div>
        <div>
          <div className="mb-4 text-label-md font-bold text-white">ZeuDin</div>
          <div className="flex flex-col gap-2.5 text-[13.5px] text-white/55">
            <Link to="/admin" className="hover:text-white">Panel admin</Link>
            <Link to="/cuenta" className="hover:text-white">Ayuda</Link>
            <Link to="/cuenta" className="hover:text-white">Contacto</Link>
          </div>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="container-app flex flex-col gap-3 py-5 text-[12.5px] text-white/40 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} ZeuDin Group LLC. Marketplace multivendedor · Cuba.</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            <Link to="/terminos" className="hover:text-white/70">Términos y condiciones</Link>
            <Link to="/privacidad" className="hover:text-white/70">Política de privacidad</Link>
            <Link to="/faq" className="hover:text-white/70">Preguntas frecuentes</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
