/* Service worker de Baznova (las tres aplicaciones: Marketplace, Tienda y Admin).
 *
 * Qué hace:
 *  - Avisos push: muestra la notificación y, al tocarla, abre la pantalla correspondiente.
 *  - Arranque sin conexión: guarda la aplicación (index.html y los archivos del build, que llevan hash en el nombre) para que el
 *    panel abra aunque no haya internet. Los datos y las ventas sin conexión los maneja la propia aplicación (cola local).
 *
 * Qué NO hace nunca:
 *  - Guardar respuestas de la API (/api): pedidos, precios, stock y datos privados siempre vienen del servidor.
 *  - Servir una versión vieja estando en línea: la página se pide primero a la red y la copia guardada solo se usa sin conexión.
 *
 * Interruptor de emergencia: si el admin apaga la PWA, la aplicación desregistra este service worker y borra su caché.
 */
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const STATIC = `baznova-static-${VERSION}`;
const SHELL = "baznova-shell";
const MEDIA = "baznova-media";
const MEDIA_MAX = 150;

// Primera instalación: se activa enseguida (no hay otro service worker al que reemplazar). Al publicar una versión nueva, en
// cambio, espera: si tomaba el control mientras una página cargaba sus archivos, cortaba esas descargas y la pantalla fallaba
// ("Importing a module script failed" en iPhone). La página le avisa (SKIP_WAITING) cuando terminó de cargar o al pasar a
// segundo plano, segundos después, así que la actualización no se atrasa.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.add(new Request("/index.html", { cache: "reload" })))
      .catch(() => {})
      .then(() => {
        if (!self.registration.active) return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC, SHELL, MEDIA]);
      for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

async function trimMedia() {
  const cache = await caches.open(MEDIA);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MEDIA_MAX; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js" || url.pathname.endsWith(".webmanifest")) return;

  // Navegación: siempre de la red; sin conexión, la última copia de la aplicación.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh.ok && fresh.headers.get("content-type")?.includes("text/html")) {
            const copy = fresh.clone();
            caches.open(SHELL).then((c) => c.put("/index.html", copy)).catch(() => {});
          }
          return fresh;
        } catch {
          return (await caches.match("/index.html", { cacheName: SHELL })) || Response.error();
        }
      })()
    );
    return;
  }

  // Archivos del build (nombre con hash, nunca cambian) y archivos fijos: de la caché si ya están.
  if (/^\/(assets|fonts|pwa|flags)\//.test(url.pathname) || /^\/(logo-loader\.js|opentype\.min\.js|favicon\.(svg|ico))$/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req, { cacheName: STATIC });
        if (cached) return cached;
        try {
          const res = await fetch(req);
          // La copia se saca antes de entregar la respuesta: si se clonaba después, la página ya había leído el cuerpo y en
          // iPhone podía quedar guardado un archivo roto, que fallaba en cada recarga ("Importing a module script failed").
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(STATIC).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        } catch (err) {
          // Si la red falla (por ejemplo, justo al cambiar de versión), cualquier copia guardada del mismo archivo sirve.
          const any = await caches.match(req);
          if (any) return any;
          throw err;
        }
      })()
    );
    return;
  }

  // Fotos de productos y tiendas: se muestran de la red; sin conexión, la última copia (máximo 150).
  if (url.pathname.startsWith("/uploads/") && req.destination === "image") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) caches.open(MEDIA).then((c) => c.put(req, res.clone()).then(trimMedia)).catch(() => {});
          return res;
        } catch {
          return (await caches.match(req, { cacheName: MEDIA })) || Response.error();
        }
      })()
    );
  }
});

// --- Avisos push ---------------------------------------------------------------------------------------------------------

const VENDOR_CATEGORIES = new Set(["orders", "customers", "stock", "reviews", "account"]);
const ADMIN_CATEGORIES = new Set(["vendors", "approvals", "errors"]);

// Las tres aplicaciones (Marketplace, Tienda y Admin) usan el mismo ícono de la plataforma.
const NOTIFICATION_ICON = "/pwa/icon-192.png";


self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Baznova", body: event.data?.text() ?? "" };
  }
  event.waitUntil(
    (async () => {
      // Con la aplicación abierta y a la vista, el aviso ya se muestra dentro de la página (canal en vivo): no se repite.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (windows.some((w) => w.visibilityState === "visible" && w.focused)) return;
      await self.registration.showNotification(data.title || "Baznova", {
        body: data.body || "",
        icon: NOTIFICATION_ICON,
        badge: "/pwa/badge-96.png",
        // Foto del producto (Android la muestra grande al desplegar el aviso; iOS no muestra imágenes en avisos web).
        image: data.image || undefined,
        tag: data.tag || undefined,
        renotify: !!data.tag,
        data: { url: data.url || "/" },
        lang: "es",
        // Los avisos de pedidos (nuevos, atrasados, cambios) vibran y se quedan en pantalla hasta que la tienda los toque:
        // son los que no pueden pasar desapercibidos. El resto se va solo como cualquier aviso del teléfono.
        requireInteraction: data.category === "orders",
        vibrate: data.category === "orders" ? [180, 80, 180] : undefined,
        actions: [{ action: "open", title: data.category === "orders" || data.category === "order_status" ? "Ver pedido" : "Ver" }],
      });
    })()
  );
});

// El navegador puede renovar la suscripción por su cuenta (vence, cambia el servicio de avisos). Sin esto, el servidor seguía
// enviando a la dirección vieja y la tienda dejaba de recibir avisos sin saberlo hasta abrir la app otra vez. Aquí se vuelve a
// suscribir con la misma clave y se le pasa al servidor la dirección vieja (la prueba de que es este dispositivo) y la nueva.
function keyBytes(base64url) {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const oldEndpoint = event.oldSubscription?.endpoint;
      if (!oldEndpoint) return;
      let sub = event.newSubscription;
      if (!sub) {
        let key = event.oldSubscription?.options?.applicationServerKey;
        if (!key) {
          const res = await fetch("/api/push/public-key", { cache: "no-store" });
          const { key: k } = await res.json();
          if (!k) return;
          key = keyBytes(k);
        }
        sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      const json = sub.toJSON();
      await fetch("/api/push/rotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldEndpoint, endpoint: json.endpoint, keys: json.keys }),
      });
    })().catch(() => {})
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Preferir una ventana de la misma aplicación (tienda, admin o sitio) ya abierta.
      const area = (u) => (new URL(u).pathname.startsWith("/admin") ? "admin" : new URL(u).pathname.startsWith("/vendedor") ? "tienda" : "sitio");
      const same = windows.find((w) => area(w.url) === area(target)) || windows[0];
      if (same) {
        await same.focus();
        if ("navigate" in same) return same.navigate(target).catch(() => self.clients.openWindow(target));
        return;
      }
      return self.clients.openWindow(target);
    })()
  );
});
