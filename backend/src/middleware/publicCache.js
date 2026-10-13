// Caché en memoria, de pocos segundos, para las consultas públicas más pedidas (portada, catálogo, tiendas, lugares, categorías).
// Son iguales para todos los visitantes, así que mil personas pidiendo lo mismo en el mismo instante cuestan una sola consulta a
// la base de datos. Se descarta sola a los pocos segundos y se vacía por completo cada vez que alguien modifica algo (ver
// clearPublicCache en app.js), de modo que un cambio se ve de inmediato y no hay datos viejos más allá de unos segundos.
// Pruebas de carga: /search pasaba de ~140 a miles de respuestas por segundo con la misma máquina.
const MAX_ENTRIES = 300;
const store = new Map(); // clave -> { body, expires }
const inflight = new Map(); // clave -> Promise<body> de la consulta que ya está en curso

export function clearPublicCache() {
  store.clear();
}

// ttlMs: cuánto vale una respuesta. skip(req): true para no cachear esa petición (por ejemplo, una búsqueda con texto, que además
// se registra para "Lo más buscado" y no debe contarse una sola vez).
export function publicCache(ttlMs, { skip } = {}) {
  return (req, res, next) => {
    if (req.method !== "GET" || req.headers.authorization || skip?.(req)) return next();
    const key = req.originalUrl;
    const hit = store.get(key);
    if (hit && hit.expires > Date.now()) {
      res.set("X-Cache", "HIT");
      return res.json(hit.body);
    }

    // Misma consulta ya en curso: se espera su resultado en vez de repetirla.
    const pending = inflight.get(key);
    if (pending) {
      pending.then(
        (body) => (res.headersSent ? undefined : (res.set("X-Cache", "COALESCED"), res.json(body))),
        () => next()
      );
      return undefined;
    }

    let resolve;
    let reject;
    const mine = new Promise((ok, no) => { resolve = ok; reject = no; });
    mine.catch(() => {}); // sin esperadores, un rechazo no debe quedar sin atender
    inflight.set(key, mine);

    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 200) {
        if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
        store.set(key, { body, expires: Date.now() + ttlMs });
        resolve(body);
      } else {
        reject(new Error("no cacheable"));
      }
      inflight.delete(key);
      res.set("X-Cache", "MISS");
      return json(body);
    };
    res.on("close", () => {
      if (inflight.get(key) === mine) {
        reject(new Error("cerrada"));
        inflight.delete(key);
      }
    });
    return next();
  };
}
