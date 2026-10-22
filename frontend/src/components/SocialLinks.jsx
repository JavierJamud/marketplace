import { Facebook, Instagram, Youtube, Send, MessageCircle } from "lucide-react";

// Redes de la tienda (decisión del dueño: solo estas seis; Facebook y Messenger son el mismo botón). En la tienda se
// muestran solo las que tienen enlace guardado y el interruptor encendido (el servidor ya filtra, ver backend
// lib/socialLinks.js). Las líneas de cada ícono van en el color de su plataforma, sobre un círculo negro al 50 % de
// opacidad (pedido del dueño); Instagram usa su degradado.
function TikTokIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" />
      <path d="M14 3c.5 2.6 2.4 4.4 5 4.6" />
    </svg>
  );
}

export const SOCIAL_NETWORKS = [
  { key: "whatsapp", label: "WhatsApp", Icon: MessageCircle, placeholder: "+5351234567 o wa.me/5351234567", color: "#25D366" },
  { key: "facebook", label: "Facebook / Messenger", Icon: Facebook, placeholder: "facebook.com/mitienda o m.me/mitienda", color: "#1877F2" },
  { key: "instagram", label: "Instagram", Icon: Instagram, placeholder: "@mitienda", color: "url(#baznova-ig-gradient)" },
  { key: "tiktok", label: "TikTok", Icon: TikTokIcon, placeholder: "@mitienda", color: "#FE2C55" },
  { key: "youtube", label: "YouTube", Icon: Youtube, placeholder: "@mitienda", color: "#FF0000" },
  { key: "telegram", label: "Telegram", Icon: Send, placeholder: "t.me/mitienda", color: "#29A9EB" },
];

// Degradado de Instagram, definido una vez para que el ícono lo use como trazo.
export function InstagramGradient() {
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

// Íconos de la cabecera de la tienda. `links`: { red: url } con solo las encendidas; sin ninguna, no se muestra nada.
// Círculo de 36 px con un área táctil de 44 px.
export function StoreSocialLinks({ links, storeName, className = "" }) {
  const present = SOCIAL_NETWORKS.filter((n) => typeof links?.[n.key] === "string");
  if (!present.length) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {present.some((n) => n.key === "instagram") && <InstagramGradient />}
      {present.map(({ key, label, Icon, color }) => (
        <a
          key={key}
          href={links[key]}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label={`${storeName} en ${label}`}
          title={label}
          className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-white"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 transition-colors hover:bg-black/60">
            <Icon className="h-[18px] w-[18px]" style={{ stroke: color }} aria-hidden="true" />
          </span>
        </a>
      ))}
    </div>
  );
}
