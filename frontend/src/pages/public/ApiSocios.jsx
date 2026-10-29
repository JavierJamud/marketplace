import { useMemo, useState } from "react";
import { Copy, Play, KeyRound, Globe, Gauge, Store, ShoppingCart, Wallet, Activity, ShieldCheck, Layers, AlertTriangle, RefreshCw } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { copyToClipboard } from "../../lib/clipboard.js";
import { generateId } from "../../lib/uuid.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";

// Documentación pública de la API de socios, con una consola para probar las llamadas con la
// propia credencial. La credencial solo vive en memoria de esta pestaña.

const BASE = (() => {
  const b = String(api.defaults.baseURL ?? "").replace(/\/$/, "");
  return `${new URL(b || "/", window.location.origin).href.replace(/\/$/, "")}/partner/v1`;
})();

// Los textos nombran la plataforma con su nombre configurado en el admin (siteName), no con uno fijo: por eso es una función.
const getEndpoints = (site) => [
  { id: "me", scope: "Siempre", method: "GET", path: "/me", title: "Mi credencial", desc: "Permisos, límites y cuánto queda de cuota, más el enlace de registro de tiendas.", params: [] },
  { id: "products", scope: "products:read", method: "GET", path: "/products", title: "Productos", desc: `Lista con filtros. Solo trae productos con stock. Por defecto va ordenada por el ranking real de ${site}.`,
    // payment filtra por los códigos de paymentMethods de cada producto (buildProductWhere en partnerApi.controller.js).
    // inStock no se lista aquí: este listado ya excluye los agotados y el filtro no cambiaría nada; sí sirve en /stores/{slug}/products.
    params: [["q", "Texto a buscar"], ["categoryId", "Categoría (incluye subcategorías)"], ["storeSlug", "Solo una tienda"], ["provinceId", "Provincia"], ["municipalityId", "Municipio"], ["minPrice", "Precio mínimo"], ["maxPrice", "Precio máximo"], ["currency", "CUP o USD"], ["payment", "Formas de pago separadas por coma (códigos de paymentMethods)"], ["onlyVerified", "true: solo tiendas verificadas"], ["sort", "relevance, newest, price-asc, price-desc, rating"], ["page", "Página (1)"], ["pageSize", "Por página (20, máx. 50)"]] },
  { id: "featured", scope: "ranking:read", method: "GET", path: "/products/featured", title: "Destacados", desc: "Los mejor posicionados según ventas, clics, reseñas y calidad del contenido.", params: [["limit", "Cantidad (12, máx. 50)"], ["categoryId", "Categoría"], ["storeSlug", "Tienda"]] },
  { id: "product", scope: "products:read", method: "GET", path: "/products/{id}", title: "Detalle de producto", desc: "Un producto con precios por cantidad, fotos y datos de su tienda.", path_params: ["id"], params: [] },
  { id: "product-reviews", scope: "reviews:read", method: "GET", path: "/products/{id}/reviews", title: "Reseñas de un producto", desc: "Solo reseñas visibles.", path_params: ["id"], params: [["page", "Página"], ["pageSize", "Por página"]] },
  { id: "stores", scope: "stores:read", method: "GET", path: "/stores", title: "Tiendas", desc: "Tiendas activas con productos publicados.", params: [["q", "Nombre"], ["provinceId", "Provincia"], ["municipalityId", "Municipio"], ["businessCategoryId", "Tipo de negocio"], ["onlyVerified", "true"], ["isRestaurant", "true o false"], ["page", "Página"], ["pageSize", "Por página"]] },
  { id: "store", scope: "stores:read", method: "GET", path: "/stores/{slug}", title: "Detalle de tienda", desc: "Datos públicos, ubicación y si está abierta ahora.", path_params: ["slug"], params: [] },
  { id: "store-products", scope: "stores:read + products:read", method: "GET", path: "/stores/{slug}/products", title: "Productos de una tienda", desc: "Acepta los mismos filtros que /products. A diferencia de /products, también trae los agotados; con inStock=true se quitan.", path_params: ["slug"], params: [["q", "Texto"], ["inStock", "true: sin los agotados"], ["payment", "Formas de pago separadas por coma"], ["sort", "Orden"], ["page", "Página"], ["pageSize", "Por página"]] },
  { id: "store-reviews", scope: "reviews:read", method: "GET", path: "/stores/{slug}/reviews", title: "Reseñas de una tienda", desc: "Reseñas visibles de la tienda.", path_params: ["slug"], params: [["page", "Página"], ["pageSize", "Por página"]] },
  { id: "store-offers", scope: "store-offers:read", method: "GET", path: "/stores/{slug}/offers", title: "Ofertas de una tienda", desc: "Ofertas vigentes y su código de descuento público.", path_params: ["slug"], params: [] },
  { id: "offers", scope: "offers:read", method: "GET", path: "/offers", title: "Ofertas del sitio", desc: `Ofertas activas publicadas por ${site}.`, params: [] },
  { id: "categories", scope: "catalog:read", method: "GET", path: "/categories", title: "Categorías", desc: "Categorías y subcategorías de productos.", params: [] },
  { id: "business-categories", scope: "catalog:read", method: "GET", path: "/business-categories", title: "Tipos de negocio", desc: "Tipos de tienda disponibles.", params: [] },
  { id: "provinces", scope: "catalog:read", method: "GET", path: "/locations/provinces", title: "Provincias", desc: "Provincias y estados activos.", params: [] },
  { id: "municipalities", scope: "catalog:read", method: "GET", path: "/locations/municipalities", title: "Municipios y ciudades", desc: "Municipios de una provincia de Cuba o ciudades de un estado de otro país. En un pedido van en shippingMunicipalityId; en un estado, si la ciudad no está en la lista, puede enviarse escrita en shippingCity.", params: [["provinceId", "Obligatorio"]] },
  { id: "cart", scope: "cart:validate", method: "POST", path: "/cart/validate", title: "Validar carrito", desc: "Revisa precios vigentes, stock y totales por tienda y moneda. Un carrito con productos de más de una tienda es inválido (multiple_stores). No guarda nada.", params: [],
    body: '{\n  "items": [\n    { "productId": "ID_DEL_PRODUCTO", "quantity": 2 }\n  ]\n}' },
  { id: "checkout", scope: "cart:validate", method: "GET", path: "/stores/{slug}/checkout", title: "Requisitos del pedido", desc: "Campos del formulario, métodos de pago, provincias donde entrega la tienda, si está abierta y a dónde llega el pedido (panel, WhatsApp o ambos). También trae acceptsOrders: si es false, la tienda no está recibiendo pedidos y reason y reasonCode dicen por qué (reasonCode es el mismo code del 409 de POST /orders).", path_params: ["slug"], params: [] },
  { id: "order-create", scope: "orders:create", method: "POST", path: "/orders", title: "Crear pedido", desc: `Crea un pedido real con las mismas reglas que el checkout de ${site}: llega al panel del vendedor y la respuesta trae el enlace de WhatsApp con el mensaje. Exige la cabecera Idempotency-Key.`, params: [],
    body: '{\n  "storeSlug": "SLUG_DE_LA_TIENDA",\n  "channel": "cod",\n  "customerName": "Nombre Apellido",\n  "customerPhone": "+5355512345",\n  "customerEmail": "cliente@correo.com",\n  "shippingProvinceId": "ID_PROVINCIA",\n  "shippingMunicipalityId": "ID_MUNICIPIO",\n  "shippingAddress": "Calle y número",\n  "items": [{ "productId": "ID_DEL_PRODUCTO", "quantity": 1 }]\n}' },
  { id: "order-get", scope: "orders:create", method: "GET", path: "/orders/{code}", title: "Estado de un pedido", desc: "Estado de un pedido creado con tu credencial.", path_params: ["code"], params: [] },
  { id: "plans", scope: "plans:read", method: "GET", path: "/plans", title: "Planes y precios", desc: `Planes de ${site} con el precio base y tu precio final por mes. Cada plan trae includes (lo que incluye), isFree, contactOnly (se contrata hablando con el equipo y no tiene precio que ajustar), listPrice (precio tachado) y monthDiscounts (descuentos por pagar varios meses). features trae lo mismo que includes, por compatibilidad.`, params: [] },
];

const CODE = "overflow-x-auto rounded-xl bg-[#0f172a] p-4 text-[12.5px] leading-relaxed text-[#e2e8f0]";
const BTN = "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-semibold transition disabled:opacity-50";
const INPUT = "min-h-[44px] w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[14px] text-on-surface outline-none focus:border-primary";

function Code({ children }) {
  return (
    <div className="relative">
      <pre className={CODE}>{children}</pre>
      <button
        aria-label="Copiar código"
        onClick={async () => ((await copyToClipboard(children)) ? toast.success("Copiado.") : toast.error("No se pudo copiar."))}
        className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-lg text-[#94a3b8] hover:bg-white/10"
      >
        <Copy className="h-4 w-4" />
      </button>
    </div>
  );
}

function Section({ id, title, children }) {
  return (
    <section id={id} className="mb-10 scroll-mt-24">
      <h2 className="mb-3 font-display text-[22px] font-extrabold text-on-surface">{title}</h2>
      <div className="space-y-3 text-[14px] leading-relaxed text-on-surface-variant">{children}</div>
    </section>
  );
}

// Respuestas de error de la API de socios, sacadas de partnerAuth.js, partnerApi.routes.js y partnerOrders.controller.js.
// Las de la credencial y del cuerpo traen el código en `code`; las de los controladores, en `details.code`.
const ERRORS = [
  ["400", "invalid_json, idempotency_key_required", "El cuerpo no es un JSON válido, falta la cabecera Idempotency-Key o un dato del pedido no es válido. El campo error de la respuesta dice cuál."],
  ["401", "missing_key, invalid_key, revoked_key, expired_key", "Falta la credencial o no es válida."],
  ["403", "origin_not_allowed, scope_missing, partner_suspended", "Sitio o IP no autorizados, la credencial no tiene ese permiso o la cuenta de socio está suspendida."],
  ["404", "not_found", "El recurso no existe o no está disponible."],
  ["409", "idempotency_key_reused, VENDOR_BILLING_OVERDUE", "La Idempotency-Key ya se usó con otro pedido, la tienda no está recibiendo pedidos o algún producto no tiene stock suficiente (la lista va en details.insufficientStock)."],
  ["413", "body_too_large", "El cuerpo pasa de 100 KB."],
  ["429", "rate_limit, daily_limit, too_many_invalid_keys, order_rate_limit", "Demasiadas solicitudes, demasiados intentos con credenciales no válidas o más de 60 pedidos en 5 minutos."],
];

// Misma regla que partnerOrders.controller.js (IDEMPOTENCY): 8 a 64 letras, números, guion o guion bajo.
const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const newIdemKey = () => generateId().replace(/-/g, "");

function Console({ endpoints }) {
  const [key, setKey] = useState("");
  const [epId, setEpId] = useState("products");
  const ep = endpoints.find((e) => e.id === epId);
  const [vals, setVals] = useState({});
  // Un cuerpo por recurso: con uno solo compartido, "Crear pedido" mandaba el JSON del carrito y siempre volvía 400.
  const [bodies, setBodies] = useState({});
  const body = bodies[ep.id] ?? ep.body ?? "";
  // POST /orders exige Idempotency-Key. Repetir la misma clave con el mismo pedido devuelve ese pedido sin duplicarlo;
  // para probar otro pedido hay que generar una clave nueva.
  const [idemKey, setIdemKey] = useState(newIdemKey);
  const isOrder = ep.id === "order-create";
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);

  const url = useMemo(() => {
    let path = ep.path;
    for (const p of ep.path_params ?? []) path = path.replace(`{${p}}`, encodeURIComponent(vals[`path:${p}`] ?? `{${p}}`));
    const qs = new URLSearchParams();
    for (const [name] of ep.params) if (vals[name]) qs.set(name, vals[name]);
    const q = qs.toString();
    return `${BASE}${path}${q ? `?${q}` : ""}`;
  }, [ep, vals]);

  async function send() {
    if (!key.trim()) return toast.error("Pega tu credencial.");
    if (isOrder && !IDEMPOTENCY_RE.test(idemKey.trim())) return toast.error("La Idempotency-Key debe tener de 8 a 64 caracteres: letras, números, guion o guion bajo.");
    setBusy(true);
    setRes(null);
    const started = performance.now();
    try {
      const r = await fetch(url, {
        method: ep.method,
        headers: {
          Authorization: `Bearer ${key.trim()}`,
          ...(ep.method === "POST" ? { "Content-Type": "application/json" } : {}),
          ...(isOrder ? { "Idempotency-Key": idemKey.trim() } : {}),
        },
        body: ep.method === "POST" ? body : undefined,
      });
      const text = await r.text();
      let pretty = text;
      let parsed = null;
      try { parsed = JSON.parse(text); pretty = JSON.stringify(parsed, null, 2); } catch { /* texto plano */ }
      // La clave no se cambia sola después de un 201: si se cambiara, pulsar Probar dos veces crearía dos pedidos reales,
      // justo lo que la Idempotency-Key evita. En cambio, si el socio editó el cuerpo y reusó la clave, se lo decimos aquí.
      const reused = isOrder && r.status === 409 && parsed?.details?.code === "idempotency_key_reused";
      setRes({
        hint: reused ? "Esta clave ya creó un pedido con otro cuerpo. Pulsa Nueva para probar un pedido distinto." : null,
        status: r.status,
        ms: Math.round(performance.now() - started),
        limits: ["x-ratelimit-remaining", "x-ratelimit-limit", "x-dailylimit-remaining", "retry-after"].map((h) => [h, r.headers.get(h)]).filter(([, v]) => v !== null),
        body: pretty.length > 20000 ? `${pretty.slice(0, 20000)}\n… (recortado)` : pretty,
      });
    } catch {
      setRes({ status: 0, ms: 0, limits: [], body: "No se pudo conectar con la API." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4">
      <div>
        <label htmlFor="console-key" className="mb-1 block text-[12px] font-bold text-on-surface-variant">Tu credencial</label>
        <input id="console-key" className={`${INPUT} font-mono`} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="bzp_key_..." />
        <p className="mt-1 text-[11.5px] text-outline">Solo se usa en esta pestaña y no se guarda. Las llamadas de esta consola salen de tu navegador, así que tu dominio o IP deben estar autorizados.</p>
      </div>
      <div>
        <label className="mb-1 block text-[12px] font-bold text-on-surface-variant">Recurso</label>
        <select className={INPUT} value={epId} onChange={(e) => { setEpId(e.target.value); setRes(null); }}>
          {endpoints.map((e) => <option key={e.id} value={e.id}>{e.method} {e.path}</option>)}
        </select>
      </div>
      {(ep.path_params ?? []).map((p) => (
        <div key={p}><label className="mb-1 block text-[12px] font-bold text-on-surface-variant">{p}</label><input className={INPUT} value={vals[`path:${p}`] ?? ""} onChange={(e) => setVals({ ...vals, [`path:${p}`]: e.target.value })} /></div>
      ))}
      {ep.params.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {ep.params.map(([name, hint]) => (
            <div key={name}><label className="mb-1 block text-[12px] font-bold text-on-surface-variant">{name}</label><input className={INPUT} placeholder={hint} value={vals[name] ?? ""} onChange={(e) => setVals({ ...vals, [name]: e.target.value })} /></div>
          ))}
        </div>
      )}
      {ep.method === "POST" && (
        <div><label className="mb-1 block text-[12px] font-bold text-on-surface-variant">Cuerpo (JSON)</label><textarea className={`${INPUT} py-2 font-mono text-[12.5px]`} rows={6} value={body} onChange={(e) => setBodies({ ...bodies, [ep.id]: e.target.value })} /></div>
      )}
      {isOrder && (
        <div>
          <label htmlFor="console-idem" className="mb-1 block text-[12px] font-bold text-on-surface-variant">Idempotency-Key</label>
          <div className="flex gap-2">
            <input id="console-idem" className={`${INPUT} min-w-0 flex-1 font-mono`} autoComplete="off" spellCheck={false} value={idemKey} onChange={(e) => setIdemKey(e.target.value)} />
            <button type="button" onClick={() => setIdemKey(newIdemKey())} className={`${BTN} flex-shrink-0 border border-outline-variant text-on-surface hover:bg-surface-container`}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Nueva
            </button>
          </div>
          <p className="mt-1 text-[11.5px] text-outline">Con la misma clave y el mismo pedido recibes el pedido ya creado, sin duplicarlo. Para probar otro pedido, pulsa Nueva.</p>
        </div>
      )}
      <p className="break-all rounded-lg bg-surface-container px-3 py-2 font-mono text-[12px] text-on-surface">{ep.method} {url}</p>
      {isOrder && (
        <p role="note" className="flex items-start gap-2 rounded-xl border border-error/30 bg-error/5 px-3 py-2 text-[12.5px] text-on-surface">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-error" aria-hidden="true" />
          Esto crea un pedido real en la tienda: le llega al vendedor como cualquier otro pedido.
        </p>
      )}
      <button onClick={send} disabled={busy} className={`${BTN} bg-primary text-white hover:bg-primary/90`}><Play className="h-4 w-4" /> {busy ? "Enviando..." : "Probar"}</button>
      {res && (
        <div>
          <p className="mb-1 text-[12.5px]">
            <b className={res.status >= 200 && res.status < 300 ? "text-verified-dark" : "text-error"}>{res.status || "Error"}</b>
            <span className="text-outline"> · {res.ms} ms{res.limits.map(([h, v]) => ` · ${h}: ${v}`).join("")}</span>
          </p>
          {res.hint && <p role="status" className="mb-2 rounded-lg bg-error/5 px-3 py-2 text-[12.5px] text-on-surface">{res.hint}</p>}
          <pre className={`${CODE} max-h-[420px]`}>{res.body}</pre>
        </div>
      )}
    </div>
  );
}

export default function ApiSocios() {
  const { siteName } = usePlatformSettings();
  const endpoints = useMemo(() => getEndpoints(siteName), [siteName]);
  return (
    <div className="mx-auto max-w-[900px] px-4 py-10">
      <header className="mb-8">
        <h1 className="mb-2 font-display text-[32px] font-extrabold tracking-tight text-on-surface">API para socios</h1>
        <p className="mb-5 max-w-[640px] text-[15px] text-on-surface-variant">
          Conecta tu sitio con {siteName}: muestra sus productos y tiendas, arma el carrito y recibe pedidos reales, con las mismas reglas que el sitio original. Esta página explica qué hace la API, cómo se usa y cómo conseguir tu credencial.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <a href="/socios/solicitar" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-5 text-[14px] font-semibold text-white hover:bg-primary/90">Solicitar acceso a la API</a>
          <a href="/socio/ingresar" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-outline-variant px-5 text-[14px] font-semibold text-on-surface hover:bg-surface-container">Ya tengo una credencial: entrar a mi panel</a>
        </div>
      </header>

      <Section id="ventajas" title="Por qué integrarla a tu negocio">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            [Store, `El mismo catálogo que ${siteName}`, "Productos, tiendas, reseñas y calificaciones salen del mismo catálogo y con el mismo ranking real, siempre al día. No copias datos: los consultas."],
            [ShoppingCart, "Pedidos reales, no simulados", `Un pedido hecho desde tu sitio le llega al vendedor en su panel y por WhatsApp, igual que uno hecho en ${siteName}, con las mismas reglas de stock, tallas, descuentos y cobertura.`],
            [KeyRound, "Una sola credencial", `Con una credencial usas productos, tiendas, carrito, pedidos y planes. Los servicios a los que tiene acceso los define ${siteName} al aprobarte.`],
            [ShieldCheck, "Control sobre tu acceso", `Tu credencial solo funciona desde los sitios que registraste y tiene límites por minuto y por día. Solo ${siteName} puede regenerarla.`],
            [Wallet, "Tus propios precios de plan", `Ves los planes de ${siteName}, les sumas tu extra (nunca por debajo del precio base) y consultas tu ganancia estimada en tu panel.`],
            [Activity, "Un panel con tus métricas", "Solicitudes por día, errores, tiempos de respuesta, cuota usada y movimientos recientes de tu credencial."],
            [Layers, "Tiendas con tu enlace", "Las tiendas que se registran con tu enlace de socio quedan asociadas a ti."],
          ].map(([Icon, title, text]) => (
            <div key={title} className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4">
              <Icon className="mb-2 h-5 w-5 text-primary" aria-hidden="true" />
              <p className="text-[14px] font-bold text-on-surface">{title}</p>
              <p className="text-[13px] text-on-surface-variant">{text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="pasos" title="Cómo empezar">
        <div className="grid gap-3 sm:grid-cols-3">
          {[[KeyRound, "1. Pide tu credencial", "Envías una solicitud con tus datos y los sitios desde los que usarás la API (hasta dos). Un administrador la revisa."], [Globe, "2. Recibe tu acceso", "Si la aprueba, te llega la credencial por correo y entras a tu panel de socio con la contraseña que elegiste."], [Gauge, "3. Conecta tu sitio", "Envía la credencial en cada solicitud y usa los datos en tu sitio. Abajo está todo lo que puedes pedir."]].map(([Icon, t, d]) => (
            <div key={t} className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4">
              <Icon className="mb-2 h-5 w-5 text-primary" aria-hidden="true" />
              <p className="text-[14px] font-bold text-on-surface">{t}</p>
              <p className="text-[12.5px] text-on-surface-variant">{d}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="inicio" title="Empezar">
        <p>Dirección base de la API:</p>
        <Code>{BASE}</Code>
        <p>Envía tu credencial en el encabezado <code>Authorization</code> (o en <code>X-Api-Key</code>). Todas las respuestas son JSON con la forma <code>{"{ data, meta }"}</code>.</p>
        <Code>{`curl "${BASE}/products?pageSize=5" \\\n  -H "Authorization: Bearer TU_CREDENCIAL"`}</Code>
      </Section>

      <Section id="llaves" title="Tu credencial">
        <p>Cada socio tiene <b>una sola credencial</b>, que empieza con <code>bzp_key_</code>. Con ella usas todo: productos, tiendas, carrito, pedidos y planes. Funciona desde tu sitio web (se comprueba el dominio) y desde tu servidor (se comprueba la IP): basta con que coincida uno de los dos.</p>
        <p>Una credencial puesta en el código de una página se puede ver. Para crear pedidos, lo más seguro es llamar a la API desde tu servidor. Si se filtra, avisa a {siteName}: se revoca al instante y se crea otra.</p>
      </Section>

      <Section id="pedidos" title="Cómo crear un pedido">
        <p>Es el mismo proceso que el checkout de {siteName}, con reglas más estrictas porque no puede haber un pedido a medias:</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Valida el carrito con <code>POST /cart/validate</code>. Todos los productos deben ser de la misma tienda.</li>
          <li>Pide los requisitos con <code>{"GET /stores/{slug}/checkout"}</code>: campos, métodos de pago y provincias donde entrega.</li>
          <li>Crea el pedido con <code>POST /orders</code> y una cabecera <code>Idempotency-Key</code> única por pedido. Si repites la misma clave, recibes el mismo pedido y no se duplica.</li>
          <li>Si la tienda recibe por WhatsApp, abre <code>data.whatsapp.url</code> para que el cliente envíe el pedido. Si recibe por panel, ya le llegó al vendedor.</li>
        </ol>
        <p>El precio y el total siempre los calcula {siteName}. Se rechaza cualquier campo que no esté en el formulario, un teléfono sin código de país, un municipio o ciudad que no sea de esa provincia o estado, una provincia donde la tienda no entrega, productos pausados o sin stock, y más de 60 pedidos en 5 minutos.</p>
        <Code>{`curl -X POST "${BASE}/orders" \\\n  -H "Authorization: Bearer TU_CREDENCIAL" \\\n  -H "Idempotency-Key: pedido-2026-0001" \\\n  -H "Content-Type: application/json" \\\n  -d '{"storeSlug":"mi-tienda","channel":"cod","customerName":"Ana Pérez","customerPhone":"+5355512345","customerEmail":"ana@correo.com","shippingProvinceId":"ID","shippingMunicipalityId":"ID","shippingAddress":"Calle 1 entre 2 y 3","items":[{"productId":"ID","quantity":1}]}'`}</Code>
      </Section>

      <Section id="ejemplos" title="Ejemplos">
        <p>En el navegador:</p>
        <Code>{`const res = await fetch("${BASE}/products/featured?limit=8", {\n  headers: { Authorization: "Bearer bzp_key_..." },\n});\nconst { data } = await res.json();`}</Code>
        <p>En tu servidor con Node:</p>
        <Code>{`const res = await fetch("${BASE}/stores?pageSize=20", {\n  headers: { Authorization: \`Bearer \${process.env.PARTNER_API_KEY}\` },\n});\nconst { data, meta } = await res.json();`}</Code>
        <p>Validar un carrito:</p>
        <Code>{`const res = await fetch("${BASE}/cart/validate", {\n  method: "POST",\n  headers: { Authorization: "Bearer bzp_key_...", "Content-Type": "application/json" },\n  body: JSON.stringify({ items: [{ productId: "ID", quantity: 2 }] }),\n});`}</Code>
      </Section>

      <Section id="limites" title="Límites y errores">
        <p>Tu credencial tiene un límite por minuto y otro por día, amplios y pensados solo para frenar bots. Cada respuesta incluye <code>X-RateLimit-Remaining</code> y <code>X-DailyLimit-Remaining</code>. Al pasarte recibes <code>429</code> con <code>Retry-After</code> en segundos.</p>
        <p>Un error responde con <code>error</code> (el motivo en español) y, cuando tiene código, lo trae en <code>code</code> o en <code>details.code</code>.</p>
        {/* Filas en rejilla y no una tabla: a 390 px, tres columnas dejaban la de códigos tan angosta que
            idempotency_key_required se partía cada cuatro letras. En móvil el código y la explicación van uno
            debajo del otro junto al número; desde sm vuelven a ser tres columnas. Cada código es su propio
            elemento para que el salto de línea caiga entre códigos y no dentro de uno. */}
        <div className="divide-y divide-surface-container rounded-xl border border-surface-container-high text-[13px]">
          {ERRORS.map(([c, k, d]) => (
            <div key={c} className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-[40px_minmax(0,230px)_minmax(0,1fr)]">
              <p className="font-bold text-on-surface">{c}</p>
              <p className="flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[12px] text-on-surface">
                {k.split(", ").map((code) => <code key={code} className="[overflow-wrap:anywhere]">{code}</code>)}
              </p>
              <p className="col-start-2 sm:col-start-auto">{d}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="registro" title="Registrar tiendas con tu enlace">
        <p>La API no crea tiendas. Para traer tiendas, comparte tu enlace de socio: <code>{window.location.origin}/vender?socio=TU_CODIGO</code>. Las tiendas que se registren desde ese enlace quedan asociadas a ti para siempre. Tu código y enlace salen en <code>GET /me</code>.</p>
      </Section>

      <Section id="recursos" title="Recursos">
        <div className="space-y-3">
          {endpoints.map((e) => (
            <div key={e.id} className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4">
              <p className="font-mono text-[13px] font-bold text-on-surface"><span className="mr-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">{e.method}</span>{e.path}</p>
              <p className="mt-1 text-[13.5px] text-on-surface">{e.title}. <span className="text-on-surface-variant">{e.desc}</span></p>
              <p className="mt-1 text-[12px] text-outline">Permiso: {e.scope}</p>
              {e.params.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-[12.5px]">
                  {e.params.map(([n, h]) => <li key={n}><code className="font-bold">{n}</code> <span className="text-on-surface-variant">{h}</span></li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section id="probar" title="Probar la API">
        <p>Pega tu credencial y haz una llamada real.</p>
        <Console endpoints={endpoints} />
      </Section>
    </div>
  );
}
