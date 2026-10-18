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

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.add(new Request("/index.html", { cache: "reload" })))
      .catch(() => {})
      .then(() => self.skipWaiting())
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
        const res = await fetch(req);
        if (res.ok) caches.open(STATIC).then((c) => c.put(req, res.clone())).catch(() => {});
        return res;
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
