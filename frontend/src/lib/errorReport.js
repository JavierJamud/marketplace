// Reporte manual de errores. Cuando algo falla por un problema técnico (sin conexión, error del servidor), la
// persona ve un aviso amable de "problema de conexión" con un botón para reportarlo. Aquí vive lo que el sitio
// recuerda del último fallo y el evento que abre la ventana de reporte (components/ReportErrorModal.jsx).

export const FRIENDLY_TITLE = "Hay un problema de conexión en este momento";
export const FRIENDLY_HINT = "Prueba de nuevo en unos minutos. Si sigue igual, cuéntanos qué pasó.";
export const REPORT_EVENT = "zeudin:error-report";

let lastFailure = null;
let lastToastAt = 0;

// ¿Es un fallo técnico y no un error de la persona? Sin respuesta del servidor (red caída, tiempo agotado) o un
// error 5xx. Un 400, 401, 403, 404 o 409 son respuestas esperadas (dato mal puesto, sin permiso...) y no se tocan.
export function isTechnicalFailure(error) {
  if (!error || error.actionCodeCancelled || error.config?.skipErrorReport) return false;
  if (error.code === "ERR_CANCELED") return false;
  const status = error.response?.status;
  return status === undefined || status >= 500 || status === 408;
}

export function recordApiFailure(error) {
  const cfg = error.config ?? {};
  let path = String(cfg.url ?? "");
  try {
    path = new URL(path, "http://x").pathname;
  } catch {
    // se deja tal cual
  }
  lastFailure = {
    method: String(cfg.method ?? "get").toUpperCase(),
    path: path.slice(0, 200),
    status: error.response?.status ?? null,
    message: String(error.response?.data?.error ?? error.message ?? "").slice(0, 300),
    at: new Date().toISOString(),
    time: Date.now(),
  };
}

// Fallo técnico reciente (por defecto, de los últimos 3 segundos): el que explica el aviso que se está mostrando.
export function getRecentFailure(maxAgeMs = 3000) {
  return lastFailure && Date.now() - lastFailure.time <= maxAgeMs ? lastFailure : null;
}

// Evita apilar el mismo aviso varias veces cuando fallan varias peticiones juntas.
export function shouldShowFriendlyToast(minGapMs = 4000) {
  const now = Date.now();
  if (now - lastToastAt < minGapMs) return false;
  lastToastAt = now;
  return true;
}

export function openErrorReport(detail = {}) {
  window.dispatchEvent(new CustomEvent(REPORT_EVENT, { detail: { failure: lastFailure, ...detail } }));
}

// Lo que el sitio sabe del momento del fallo; se manda junto con lo que cuenta la persona.
export function collectReportContext(failure) {
  return {
    page: `${window.location.pathname}${window.location.search}`.slice(0, 300),
    referrer: String(document.referrer ?? "").slice(0, 300),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    language: String(navigator.language ?? "").slice(0, 20),
    online: navigator.onLine,
    request: failure ? { method: failure.method, path: failure.path, status: failure.status, message: failure.message, at: failure.at } : undefined,
  };
}
