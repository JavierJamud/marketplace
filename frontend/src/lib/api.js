import { isTechnicalFailure, recordApiFailure } from "./errorReport.js";
import axios from "axios";

// Bloque 182 (bug real reportado en vivo — "tengo problemas al cargar mi
// proyecto cuando la computadora no tiene internet o cuando está conectada
// a otra red... no me carga el backend"): antes esto solo se resolvía a
// una IP de LAN fija si `VITE_API_URL` (.env/.env.development) la
// sobreescribía — y ESTABA sobreescrita con `http://192.168.1.79:4000`, la
// IP de una red puntual. En cualquier otra red (o sin red, ej. WiFi
// desconectado del todo) esa IP deja de existir y el frontend queda
// apuntando a una dirección inalcanzable, aunque el backend esté corriendo
// perfectamente en la misma máquina. La solución real es dejar de fijar
// una IP a mano: `window.location.hostname` es SIEMPRE el host correcto
// desde donde se está sirviendo el propio frontend (localhost en la PC,
// automáticamente la IP de LAN real y ACTUAL si se abre el panel desde un
// celular en esa red) — el backend corre en el mismo host, solo cambia el
// puerto. `VITE_API_URL` queda como escape hatch explícito para
// producción/casos raros (nunca debería estar seteada en dev).
const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:4000`;

export const api = axios.create({ baseURL: API_URL });

// Evento que se avisa a la aplicación cuando el servidor responde que todo el sitio está en mantenimiento (ver lib/useMaintenance.js).
export const MAINTENANCE_EVENT = "zeudin:maintenance";

// Bloque 60: este módulo no es un componente — no puede leer el `user`
// actual ni navegar. AuthContext.jsx se registra acá una sola vez al
// montar, así que cuando el refresh falla de verdad (sesión revocada o
// vencida) el cierre es el mismo "de verdad" (limpiar estado + redirigir)
// que usan el resto de los casos (logout explícito, inactividad,
// sincronización entre pestañas) — antes esto solo borraba localStorage y
// dejaba la pantalla viva con datos viejos.
let sessionExpiredHandler = null;
export function setSessionExpiredHandler(fn) {
  sessionExpiredHandler = fn;
}

// Bloque 272: el panel del admin se registra acá (ActionCodeProvider) para pedir el código de
// confirmación que el servidor exige en las acciones sensibles. Devuelve el código o null.
let actionCodeHandler = null;
export function setActionCodeHandler(fn) {
  actionCodeHandler = fn;
}

// Bloque 29: cuando una llamada usa responseType:"blob" (descarga de PDF), un
// error del backend (400/500 con {error:"..."} en JSON) también llega como
// Blob en err.response.data — el patrón de siempre (err.response?.data?.error)
// no lo lee, hay que abrir el blob como texto primero. Fuera de ese caso, se
// comporta igual que antes.
export async function getErrorMessage(err, fallback = "Ocurrió un error. Intenta de nuevo.") {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      return parsed.error ?? fallback;
    } catch {
      return fallback;
    }
  }
  return data?.error ?? fallback;
}

// Adjunta el access token guardado y bypass para localtunnel si aplica
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("accessToken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  config.headers["bypass-tunnel-reminder"] = "true";
  return config;
});

// Si el access token expiró, intenta refrescarlo una vez y reintenta la petición
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    // Distingue "esta llamada nunca llevó sesión" (visitante anónimo pegándole
    // a algo que da 401 — normal, no hay ninguna sesión que "expiró") de "esta
    // llamada SÍ llevaba un access token y aun así lo rechazaron" (sesión
    // realmente rota) — solo el segundo caso amerita el cierre forzado.
    const hadAuthHeader = !!original?.headers?.Authorization;
    // Bloque 272: 403 ACTION_CODE_REQUIRED = hace falta el código enviado al correo. Se pide en un
    // modal y la MISMA petición se repite con el código (si es incorrecto vuelve a preguntar).
    if (error.response?.status === 403 && error.response.data?.code === "ACTION_CODE_REQUIRED" && actionCodeHandler) {
      const code = await actionCodeHandler({ action: error.response.data.action, label: error.response.data.label, wrong: !!error.response.data.wrong, totp: !!error.response.data.totp, target: error.response.data.target ?? null });
      if (code) {
        original.headers["X-Action-Code"] = code;
        return api(original);
      }
      error.actionCodeCancelled = true;
      // Cancelar no es un error: se vacía el mensaje para que los avisos del panel no muestren nada.
      error.response.data = { ...error.response.data, error: "" };
    }
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refreshToken = localStorage.getItem("refreshToken");
      if (refreshToken) {
        try {
          const { data } = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
          localStorage.setItem("accessToken", data.accessToken);
          original.headers.Authorization = `Bearer ${data.accessToken}`;
          return api(original);
        } catch {
          localStorage.removeItem("accessToken");
          localStorage.removeItem("refreshToken");
          sessionExpiredHandler?.();
        }
      } else if (hadAuthHeader) {
        localStorage.removeItem("accessToken");
        sessionExpiredHandler?.();
      }
    }
    // Mantenimiento de todo el sitio: no es un corte pasajero ni se repite; se avisa a la aplicación para que muestre el aviso.
    if (error.response?.status === 503 && error.response.data?.code === "MAINTENANCE") {
      window.dispatchEvent(new CustomEvent(MAINTENANCE_EVENT, { detail: { message: error.response.data.error } }));
      return Promise.reject(error);
    }
    // Cortes breves del servidor (reinicio, despliegue, red inestable): las lecturas se reintentan solas hasta 3 veces, con
    // espera creciente, para que la persona no vea un error por algo que se arregla en segundos. Solo GET/HEAD: nunca se
    // repite algo que cambia datos.
    const method = String(original?.method ?? "get").toLowerCase();
    const status = error.response?.status;
    const transient = !error.response || [502, 503, 504].includes(status);
    // El aviso de "se está reiniciando" lo da Nginx cuando la API no estaba disponible: esa petición nunca llegó a la API, así que repetirla
    // es seguro aunque cambie datos (un registro, un pedido); con cualquier otro fallo solo se repiten las lecturas.
    const neverReachedApi = status === 503 && /reinici/i.test(String(error.response?.data?.error ?? ""));
    if (original && transient && (method === "get" || method === "head" || neverReachedApi) && !error.code?.includes("CANCEL") && (original._netRetry ?? 0) < 3) {
      original._netRetry = (original._netRetry ?? 0) + 1;
      await new Promise((r) => setTimeout(r, 700 * original._netRetry ** 2));
      return api(original);
    }
    // Fallo técnico (sin conexión o error del servidor): se recuerda para poder ofrecer el reporte del problema.
    if (isTechnicalFailure(error)) recordApiFailure(error);
    return Promise.reject(error);
  }
);
