// Bloque 60: dos identificadores propios de ESTE navegador, ninguno de los
// dos se borra al cerrar sesión (logout()) — son justamente lo que permite
// que un logout/relogin normal no vuelva a pedir el código de verificación,
// mientras que un navegador distinto sí lo pida.
//
// browserId: identifica "este navegador" para que el backend pueda
// garantizar una sola sesión activa por navegador (ver Session.browserId).
// deviceToken: "dispositivo de confianza" — si el backend lo reconoce
// vigente para la cuenta que se está logueando, se salta el código de
// verificación (ver TrustedDevice).

const BROWSER_ID_KEY = "zeudin_browser_id";
const DEVICE_TOKEN_KEY = "zeudin_device_token";

export function getBrowserId() {
  let id = localStorage.getItem(BROWSER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(BROWSER_ID_KEY, id);
  }
  return id;
}

export function getDeviceToken() {
  // Bug real reportado en vivo: localStorage.getItem() devuelve `null`
  // (nunca `undefined`) cuando la clave no existe — todo login fallaba con
  // 400 porque el backend esperaba `deviceToken` ausente (undefined) o un
  // string, nunca null. `?? undefined` evita mandar null en el body del todo.
  return localStorage.getItem(DEVICE_TOKEN_KEY) ?? undefined;
}

export function setDeviceToken(token) {
  if (token) localStorage.setItem(DEVICE_TOKEN_KEY, token);
}
