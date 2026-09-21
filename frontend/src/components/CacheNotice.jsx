import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Cookie } from "lucide-react";

const SEEN_KEY = "zeudin_cache_notice_seen";

// Bloque 138/139 (pedido explícito, con captura de referencia + texto
// dictado a mano por el dueño): mismo formato que un aviso de cookies
// típico — título, ícono + texto + "Más información". Bloque 139: un solo
// botón de confirmación ("Estoy de acuerdo"), sin la opción de rechazar
// del Bloque 138 — aparece UNA sola vez por navegador (localStorage).
export function CacheNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(SEEN_KEY) !== "1") setShow(true);
  }, []);

  function acknowledge() {
    localStorage.setItem(SEEN_KEY, "1");
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed bottom-5 left-5 z-[150] w-[min(380px,calc(100vw-40px))] rounded-2xl bg-surface-container-lowest p-4 shadow-2xl animate-fade-up">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-tertiary-accent/10">
          <Cookie className="h-[18px] w-[18px] text-tertiary-accent" />
        </div>
        <div>
          <p className="mb-1 text-[13.5px] font-bold text-on-surface">Este sitio web usa cookies</p>
          <p className="text-[13px] leading-[19px] text-on-surface-variant">
            Almacenamos datos de forma temporal para mejorar su experiencia de navegación y recomendarle contenido de
            interés.{" "}
            <Link to="/privacidad" className="font-semibold text-tertiary-accent underline">
              Más información
            </Link>
          </p>
        </div>
      </div>
      <button
        onClick={acknowledge}
        className="h-10 w-full rounded-xl bg-secondary-container text-[13px] font-bold text-on-secondary-container hover:brightness-95"
      >
        Estoy de acuerdo
      </button>
    </div>
  );
}
