import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useZone } from "./LocationContext.jsx";

// Orden de lo que se le pide al visitante al llegar, un paso a la vez para que nada se acumule:
//   1. La página carga mostrando todo.
//   2. Se pregunta el lugar de entrega o recogida (solo en las pantallas de productos y tiendas).
//   3. Cuando ya decidió y empieza a navegar (cambia de pantalla, se desplaza o pasa un rato), aparece el aviso de cookies.
//   4. Cuando acepta las cookies, aparece el asistente de chat y los avisos del sitio (anuncios y ofertas).
// Quien ya decidió el lugar y aceptó las cookies en una visita anterior ve el asistente de inmediato.
const COOKIES_KEY = "zeudin_cache_notice_seen";
const LISTING_PAGES = new Set(["/", "/catalogo", "/tiendas", "/ventas-rapidas"]);
const NAVIGATING_AFTER_MS = 20000;
const SCROLL_PX = 600;

const FlowContext = createContext({ showCookies: false, canShowChat: true, canShowPopups: true, acceptCookies: () => {}, zoneStagePending: false });

function readAck() {
  try {
    return localStorage.getItem(COOKIES_KEY) === "1";
  } catch {
    return true;
  }
}

export function FlowProvider({ children }) {
  const { pathname } = useLocation();
  const { loading, decided, countries } = useZone();
  const [cookiesAck, setCookiesAck] = useState(readAck);
  const [navigating, setNavigating] = useState(false);
  const firstPath = useRef(pathname);

  // La pregunta del lugar solo se hace en las pantallas de productos y tiendas, y solo si hay dónde elegir.
  const askingZone = LISTING_PAGES.has(pathname) && !decided && (loading || countries.length > 0);
  const zoneDone = !askingZone;

  // "Empieza a navegar": cambia de pantalla, se desplaza o pasa un rato, siempre después de resolver el lugar.
  useEffect(() => {
    if (!zoneDone || navigating) return undefined;
    if (pathname !== firstPath.current) {
      setNavigating(true);
      return undefined;
    }
    const go = () => setNavigating(true);
    const onScroll = () => window.scrollY >= SCROLL_PX && go();
    window.addEventListener("scroll", onScroll, { passive: true });
    const timer = setTimeout(go, NAVIGATING_AFTER_MS);
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, [zoneDone, navigating, pathname]);

  const acceptCookies = useCallback(() => {
    try {
      localStorage.setItem(COOKIES_KEY, "1");
    } catch {
      /* sin almacenamiento: se vuelve a preguntar la próxima visita */
    }
    setCookiesAck(true);
  }, []);

  const value = useMemo(
    () => ({
      zoneStagePending: askingZone,
      showCookies: zoneDone && !cookiesAck && navigating,
      // El asistente y los avisos esperan a que el lugar esté resuelto y las cookies aceptadas.
      canShowChat: zoneDone && cookiesAck,
      canShowPopups: zoneDone && cookiesAck,
      acceptCookies,
    }),
    [askingZone, zoneDone, cookiesAck, navigating, acceptCookies]
  );
  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow() {
  return useContext(FlowContext);
}
