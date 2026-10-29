import { getAllPlanConfigs, buildPlanIncludes, normalizeMonthDiscounts } from "./planConfig.js";
import { planFeatureList } from "./planFeatures.js";

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
  plans: { label: "Ver los planes", href: "/planes" },
};

const link = (key) => ASSISTANT_LINKS[key];

const limit = (n, unit = "") => (n == null ? "Sin límite" : `${n}${unit ? ` ${unit}` : ""}`);

// Planes públicos vigentes (los mismos que muestra /planes), en su orden. Sin caché propia: getAllPlanConfigs ya guarda 5 s y
// se invalida al guardar un plan en el admin, así Nova cambia de respuesta en cuanto cambia el plan. Antes esto leía los precios
// de SiteSettings (que ya no se editan en ninguna pantalla) y solo conocía dos planes, Regular y Business.
export async function getPlansFacts() {
  const plans = (await getAllPlanConfigs()).filter((p) => p.isPublic);
  return { plans };
}

// Mismo formato que la página de planes (fmt en PlansCatalog.jsx).
const money = (n, currency) =>
  `${Number(n).toLocaleString("es-CU", { maximumFractionDigits: currency === "USD" ? 2 : 0, minimumFractionDigits: currency === "USD" && n % 1 ? 2 : 0 })} ${currency}`;

// Precio de un plan tal como lo muestra la página de planes (PlansCatalog.jsx): "a la medida" si se contrata por WhatsApp,
// gratis con el precio normal al lado si por ahora no se cobra, o el precio mensual en CUP y con tarjeta en USD.
function priceText(p) {
  if (p.contactOnly) return "precio a la medida, se contrata hablando con el equipo por WhatsApp";
  if (p.isFree) {
    const list = [p.listPriceCup > 0 && money(p.listPriceCup, "CUP"), p.listPriceUsd > 0 && money(p.listPriceUsd, "USD")].filter(Boolean);
    return list.length ? `gratis por ahora (precio normal: ${list.join(" o ")} al mes)` : "gratis por ahora";
  }
  const parts = [];
  if (Number(p.priceCup) > 0) parts.push(`${money(p.priceCup, "CUP")} al mes por transferencia`);
  if (Number(p.priceUsd) > 0) parts.push(`${money(p.priceUsd, "USD")} al mes con tarjeta`);
  return parts.length ? parts.join(" o ") : "consulta el precio en la página de planes";
}

// Descuentos por pagar varios meses juntos (PlanConfig.monthDiscounts), en texto. Vacío si el plan no tiene o no se cobra.
function discountsText(p) {
  if (p.isFree || p.contactOnly) return "";
  return normalizeMonthDiscounts(p.monthDiscounts)
    .map((d) => (d.cup === d.usd ? `${d.months} meses: ${d.cup} % menos` : `${d.months} meses: ${d.cup} % menos en CUP y ${d.usd} % con tarjeta`))
    .join("; ");
}

const capitalize = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// Texto compacto para el prompt del modelo cuando la pregunta toca planes (solo se envía en esos casos). Lo que incluye cada
// plan sale de buildPlanIncludes, el mismo texto de la página de planes: nunca dicen cosas distintas.
export async function planFactsForPrompt() {
  const { plans } = await getPlansFacts();
  if (plans.length === 0) return "- Los planes se muestran en la página de planes (/planes).";
  return plans
    .map((p) => {
      const discounts = discountsText(p);
      return `- Plan ${p.displayName}. Precio: ${priceText(p)}.${discounts ? ` Descuentos por pagar varios meses: ${discounts}.` : ""} Incluye: ${buildPlanIncludes(p).join("; ")}.`;
    })
    .join("\n");
}

// Respuesta lista para el chat (tabla en markdown) con todos los planes públicos, una columna por plan.
// Las filas salen del catálogo de funciones (planFeatureList, el mismo de la página de planes): antes eran una lista fija
// aquí y no mostraban las funciones nuevas ni las personalizadas que crea el admin. Un interruptor con tope (usuarios,
// mesas, códigos, ofertas, correos) va en UNA fila con el nombre del interruptor y el valor del tope ("No" si está apagado).
export async function plansAnswer() {
  const { plans } = await getPlansFacts();
  if (plans.length === 0) {
    return { text: "Los planes se muestran al registrar tu tienda. Entra a tu panel de vendedor para verlos.", links: [link("plans"), link("registerVendor")] };
  }
  const cell = (fn) => plans.map(fn);
  const lists = plans.map((p) => planFeatureList(p));
  const labelOf = (key) => lists[0].find((f) => f.key === key)?.label ?? key;
  // Valor de una función en un plan: tope ("Sin límite", el número o "No") o Sí/No.
  const valueOf = (f) => (!f?.enabled ? "No" : f.kind === "limit" ? limit(f.limit) : "Sí");
  const featureRows = lists[0]
    .filter((f) => !f.pairedLimit)
    .map((f) => [f.governedBy ? labelOf(f.governedBy) : f.label, ...lists.map((list) => valueOf(list.find((x) => x.key === f.key)))]);
  const rows = [
    ["Precio", ...cell((p) => capitalize(priceText(p)))],
    ["Pedidos en tu panel", ...cell(() => "Sí")],
    ...featureRows,
    ["Insignia de tienda verificada", ...cell((p) => (p.grantsBadge ? "Sí, tras la verificación" : "No"))],
  ];
  const table = [`| Característica | ${plans.map((p) => p.displayName).join(" | ")} |`, `|---|${plans.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
  const discountLines = plans.map((p) => [p.displayName, discountsText(p)]).filter(([, d]) => d);
  const discounts = discountLines.length ? `\n\nDescuentos por pagar varios meses juntos:\n${discountLines.map(([name, d]) => `- ${name}: ${d}`).join("\n")}` : "";
  // Toda tienda nueva entra en el plan por defecto (isDefault): solo se puede decir "empieza gratis" si ESE plan es gratis.
  const start = plans.find((p) => p.isDefault && p.isFree);
  const outro = start ? `Puedes empezar gratis con el plan ${start.displayName} y cambiar de plan cuando quieras desde tu panel.` : "Puedes cambiar de plan cuando quieras desde tu panel.";
  const text = `Estos son los planes vigentes:\n\n${table}${discounts}\n\n${outro}`;
  return { text, links: [link("plans"), link("registerVendor")] };
}

// Planes de pago con insignia (los que piden la verificación), con su precio. Ej.: "Estándar (…) o Premium (…)".
function badgePlansText(plans, joiner = "o") {
  const list = plans.filter((p) => p.grantsBadge && !p.contactOnly && !p.isFree).map((p) => `${p.displayName} (${priceText(p)})`);
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} ${joiner} ${list[list.length - 1]}`;
}

// Respuestas fijas de procedimiento. Los pasos describen el recorrido real de la plataforma; los datos que cambian (planes
// y precios) se piden siempre a la base.
export async function sellAnswer() {
  const { plans } = await getPlansFacts();
  // El plan en el que se abre la tienda es el por defecto (isDefault); "gratis" solo si ese plan lo es.
  const free = plans.find((p) => p.isDefault && p.isFree);
  const badgePlans = badgePlansText(plans);
  const text = [
    free ? `Abrir tu tienda en Baznova es gratis con el plan ${free.displayName}:` : "Así abres tu tienda en Baznova:",
    "",
    "1. Crea tu cuenta de vendedor.",
    "2. Confirma tu correo con el código que te enviamos.",
    "3. Completa los datos de tu tienda y publica tus productos.",
    "4. Recibe pedidos por WhatsApp o por tu panel.",
    "",
    badgePlans ? `Cuando quieras más funciones y la insignia de tienda verificada, pasa a ${badgePlans}.` : "",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n")
    .trim();
  return { text, links: [link("registerVendor"), link("plans")] };
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
  const { plans } = await getPlansFacts();
  const badgePlans = badgePlansText(plans, "y");
  const text = [
    "Así se verifica una tienda:",
    "",
    "1. Entra a tu panel de vendedor, sección Verificación.",
    "2. Sube tus documentos, una foto de tu rostro y un video corto.",
    "3. Nuestro equipo los revisa.",
    "4. Si se aprueba, eliges el plan y los meses y envías el comprobante de pago.",
    "",
    ...(badgePlans ? [`Los planes con insignia de tienda verificada son ${badgePlans}.`, ""] : []),
    "La insignia indica que revisamos la identidad del negocio; no es una garantía de calidad.",
  ].join("\n");
  return { text, links: [link("loginVendor"), link("plans")] };
}
