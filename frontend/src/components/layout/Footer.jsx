import { Link } from "react-router-dom";
import { Facebook, Instagram, Mail, MessageCircle } from "lucide-react";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";

// Bloque 223 (pedido explícito — "el footer debe verse más organizado para
// dispositivos móviles"): en mobile, cada una de las 4 secciones ocupaba su
// propio ancho completo, una abajo de la otra (el grid de 4 columnas de
// abajo solo arranca en md:) — con "Ayuda y legal" sola ya suma 5 líneas,
// la pantalla terminaba siendo puro scroll vertical antes de llegar al pie
// de la página. Un ícono de contacto, sea tap target o no, pasa el umbral
// mínimo de 44px (R-03) envolviéndolo en un botón circular de ese tamaño
// aunque el ícono en sí se vea chico y apagado.
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
  // Bloque 223: mismo criterio que ya usaba la fila de íconos del pie de
  // los correos (ver socialIconsRowHtml en backend/_shared.js) — un canal
  // sin configurar en Marca → Redes sociales no aparece, nunca un ícono
  // "muerto" que no lleve a ningún lado (R-24/R-26). El de Correo es
  // distinto: no es un link libre configurable, así que en vez de
  // inventar una dirección de correo acá, manda a /contacto (siempre
  // real, siempre funcional).
  return (
    <footer className="rounded-t-[28px] bg-primary">
      {/* Bloque 251 (pedido explícito — "no debe verse con líneas limitado así y
          ajusta mejor el espacio"): antes eran tres franjas apiladas (columnas,
          iconos y copyright) separadas por líneas, con los iconos centrados y
          casi invisibles (35% de opacidad). Ahora los iconos viven bajo la marca,
          sin líneas divisorias, y el copyright cierra el mismo bloque. */}
      <div className="container-app grid gap-6 pb-2 pt-9 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:gap-8 md:pt-11">
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
          <p className="max-w-[280px] text-[13.5px] leading-[21px] text-white/60">
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

        {/* Bloque 223: "Comprar" y "Vender" lado a lado en mobile (grid de
            2 columnas) — en md: este wrapper se vuelve display:contents
            (deja de existir como elemento de layout) y cada uno recupera
            su propia columna del grid de 4 de arriba, como ya era. */}
        <div className="grid grid-cols-2 gap-6 md:contents">
          <div>
            <div className="mb-2 text-label-md font-bold text-white md:mb-4">Comprar</div>
            <div className="flex flex-col gap-0 text-[13.5px] text-white/65 md:gap-2.5">
              <Link to="/catalogo" className="flex min-h-11 items-center hover:text-white md:min-h-0">Catálogo</Link>
              <Link to="/tiendas" className="flex min-h-11 items-center hover:text-white md:min-h-0">Tiendas</Link>
              <Link to="/tiendas?isRestaurant=true" className="flex min-h-11 items-center hover:text-white md:min-h-0">Menú QR restaurantes</Link>
              {/* Bloque 236 (pedido explícito — "debería existir un link
                  para ventas rápidas"): bug real encontrado en la
                  conversación anterior — la página /ventas-rapidas
                  funcionaba perfecto pero no había NINGÚN link hacia ella
                  en todo el sitio (ni Header, ni Home, ni este footer). */}
              <Link to="/ventas-rapidas" className="flex min-h-11 items-center hover:text-white md:min-h-0">Ventas rápidas</Link>
            </div>
          </div>
          <div>
            <div className="mb-2 text-label-md font-bold text-white md:mb-4">Vender</div>
            <div className="flex flex-col gap-0 text-[13.5px] text-white/65 md:gap-2.5">
              <Link to="/vendedor/ingresar?tab=registro" className="flex min-h-11 items-center hover:text-white md:min-h-0">Registrarse gratis</Link>
              <Link to="/vendedor/ingresar?tab=registro" className="flex min-h-11 items-center hover:text-white md:min-h-0">Planes y verificación</Link>
            </div>
          </div>
        </div>

        {/* Bloque 48 (pedido explícito): sin ningún link a /admin ni /vendedor
            — un footer público de cara al cliente no lleva accesos a
            paneles internos. Pasa a ser "Ayuda y legal" con las 5 páginas
            (las 3 de siempre + Centro de ayuda/Contacto, nuevas).
            Bloque 223: en mobile, esos 5 links pasan a 2 columnas
            (grid-flow-col agrupa de arriba hacia abajo por columna — 3 a
            la izquierda, 2 a la derecha — en vez de alternar izquierda/
            derecha fila por fila) para no sumar 5 líneas más de puro
            scroll vertical. En md: vuelve a ser una lista vertical simple,
            ya angosta de por sí al ser 1 de 4 columnas. */}
        <div>
          <div className="mb-2 text-label-md font-bold text-white md:mb-4">Ayuda y legal</div>
          <div className="grid grid-flow-col grid-rows-3 gap-x-6 gap-y-0 text-[13.5px] text-white/65 md:flex md:flex-col md:gap-2.5">
            <Link to="/faq" className="flex min-h-11 items-center hover:text-white md:min-h-0">Preguntas frecuentes</Link>
            <Link to="/ayuda" className="flex min-h-11 items-center hover:text-white md:min-h-0">Centro de ayuda</Link>
            <Link to="/contacto" className="flex min-h-11 items-center hover:text-white md:min-h-0">Contacto</Link>
            <Link to="/terminos" className="flex min-h-11 items-center hover:text-white md:min-h-0">Términos y condiciones</Link>
            <Link to="/privacidad" className="flex min-h-11 items-center hover:text-white md:min-h-0">Política de privacidad</Link>
          </div>
        </div>
      </div>

      <div className="container-app pb-24 pt-4 text-[12.5px] text-white/60 md:pb-6 md:pt-6">
        © {new Date().getFullYear()} {siteName}. Marketplace multivendedor · Cuba.
      </div>
    </footer>
  );
}
