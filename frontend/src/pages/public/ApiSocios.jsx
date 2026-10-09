import { useMemo, useState } from "react";
import { Copy, Play, KeyRound, Globe, Server, Gauge } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { copyToClipboard } from "../../lib/clipboard.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";

// Documentación pública de la API de socios, con una consola para probar las llamadas con la
// propia llave. La llave solo vive en memoria de esta pestaña.

const BASE = (() => {
  const b = String(api.defaults.baseURL ?? "").replace(/\/$/, "");
  return `${new URL(b || "/", window.location.origin).href.replace(/\/$/, "")}/partner/v1`;
})();

const ENDPOINTS = [
  { id: "me", scope: "Siempre", method: "GET", path: "/me", title: "Mi llave", desc: "Permisos, límites y cuánto queda de cuota, más el enlace de registro de tiendas.", params: [] },
  { id: "products", scope: "products:read", method: "GET", path: "/products", title: "Productos", desc: "Lista con filtros. Por defecto va ordenada por el ranking real de Baznova.",
    params: [["q", "Texto a buscar"], ["categoryId", "Categoría (incluye subcategorías)"], ["storeSlug", "Solo una tienda"], ["provinceId", "Provincia"], ["municipalityId", "Municipio"], ["minPrice", "Precio mínimo"], ["maxPrice", "Precio máximo"], ["currency", "CUP o USD"], ["onlyVerified", "true: solo tiendas verificadas"], ["sort", "relevance, newest, price-asc, price-desc, rating"], ["page", "Página (1)"], ["pageSize", "Por página (20, máx. 50)"]] },
  { id: "featured", scope: "ranking:read", method: "GET", path: "/products/featured", title: "Destacados", desc: "Los mejor posicionados según ventas, clics, reseñas y calidad del contenido.", params: [["limit", "Cantidad (12, máx. 50)"], ["categoryId", "Categoría"], ["storeSlug", "Tienda"]] },
  { id: "product", scope: "products:read", method: "GET", path: "/products/{id}", title: "Detalle de producto", desc: "Un producto con precios por cantidad, fotos y datos de su tienda.", path_params: ["id"], params: [] },
  { id: "product-reviews", scope: "reviews:read", method: "GET", path: "/products/{id}/reviews", title: "Reseñas de un producto", desc: "Solo reseñas visibles.", path_params: ["id"], params: [["page", "Página"], ["pageSize", "Por página"]] },
  { id: "stores", scope: "stores:read", method: "GET", path: "/stores", title: "Tiendas", desc: "Tiendas activas con productos publicados.", params: [["q", "Nombre"], ["provinceId", "Provincia"], ["municipalityId", "Municipio"], ["businessCategoryId", "Tipo de negocio"], ["onlyVerified", "true"], ["isRestaurant", "true o false"], ["page", "Página"], ["pageSize", "Por página"]] },
  { id: "store", scope: "stores:read", method: "GET", path: "/stores/{slug}", title: "Detalle de tienda", desc: "Datos públicos, ubicación y si está abierta ahora.", path_params: ["slug"], params: [] },
  { id: "store-products", scope: "stores:read + products:read", method: "GET", path: "/stores/{slug}/products", title: "Productos de una tienda", desc: "Acepta los mismos filtros que /products.", path_params: ["slug"], params: [["q", "Texto"], ["sort", "Orden"], ["page", "Página"], ["pageSize", "Por página"]] },
  { id: "store-reviews", scope: "reviews:read", method: "GET", path: "/stores/{slug}/reviews", title: "Reseñas de una tienda", desc: "Reseñas visibles de la tienda.", path_params: ["slug"], params: [["page", "Página"], ["pageSize", "Por página"]] },
  { id: "store-offers", scope: "store-offers:read", method: "GET", path: "/stores/{slug}/offers", title: "Ofertas de una tienda", desc: "Ofertas vigentes y su código de descuento público.", path_params: ["slug"], params: [] },
  { id: "offers", scope: "offers:read", method: "GET", path: "/offers", title: "Ofertas del sitio", desc: "Ofertas activas publicadas por Baznova.", params: [] },
  { id: "categories", scope: "catalog:read", method: "GET", path: "/categories", title: "Categorías", desc: "Categorías y subcategorías de productos.", params: [] },
  { id: "business-categories", scope: "catalog:read", method: "GET", path: "/business-categories", title: "Tipos de negocio", desc: "Tipos de tienda disponibles.", params: [] },
  { id: "provinces", scope: "catalog:read", method: "GET", path: "/locations/provinces", title: "Provincias", desc: "Provincias y estados activos.", params: [] },
  { id: "municipalities", scope: "catalog:read", method: "GET", path: "/locations/municipalities", title: "Municipios", desc: "Municipios de una provincia.", params: [["provinceId", "Obligatorio"]] },
  { id: "cart", scope: "cart:validate", method: "POST", path: "/cart/validate", title: "Validar carrito", desc: "Revisa precios vigentes, stock y totales por tienda y moneda. No guarda nada ni crea pedidos.", params: [],
    body: '{\n  "items": [\n    { "productId": "ID_DEL_PRODUCTO", "quantity": 2 }\n  ]\n}' },
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

function Console() {
  const [key, setKey] = useState("");
  const [epId, setEpId] = useState("products");
  const ep = ENDPOINTS.find((e) => e.id === epId);
  const [vals, setVals] = useState({});
  const [body, setBody] = useState(ENDPOINTS.find((e) => e.id === "cart").body);
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
    if (!key.trim()) return toast.error("Pega tu llave de navegador.");
    setBusy(true);
    setRes(null);
    const started = performance.now();
    try {
      const r = await fetch(url, {
        method: ep.method,
        headers: { Authorization: `Bearer ${key.trim()}`, ...(ep.method === "POST" ? { "Content-Type": "application/json" } : {}) },
        body: ep.method === "POST" ? body : undefined,
      });
      const text = await r.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* texto plano */ }
      setRes({
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
        <label className="mb-1 block text-[12px] font-bold text-on-surface-variant">Llave de navegador</label>
        <input className={`${INPUT} font-mono`} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="bzp_pub_..." />
        <p className="mt-1 text-[11.5px] text-outline">Solo se usa en esta pestaña y no se guarda. Las llaves de servidor no funcionan aquí.</p>
      </div>
      <div>
        <label className="mb-1 block text-[12px] font-bold text-on-surface-variant">Recurso</label>
        <select className={INPUT} value={epId} onChange={(e) => { setEpId(e.target.value); setRes(null); }}>
          {ENDPOINTS.map((e) => <option key={e.id} value={e.id}>{e.method} {e.path}</option>)}
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
        <div><label className="mb-1 block text-[12px] font-bold text-on-surface-variant">Cuerpo (JSON)</label><textarea className={`${INPUT} py-2 font-mono text-[12.5px]`} rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></div>
      )}
      <p className="break-all rounded-lg bg-surface-container px-3 py-2 font-mono text-[12px] text-on-surface">{ep.method} {url}</p>
      <button onClick={send} disabled={busy} className={`${BTN} bg-primary text-white hover:bg-primary/90`}><Play className="h-4 w-4" /> {busy ? "Enviando..." : "Probar"}</button>
      {res && (
        <div>
          <p className="mb-1 text-[12.5px]">
            <b className={res.status >= 200 && res.status < 300 ? "text-verified-dark" : "text-error"}>{res.status || "Error"}</b>
            <span className="text-outline"> · {res.ms} ms{res.limits.map(([h, v]) => ` · ${h}: ${v}`).join("")}</span>
          </p>
          <pre className={`${CODE} max-h-[420px]`}>{res.body}</pre>
        </div>
      )}
    </div>
  );
}

export default function ApiSocios() {
  const { siteName } = usePlatformSettings();
  return (
    <div className="mx-auto max-w-[900px] px-4 py-10">
      <h1 className="mb-2 font-display text-[32px] font-extrabold tracking-tight text-on-surface">API para socios</h1>
      <p className="mb-8 text-[15px] text-on-surface-variant">
        Muestra los productos y tiendas de {siteName} en tu sitio, valida carritos y trae tiendas con tu enlace de socio. La API es de solo lectura.
      </p>

      <div className="mb-10 grid gap-3 sm:grid-cols-3">
        {[[KeyRound, "1. Pide tu llave", "El equipo de Baznova crea tu cuenta de socio y te entrega las llaves."], [Globe, "2. Autoriza tu sitio", "Cada llave funciona solo desde los dominios o IP registrados."], [Gauge, "3. Conecta", "Envía la llave en cada solicitud y usa los datos en tu sitio."]].map(([Icon, t, d]) => (
          <div key={t} className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4">
            <Icon className="mb-2 h-5 w-5 text-primary" />
            <p className="text-[14px] font-bold text-on-surface">{t}</p>
            <p className="text-[12.5px] text-on-surface-variant">{d}</p>
          </div>
        ))}
      </div>

      <Section id="inicio" title="Empezar">
        <p>Dirección base de la API:</p>
        <Code>{BASE}</Code>
        <p>Envía tu llave en el encabezado <code>Authorization</code> (o en <code>X-Api-Key</code>). Todas las respuestas son JSON con la forma <code>{"{ data, meta }"}</code>.</p>
        <Code>{`curl "${BASE}/products?pageSize=5" \\\n  -H "Authorization: Bearer TU_LLAVE"`}</Code>
      </Section>

      <Section id="llaves" title="Tipos de llave">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4">
            <Globe className="mb-2 h-5 w-5 text-primary" />
            <p className="font-bold text-on-surface">Navegador</p>
            <p className="text-[13px]">Empieza con <code>bzp_pub_</code>. Va en el código de tu página y solo funciona desde los dominios que registraste.</p>
          </div>
          <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4">
            <Server className="mb-2 h-5 w-5 text-primary" />
            <p className="font-bold text-on-surface">Servidor</p>
            <p className="text-[13px]">Empieza con <code>bzp_sec_</code>. Es secreta: úsala solo en tu servidor, que debe tener una IP registrada. Si se usa desde un navegador se rechaza.</p>
          </div>
        </div>
        <p>Si una llave se filtra, avisa a Baznova: se revoca al instante y se crea otra.</p>
      </Section>

      <Section id="ejemplos" title="Ejemplos">
        <p>En el navegador (llave de navegador):</p>
        <Code>{`const res = await fetch("${BASE}/products/featured?limit=8", {\n  headers: { Authorization: "Bearer bzp_pub_..." },\n});\nconst { data } = await res.json();`}</Code>
        <p>En tu servidor con Node (llave de servidor):</p>
        <Code>{`const res = await fetch("${BASE}/stores?pageSize=20", {\n  headers: { Authorization: \`Bearer \${process.env.BAZNOVA_KEY}\` },\n});\nconst { data, meta } = await res.json();`}</Code>
        <p>Validar un carrito:</p>
        <Code>{`const res = await fetch("${BASE}/cart/validate", {\n  method: "POST",\n  headers: { Authorization: "Bearer bzp_pub_...", "Content-Type": "application/json" },\n  body: JSON.stringify({ items: [{ productId: "ID", quantity: 2 }] }),\n});`}</Code>
      </Section>

      <Section id="limites" title="Límites y errores">
        <p>Cada llave tiene un límite por minuto y otro por día, amplios y pensados solo para frenar bots. Cada respuesta incluye <code>X-RateLimit-Remaining</code> y <code>X-DailyLimit-Remaining</code>. Al pasarte recibes <code>429</code> con <code>Retry-After</code> en segundos.</p>
        <div className="overflow-x-auto rounded-xl border border-surface-container-high">
          <table className="w-full text-left text-[13px]">
            <tbody>
              {[["401", "missing_key, invalid_key, revoked_key, expired_key", "Falta la llave o no es válida."], ["403", "origin_not_allowed, secret_key_in_browser, scope_missing, partner_suspended", "Sitio o IP no autorizados, o la llave no tiene ese permiso."], ["404", "not_found", "El recurso no existe o no está disponible."], ["429", "rate_limit, daily_limit", "Demasiadas solicitudes."]].map(([c, k, d]) => (
                <tr key={c} className="border-b border-surface-container last:border-b-0"><td className="px-3 py-2 font-bold text-on-surface">{c}</td><td className="px-3 py-2 font-mono text-[12px]">{k}</td><td className="px-3 py-2">{d}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="registro" title="Registrar tiendas con tu enlace">
        <p>La API no crea tiendas. Para traer tiendas, comparte tu enlace de socio: <code>{window.location.origin}/vender?socio=TU_CODIGO</code>. Las tiendas que se registren desde ese enlace quedan asociadas a ti para siempre. Tu código y enlace salen en <code>GET /me</code>.</p>
      </Section>

      <Section id="recursos" title="Recursos">
        <div className="space-y-3">
          {ENDPOINTS.map((e) => (
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
        <p>Pega una llave de navegador y haz una llamada real.</p>
        <Console />
      </Section>
    </div>
  );
}
