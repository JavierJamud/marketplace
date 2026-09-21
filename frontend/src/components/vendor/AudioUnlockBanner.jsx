import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import { isAudioUnlocked, forceUnlockAudio } from "../../lib/orderNotificationSound.js";

// Bloque 178 (pedido explícito — "el audio ya está en la carpeta pero
// cuando llegan los pedidos aún no suena... haz que se lo pida al usuario
// o que se active automáticamente al primer clic dentro del panel"): la
// mitad "automática" ya la resuelve unlockAudioOnFirstInteraction
// (orderNotificationSound.js, reintenta en cada click/tecla/touch hasta
// que un intento realmente funciona) — esta es la otra mitad, explícita:
// mientras ese desbloqueo automático todavía no se confirmó, se ofrece acá
// un botón que el vendedor toca a mano. Un click DIRECTO sobre este botón
// es un gesto real e inequívoco — ningún navegador puede rechazar
// reproducir audio disparado así, es la forma más segura de garantizar que
// el sonido de "pedido nuevo" funcione. Solo se muestra a restaurantes
// (los únicos que reciben este tipo de aviso, ver NewOrderPopup.jsx) y
// desaparece solo apenas se confirma el desbloqueo (automático o manual).
// Bloque 205: `enabled` (default true — dueño/admin nunca lo pasan) — un
// usuario de sistema sin receivesOrderNotifications nunca va a escuchar el
// aviso de pedido nuevo, así que tampoco tiene sentido pedirle que active
// el sonido (ver el mismo gate en NewOrderPopup/StaleOrderAlert, VendorLayout.jsx).
export function AudioUnlockBanner({ vendor, enabled = true }) {
  const [unlocked, setUnlocked] = useState(isAudioUnlocked());

  useEffect(() => {
    function onUnlocked() {
      setUnlocked(true);
    }
    window.addEventListener("zeudin:audio-unlocked", onUnlocked);
    return () => window.removeEventListener("zeudin:audio-unlocked", onUnlocked);
  }, []);

  if (!vendor?.isRestaurant || !enabled || unlocked) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-tertiary-accent/30 bg-tertiary-accent/10 px-4 py-2.5">
      <p className="flex items-center gap-2 text-[12.5px] font-semibold text-tertiary-accent">
        <Volume2 className="h-4 w-4 flex-shrink-0" /> Activa el sonido de avisos para no perderte un pedido nuevo.
      </p>
      <button
        onClick={() => forceUnlockAudio()}
        className="flex-shrink-0 rounded-md bg-tertiary-accent px-3.5 py-1.5 text-[12px] font-bold text-white"
      >
        Activar sonido
      </button>
    </div>
  );
}
