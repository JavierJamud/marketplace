import { useEffect } from "react";
import toast from "../../lib/toast.jsx";
import { devicePlatform, isStandalone, pingInstalledApp } from "../../lib/pwa.js";

// Novedades de la aplicación instalada:
//  - Versión nueva del sitio: el service worker nuevo se activa solo; cuando toma el control se ofrece "Actualizar" (recarga)
//    para ver los cambios al momento. Se busca una versión nueva al volver a la app y cada 30 minutos.
//  - Nombre o ícono nuevos: la app avisa una sola vez. En Android y computadora el navegador los cambia solo al reabrir la app
//    (a veces pide confirmarlo); en iPhone hay que borrarla y volver a añadirla, porque iOS no actualiza el ícono.
// Además, cada vez que se abre instalada, avisa al servidor que sigue instalada (ver pingInstalledApp).
const CHECK_EVERY_MS = 30 * 60 * 1000;

export function AppUpdateNotices({ app, enabled, userId }) {
  useEffect(() => {
    if (!enabled || !app || !isStandalone()) return;
    pingInstalledApp(app).then((identityChanged) => {
      if (!identityChanged) return;
      const ios = devicePlatform() === "ios";
      toast.info(
        `${app.name} tiene nombre o ícono nuevos`,
        ios ? "Para verlos en tu pantalla de inicio, mantén pulsado el ícono, quita la app y vuelve a añadirla desde Safari." : "Se cambian solos la próxima vez que abras la app. Si el teléfono te pregunta, acepta la actualización.",
        { duration: 15000 }
      );
    });
  }, [app, enabled, userId]); // al iniciar sesión se vuelve a avisar, para asociar la instalación a la persona

  useEffect(() => {
    if (!enabled || !("serviceWorker" in navigator)) return undefined;
    // Solo cuenta como "versión nueva" si ya había un service worker al abrir (el primero no es una actualización).
    const hadController = !!navigator.serviceWorker.controller;
    let shown = false;
    const onChange = () => {
      if (!hadController || shown) return;
      shown = true;
      toast.action("Hay una versión nueva de Baznova", "Actualiza para ver los cambios ahora.", { label: "Actualizar", duration: Infinity, onClick: () => window.location.reload() });
    };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    const check = () => navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [enabled]);

  return null;
}
