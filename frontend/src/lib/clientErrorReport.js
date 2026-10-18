import { api } from "./api.js";

// Aviso automático al servidor cuando la pantalla de un visitante se rompe (ver ErrorBoundary.jsx y main.jsx). Deja rastro en
// Admin > Errores de lo que de otro modo solo vería quien lo sufre. Nunca debe causar otro problema: todo va protegido, con un
// tope por visita y sin esperar respuesta.
const MAX_PER_VISIT = 6;
const IGNORED = /ResizeObserver loop|Script error\.?$|chrome-extension|moz-extension|safari-extension|webkit-masked-url|Non-Error promise rejection|Network Error|Request aborted|cancel/i;

function storageOk() {
  try {
    localStorage.setItem("__t", "1");
    localStorage.removeItem("__t");
    return true;
  } catch {
    return false;
  }
}

export function reportClientError({ kind, error, recovered = false }) {
  try {
    const message = String(error?.message ?? error ?? "").slice(0, 300) || "(sin mensaje)";
    if (IGNORED.test(message)) return;
    const n = Number(sessionStorage.getItem("client_err_n") || 0);
    if (n >= MAX_PER_VISIT) return;
    sessionStorage.setItem("client_err_n", String(n + 1));
    const body = {
      kind,
      message,
      stack: String(error?.stack ?? "").slice(0, 1500) || undefined,
      page: `${window.location.pathname}${window.location.search}`.slice(0, 300),
      version: typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : undefined,
      recovered,
      online: navigator.onLine,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      language: String(navigator.language ?? "").slice(0, 20),
      storage: storageOk(),
    };
    // Con la sesión, si la hay: el admin sabe a quién (y a qué tienda) le falló la pantalla.
    let token = null;
    try {
      token = localStorage.getItem("accessToken");
    } catch {
      /* sin almacenamiento */
    }
    fetch(`${api.defaults.baseURL ?? ""}/error-reports/client`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
  } catch {
    /* el aviso nunca debe romper nada */
  }
}
