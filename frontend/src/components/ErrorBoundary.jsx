import { Component } from "react";
import { AlertTriangle } from "lucide-react";
import { openErrorReport } from "../lib/errorReport.js";
import { reportClientError } from "../lib/clientErrorReport.js";

// Bloque 197 (pedido explícito — "no debe ponerse la página en blanco nunca
// más bajo ninguna circunstancia"): la app entera no tenía NINGÚN error
// boundary — cualquier excepción sin atrapar durante un render (en
// cualquier página, no solo la de la mesa) desmontaba React entero y
// dejaba una pantalla blanca, sin ningún aviso. Esto envuelve TODAS las
// rutas (ver App.jsx) para que ese caso siempre caiga acá en vez de a una
// pantalla vacía.
// Tras un despliegue, una pestaña que ya estaba abierta pide archivos de la versión anterior que ya no existen ("Failed to
// fetch dynamically imported module"). No es un fallo real: basta recargar para bajar la versión nueva. Se recarga sola una
// vez (con una marca para no entrar en bucle si el problema fuera otro).
export function isStaleChunkError(error) {
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed|Unable to preload CSS/i.test(String(error?.message ?? error));
}

// Borra los archivos de la aplicación que guardó el service worker; al recargar se bajan de nuevo del servidor. El service
// worker no se quita: con él se irían también los avisos push de este dispositivo.
async function resetAppFiles() {
  try {
    if (window.caches) for (const key of await caches.keys()) if (key.startsWith("baznova-")) await caches.delete(key);
  } catch {
    /* sin service worker o sin caché */
  }
}

// Primer fallo: recarga simple. Si vuelve a fallar enseguida, lo que está roto es la copia guardada en el teléfono (pasó en
// iPhone al cambiar de versión mientras la página cargaba): se borra el service worker y su caché, y se recarga una vez más.
export function reloadOnceForNewVersion() {
  try {
    const now = Date.now();
    const last = Number(sessionStorage.getItem("chunk_reload_at") || 0);
    if (now - last >= 15000) {
      sessionStorage.setItem("chunk_reload_at", String(now));
      window.location.reload();
      return true;
    }
    const lastReset = Number(sessionStorage.getItem("chunk_reset_at") || 0);
    if (now - lastReset < 120000) return false;
    sessionStorage.setItem("chunk_reset_at", String(now));
  } catch {
    return false;
  }
  resetAppFiles().finally(() => window.location.reload());
  return true;
}

// Borra lo que el navegador guardó (consultas anteriores y archivos de la aplicación) y recarga.
export function clearSavedDataAndReload() {
  try {
    localStorage.removeItem("zeudin_query_cache");
  } catch {
    /* sin almacenamiento */
  }
  resetAppFiles().finally(() => window.location.reload());
}

// Un fallo de pantalla que no es de archivos viejos casi siempre se arregla borrando la caché guardada y recargando: se intenta una
// sola vez por minuto (con marca para no entrar en bucle) antes de mostrar la pantalla de aviso.
function recoverOnce() {
  try {
    const last = Number(sessionStorage.getItem("render_recover_at") || 0);
    if (Date.now() - last < 60000) return false;
    sessionStorage.setItem("render_recover_at", String(Date.now()));
  } catch {
    return false;
  }
  clearSavedDataAndReload();
  return true;
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, resetKey: props.resetKey };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  // Al cambiar de pantalla (otra ruta) el aviso desaparece solo: un fallo en una página no deja atascado el resto del sitio.
  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) return { hasError: false, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error, info) {
    const stale = isStaleChunkError(error);
    if (stale && reloadOnceForNewVersion()) {
      reportClientError({ kind: "chunk", error, recovered: true });
      return;
    }
    console.error("ErrorBoundary atrapó un error de render:", error, info);
    this.failure = { method: "RENDER", path: window.location.pathname, status: null, message: String(error?.message ?? error).slice(0, 300), at: new Date().toISOString() };
    const recovered = !stale && recoverOnce();
    reportClientError({ kind: stale ? "chunk" : "render", error, recovered });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface-container-lowest p-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-error/10">
          <AlertTriangle className="h-7 w-7 text-error" />
        </div>
        <div>
          <h1 className="mb-1.5 text-title-lg font-bold text-on-surface">Hay un problema en este momento</h1>
          <p className="mx-auto max-w-sm text-[13.5px] text-on-surface-variant">
            Tuvimos un problema mostrando esta página. Prueba recargarla — tus datos están a salvo.
          </p>
        </div>
        <div className="flex w-full max-w-xs flex-col gap-2">
          <button onClick={clearSavedDataAndReload} className="min-h-11 rounded-md bg-primary px-6 py-2.5 text-label-md font-bold text-white">
            Recargar página
          </button>
          <a href="/" className="flex min-h-11 items-center justify-center rounded-md border border-outline-variant px-6 py-2.5 text-label-md font-bold text-on-surface">
            Ir al inicio
          </a>
          <button onClick={() => openErrorReport({ failure: this.failure })} className="min-h-11 px-6 py-2.5 text-label-md font-semibold text-on-surface-variant underline">
            Reportar el problema
          </button>
        </div>
      </div>
    );
  }
}
