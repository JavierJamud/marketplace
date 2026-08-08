import { motion } from "motion/react";

// Bloque 38 (pedido explícito): solo los 3 puntitos, sin texto de estado al
// lado — animados con Framer Motion (ya instalado en el proyecto) en vez de
// keyframes CSS, misma onda secuencial de WhatsApp/Messenger (cada puntito
// sube y baja con su propio delay). Compartido entre los dos widgets de
// chat (tienda y general) — mismo criterio que api.js/chatSound.js: una
// utilidad chica sin estado propio, no un widget importando del otro.
const DOT_DELAYS = [0, 0.15, 0.3];

// "inline-flex", no "flex" (fix real encontrado en vivo): un flex-container
// normal sigue siendo una caja de BLOQUE (se estira a ocupar todo el ancho
// disponible del padre); "inline-flex" es lo que hace que la burbuja se
// ajuste a su contenido (3 puntitos chicos) sin importar el ancho del
// contenedor donde se use.
export function TypingDots() {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg rounded-tl-none bg-surface-container px-3.5 py-2.5">
      {DOT_DELAYS.map((delay) => (
        <motion.span
          key={delay}
          className="h-1.5 w-1.5 rounded-full bg-outline"
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay }}
        />
      ))}
    </div>
  );
}
