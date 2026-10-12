import { getAllPlanConfigs } from "./planConfig.js";
import { getSubscriptionPricing } from "../controllers/settings.controller.js";

// Datos de la plataforma que el asistente da a los clientes (planes, precios, límites). Salen SIEMPRE de la base de datos
// en el momento de la pregunta, nunca de un texto fijo: si el admin cambia un plan o un precio, la respuesta cambia sola.

// Enlaces seguros que el asistente puede ofrecer como botones: rutas reales de la plataforma, nunca inventadas por la IA.
export const ASSISTANT_LINKS = {
  registerCustomer: { label: "Crear mi cuenta", href: "/cuenta?tab=registro" },
  loginCustomer: { label: "Iniciar sesión", href: "/cuenta" },
  myOrders: { label: "Mis pedidos", href: "/cuenta/panel" },
  registerVendor: { label: "Registrar mi tienda", href: "/vendedor/ingresar?tab=registro" },
  loginVendor: { label: "Entrar a mi tienda", href: "/vendedor/ingresar" },
  catalog: { label: "Ver el catálogo", href: "/catalogo" },
  stores: { label: "Ver tiendas", href: "/tiendas" },
  faq: { label: "Preguntas frecuentes", href: "/faq" },
  help: { label: "Centro de ayuda", href: "/ayuda" },
  contact: { label: "Contactar al equipo", href: "/contacto" },
  terms: { label: "Términos y condiciones", href: "/terminos" },
  privacy: { label: "Política de privacidad", href: "/privacidad" },
  partnerApi: { label: "API para socios", href: "/api-socios" },
  partnerRequest: { label: "Solicitar acceso de socio", href: "/socios/solicitar" },
};

const link = (key) => ASSISTANT_LINKS[key];

const limit = (n, unit = "") => (n == null ? "Sin límite" : `${n}${unit ? ` ${unit}` : ""}`);
const yesNo = (v) => (v ? "Sí" : "No");

let cache = { at: 0, value: null };
const TTL_MS = 30 * 1000;

// Planes y precios vigentes. Caché de 30 s: lo bastante corta para que un cambio del admin se note casi al instante.
export async function getPlansFacts() {
  if (cache.value && Date.now() - cache.at < TTL_MS) return cache.value;
  const [plans, pricing] = await Promise.all([getAllPlanConfigs(), getSubscriptionPricing()]);
  const byType = Object.fromEntries(plans.map((p) => [p.planType, p]));
  cache = { at: Date.now(), value: { regular: byType.REGULAR ?? null, business: byType.BUSINESS ?? null, pricing } };
  return cache.value;
}

function businessPriceText(pricing) {
  const parts = [];
  if (pricing?.cupPricePerMonth != null) parts.push(`${Number(pricing.cupPricePerMonth).toLocaleString("es-CU")} CUP al mes`);
  if (pricing?.cardPricePerMonthUsd != null) parts.push(`${Number(pricing.cardPricePerMonthUsd).toLocaleString("es-CU")} USD al mes con tarjeta`);
  return parts.length ? parts.join(" o ") : "consulta el precio en tu panel";
}

// Texto compacto para el prompt del modelo cuando la pregunta toca planes (solo se envía en esos casos).
export async function planFactsForPrompt() {
  const { regular, business, pricing } = await getPlansFacts();
  const line = (p, price) =>
    p
      ? `- ${p.displayName} (${price}): productos ${limit(p.maxProducts)}; provincias ${limit(p.maxProvinces)}; mesas QR ${p.allowQrTables ? limit(p.maxTables) : "no"}; usuarios de equipo ${p.allowStaffUsers ? limit(p.maxStaffUsers) : "no"}; pedidos por WhatsApp ${yesNo(p.allowWhatsappOrders)}, por panel ${yesNo(p.allowPanelOrders)}; destacada en la Home ${yesNo(p.featuredInHome)}; asistente de IA ${yesNo(p.allowAiChatbot)}${p.features?.length ? `; beneficios: ${p.features.join(", ")}` : ""}.`
      : null;
  return [line(regular, "gratis"), line(business, businessPriceText(pricing))].filter(Boolean).join("\n");
}

// Respuesta lista para el chat (tabla en markdown) con los planes reales.
export async function plansAnswer() {
  const { regular, business, pricing } = await getPlansFacts();
  if (!regular && !business) {
    return { text: "Los planes se muestran al registrar tu tienda. Entra a tu panel de vendedor para verlos.", links: [link("registerVendor")] };
  }
  const r = regular;
  const b = business;
  const rows = [
    ["Precio", "Gratis", b ? businessPriceText(pricing) : "—"],
    ["Productos publicados", limit(r?.maxProducts), limit(b?.maxProducts)],
    ["Provincias donde vendes", limit(r?.maxProvinces), limit(b?.maxProvinces)],
    ["Pedidos por WhatsApp", yesNo(r?.allowWhatsappOrders), yesNo(b?.allowWhatsappOrders)],
    ["Pedidos por el panel", yesNo(r?.allowPanelOrders), yesNo(b?.allowPanelOrders)],
    ["Mesas con QR (restaurantes)", r?.allowQrTables ? limit(r?.maxTables) : "No", b?.allowQrTables ? limit(b?.maxTables) : "No"],
    ["Usuarios de equipo", r?.allowStaffUsers ? limit(r?.maxStaffUsers) : "No", b?.allowStaffUsers ? limit(b?.maxStaffUsers) : "No"],
    ["Ofertas de tienda activas", r?.allowStoreOffers ? limit(r?.maxActiveStoreOffers) : "No", b?.allowStoreOffers ? limit(b?.maxActiveStoreOffers) : "No"],
    ["Códigos de descuento", r?.allowDiscountCodes ? limit(r?.maxDiscountCodes) : "No", b?.allowDiscountCodes ? limit(b?.maxDiscountCodes) : "No"],
    ["Asistente de IA en tu tienda", yesNo(r?.allowAiChatbot), yesNo(b?.allowAiChatbot)],
    ["Destacada en la Home y búsquedas", yesNo(r?.featuredInHome), yesNo(b?.featuredInHome)],
    ["Insignia de tienda verificada", "No", "Sí, tras la verificación"],
  ];
  const table = [`| Característica | ${r?.displayName ?? "Regular"} | ${b?.displayName ?? "Business"} |`, "|---|---|---|", ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
  const text = `Estos son los planes vigentes:\n\n${table}\n\nEmpiezas gratis y puedes pasar a ${b?.displayName ?? "Business"} cuando quieras desde tu panel.`;
  return { text, links: [link("registerVendor"), link("faq")] };
}

// Respuestas fijas de procedimiento. Los pasos describen el recorrido real de la plataforma; los datos que cambian (planes
// y precios) se piden siempre a la base.
export async function sellAnswer() {
  const { business, pricing } = await getPlansFacts();
  const text = [
    "Abrir tu tienda en Baznova es gratis:",
    "",
    "1. Crea tu cuenta de vendedor.",
    "2. Confirma tu correo con el código que te enviamos.",
    "3. Completa los datos de tu tienda y publica tus productos.",
    "4. Recibe pedidos por WhatsApp o por tu panel.",
    "",
    business ? `Cuando quieras más funciones y la insignia de verificada, pasa al ${business.displayName} (${businessPriceText(pricing)}).` : "",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n")
    .trim();
  return { text, links: [link("registerVendor"), link("loginVendor")] };
}

export function buyAnswer() {
  const text = ["Comprar es sencillo:", "", "1. Busca un producto o entra a una tienda.", "2. Agrégalo al carrito (cada pedido es de una sola tienda).", "3. Confirma tus datos y elige el pago que acepte la tienda.", "4. La tienda recibe tu pedido; sigue su estado en Mis pedidos."].join("\n");
  return { text, links: [link("catalog"), link("stores"), link("registerCustomer")] };
}

export function registerAnswer({ vendor }) {
  if (vendor) {
    return { text: "Para vender, crea tu cuenta de vendedor. Es gratis y toma unos minutos.", links: [link("registerVendor"), link("loginVendor")] };
  }
  return { text: "Crea tu cuenta gratis para hacer pedidos, guardar favoritos y ver tu historial. Si ya tienes una, inicia sesión.", links: [link("registerCustomer"), link("loginCustomer")] };
}

export function loginAnswer({ vendor }) {
  const text = vendor ? "Entra a tu panel de vendedor con tu correo y contraseña. Si la olvidaste, puedes recuperarla desde esa pantalla." : "Inicia sesión con tu correo y contraseña. Si la olvidaste, puedes recuperarla desde esa pantalla.";
  return { text, links: vendor ? [link("loginVendor"), link("registerVendor")] : [link("loginCustomer"), link("registerCustomer"), link("loginVendor")] };
}

export async function verificationAnswer() {
  const { business, pricing } = await getPlansFacts();
  const text = [
    "Así se verifica una tienda:",
    "",
    "1. Entra a tu panel de vendedor, sección Verificación.",
    "2. Sube tus documentos, una foto de tu rostro y un video corto.",
    "3. Nuestro equipo los revisa.",
    `4. Si se aprueba, eliges los meses del ${business?.displayName ?? "plan Business"} (${businessPriceText(pricing)}) y envías el comprobante de pago.`,
    "",
    "La insignia indica que revisamos la identidad del negocio; no es una garantía de calidad.",
  ].join("\n");
  return { text, links: [link("loginVendor"), link("faq")] };
}
