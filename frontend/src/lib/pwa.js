import { api } from "./api.js";

// PWA de Baznova: tres aplicaciones instalables sobre el mismo sitio.
//  - Marketplace (clientes), Tienda (vendedores y su personal) y Admin.
// Este módulo registra el service worker (o lo quita si el admin apagó la PWA), cambia el manifiesto según la zona del sitio,
// guarda el aviso de instalación del navegador y maneja la suscripción a los avisos push.

export const APPS = {
  cliente: { key: "cliente", name: "Baznova Marketplace", push: "CLIENT", manifest: "/manifest-cliente.webmanifest", icon: "/pwa/icon-192.png", apple: "/pwa/apple-touch-icon.png", title: "Baznova" },
  tienda: { key: "tienda", name: "Baznova Tienda", push: "VENDOR", manifest: "/manifest-tienda.webmanifest", icon: "/pwa/icon-192.png", apple: "/pwa/apple-touch-icon.png", title: "Baznova Tienda" },
  admin: { key: "admin", name: "Baznova Admin", push: "ADMIN", manifest: "/manifest-admin.webmanifest", icon: "/pwa/icon-192.png", apple: "/pwa/apple-touch-icon.png", title: "Baznova Admin" },
};

export function appForPath(pathname) {
  if (/^\/admin(\/|$)/.test(pathname)) return APPS.admin;
  if (/^\/vendedor(\/|$)/.test(pathname)) return APPS.tienda;
  return APPS.cliente;
}

// El navegador lee el manifiesto que está en la página; al pasar del sitio al panel (sin recargar) se cambia aquí.
export function applyManifest(app) {
  const link = document.getElementById("app-manifest");
  if (link && !link.href.endsWith(app.manifest)) link.href = app.manifest;
  const title = document.getElementById("app-apple-title");
  if (title) title.content = app.title;
  const icon = document.querySelector('link[rel="apple-touch-icon"]');
  if (icon) icon.setAttribute("href", app.apple);
}

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
// Si la aplicación ya se instaló en este dispositivo. El navegador no lo dice desde una pestaña normal, así que se recuerda al
// instalarla (evento appinstalled) y cada vez que se abre instalada; la app instalada y el navegador comparten este almacenamiento.
const INSTALLED_KEY = "pwa-installed";
export function markInstalled() {
  try {
    localStorage.setItem(INSTALLED_KEY, "1");
  } catch {
    /* sin almacenamiento: se vuelve a comprobar en la próxima visita */
  }
}
export function wasInstalled() {
  if (isStandalone()) {
    markInstalled();
    return true;
  }
  try {
    return localStorage.getItem(INSTALLED_KEY) === "1";
  } catch {
    return false;
  }
}
// --- ¿Está instalada? -----------------------------------------------------------------------------------------------------
// Ningún navegador lo dice con certeza desde una pestaña normal, así que se combinan varias señales, de la más segura a la menos:
//  1. Estar abierta como app (standalone).
//  2. getInstalledRelatedApps (Chrome y Edge en Android y computadora): pregunta al sistema si esta app web está instalada.
//  3. La marca que deja la app al abrirse; en Android y computadora la app y el navegador comparten este almacenamiento.
//  4. El servidor: cada app instalada avisa al abrirse con un identificador propio del dispositivo (installId). En iPhone es la
//     única señal posible, porque Safari y la app instalada no comparten datos. Si no se abre en 30 días, se toma como borrada.
// Si ninguna señal dice "instalada", se ofrece instalar. Instalar de nuevo una app que ya estaba no la duplica en Android ni
// en computadora: el manifiesto tiene un `id` fijo y el navegador la reconoce como la misma (se actualiza).
// IDENTITY_VERSION sube cuando cambian el nombre o los íconos (mismo número en appInstalls.controller.js).
export const IDENTITY_VERSION = 2;
const INSTALL_ID_KEY = "pwa-install-id";
const IDENTITY_KEY = "pwa-identity-version";

export function devicePlatform() {
  if (isIos()) return "ios";
  if (/android/i.test(navigator.userAgent)) return "android";
  return "desktop";
}

export function installId() {
  try {
    let id = localStorage.getItem(INSTALL_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(INSTALL_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

function clearInstalled() {
  try {
    localStorage.removeItem(INSTALLED_KEY);
  } catch {
    /* sin almacenamiento */
  }
}

// Desde la app instalada: avisa al servidor que sigue instalada (y de quién es, si hay sesión). Devuelve true si el nombre o
// los íconos cambiaron desde la última vez que se abrió (para mostrar la novedad una sola vez).
export async function pingInstalledApp(app) {
  if (!isStandalone()) return false;
  markInstalled();
  const id = installId();
  let seen = 0;
  try {
    seen = Number(localStorage.getItem(IDENTITY_KEY) || 0);
    localStorage.setItem(IDENTITY_KEY, String(IDENTITY_VERSION));
  } catch {
    /* sin almacenamiento */
  }
  if (id) await api.post("/push/installs", { installId: id, app: app.push, platform: devicePlatform(), identityVersion: IDENTITY_VERSION }).catch(() => {});
  return seen > 0 && seen < IDENTITY_VERSION;
}

// Desde el navegador: ¿esta persona ya tiene esta app en este tipo de dispositivo? Devuelve { installed, source }.
export async function detectInstalled(app, { loggedIn = false } = {}) {
  if (isStandalone()) return { installed: true, source: "standalone" };
  if (navigator.getInstalledRelatedApps) {
    try {
      const related = await navigator.getInstalledRelatedApps();
      if (related.some((r) => r.platform === "webapp")) {
        markInstalled();
        return { installed: true, source: "system" };
      }
      // En Chrome de Android la respuesta es confiable: si la marca dice "instalada" pero el sistema no la ve, la borraron.
      if (devicePlatform() === "android") {
        clearInstalled();
        return { installed: false, source: "system" };
      }
    } catch {
      /* el navegador no responde: se sigue con las demás señales */
    }
  }
  if (wasInstalled()) return { installed: true, source: "local" };
  if (loggedIn) {
    try {
      const { data } = await api.get("/push/installs/status", { params: { app: app.push, platform: devicePlatform() } });
      if (data.installed) return { installed: true, source: "server" };
    } catch {
      /* sin conexión: se ofrece instalar */
    }
  }
  return { installed: false, source: null };
}

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// --- Aviso de instalación del navegador (Chrome, Edge, Samsung Internet) ----------------------------------------------------
let deferredPrompt = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(deferredPrompt));

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    markInstalled();
    deferredPrompt = null;
    emit();
  });
}

export function onInstallAvailability(fn) {
  listeners.add(fn);
  fn(deferredPrompt);
  return () => listeners.delete(fn);
}

// Chrome avisa que la app se puede instalar unos segundos después de abrir la página. Si la persona toca "Instalar" antes,
// se espera un poco a ese aviso en vez de mostrarle los pasos manuales enseguida.
export function waitForInstallPrompt(ms = 3000) {
  if (deferredPrompt) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      listeners.delete(check);
      resolve(false);
    }, ms);
    function check(p) {
      if (!p) return;
      clearTimeout(timer);
      listeners.delete(check);
      resolve(true);
    }
    listeners.add(check);
  });
}

export async function promptInstall() {
  if (!deferredPrompt) return "unavailable";
  const prompt = deferredPrompt;
  deferredPrompt = null;
  emit();
  await prompt.prompt();
  const choice = await prompt.userChoice.catch(() => ({ outcome: "dismissed" }));
  return choice?.outcome ?? "dismissed";
}

// --- Service worker ------------------------------------------------------------------------------------------------------
let registration = null;

export async function syncServiceWorker(enabled) {
  if (!("serviceWorker" in navigator)) return null;
  if (!enabled) {
    // Interruptor de emergencia: se quita el service worker y todo lo que guardó.
    const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
    if (window.caches) for (const key of await caches.keys()) if (key.startsWith("baznova-")) await caches.delete(key);
    registration = null;
    return null;
  }
  // En desarrollo (vite) no se registra: el servidor de desarrollo sirve archivos sin hash y la caché confundiría.
  if (import.meta.env.DEV && !localStorage.getItem("pwa-dev")) return null;
  try {
    registration = await navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(__APP_BUILD__)}`, { scope: "/" });
    return registration;
  } catch {
    return null;
  }
}

// navigator.serviceWorker.ready no termina nunca si no hay service worker (PWA apagada o servidor de desarrollo): se espera
// como mucho 8 segundos para que el botón "Activar avisos" no se quede cargando para siempre.
async function readyRegistration() {
  if (registration) return registration;
  if (!("serviceWorker" in navigator)) return null;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 8000));
  return Promise.race([navigator.serviceWorker.ready.catch(() => null), timeout]);
}

const urlB64ToUint8 = (base64) => {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

// --- Avisos push ----------------------------------------------------------------------------------------------------------
export function pushPermission() {
  return pushSupported() ? Notification.permission : "unsupported";
}

// Pide permiso (si hace falta) y registra este dispositivo para la persona con sesión. Devuelve "granted", "denied" o "unsupported".
export async function enablePush(app) {
  if (!pushSupported()) return "unsupported";
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return permission;
  const reg = await readyRegistration();
  if (!reg) return "unsupported";
  const { data } = await api.get("/push/public-key");
  if (!data?.enabled) return "unsupported";
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(data.key) });
  await api.post("/push/subscribe", { ...sub.toJSON(), app: app.push });
  return "granted";
}

// Al entrar con sesión: si este dispositivo ya dio permiso, se vuelve a asociar a la persona que entró (puede ser otra).
export async function resyncPush(app) {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const reg = await readyRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await api.post("/push/subscribe", { ...sub.toJSON(), app: app.push }).catch(() => {});
}

// Al cerrar sesión: este dispositivo deja de recibir los avisos de esa persona.
export async function detachPush() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await api.post("/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
}

export async function disablePush() {
  await detachPush();
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => null);
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe().catch(() => {});
}

export async function hasPushSubscription() {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
  return !!(await reg?.pushManager.getSubscription());
}
