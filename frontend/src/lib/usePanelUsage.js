import { useEffect } from "react";
import { api } from "./api.js";

// Uso del panel de la tienda (para el admin: qué secciones usa, cuánto tiempo y dónde le hace falta ayuda). Al entrar a una
// sección se avisa la visita; al salir de ella, o al esconder la pestaña, el tiempo que estuvo con la pantalla activa. Si
// falla no pasa nada: es solo estadística. Ver backend lib/vendorUsage.js.
const PATH_SECTION = { "": "resumen", verificacion: "suscripcion", "pago-manual": "suscripcion" };

export function sectionFromPath(pathname) {
  const seg = pathname.replace(/^\/vendedor\/?/, "").split("/")[0];
  return PATH_SECTION[seg] ?? seg;
}

// Mandar al cerrar la pestaña: fetch con keepalive sigue en vuelo aunque la página se cierre (sendBeacon no lleva la sesión).
function send(body, keepalive = false) {
  const token = localStorage.getItem("accessToken");
  if (!token) return;
  if (keepalive) {
    fetch(`${api.defaults.baseURL}/vendors/me/usage`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }).catch(() => {});
    return;
  }
  api.post("/vendors/me/usage", body).catch(() => {});
}

export function usePanelUsage(pathname, enabled) {
  const section = sectionFromPath(pathname);
  useEffect(() => {
    if (!enabled || !section) return undefined;
    send({ section, view: true });
    let startedAt = document.visibilityState === "visible" ? Date.now() : null;
    const flush = (keepalive) => {
      if (startedAt == null) return;
      const ms = Date.now() - startedAt;
      startedAt = null;
      if (ms >= 2000) send({ section, ms }, keepalive);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush(true);
      else startedAt = Date.now();
    };
    const onHide = () => flush(true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      flush(false);
    };
  }, [section, enabled]);
}
