import { Facebook, Instagram, Youtube, Send, Globe } from "lucide-react";

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

export const SOCIAL_NETWORKS = [
  { key: "facebook", label: "Facebook", Icon: Facebook, placeholder: "facebook.com/mitienda" },
  { key: "instagram", label: "Instagram", Icon: Instagram, placeholder: "@mitienda" },
  { key: "tiktok", label: "TikTok", Icon: TikTokIcon, placeholder: "@mitienda" },
  { key: "youtube", label: "YouTube", Icon: Youtube, placeholder: "@mitienda" },
  { key: "telegram", label: "Telegram", Icon: Send, placeholder: "t.me/mitienda" },
  { key: "x", label: "X (Twitter)", Icon: XIcon, placeholder: "@mitienda" },
  { key: "website", label: "Sitio web", Icon: Globe, placeholder: "mitienda.com" },
];

// Íconos de las redes puestas; sin ninguna, no se muestra nada. Botones de 36 px con un área táctil de 44 px.
export function StoreSocialLinks({ links, storeName, className = "" }) {
  const present = SOCIAL_NETWORKS.filter((n) => links?.[n.key]);
  if (!present.length) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {present.map(({ key, label, Icon }) => (
        <a
          key={key}
          href={links[key]}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label={`${storeName} en ${label}`}
          title={label}
          className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-white"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        </a>
      ))}
    </div>
  );
}
