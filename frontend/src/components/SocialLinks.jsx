import { Facebook, Instagram, Youtube, Send, Globe, MessageCircle } from "lucide-react";
import { waLink } from "../lib/whatsapp.js";

// Redes de la tienda (Vendor.socialLinks, enlaces ya validados por el servidor, ver backend lib/socialLinks.js).
// TikTok y X no están en la librería de íconos: van como SVG propios con el mismo trazo.
function TikTokIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" />
      <path d="M14 3c.5 2.6 2.4 4.4 5 4.6" />
    </svg>
  );
}
function XIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 4l16 16M20 4L4 20" />
    </svg>
  );
}

// `color`: el trazo del ícono en el color de cada plataforma (pedido del dueño). Instagram usa su degradado (IG_GRADIENT).
export const SOCIAL_NETWORKS = [
  { key: "facebook", label: "Facebook", Icon: Facebook, placeholder: "facebook.com/mitienda", color: "#1877F2" },
  { key: "instagram", label: "Instagram", Icon: Instagram, placeholder: "@mitienda", color: "url(#baznova-ig-gradient)" },
  { key: "tiktok", label: "TikTok", Icon: TikTokIcon, placeholder: "@mitienda", color: "#000000" },
  { key: "youtube", label: "YouTube", Icon: Youtube, placeholder: "@mitienda", color: "#FF0000" },
  { key: "telegram", label: "Telegram", Icon: Send, placeholder: "t.me/mitienda", color: "#229ED9" },
  { key: "x", label: "X (Twitter)", Icon: XIcon, placeholder: "@mitienda", color: "#000000" },
  { key: "website", label: "Sitio web", Icon: Globe, placeholder: "mitienda.com", color: "#337475" },
];

// WhatsApp no se carga aquí: sale del número de la tienda (Vendor.whatsapp).
const WHATSAPP = { key: "whatsapp", label: "WhatsApp", Icon: MessageCircle, color: "#25D366" };

// Degradado de Instagram, definido una vez para que los íconos lo usen como trazo.
function InstagramGradient() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="baznova-ig-gradient" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FEDA75" />
          <stop offset="30%" stopColor="#FA7E1E" />
          <stop offset="60%" stopColor="#D62976" />
          <stop offset="100%" stopColor="#4F5BD5" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// Íconos de las redes puestas (y WhatsApp, si la tienda tiene número); sin ninguna, no se muestra nada. Círculo blanco
// para que el color de cada red se lea sobre cualquier color de cabecera. Botones de 36 px con un área táctil de 44 px.
export function StoreSocialLinks({ links, whatsapp, storeName, className = "" }) {
  const present = SOCIAL_NETWORKS.filter((n) => links?.[n.key]).map((n) => ({ ...n, href: links[n.key] }));
  const wa = whatsapp ? waLink(whatsapp, `Hola ${storeName}, tengo una consulta sobre sus productos.`) : null;
  if (wa) present.unshift({ ...WHATSAPP, href: wa });
  if (!present.length) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {present.some((n) => n.key === "instagram") && <InstagramGradient />}
      {present.map(({ key, label, Icon, color, href }) => (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label={`${storeName} en ${label}`}
          title={label}
          className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-white"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm transition-transform hover:scale-105">
            <Icon className="h-[18px] w-[18px]" style={{ stroke: color }} aria-hidden="true" />
          </span>
        </a>
      ))}
    </div>
  );
}
