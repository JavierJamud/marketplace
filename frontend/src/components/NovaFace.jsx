import { useId } from "react";

// Nova, el agente de IA de Baznova: la burbuja azul del logo (redonda, con la esquina inferior derecha recta), dos ojos
// blancos (el derecho más abajo) y la sonrisa con el borde de arriba inclinado. Medidas tomadas del logo original en un
// lienzo de 100 x 100. Es el ícono de todos los chats con IA (web pública, panel de vendedor y admin), así el bot se
// reconoce igual en todas partes. Los colores son las variables --nova-* de index.css (un azul más profundo que el
// del logo, para que combine con la paleta de la plataforma).
// `happy`: ojos felices (^ ^), para cuando el chat está abierto o el cursor pasa encima. Los ojos abiertos parpadean
// con CSS (.nova-face en index.css), que se apaga con "reducir movimiento".
const BUBBLE = "M50 8C26.8 8 8 26.8 8 50s18.8 42 42 42h38.5c1.9 0 3.5-1.6 3.5-3.5V50C92 26.8 73.2 8 50 8Z";

export function NovaFace({ happy = false, className = "" }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="8 8 84 84" aria-hidden="true" focusable="false" className={`nova-face ${happy ? "is-happy" : ""} ${className}`}>
      <defs>
        <linearGradient id={`nova-g${id}`} x1="0.15" y1="0.1" x2="0.9" y2="0.95">
          <stop offset="0%" style={{ stopColor: "var(--nova-light)" }} />
          <stop offset="55%" style={{ stopColor: "var(--nova-mid)" }} />
          <stop offset="100%" style={{ stopColor: "var(--nova-deep)" }} />
        </linearGradient>
      </defs>
      <path d={BUBBLE} fill={`url(#nova-g${id})`} />
      <g className="nova-face-eyes" fill="#fff">
        <ellipse cx="32.5" cy="36" rx="6.9" ry="6.9" />
        <ellipse cx="56.5" cy="42.5" rx="6.9" ry="6.9" />
      </g>
      <g className="nova-face-happy" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round">
        <path d="M26.5 38Q32.5 31 38.5 38" />
        <path d="M50.5 44.5Q56.5 37.5 62.5 44.5" />
      </g>
      <path className="nova-face-mouth" d="M21 48.6c-.2-.9.6-1.6 1.5-1.4l43.1 9.7c.9.2 1.4 1.1 1 1.9C63 69 53.6 75.5 43.6 75.5 30.6 75.5 20.1 64.9 21 52.4Z" fill="#fff" />
    </svg>
  );
}
