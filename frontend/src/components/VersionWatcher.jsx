import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import toast from "../lib/toast.jsx";
import { reloadWithWaitingWorker } from "../lib/pwa.js";

// Una pestaña que quedó abierta días (o que el teléfono restauró de memoria) sigue corriendo la versión con la que se abrió:
// en el teléfono se veía un checkout viejo, sin "¿Quién recibe el pedido?" y con los avisos de antes. Esto no depende de la
// app instalada: pregunta al servidor qué compilación está publicada (version.json, lo genera vite.config.js) al abrir, al
// volver a la pestaña y cada 10 minutos. Si hay una nueva, avisa con "Actualizar" y, en el próximo cambio de pantalla, recarga
// sola (la persona ya está saliendo de esa pantalla, así no pierde lo que estaba escribiendo).
const CHECK_EVERY_MS = 10 * 60 * 1000;
const RELOADED_KEY = "baznova_reloaded_for_build";

export function VersionWatcher() {
  const { pathname } = useLocation();
  const latest = useRef(null);
  const firstPath = useRef(pathname);

  useEffect(() => {
    if (import.meta.env.DEV) return undefined;
    let noticeShown = false;
    const check = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const { build } = await res.json();
        if (!build || build === __APP_BUILD__) return;
        latest.current = build;
        if (noticeShown) return;
        noticeShown = true;
        toast.action("Hay una versión nueva", "Actualiza para ver los últimos cambios de Baznova.", { label: "Actualizar", duration: Infinity, onClick: () => reloadWithWaitingWorker() });
      } catch {
        /* sin conexión: se vuelve a intentar más tarde */
      }
    };
    check();
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, []);

  // Al cambiar de pantalla con una versión nueva publicada, se recarga una sola vez por compilación (si el servidor siguiera
  // respondiendo otra cosa, no entra en un ciclo de recargas).
  useEffect(() => {
    if (pathname === firstPath.current || !latest.current) return;
    let already = null;
    try {
      already = sessionStorage.getItem(RELOADED_KEY);
    } catch {
      /* almacenamiento bloqueado */
    }
    if (already === latest.current) return;
    try {
      sessionStorage.setItem(RELOADED_KEY, latest.current);
    } catch {
      /* almacenamiento bloqueado */
    }
    reloadWithWaitingWorker();
  }, [pathname]);

  return null;
}
