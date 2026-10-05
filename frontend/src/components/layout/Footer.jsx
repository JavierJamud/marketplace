import { Link } from "react-router-dom";
import { Facebook, Instagram, Mail, MessageCircle } from "lucide-react";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";

// Bloque 223: footer en mobile con las secciones agrupadas para no sumar puro
// scroll vertical. Bloque 251: sin líneas divisorias y con los iconos bajo la
// marca. Bloque 254 (pedido explícito — "en celular se ve desorganizado"): la
// versión anterior ponía "Comprar" y "Vender" lado a lado, y "Ayuda y legal"
// en otra cuadrícula de 2 columnas y 3 filas que dejaba "Contacto" solo a la
// izquierda y las demás desalineadas. Ahora en celular son DOS columnas
// equilibradas: a la izquierda "Comprar" y "Vender" apiladas, a la derecha
// "Ayuda y legal". Desde md vuelve a ser una fila de 4 columnas (marca,
// Comprar, Vender, Ayuda y legal).
//
// Cada enlace mide 44px de alto en celular (R-03). Los iconos sociales solo
// aparecen si están configurados en Admin → Marca → Redes sociales; el de correo
// manda a /contacto (siempre real).
const LINK = "flex min-h-11 items-center text-[13.5px] text-white/70 transition-colors hover:text-white md:min-h-0";
const HEADING = "mb-1 text-label-md font-bold text-white md:mb-4";

function SocialLink({ href, label, Icon }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.08] text-white/80 transition-colors hover:bg-white/15 hover:text-white"
    >
      <Icon className="h-[18px] w-[18px]" />
    </a>
  );
}

export function Footer() {
  const { siteName, logoUrl, whatsappUrl, instagramUrl, facebookUrl } = usePlatformSettings();
  return (
    <footer className="rounded-t-[28px] bg-primary">
      <div className="container-app grid gap-8 pb-2 pt-10 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:gap-8 md:pt-11">
        {/* Marca, descripción y contacto */}
        <div>
          <div className="mb-3 flex items-center gap-2.5">
            {logoUrl ? (
              <img src={logoUrl} alt={siteName} className="h-[34px] w-[34px] flex-shrink-0 rounded object-cover" />
            ) : (
              <div className="flex h-[34px] w-[34px] items-center justify-center rounded bg-secondary-container font-display text-lg font-extrabold text-primary">
                {siteName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="font-display text-lg font-bold text-white">{siteName}</span>
          </div>
          <p className="max-w-[300px] text-[13.5px] leading-[21px] text-white/65">
            Marketplace multivendedor de Cuba. Compra local, pide por WhatsApp, vende sin comisiones.
          </p>
          <div className="-ml-0.5 mt-3 flex gap-2">
            {whatsappUrl && <SocialLink href={whatsappUrl} label="WhatsApp" Icon={MessageCircle} />}
            {facebookUrl && <SocialLink href={facebookUrl} label="Facebook" Icon={Facebook} />}
            {instagramUrl && <SocialLink href={instagramUrl} label="Instagram" Icon={Instagram} />}
            <Link
              to="/contacto"
              aria-label="Escribirnos por correo"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.08] text-white/80 transition-colors hover:bg-white/15 hover:text-white"
            >
              <Mail className="h-[18px] w-[18px]" />
            </Link>
          </div>
        </div>

        {/* Enlaces: 2 columnas en celular, y desde md cada grupo recupera su
            propia columna del grid de 4 (md:contents quita estos contenedores
            del layout). */}
        <div className="grid grid-cols-2 gap-x-6 md:contents">
          <div className="flex flex-col gap-6 md:contents">
            <nav aria-label="Comprar">
              <div className={HEADING}>Comprar</div>
              <div className="flex flex-col md:gap-2.5">
                <Link to="/catalogo" className={LINK}>Catálogo</Link>
                <Link to="/tiendas" className={LINK}>Tiendas</Link>
                <Link to="/tiendas?isRestaurant=true" className={LINK}>Menú QR restaurantes</Link>
                <Link to="/ventas-rapidas" className={LINK}>Ventas rápidas</Link>
              </div>
            </nav>
            <nav aria-label="Vender">
              <div className={HEADING}>Vender</div>
              <div className="flex flex-col md:gap-2.5">
                <Link to="/vendedor/ingresar?tab=registro" className={LINK}>Registrarse gratis</Link>
                <Link to="/vendedor/ingresar?tab=registro" className={LINK}>Planes y verificación</Link>
              </div>
            </nav>
          </div>
          {/* Bloque 48: sin ningún link a /admin ni /vendedor (paneles internos):
              solo ayuda y las páginas legales. */}
          <nav aria-label="Ayuda y legal">
            <div className={HEADING}>Ayuda y legal</div>
            <div className="flex flex-col md:gap-2.5">
              <Link to="/faq" className={LINK}>Preguntas frecuentes</Link>
              <Link to="/ayuda" className={LINK}>Centro de ayuda</Link>
              <Link to="/contacto" className={LINK}>Contacto</Link>
              <Link to="/terminos" className={LINK}>Términos y condiciones</Link>
              <Link to="/privacidad" className={LINK}>Política de privacidad</Link>
            </div>
          </nav>
        </div>
      </div>

      {/* pb-24 en celular: el botón flotante del chat (52 a 60px más su margen)
          no tapa el texto legal. */}
      <div className="container-app pb-24 pt-5 text-[12.5px] text-white/60 md:pb-6 md:pt-6">
        © {new Date().getFullYear()} {siteName}. Marketplace multivendedor · Cuba.
      </div>
    </footer>
  );
}
