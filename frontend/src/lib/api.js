import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export const api = axios.create({ baseURL: API_URL });

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

// Adjunta el access token guardado a cada petición
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("accessToken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
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
    return Promise.reject(error);
  }
);
