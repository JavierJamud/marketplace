import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api, setSessionExpiredHandler } from "../lib/api.js";
import { getBrowserId, getDeviceToken, setDeviceToken } from "../lib/deviceId.js";
import { IdleWarningModal } from "../components/IdleWarningModal.jsx";
import { queryClient, queryPersister } from "../lib/queryClient.js";

const AuthContext = createContext(null);

const ACCESS_TOKEN_KEY = "accessToken";
const REFRESH_TOKEN_KEY = "refreshToken";
const LAST_ACTIVITY_KEY = "zeudin_last_activity";

// Bloque 60 (pedido explícito): 30 min sin actividad -> aviso con cuenta
// regresiva de 5 min ("¿sigues ahí?") -> si no hay CLIC en "Sigo aquí" en
// ese tiempo, cierre real. Total: hasta 35 min desde la última actividad.
const IDLE_WARNING_MS = 30 * 60 * 1000;
const IDLE_COUNTDOWN_MS = 5 * 60 * 1000;
const ACTIVITY_EVENTS = ["mousedown", "keydown", "scroll", "touchstart"];
const ACTIVITY_THROTTLE_MS = 15 * 1000; // no escribir en localStorage en cada pixel de scroll

// Bloque 60: un solo lugar para decidir a dónde mandar a alguien que se
// queda sin sesión (logout explícito, inactividad, sincronización entre
// pestañas, refresh fallido) — según en qué panel estaba, NUNCA según qué
// rol tenía (si estaba viendo /vendedor/* como vendedor, vuelve a
// /vendedor/ingresar sin importar qué más sea cierto de la cuenta).
export function loginPathFor(pathname) {
  if (pathname?.startsWith("/vendedor")) return "/vendedor/ingresar";
  if (pathname?.startsWith("/admin")) return "/admin/ingresar";
  return "/";
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [idleWarningActive, setIdleWarningActive] = useState(false);
  const [idleSecondsLeft, setIdleSecondsLeft] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();

  // Los listeners globales (storage, idle interval) se registran una sola
  // vez — leen el pathname/user más reciente por ref en vez de quedar
  // encerrados con el valor del momento en que se registraron.
  const locationRef = useRef(location);
  locationRef.current = location;
  const userRef = useRef(user);
  userRef.current = user;

  const loadMe = useCallback(async () => {
    const token = localStorage.getItem(ACCESS_TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data.user);
    } catch {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  // Limpieza local — nunca borra browserId/deviceToken (eso identifica el
  // navegador/"dispositivo de confianza", sobrevive a un logout normal a
  // propósito, ver deviceId.js).
  const clearLocalSession = useCallback(() => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    // Bug real: si esto no se borra acá, un login posterior hereda la marca
    // de tiempo vieja (de la sesión que recién expiró por inactividad) y el
    // primer tick del intervalo de abajo la lee como "ya pasaron 35 min",
    // cerrando la sesión recién creada casi al instante. Cada login vuelve a
    // sellar su propia marca de todos modos (ver login/verifyTwoFactor/
    // verifyRegistration), pero limpiar acá evita que quede flotando entre
    // el cierre y el próximo login.
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    // Bloque 136 (pedido explícito, junto con el caché persistido nuevo —
    // ver queryClient.js): sin esto, el caché de React Query de la cuenta
    // que se acaba de ir (pedidos, mensajes, datos de "/vendors/me", etc.)
    // se quedaría vivo en memoria Y en localStorage, visible un instante
    // (o filtrado del todo si el próximo login falla/tarda) a la PRÓXIMA
    // cuenta que entre en este mismo navegador. Se limpian los 2: el
    // caché en memoria (queryClient.clear()) y la copia en localStorage
    // (queryPersister.removeClient()).
    queryClient.clear();
    queryPersister.removeClient();
    setUser(null);
    setIdleWarningActive(false);
  }, []);

  // Único punto que de verdad "cierra todo" sin que un componente lo pida a
  // mano — expiración por inactividad, refresh fallido (api.js) y
  // sincronización entre pestañas pasan por acá.
  const forceLogout = useCallback(() => {
    clearLocalSession();
    navigate(loginPathFor(locationRef.current.pathname), { replace: true });
  }, [clearLocalSession, navigate]);

  // api.js no es un componente — no puede navegar ni leer el user actual
  // directo, así que se conecta acá una sola vez.
  useEffect(() => {
    setSessionExpiredHandler(forceLogout);
    return () => setSessionExpiredHandler(null);
  }, [forceLogout]);

  // Bloque 60: si otra pestaña de este mismo navegador borra el accessToken
  // (logout, "cerrar en todos los dispositivos", expiración), esta pestaña
  // se entera vía el evento `storage` (el navegador nunca lo dispara en la
  // MISMA pestaña que hizo el cambio, solo en las demás) y se cierra
  // igual — ninguna debe quedar con la vista de adentro sin datos.
  useEffect(() => {
    function onStorage(e) {
      if (e.key === ACCESS_TOKEN_KEY && !e.newValue && userRef.current) {
        clearLocalSession();
        navigate(loginPathFor(locationRef.current.pathname), { replace: true });
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [clearLocalSession, navigate]);

  // --- Bloque 60: expiración por inactividad (30 min) + aviso de 5 min ----
  useEffect(() => {
    if (!user) return;

    let lastThrottledWrite = 0;
    function markActivity() {
      const now = Date.now();
      if (now - lastThrottledWrite < ACTIVITY_THROTTLE_MS) return;
      lastThrottledWrite = now;
      localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
    }
    // Actividad ambiente (mover el mouse, hacer scroll) solo cuenta MIENTRAS
    // el aviso todavía no se muestra — pedido explícito: una vez que
    // aparece "¿sigues ahí?", solo el clic en ESE botón reinicia el reloj.
    function onActivity() {
      if (!idleWarningActive) markActivity();
    }
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    if (!localStorage.getItem(LAST_ACTIVITY_KEY)) markActivity();

    const interval = setInterval(() => {
      const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY) ?? Date.now());
      const idleFor = Date.now() - last;

      if (idleFor >= IDLE_WARNING_MS + IDLE_COUNTDOWN_MS) {
        forceLogout();
        return;
      }
      if (idleFor >= IDLE_WARNING_MS) {
        setIdleWarningActive(true);
        setIdleSecondsLeft(Math.max(0, Math.round((IDLE_WARNING_MS + IDLE_COUNTDOWN_MS - idleFor) / 1000)));
      } else if (idleWarningActive) {
        setIdleWarningActive(false);
      }
    }, 1000);

    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, onActivity));
      clearInterval(interval);
    };
  }, [user, idleWarningActive, forceLogout]);

  // Botón "Sigo aquí" del aviso — único gesto que reinicia el reloj mientras
  // el aviso está activo.
  const confirmStillHere = useCallback(() => {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    setIdleWarningActive(false);
  }, []);

  // Bloque 76 (pedido explícito, bug real reportado en vivo): `context`
  // ("admin"/"vendor", ausente = /cuenta) le dice al backend qué formulario
  // se usó — así una cuenta admin probando /vendedor/ingresar (o viceversa)
  // se corta ANTES de mandar el código de verificación, en vez de recién
  // después de completarlo (ver auth.controller.js).
  const login = async (email, password, context) => {
    const { data } = await api.post("/auth/login", { email, password, browserId: getBrowserId(), deviceToken: getDeviceToken(), context });
    // Bloque 60: el código de login pasa a ser obligatorio para todos salvo
    // que este navegador ya sea de confianza (ver login() en el backend) —
    // el backend NUNCA emite tokens acá si hace falta, solo avisa que mandó
    // un código. Account.jsx detecta esta forma (sin accessToken) y muestra
    // el paso de "ingresa el código".
    if (data.requiresTwoFactor) return { requiresTwoFactor: true, email: data.email };
    // Bloque 183 (pedido explícito — "el sistema automáticamente detecte
    // que ese usuario no tiene una contraseña válida aún... se le enviará
    // un código"): mismo patrón que requiresTwoFactor de arriba — el
    // backend YA mandó el código de reset en esta misma llamada (reusa
    // forgotPassword/resetPassword, ver login() en auth.controller.js),
    // Account.jsx solo tiene que saltar directo al paso de "ingresa el
    // código" en vez de pedirlo nuevo.
    if (data.requiresPasswordSetup) return { requiresPasswordSetup: true, email: data.email };
    localStorage.setItem(ACCESS_TOKEN_KEY, data.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
    // Toda sesión nueva sella su propia marca de actividad "ahora" — nunca
    // depender de que el bootstrap del efecto de inactividad la escriba
    // (ese solo actúa si la clave no existe para nada, y acá puede existir
    // una vieja de una sesión anterior ya cerrada).
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    setUser(data.user);
    return data.user;
  };

  // Segundo paso del login — mismo resultado final que login() (tokens +
  // user), validando el código de 6 dígitos. Además marca este navegador
  // como de confianza por 30 días (deviceToken) para no volver a pedirlo.
  const verifyTwoFactor = async (email, code, context) => {
    const { data } = await api.post("/auth/2fa/verify", { email, code, browserId: getBrowserId(), context });
    localStorage.setItem(ACCESS_TOKEN_KEY, data.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    setDeviceToken(data.deviceToken);
    setUser(data.user);
    return data.user;
  };

  // Bloque 59: el registro ya NUNCA crea la cuenta ni emite tokens acá — el
  // backend manda un código de 6 dígitos al correo y solo avisa que lo
  // mandó. Account.jsx detecta `requiresVerification` (misma forma que
  // `requiresTwoFactor` en login()) y muestra el paso de "ingresa el código".
  const register = async (payload) => {
    const { data } = await api.post("/auth/register", payload);
    return { requiresVerification: true, email: data.email };
  };

  // Segundo paso del registro — recién acá se crea la cuenta de verdad y se
  // emiten tokens (mismo resultado final que verifyTwoFactor arriba, pero
  // validando el código de confirmación de correo). También marca este
  // navegador como de confianza (ya probó ser dueño del correo, no hace
  // falta pedirle un segundo código de login apenas después). `linkedOrdersCount`
  // le avisa a Account.jsx si había pedidos de invitado con este mismo
  // correo que ya quedaron vinculados a la cuenta recién creada.
  const verifyRegistration = async (email, code) => {
    const { data } = await api.post("/auth/verify-registration", { email, code, browserId: getBrowserId() });
    localStorage.setItem(ACCESS_TOKEN_KEY, data.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    setDeviceToken(data.deviceToken);
    setUser(data.user);
    return { user: data.user, linkedOrdersCount: data.linkedOrdersCount ?? 0 };
  };

  // Bloque 60: ahora async — avisa al backend para revocar la sesión de
  // verdad (best-effort, nunca bloquea si falla la llamada) en vez de solo
  // borrar el token del lado del cliente y dejarlo igual de válido en el
  // servidor. Nunca toca browserId/deviceToken — eso es "recordar este
  // dispositivo", sobrevive a un logout normal a propósito.
  const logout = async () => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (refreshToken) {
      try {
        await api.post("/auth/logout", { refreshToken });
      } catch {
        // best-effort — igual se limpia todo del lado del cliente.
      }
    }
    clearLocalSession();
  };

  // "Cerrar sesión en todos los dispositivos" (VendorProfile.jsx) — revoca
  // TODAS las sesiones del usuario y borra todos sus dispositivos de
  // confianza del lado del servidor; esta pestaña es uno de esos
  // dispositivos, así que también se limpia acá.
  const logoutAllDevices = async () => {
    await api.post("/auth/logout-all");
    clearLocalSession();
  };

  // El JWT lleva el role "horneado" al firmarlo (ver middleware/auth.js:
  // requireRole nunca vuelve a mirar la DB) — un usuario que se acaba de
  // convertir en vendedor (createVendor sube su role a VENDOR en la DB)
  // sigue teniendo un accessToken viejo con role CUSTOMER hasta que se
  // reemite. Sin este paso, /vendedor/* devuelve 403 hasta el próximo login.
  const refreshRole = async () => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return;
    const { data } = await api.post("/auth/refresh", { refreshToken });
    localStorage.setItem(ACCESS_TOKEN_KEY, data.accessToken);
    await loadMe();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        verifyTwoFactor,
        register,
        verifyRegistration,
        logout,
        logoutAllDevices,
        // Bloque 71: expuesto para ChangeEmailModal.jsx — confirmar el
        // cambio de correo ya revoca la sesión del lado del servidor (ver
        // confirmMyEmailChange en auth.controller.js), así que acá solo
        // hace falta limpiar el lado del cliente, sin otra llamada HTTP
        // (llamar a logoutAllDevices() de nuevo pegaría contra un endpoint
        // `authenticate` con una sesión que ya quedó revocada, 401 antes de
        // poder limpiar nada).
        clearLocalSession,
        refreshRole,
        refetch: loadMe,
      }}
    >
      {children}
      {idleWarningActive && <IdleWarningModal secondsLeft={idleSecondsLeft} onConfirm={confirmStillHere} />}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
