// Pruebas de la API de socios (/partner/v1): escenarios, alcance y carga.
//   DATABASE_URL="postgresql://…/zeudin?schema=partner_test" node scripts/test-partner-api.mjs [--quick]
// Usa SOLO una base/esquema de pruebas: se niega a correr si la URL no incluye "partner_test".
// Antes: npx prisma migrate deploy (con esa misma URL).
import http from "node:http";
import jwt from "jsonwebtoken";

const DB = process.env.DATABASE_URL ?? "";
if (!DB.includes("partner_test")) {
  console.error('Por seguridad, DATABASE_URL debe incluir "partner_test" (esquema de pruebas).');
  process.exit(2);
}
process.env.NODE_ENV ??= "development";
const QUICK = process.argv.includes("--quick");

const { app } = await import("../src/app.js");
const { prisma } = await import("../src/lib/prisma.js");
const { env } = await import("../src/config/env.js");
const usage = await import("../src/lib/partnerUsage.js");
const { generateApiKey } = await import("../src/lib/partnerKeys.js");

const server = http.createServer(app);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;

// ---- utilidades -----------------------------------------------------------------------------
let passed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) passed += 1;
  else {
    failures.push(name);
    console.log(`  FALLA: ${name}${extra !== undefined ? ` -> ${typeof extra === "string" ? extra : JSON.stringify(extra).slice(0, 300)}` : ""}`);
  }
}
const section = (t) => console.log(`\n== ${t}`);

const agent = new http.Agent({ keepAlive: true, maxSockets: 100 });
function call(path, { key, origin, referer, method = "GET", body, rawBody, headers = {}, bearer = true } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (key) h[bearer ? "Authorization" : "X-Api-Key"] = bearer ? `Bearer ${key}` : key;
    if (origin) h.Origin = origin;
    if (referer) h.Referer = referer;
    let payload;
    if (body !== undefined || rawBody !== undefined) {
      payload = rawBody ?? JSON.stringify(body);
      h["Content-Type"] = "application/json";
      h["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = http.request({ host: "127.0.0.1", port: PORT, path, method, headers: h, agent }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* no JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const P = (p) => `/partner/v1${p}`;
const codeOf = (r) => r.json?.code;

// ---- datos de prueba --------------------------------------------------------------------------
section("Preparando datos");
await prisma.$executeRawUnsafe(
  `TRUNCATE "PartnerApiLog","PartnerApiUsageHour","PartnerApiKey","Partner","Review","StoreOffer","DiscountCode","Offer","ProductPriceTier","Product","VendorLocation","Vendor","Session","User","Category","BusinessCategory" RESTART IDENTITY CASCADE`
);

const mkUser = (email, role = "CUSTOMER") => prisma.user.create({ data: { email, passwordHash: "x", role, fullName: email } });
const admin = await mkUser("admin@test.local", "ADMIN");
const session = await prisma.session.create({ data: { userId: admin.id, browserId: "t", refreshTokenHash: "h-admin", expiresAt: new Date(Date.now() + 3.6e6) } });
const adminToken = jwt.sign({ sub: admin.id, role: "ADMIN", sid: session.id }, env.jwtSecret, { expiresIn: "1h" });
const adm = (path, method = "GET", body) => call(`/admin${path}`, { method, body, headers: { Authorization: `Bearer ${adminToken}` } });

const cat = await prisma.category.create({ data: { name: "Ropa", slug: "ropa" } });
const catChild = await prisma.category.create({ data: { name: "Camisas", slug: "camisas", parentId: cat.id } });
const biz = await prisma.businessCategory.create({ data: { name: "Tienda", slug: "tienda", icon: "store" } });

let n = 0;
async function mkVendor(name, extra = {}) {
  n += 1;
  const u = await mkUser(`v${n}@test.local`, "VENDOR");
  return prisma.vendor.create({ data: { userId: u.id, companyName: name, slug: name.toLowerCase().replace(/\s+/g, "-"), whatsapp: "+5350000000", businessCategoryId: biz.id, ...extra } });
}
const mkProduct = (vendorId, name, extra = {}) =>
  prisma.product.create({ data: { vendorId, name, slug: name.toLowerCase().replace(/\s+/g, "-"), price: 100, stock: 5, images: ["/uploads/products/a.webp"], description: "Descripción completa del producto de prueba para el ranking.", ...extra } });

const v1 = await mkVendor("Tienda Uno", { verificationStatus: "VERIFIED" });
const v2 = await mkVendor("Tienda Privada", { isPrivate: true });
const v3 = await mkVendor("Tienda Bloqueada", { isBlocked: true });
const v4 = await mkVendor("Tienda Vacia");
const v5 = await mkVendor("Tienda Dos");

const p1 = await mkProduct(v1.id, "Camisa Azul", { price: 200, stock: 5, categoryId: catChild.id, tags: ["camisa"] });
await prisma.productPriceTier.create({ data: { productId: p1.id, minQty: 3, price: 150 } });
const p2 = await mkProduct(v1.id, "Servicio Sin Limite", { price: 50, unlimitedStock: true, stock: 0 });
const p3 = await mkProduct(v1.id, "Agotado", { stock: 0 });
const p4 = await mkProduct(v1.id, "Solo Mesa", { hiddenFromStore: true });
const p5 = await mkProduct(v1.id, "Zapato Talla", { price: 300, sizes: ["S", "M"], sizeStock: { S: 2, M: 0 }, stock: 2 });
const p6 = await mkProduct(v2.id, "Producto Privado", { price: 10 });
const p7 = await mkProduct(v3.id, "Producto Bloqueado");
const p8 = await mkProduct(v5.id, "Pantalon Barato", { price: 20, categoryId: cat.id, currency: "USD" });
const p9 = await mkProduct(v1.id, "Fuera De Cupo", { overQuota: true });
await mkProduct(v4.id, "Inactivo", { isActive: false });

await prisma.review.create({ data: { productId: p1.id, vendorId: v1.id, authorName: "Ana", rating: 5, comment: "Excelente" } });
await prisma.review.create({ data: { productId: p1.id, vendorId: v1.id, authorName: "Oculta", rating: 1, comment: "Oculta", isHidden: true } });
const dc = await prisma.discountCode.create({ data: { vendorId: v1.id, code: "HOLA10", type: "PERCENTAGE", value: 10 } });
const dcEx = await prisma.discountCode.create({ data: { vendorId: v1.id, code: "SECRETO", type: "PERCENTAGE", value: 50 } });
await prisma.storeOffer.create({ data: { vendorId: v1.id, title: "Oferta pública", discountCodeId: dc.id } });
await prisma.storeOffer.create({ data: { vendorId: v1.id, title: "Oferta exclusiva", discountCodeId: dcEx.id, discountCodeExclusive: true } });
await prisma.storeOffer.create({ data: { vendorId: v1.id, title: "Vencida", discountCodeId: dc.id, isLimitedTime: true, expiresAt: new Date(Date.now() - 1000) } });
await prisma.offer.create({ data: { title: "Oferta del sitio", createdByAdmin: true, status: "ACTIVE", couponCode: "BAZ5" } });
await prisma.offer.create({ data: { title: "De una tienda", createdByAdmin: false, vendorId: v1.id, status: "ACTIVE" } });
console.log("  datos listos");

// ---- admin: socios y llaves -------------------------------------------------------------------
section("Admin: socios y llaves");
let r = await adm("/partners", "POST", { name: "Socio Uno", contactEmail: "uno@socio.com" });
check("crear socio 201", r.status === 201, r.json);
const partner = r.json.partner;
check("código generado desde el nombre", partner.code === "SOCIO-UNO", partner.code);
check("enlace de registro", partner.signupUrl.endsWith("/vender?socio=SOCIO-UNO"), partner.signupUrl);
r = await adm("/partners", "POST", { name: "Otro", code: "socio-uno", contactEmail: "x@y.com" });
check("código duplicado 409", r.status === 409, r.json);
r = await adm("/partners", "POST", { name: "X", contactEmail: "no-es-correo" });
check("datos inválidos 400", r.status === 400, r.json);
r = await adm("/partners", "POST", { name: "Mal Codigo", code: "a b", contactEmail: "a@b.com" });
check("código con espacio 400", r.status === 400, r.json);
const noAdmin = await call("/admin/partners", {});
check("admin sin sesión 401", noAdmin.status === 401, noAdmin.status);

r = await adm(`/partners/${partner.id}/keys`, "POST", { name: "Sin dominio", kind: "BROWSER" });
check("llave navegador sin dominio 400", r.status === 400, r.json);
r = await adm(`/partners/${partner.id}/keys`, "POST", { name: "Sin IP", kind: "SERVER" });
check("llave servidor sin IP 400", r.status === 400, r.json);
r = await adm(`/partners/${partner.id}/keys`, "POST", { name: "Servidor con dominio", kind: "SERVER", allowedIps: ["127.0.0.1"], allowedDomains: ["a.com"] });
check("llave servidor con dominio 400", r.status === 400, r.json);
r = await adm(`/partners/${partner.id}/keys`, "POST", { name: "Dominio malo", kind: "BROWSER", allowedDomains: ["no es dominio"] });
check("dominio inválido 400", r.status === 400, r.json);
r = await adm(`/partners/${partner.id}/keys`, "POST", { name: "IP mala", kind: "SERVER", allowedIps: ["999.1.1.1"] });
check("IP inválida 400", r.status === 400, r.json);
r = await adm(`/partners/${partner.id}/keys`, "POST", { name: "Sin permisos", kind: "BROWSER", allowedDomains: ["a.com"], scopes: [] });
check("sin permisos 400", r.status === 400, r.json);

async function newKey(body, pid = partner.id) {
  const res = await adm(`/partners/${pid}/keys`, "POST", body);
  if (res.status !== 201) throw new Error(`no se pudo crear la llave: ${res.text}`);
  return { secret: res.json.secret, id: res.json.key.id, key: res.json.key };
}
const browser = await newKey({ name: "Web", kind: "BROWSER", allowedDomains: ["https://www.MiTienda.com/ruta", "*.socio.com"], rateLimitPerMinute: 100000, dailyLimit: 100000000 });
check("llave navegador con prefijo", browser.secret.startsWith("bzp_pub_"));
check("dominios normalizados", JSON.stringify(browser.key.allowedDomains) === JSON.stringify(["www.mitienda.com", "*.socio.com"]), browser.key.allowedDomains);
const dbKey = await prisma.partnerApiKey.findUnique({ where: { id: browser.id } });
check("en la base solo queda la huella", dbKey.keyHash.length === 64 && !JSON.stringify(dbKey).includes(browser.secret));
check("la respuesta de la llave no trae keyHash", browser.key.keyHash === undefined);
const server1 = await newKey({ name: "Servidor", kind: "SERVER", allowedIps: ["127.0.0.1", "::1", "::ffff:127.0.0.1"], rateLimitPerMinute: 100000, dailyLimit: 100000000 });
check("llave servidor con prefijo", server1.secret.startsWith("bzp_sec_"));
r = await adm("/partners/scopes");
check("catálogo de permisos", r.status === 200 && r.json.scopes.length >= 8, r.json);

// ---- autenticación y origen -------------------------------------------------------------------
section("Autenticación, dominio e IP");
const OK_ORIGIN = "https://www.mitienda.com";
r = await call(P("/me"));
check("sin llave 401 missing_key", r.status === 401 && codeOf(r) === "missing_key", r.json);
r = await call(P("/me"), { key: "hola" });
check("llave con formato malo 401", r.status === 401 && codeOf(r) === "invalid_key", r.json);
r = await call(P("/me"), { key: `bzp_pub_${"0".repeat(48)}`, origin: OK_ORIGIN });
check("llave inexistente 401", r.status === 401 && codeOf(r) === "invalid_key", r.json);
r = await call(P("/me"), { key: browser.secret, origin: OK_ORIGIN });
check("navegador + dominio permitido 200", r.status === 200, r.json);
check("/me devuelve cuota en vivo", r.json?.data?.quota?.dayUsed >= 1 && r.json.data.quota.minuteLimit === 100000, r.json?.data?.quota);
check("/me devuelve enlace de socio", r.json?.data?.signupUrl?.endsWith("socio=SOCIO-UNO"));
r = await call(P("/me"), { key: browser.secret, origin: "https://sub.socio.com" });
check("comodín de subdominio 200", r.status === 200, r.json);
r = await call(P("/me"), { key: browser.secret, origin: "https://socio.com" });
check("el comodín no incluye el dominio raíz 403", r.status === 403 && codeOf(r) === "origin_not_allowed", r.json);
r = await call(P("/me"), { key: browser.secret, origin: "https://evil-mitienda.com" });
check("dominio parecido 403", r.status === 403, r.json);
r = await call(P("/me"), { key: browser.secret, origin: "https://www.mitienda.com.evil.com" });
check("dominio con sufijo ajeno 403", r.status === 403, r.json);
r = await call(P("/me"), { key: browser.secret });
check("navegador sin Origin ni IP autorizada 403", r.status === 403, r.json);
r = await call(P("/me"), { key: browser.secret, referer: "https://www.mitienda.com/pagina" });
check("Referer como respaldo 200", r.status === 200, r.json);
r = await call(P("/me"), { key: browser.secret, origin: "http://localhost:5173" });
check("consola de Baznova (origen del sitio) 200", r.status === 200, r.json);
r = await call(P("/me"), { key: browser.secret, origin: OK_ORIGIN, bearer: false });
check("encabezado X-Api-Key 200", r.status === 200, r.json);
r = await call(P("/me"), { method: "OPTIONS", origin: "https://cualquiera.com", headers: { "Access-Control-Request-Method": "GET" } });
check("preflight 204 con CORS", r.status === 204 && r.headers["access-control-allow-origin"] === "https://cualquiera.com", r.headers);
r = await call(P("/me"), { key: browser.secret, origin: OK_ORIGIN });
check("respuesta con Access-Control-Allow-Origin", r.headers["access-control-allow-origin"] === OK_ORIGIN);
check("encabezados de límite presentes", !!r.headers["x-ratelimit-remaining"] && !!r.headers["x-dailylimit-remaining"], r.headers);

r = await call(P("/me"), { key: server1.secret });
check("servidor desde IP autorizada 200", r.status === 200, r.json);
r = await call(P("/me"), { key: server1.secret, origin: "https://www.mitienda.com" });
check("llave de servidor en navegador 403", r.status === 403 && codeOf(r) === "secret_key_in_browser", r.json);
const serverOther = await newKey({ name: "Otra IP", kind: "SERVER", allowedIps: ["203.0.113.9"] });
r = await call(P("/me"), { key: serverOther.secret });
check("servidor desde IP no autorizada 403", r.status === 403 && codeOf(r) === "origin_not_allowed", r.json);
const browserIp = await newKey({ name: "Navegador + IP", kind: "BROWSER", allowedDomains: ["x.com"], allowedIps: ["127.0.0.1", "::1"] });
r = await call(P("/me"), { key: browserIp.secret });
check("navegador con IP autorizada sin Origin 200", r.status === 200, r.json);

// ---- permisos (scopes) ------------------------------------------------------------------------
section("Permisos por llave");
const storesOnly = await newKey({ name: "Solo tiendas", kind: "SERVER", allowedIps: ["127.0.0.1", "::1"], scopes: ["stores:read"] });
r = await call(P("/stores"), { key: storesOnly.secret });
check("permiso presente 200", r.status === 200, r.json);
r = await call(P("/products"), { key: storesOnly.secret });
check("permiso ausente 403 scope_missing", r.status === 403 && codeOf(r) === "scope_missing", r.json);
r = await call(P("/stores/tienda-uno/products"), { key: storesOnly.secret });
check("tiendas/:slug/products exige también products:read", r.status === 403, r.json);
r = await call(P("/cart/validate"), { key: storesOnly.secret, method: "POST", body: { items: [{ productId: p1.id, quantity: 1 }] } });
check("carrito sin permiso 403", r.status === 403, r.json);
r = await call(P("/me"), { key: storesOnly.secret });
check("/me siempre disponible", r.status === 200, r.json);

// ---- datos: productos --------------------------------------------------------------------------
section("Productos");
const S = browser.secret;
const get = (path, extra = {}) => call(P(path), { key: S, origin: OK_ORIGIN, ...extra });
r = await get("/products?pageSize=50");
const names = (r.json?.data ?? []).map((p) => p.name);
check("lista 200 con meta", r.status === 200 && r.json.meta?.total === names.length, r.json?.meta);
check("incluye producto normal", names.includes("Camisa Azul"));
check("incluye servicio sin límite de stock", names.includes("Servicio Sin Limite"));
check("excluye agotado", !names.includes("Agotado"));
check("excluye solo-mesa", !names.includes("Solo Mesa"));
check("excluye fuera de cupo", !names.includes("Fuera De Cupo"));
check("excluye tienda privada", !names.includes("Producto Privado"));
check("excluye tienda bloqueada", !names.includes("Producto Bloqueado"));
check("excluye producto inactivo", !names.includes("Inactivo"));
const camisa = r.json.data.find((p) => p.name === "Camisa Azul");
check("forma del producto", camisa && camisa.price === 200 && camisa.priceTiers[0]?.price === 150 && camisa.inStock === true && camisa.store.verified === true && camisa.url.includes("/producto/tienda-uno/camisa-azul"), camisa);
check("imágenes con URL absoluta", camisa.images[0].startsWith("http"), camisa.images);
check("no filtra datos privados", !("stock" in camisa) && !("vendorId" in camisa) && !("whatsapp" in camisa.store));

r = await get("/products?sort=price-asc&pageSize=50");
const prices = r.json.data.map((p) => p.price);
check("orden precio ascendente", prices.every((v, i) => i === 0 || v >= prices[i - 1]), prices);
r = await get("/products?sort=price-desc&pageSize=50");
const pd = r.json.data.map((p) => p.price);
check("orden precio descendente", pd.every((v, i) => i === 0 || v <= pd[i - 1]), pd);
r = await get("/products?sort=newest&sort=rating");
check("orden raro no rompe", [200, 400].includes(r.status), r.status);
r = await get("/products?q=camisa");
check("búsqueda por texto", r.json.data.length === 1 && r.json.data[0].name === "Camisa Azul", r.json);
r = await get("/products?q=%25%27%3B--");
check("texto con símbolos no rompe", r.status === 200 && r.json.data.length === 0, r.status);
r = await get("/products?minPrice=100&maxPrice=250");
check("filtro de precio", r.json.data.every((p) => p.price >= 100 && p.price <= 250) && r.json.data.length >= 1, r.json);
r = await get(`/products?categoryId=${cat.id}`);
check("categoría padre incluye subcategorías", ["Camisa Azul", "Pantalon Barato"].every((nm) => r.json.data.some((p) => p.name === nm)), r.json.data.map((p) => p.name));
r = await get(`/products?categoryId=${catChild.id}`);
check("subcategoría exacta", r.json.data.length === 1, r.json.data.length);
r = await get("/products?storeSlug=tienda-dos");
check("filtro por tienda", r.json.data.length === 1 && r.json.data[0].name === "Pantalon Barato", r.json);
r = await get("/products?onlyVerified=true");
check("solo verificadas", r.json.data.every((p) => p.store.verified), r.json);
r = await get("/products?currency=USD");
check("filtro de moneda", r.json.data.length === 1 && r.json.data[0].currency === "USD", r.json);
r = await get("/products?pageSize=2&page=1&sort=newest");
check("paginación", r.json.data.length === 2 && r.json.meta.pageSize === 2 && r.json.meta.pageCount >= 2, r.json.meta);
const page2 = await get("/products?pageSize=2&page=2&sort=newest");
check("página 2 distinta", page2.json.data[0].id !== r.json.data[0].id);
r = await get("/products?pageSize=1000");
check("pageSize excesivo 400", r.status === 400, r.json);
r = await get("/products?page=0");
check("page=0 400", r.status === 400, r.json);
r = await get("/products?page=abc");
check("page no numérica 400", r.status === 400, r.json);
r = await get("/products?sort=hack");
check("sort inválido 400", r.status === 400, r.json);
r = await get("/products/featured?limit=5");
check("destacados", r.status === 200 && r.json.data.length >= 1 && r.json.data.length <= 5, r.json);
r = await get(`/products/${p1.id}`);
check("detalle 200", r.status === 200 && r.json.data.id === p1.id, r.json);
for (const [label, id] of [["agotado", p3.id], ["solo mesa", p4.id], ["tienda privada", p6.id], ["tienda bloqueada", p7.id], ["fuera de cupo", p9.id], ["inexistente", "nope"]]) {
  r = await get(`/products/${id}`);
  check(`detalle ${label} 404`, r.status === 404, r.status);
}
r = await get(`/products/${p1.id}/reviews`);
check("reseñas visibles solamente", r.status === 200 && r.json.data.length === 1 && r.json.data[0].author === "Ana", r.json);

// ---- datos: tiendas ----------------------------------------------------------------------------
section("Tiendas, ofertas y catálogo");
r = await get("/stores");
const slugs = r.json.data.map((s) => s.slug).sort();
check("tiendas visibles", JSON.stringify(slugs) === JSON.stringify(["tienda-dos", "tienda-uno"]), slugs);
check("tiendas verificadas primero", r.json.data[0].slug === "tienda-uno", r.json.data.map((s) => s.slug));
check("conteo de productos de la tienda", r.json.data.find((s) => s.slug === "tienda-uno").productCount === 4, r.json.data.map((s) => [s.slug, s.productCount]));
for (const [label, slug] of [["privada", "tienda-privada"], ["bloqueada", "tienda-bloqueada"], ["sin productos", "tienda-vacia"], ["inexistente", "nada"]]) {
  r = await get(`/stores/${slug}`);
  check(`tienda ${label} 404`, r.status === 404, r.status);
}
r = await get("/stores/tienda-uno");
check("detalle de tienda", r.status === 200 && r.json.data.verified === true && (r.json.data.isOpenNow === null || typeof r.json.data.isOpenNow === "boolean"), r.json);
check("tienda sin datos privados", !("ownerName" in r.json.data) && !("whatsapp" in r.json.data) && !("companyAddress" in r.json.data));
r = await get("/stores/tienda-uno/products");
check("productos de una tienda", r.status === 200 && r.json.data.every((p) => p.store.slug === "tienda-uno"), r.json);
r = await get("/stores/tienda-uno/reviews");
check("reseñas de tienda sin ocultas", r.status === 200 && r.json.data.every((x) => x.author !== "Oculta"), r.json);
r = await get("/stores/tienda-uno/offers");
check("ofertas de tienda: pública con código, exclusiva sin código, vencida fuera", r.status === 200 && r.json.data.length === 2 && r.json.data.find((o) => o.title === "Oferta pública").discount.code === "HOLA10" && r.json.data.find((o) => o.title === "Oferta exclusiva").discount === null, r.json);
r = await get("/offers");
check("ofertas del sitio: solo las del admin", r.status === 200 && r.json.data.length === 1 && r.json.data[0].couponCode === "BAZ5", r.json);
r = await get("/categories");
check("categorías con hijas", r.status === 200 && r.json.data[0].children.length === 1, r.json);
r = await get("/business-categories");
check("tipos de negocio", r.status === 200 && r.json.data.length === 1, r.json);
r = await get("/locations/municipalities");
check("municipios sin provincia 400", r.status === 400, r.json);
r = await get("/locations/provinces");
check("provincias 200", r.status === 200, r.json);
r = await get("/ruta-que-no-existe");
check("ruta desconocida 404 con código", r.status === 404 && codeOf(r) === "not_found", r.json);

// tienda privada propia del socio
await prisma.vendor.update({ where: { id: v2.id }, data: { partnerId: partner.id } });
r = await get("/stores");
check("socio ve su propia tienda privada", r.json.data.some((s) => s.slug === "tienda-privada"), r.json.data.map((s) => s.slug));
r = await get(`/products/${p6.id}`);
check("socio ve el producto de su tienda privada", r.status === 200, r.status);
const partner2 = (await adm("/partners", "POST", { name: "Socio Dos", contactEmail: "dos@socio.com" })).json.partner;
const key2 = await newKey({ name: "Web 2", kind: "BROWSER", allowedDomains: ["dos.com"] }, partner2.id);
r = await call(P("/stores"), { key: key2.secret, origin: "https://dos.com" });
check("otro socio NO ve la tienda privada ajena", !r.json.data.some((s) => s.slug === "tienda-privada"), r.json.data.map((s) => s.slug));
r = await call(P("/stores"), { key: S });
check("llave de otro socio no sirve para dominio ajeno", r.status === 403);

// ---- carrito -----------------------------------------------------------------------------------
section("Validar carrito");
const cart = (items) => get("/cart/validate", { method: "POST", body: { items } });
r = await cart([{ productId: p1.id, quantity: 2 }, { productId: p2.id, quantity: 3 }]);
check("carrito válido", r.status === 200 && r.json.data.valid === true && r.json.data.stores.length === 1, r.json);
check("total por moneda", r.json.data.stores[0].totals.CUP === 2 * 200 + 3 * 50, r.json.data.stores[0].totals);
r = await cart([{ productId: p1.id, quantity: 4 }]);
check("precio por cantidad aplicado", r.json.data.stores[0].items[0].unitPrice === 150 && r.json.data.stores[0].totals.CUP === 600, r.json.data.stores[0]);
r = await cart([{ productId: p1.id, quantity: 6 }]);
check("stock insuficiente", r.json.data.valid === false && r.json.data.issues[0].problem === "insufficient_stock" && r.json.data.issues[0].availableQuantity === 5, r.json);
r = await cart([{ productId: p1.id, quantity: 1 }, { productId: "no-existe", quantity: 1 }]);
check("producto inexistente marcado", r.json.data.valid === false && r.json.data.issues[0].problem === "unavailable", r.json);
r = await cart([{ productId: p3.id, quantity: 1 }]);
check("producto agotado no disponible", r.json.data.valid === false, r.json);
r = await cart([{ productId: p5.id, quantity: 1 }]);
check("talla obligatoria", r.json.data.issues[0]?.problem === "size_required", r.json);
r = await cart([{ productId: p5.id, quantity: 1, size: "S" }]);
check("talla con stock válida", r.json.data.valid === true, r.json);
r = await cart([{ productId: p5.id, quantity: 1, size: "M" }]);
check("talla agotada", r.json.data.issues[0]?.problem === "out_of_stock", r.json);
r = await cart([{ productId: p1.id, quantity: 1 }, { productId: p8.id, quantity: 2 }]);
check("dos tiendas y monedas separadas", r.json.data.stores.length === 2 && r.json.data.stores.find((s) => s.store.slug === "tienda-dos").totals.USD === 40, r.json);
r = await cart([]);
check("carrito vacío 400", r.status === 400, r.json);
r = await cart(Array.from({ length: 101 }, () => ({ productId: p1.id, quantity: 1 })));
check("más de 100 líneas 400", r.status === 400, r.status);
r = await cart([{ productId: p1.id, quantity: 0 }]);
check("cantidad 0 400", r.status === 400, r.json);
r = await cart([{ productId: p1.id, quantity: -3 }]);
check("cantidad negativa 400", r.status === 400, r.json);
r = await get("/cart/validate", { method: "POST", body: "no es json", headers: {} });
check("cuerpo inválido no da 500", r.status < 500, r.status);
r = await get("/cart/validate", { method: "POST", rawBody: "{no es json" });
check("JSON mal formado 400 invalid_json", r.status === 400 && codeOf(r) === "invalid_json", r.json);
r = await cart([{ productId: p6.id, quantity: 1 }]);
check("producto de tienda privada propia del socio sí se valida", r.json.data.valid === true, r.json);
const cartCount = await prisma.product.findUnique({ where: { id: p1.id }, select: { stock: true } });
check("validar carrito no descuenta stock", cartCount.stock === 5, cartCount);

// ---- límites -------------------------------------------------------------------------------------
section("Cuotas por minuto y por día");
const lim = await newKey({ name: "Límite 5", kind: "SERVER", allowedIps: ["127.0.0.1", "::1"], rateLimitPerMinute: 5, dailyLimit: 1000 });
const codes = [];
let last;
for (let i = 0; i < 7; i++) { last = await call(P("/categories"), { key: lim.secret }); codes.push(last.status); }
check("5 pasan y la 6ª y 7ª reciben 429", JSON.stringify(codes) === JSON.stringify([200, 200, 200, 200, 200, 429, 429]), codes);
check("429 con Retry-After y código", !!last.headers["retry-after"] && codeOf(last) === "rate_limit", last.headers);
check("restante llega a 0", last.headers["x-ratelimit-remaining"] === "0");

const dayKey = await newKey({ name: "Día 3", kind: "SERVER", allowedIps: ["127.0.0.1", "::1"], rateLimitPerMinute: 1000, dailyLimit: 3 });
const dcodes = [];
for (let i = 0; i < 5; i++) dcodes.push((await call(P("/categories"), { key: dayKey.secret })).status);
check("límite diario: 3 pasan, luego 429", JSON.stringify(dcodes) === JSON.stringify([200, 200, 200, 429, 429]), dcodes);
r = await call(P("/categories"), { key: dayKey.secret });
check("429 diario con código daily_limit", codeOf(r) === "daily_limit" && r.headers["x-dailylimit-remaining"] === "0", r.json);

await usage.flushUsage();
const agg = await prisma.partnerApiUsageHour.aggregate({ where: { keyId: dayKey.id }, _sum: { requests: true } });
check("los totales guardados cuentan solo las 3 aceptadas", agg._sum.requests === 3, agg);
const rejectedLogs = await prisma.partnerApiLog.count({ where: { keyId: dayKey.id, status: 429 } });
check("las rechazadas quedan en movimientos", rejectedLogs >= 3, rejectedLogs);
usage._resetPartnerUsageForTests(); // simula reinicio del servidor
r = await call(P("/categories"), { key: dayKey.secret });
check("tras reinicio el contador diario se rehidrata desde la base", r.status === 429 && codeOf(r) === "daily_limit", r.json);

section("Revocar, vencer, suspender");
const rv = await newKey({ name: "Se revoca", kind: "SERVER", allowedIps: ["127.0.0.1", "::1"] });
check("antes de revocar funciona", (await call(P("/me"), { key: rv.secret })).status === 200);
r = await adm(`/partners/${partner.id}/keys/${rv.id}/revoke`, "POST");
check("revocar 200", r.status === 200, r.json);
r = await call(P("/me"), { key: rv.secret });
check("revocada: 401 al instante", r.status === 401 && codeOf(r) === "revoked_key", r.json);
r = await adm(`/partners/${partner.id}/keys/${rv.id}`, "PATCH", { name: "x" });
check("no se edita una revocada", r.status === 400, r.json);
const ex = await newKey({ name: "Vence", kind: "SERVER", allowedIps: ["127.0.0.1", "::1"], expiresAt: new Date(Date.now() + 60000).toISOString() });
await prisma.partnerApiKey.update({ where: { id: ex.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
r = await call(P("/me"), { key: ex.secret });
check("vencida 401", r.status === 401 && codeOf(r) === "expired_key", r.json);
r = await adm(`/partners/${partner2.id}`, "PATCH", { status: "SUSPENDED" });
check("suspender socio", r.status === 200, r.json);
r = await call(P("/me"), { key: key2.secret, origin: "https://dos.com" });
check("socio suspendido 403", r.status === 403 && codeOf(r) === "partner_suspended", r.json);
await adm(`/partners/${partner2.id}`, "PATCH", { status: "ACTIVE" });
r = await call(P("/me"), { key: key2.secret, origin: "https://dos.com" });
check("socio reactivado 200", r.status === 200, r.json);
r = await adm(`/partners/${partner.id}`, "PATCH", { code: "OTRO-CODIGO" });
check("el código no se puede cambiar", r.status === 400, r.json);
const upd = await adm(`/partners/${partner.id}/keys/${storesOnly.id}`, "PATCH", { scopes: ["stores:read", "products:read"], rateLimitPerMinute: 777 });
check("editar permisos y límite", upd.status === 200 && upd.json.key.rateLimitPerMinute === 777, upd.json);
r = await call(P("/products"), { key: storesOnly.secret });
check("el cambio de permisos aplica al instante", r.status === 200, r.json);
r = await adm(`/partners/${partner.id}`);
check("detalle de socio con llaves y uso", r.status === 200 && r.json.keys.length >= 5 && r.json.keys.every((k) => k.keyHash === undefined) && r.json.usage.requests >= 0, Object.keys(r.json));
check("llaves activas traen cuota en vivo", r.json.keys.filter((k) => k.status === "ACTIVE").every((k) => k.live && k.live.dayLimit > 0));
r = await adm(`/partners/${partner.id}/movements?pageSize=5`);
check("movimientos paginados", r.status === 200 && r.json.movements.length > 0 && r.json.pageSize === 5, r.json);
r = await adm("/partners?q=socio");
check("listado de socios", r.status === 200 && r.json.partners.length === 2 && r.json.partners[0].signupUrl, r.json);

// ---- registro con enlace de socio --------------------------------------------------------------------
section("Tienda registrada con enlace de socio");
async function registerStore(code, email) {
  const u = await mkUser(email, "CUSTOMER");
  const s = await prisma.session.create({ data: { userId: u.id, browserId: email, refreshTokenHash: `h-${email}`, expiresAt: new Date(Date.now() + 3.6e6) } });
  const tok = jwt.sign({ sub: u.id, role: "CUSTOMER", sid: s.id }, env.jwtSecret, { expiresIn: "1h" });
  const res = await call("/vendors", {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}` },
    body: { companyName: `Reg ${email}`, ownerName: "Dueño Prueba", whatsapp: "+5350000001", email, businessCategoryId: biz.id, partnerCode: code, companyAddress: "Calle 1", locations: [{ countryOther: "Pais X", stateOther: "Estado X" }] },
  });
  return { res, userId: u.id };
}
let reg = await registerStore("SOCIO-UNO", "reg1@test.local");
if (reg.res.status !== 201) console.log("  (aviso) el registro de prueba falló:", reg.res.text.slice(0, 200));
let vend = await prisma.vendor.findUnique({ where: { userId: reg.userId } });
check("tienda atribuida al socio", reg.res.status === 201 && vend?.partnerId === partner.id, reg.res.json);
check("socio con listInMarketplace=true: tienda pública", vend?.isPrivate === false, vend?.isPrivate);
await adm(`/partners/${partner.id}`, "PATCH", { listInMarketplace: false });
reg = await registerStore("socio-uno", "reg2@test.local");
vend = await prisma.vendor.findUnique({ where: { userId: reg.userId } });
check("código en minúsculas también atribuye", vend?.partnerId === partner.id);
check("listInMarketplace=false: tienda queda privada", vend?.isPrivate === true, vend?.isPrivate);
reg = await registerStore("NO-EXISTE", "reg3@test.local");
vend = await prisma.vendor.findUnique({ where: { userId: reg.userId } });
check("código desconocido se ignora y la tienda se crea", reg.res.status === 201 && vend?.partnerId === null);
await adm(`/partners/${partner2.id}`, "PATCH", { status: "SUSPENDED" });
reg = await registerStore(partner2.code, "reg4@test.local");
vend = await prisma.vendor.findUnique({ where: { userId: reg.userId } });
check("socio suspendido no atribuye", reg.res.status === 201 && vend?.partnerId === null);
reg = await registerStore(undefined, "reg5@test.local");
vend = await prisma.vendor.findUnique({ where: { userId: reg.userId } });
check("registro directo sin socio", reg.res.status === 201 && vend?.partnerId === null);

// ---- carga y fatiga ------------------------------------------------------------------------------------
section("Carga y fatiga");
const nStores = QUICK ? 10 : 40;
const perStore = QUICK ? 50 : 100;
console.log(`  sembrando ${nStores * perStore} productos en ${nStores} tiendas...`);
const bigCat = await prisma.category.create({ data: { name: "Carga", slug: "carga" } });
for (let s = 0; s < nStores; s++) {
  const v = await mkVendor(`Carga ${s}`, { verificationStatus: s % 3 === 0 ? "VERIFIED" : "NOT_STARTED" });
  await prisma.product.createMany({
    data: Array.from({ length: perStore }, (_, i) => ({
      vendorId: v.id, name: `Producto carga ${s}-${i}`, slug: `producto-carga-${s}-${i}`, price: 10 + ((s * 7 + i) % 500), stock: 10, images: ["/uploads/products/a.webp", "/uploads/products/b.webp"],
      description: "Descripción larga y completa para pasar el piso de calidad del ranking.", categoryId: bigCat.id, tags: ["carga"],
      salesCount: (s * i) % 50, clickCount: (s + i) % 200, searchClickCount: i % 30, viewCount: (s + i) % 300, totalDwellMs: ((s + i) % 300) * 4000,
    })),
  });
}

const big = await newKey({ name: "Carga", kind: "SERVER", allowedIps: ["127.0.0.1", "::1"], rateLimitPerMinute: 100000, dailyLimit: 100_000_000 });
async function blast(total, conc, path) {
  const lat = [];
  const statuses = new Map();
  let next = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: conc }, async () => {
    while (next < total) {
      next += 1;
      const s = performance.now();
      const res = await call(P(path), { key: big.secret });
      lat.push(performance.now() - s);
      statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
    }
  }));
  lat.sort((a, b) => a - b);
  const q = (p) => Math.round(lat[Math.min(lat.length - 1, Math.floor(lat.length * p))]);
  return { total, secs: (Date.now() - t0) / 1000, p50: q(0.5), p95: q(0.95), p99: q(0.99), statuses: Object.fromEntries(statuses) };
}
const heap0 = process.memoryUsage().heapUsed;
const before = (await prisma.partnerApiUsageHour.aggregate({ where: { keyId: big.id }, _sum: { requests: true } }))._sum.requests ?? 0;
const scenarios = [
  ["catálogo (ranking)", "/products?pageSize=20", QUICK ? 200 : 600, 20],
  ["destacados", "/products/featured?limit=12", QUICK ? 100 : 300, 20],
  ["búsqueda de texto", "/products?q=carga&sort=newest&pageSize=20", QUICK ? 200 : 600, 20],
  ["tiendas", "/stores?pageSize=20", QUICK ? 100 : 300, 20],
  ["categorías", "/categories", QUICK ? 300 : 1500, 50],
];
let totalSent = 0;
for (const [label, path, total, conc] of scenarios) {
  const res = await blast(total, conc, path);
  totalSent += total;
  console.log(`  ${label}: ${total} solicitudes, concurrencia ${conc}: ${(total / res.secs).toFixed(0)} req/s, p50 ${res.p50} ms, p95 ${res.p95} ms, p99 ${res.p99} ms, estados ${JSON.stringify(res.statuses)}`);
  check(`${label}: sin errores bajo carga`, Object.keys(res.statuses).every((s) => s === "200"), res.statuses);
  check(`${label}: p95 razonable (<3000 ms)`, res.p95 < 3000, res.p95);
}
await usage.flushUsage();
const after = (await prisma.partnerApiUsageHour.aggregate({ where: { keyId: big.id }, _sum: { requests: true } }))._sum.requests ?? 0;
check(`totales guardados coinciden exactamente con lo enviado (${totalSent})`, after - before === totalSent, { enviado: totalSent, guardado: after - before });
const heapGrowthMb = (process.memoryUsage().heapUsed - heap0) / 1048576;
console.log(`  crecimiento de memoria durante la carga: ${heapGrowthMb.toFixed(1)} MB`);
check("memoria estable (<200 MB de crecimiento)", heapGrowthMb < 200, heapGrowthMb);

section("Atomicidad de los límites bajo concurrencia");
const atom = await newKey({ name: "Atómica", kind: "SERVER", allowedIps: ["127.0.0.1", "::1"], rateLimitPerMinute: 100, dailyLimit: 1_000_000 });
let results = await Promise.all(Array.from({ length: 300 }, () => call(P("/categories"), { key: atom.secret })));
let ok = results.filter((x) => x.status === 200).length;
check("300 simultáneas con límite 100/min: exactamente 100 pasan", ok === 100 && results.filter((x) => x.status === 429).length === 200, { ok });
const atomDay = await newKey({ name: "Atómica día", kind: "SERVER", allowedIps: ["127.0.0.1", "::1"], rateLimitPerMinute: 100000, dailyLimit: 150 });
results = await Promise.all(Array.from({ length: 400 }, () => call(P("/categories"), { key: atomDay.secret })));
ok = results.filter((x) => x.status === 200).length;
check("400 simultáneas con límite diario 150: exactamente 150 pasan", ok === 150, { ok });
await usage.flushUsage();
const aggDay = await prisma.partnerApiUsageHour.aggregate({ where: { keyId: atomDay.id }, _sum: { requests: true } });
check("y exactamente 150 quedan contadas en la base", aggDay._sum.requests === 150, aggDay);

section("Barrido de llaves inválidas");
usage._resetPartnerUsageForTests();
const codesFlood = [];
for (let i = 0; i < 140; i++) codesFlood.push((await call(P("/me"), { key: `bzp_pub_${String(i).padStart(48, "0")}` })).status);
check("tras 120 intentos inválidos la IP recibe 429", codesFlood.slice(0, 120).every((c) => c === 401) && codesFlood.slice(125).every((c) => c === 429), [codesFlood[0], codesFlood[119], codesFlood[125], codesFlood[139]]);
r = await call(P("/me"), { key: server1.secret });
check("mientras dura el bloqueo, esa IP no puede usar ni llaves válidas", r.status === 429 && codeOf(r) === "too_many_invalid_keys", r.json);
usage._resetPartnerUsageForTests();
r = await call(P("/me"), { key: server1.secret });
check("pasado el bloqueo vuelve a funcionar", r.status === 200, r.json);

// ---- resultado -------------------------------------------------------------------------------------------
console.log(`\n${passed} comprobaciones correctas, ${failures.length} fallidas.`);
if (failures.length) console.log("Fallidas:\n - " + failures.join("\n - "));
await usage.flushUsage();
agent.destroy();
server.close();
await prisma.$disconnect();
process.exit(failures.length ? 1 : 0);
