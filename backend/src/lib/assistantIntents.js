import { currencyLabel } from "./catalog.js";
import { prisma } from "./prisma.js";
import { plansAnswer, sellAnswer, buyAnswer, registerAnswer, loginAnswer, verificationAnswer, ASSISTANT_LINKS } from "./platformFacts.js";

// Atajo del asistente de compras: las preguntas frecuentes de la plataforma (planes, registro, inicio de sesión, cómo comprar
// o vender, verificación y estado de un pedido) se responden directo desde la base de datos, sin llamar a la IA. Así la
// respuesta siempre es exacta y actual, sale en el mismo formato y no gasta tokens. Lo demás (buscar productos, preguntas
// abiertas) sigue yendo al modelo.

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const ORDER_CODE = /\bZ-[A-Z0-9]{4,}\b/i;
const MAX_LEN = 160; // un mensaje largo suele ser una búsqueda o una pregunta compuesta: lo resuelve el modelo

const RE = {
  cancel: /(cancel|anul|elimin|deshac|ya no quiero|no quiero (el|mi|este) (pedido|orden)).{0,40}(pedido|orden|compra)|(pedido|orden|compra).{0,30}(cancel|anul|equivoc|errone|por error)|me equivoque (en|con) (el|mi) pedido/,
  order: /(estado|seguimiento|rastre|donde (esta|va|anda)|como va|consult|revis|ver|saber|verific).{0,30}(pedido|orden|compra)|(mi|el) (pedido|orden)|numero de (pedido|orden)|ya (hice|realice) (un|mi) pedido/,
  plans: /\bplanes\b|\bplan (business|regular|gratis|premium|basico|estandar|empresarial)\b|que plan\b|suscripci|membresia|cuanto cuesta (vender|abrir|tener|la tienda)|precio.{0,15}(vender|tienda|business)/,
  sell: /(como|quiero|puedo|deseo|necesito|donde).{0,30}(vender|abrir.{0,10}tienda|crear.{0,10}tienda|registrar.{0,10}(tienda|negocio)|tener.{0,10}tienda)|registrar mi (tienda|negocio)|vender en /,
  buy: /como (compro|comprar|hago (un|mi) pedido|pido|se compra|funciona la compra)|quiero comprar$|como pedir/,
  verification: /verific(ar|acion|ada).{0,25}(tienda|negocio|cuenta|vendedor)|insignia|badge|sello de verificad|como (me )?verifico/,
  login: /(iniciar|inicio|entrar|acceder|ingresar|loguear|abrir).{0,15}(sesion|cuenta|panel)|\blogin\b|olvide.{0,15}(contrasena|clave|password)|recuperar.{0,15}(contrasena|clave)|no puedo (entrar|ingresar|acceder)/,
  problem: /(problema|queja|reclam|denunci|estaf|me robaron|no (me )?(llego|llegaron|ha llegado|han llegado)|nunca (me )?llego|pedido (incorrecto|equivocado|danado|roto|mal|incompleto)|me (cobraron|enviaron) (mal|de mas|otro)|(pagina|web|sitio|app|aplicacion) (no |esta |se )?(funciona|carga|abre|cae|traba|rota|caida)|no funciona|da(ndo)? error|hablar con (un |el |una )?(humano|persona|administrador|vendedor|soporte)|contactar (al )?(soporte|administrador))/,
  register: /(registr|crear|abrir|hacer|sacar).{0,15}(cuenta|usuario|perfil)|como (me )?registro|registrarme|darme de alta|sign ?up/,
};

const wantsVendor = (m) => /tienda|negocio|vender|vendedor|restaurante/.test(m);

// ---------------------------------------------------------------- estado de un pedido

const ORDER_STATUS = {
  NEW: { label: "Recibido", detail: "La tienda recibió tu pedido y un empleado lo revisará. Los pedidos se atienden en el orden en que llegan: ten paciencia, te van a contactar por WhatsApp o por teléfono." },
  PREPARING: { label: "En preparación", detail: "La tienda confirmó tu pedido y lo está preparando." },
  READY: { label: "Listo o en camino", detail: "Tu pedido está listo para entregarse o ya va en camino." },
  DELIVERED: { label: "Entregado", detail: "El pedido fue entregado." },
  CANCELLED: { label: "Cancelado", detail: "El pedido fue cancelado. Si no lo esperabas, escribe a la tienda." },
};

const nameTokens = (s) => fold(s).replace(/[^a-z\s]/g, " ").split(/\s+/).filter((t) => t.length >= 2);

// El nombre escrito tiene que coincidir con el del pedido: todas las palabras que escribe deben estar en el nombre guardado.
function nameMatches(typed, stored) {
  const t = nameTokens(typed);
  const s = new Set(nameTokens(stored));
  if (!t.length || !s.size) return false;
  return t.some((x) => x.length >= 3) && t.every((x) => s.has(x));
}

// Pedido que el cliente puede mostrar como suyo: con el número y el nombre con el que compró (o con la sesión iniciada con el correo
// del pedido). Mismo criterio que la consulta de estado: si algo no coincide no se dice qué falló, para que nadie pueda ir probando
// números de pedido.
export async function findOrderForCustomer({ code, name, sessionEmail }) {
  const cleanCode = String(code ?? "").trim().toUpperCase();
  if (!/^Z-[A-Z0-9]{4,}$/.test(cleanCode)) return null;
  const order = await prisma.order.findUnique({ where: { code: cleanCode }, include: { vendor: { select: { companyName: true, slug: true, whatsapp: true, email: true, companyAddress: true } } } });
  if (!order) return null;
  const owner = !!sessionEmail && !!order.customerEmail && order.customerEmail.trim().toLowerCase() === sessionEmail.trim().toLowerCase();
  if (!owner && !nameMatches(name, order.customerName)) return null;
  return order;
}

const money = (n) => `${Number(n).toLocaleString("es-CU")} CUP`;

export async function orderStatusAnswer({ code, name, sessionEmail }) {
  const cleanCode = String(code ?? "").trim().toUpperCase();
  if (!/^Z-[A-Z0-9]{4,}$/.test(cleanCode)) return { ok: false, reason: "code" };
  const order = await prisma.order.findUnique({
    where: { code: cleanCode },
    include: { items: { select: { name: true, quantity: true, price: true, size: true, currency: true } }, vendor: { select: { companyName: true, slug: true } } },
  });
  const owner = !!sessionEmail && !!order?.customerEmail && order.customerEmail.trim().toLowerCase() === sessionEmail.trim().toLowerCase();
  // Mismo mensaje si el código no existe o el nombre no coincide: nadie puede usarlo para saber qué pedidos existen.
  if (!order || (!owner && !nameMatches(name, order.customerName))) return { ok: false, reason: "mismatch" };

  const st = ORDER_STATUS[order.status] ?? { label: order.status, detail: "" };
  const date = new Date(order.createdAt).toLocaleDateString("es-CU", { day: "numeric", month: "long", year: "numeric" });
  const units = order.items.reduce((s, i) => s + i.quantity, 0);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const itemLines = order.items.map((i) => `  - ${i.quantity} × ${i.name}${i.size ? ` (talla ${i.size})` : ""}: ${Number(i.price).toLocaleString("es-CU")} ${currencyLabel(i.currency)} c/u`);
  const currencies = new Set(order.items.map((i) => i.currency));
  const totalText = currencies.size === 1 ? `${Number(order.total).toLocaleString("es-CU")} ${currencyLabel([...currencies][0])}` : money(order.total);
  const channel = { COD: "Pago contra entrega", ONLINE: "Pago en línea con la tienda", CASH: "Efectivo", TABLE: "Pedido de mesa" }[order.channel];
  const text = [
    `Pedido **${order.code}** de ${order.vendor.companyName}:`,
    "",
    `- Estado: **${st.label}**`,
    `- Fecha: ${date}`,
    `- Contenido: ${plural(order.items.length, "producto", "productos")}, ${plural(units, "unidad", "unidades")} en total`,
    ...itemLines,
    channel ? `- Forma de pago: ${channel}` : null,
    `- Total: ${totalText}`,
    "",
    st.detail,
  ]
    .filter((l) => l !== null)
    .join("\n");


  return { ok: true, text, links: [{ label: `Ver ${order.vendor.companyName}`, href: `/tienda/${order.vendor.slug}` }] };
}

const ORDER_ASK = "Para consultar tu pedido necesito tu nombre y el número de pedido (formato Z-1234). Escríbelos aquí abajo.";
const ORDER_FAIL = "No encontré un pedido con esos datos. Revisa que el número y tu nombre sean los de la compra.";

// Un nombre escrito junto al código: "Z-1234 Juan Pérez" (quita el código y las palabras de relleno).
function nameFromMessage(message) {
  const rest = message.replace(ORDER_CODE, " ").replace(/\b(pedido|orden|mi|el|numero|número|nombre|es|soy|de|del|estado|consultar|ver|y|con)\b/gi, " ").replace(/[^\p{L}\s]/gu, " ");
  const tokens = rest.split(/\s+/).filter((t) => t.length >= 2);
  return tokens.length >= 1 && tokens.length <= 5 ? tokens.join(" ") : "";
}

// ---------------------------------------------------------------- router principal

// Devuelve { text, actions } si la pregunta se resuelve sin IA, o null para que la atienda el modelo.
export async function routeAssistantIntent(message, { sessionEmail } = {}) {
  const raw = String(message ?? "").trim();
  if (!raw || raw.length > MAX_LEN) return null;
  const m = fold(raw);
  const codeInMessage = raw.match(ORDER_CODE)?.[0] ?? null;

  const done = (a, followUps = []) => ({ text: a.text, actions: { links: (a.links ?? []).filter(Boolean) }, followUps });

  if (RE.cancel.test(m)) {
    return {
      text: "Puedo cancelar tu pedido solo si la tienda todavía no lo ha confirmado. Necesito tu nombre, el número de pedido (formato Z-1234) y el motivo; primero reviso en qué estado está.",
      actions: { cancelForm: { code: codeInMessage ? codeInMessage.toUpperCase() : "" } },
    };
  }
  if (RE.problem.test(m)) {
    const web = /pagina|web|sitio|app|aplicacion|funciona|error/.test(m) && !/pedido|orden|compra/.test(m);
    return {
      text: web
        ? "Lamento el problema con la web. Déjame tus datos y lo que pasó para avisar al equipo; te contactarán directamente."
        : "Lamento el problema con tu pedido. Déjame tus datos y lo que pasó para avisar a quien corresponde; te contactarán directamente.",
      actions: { supportForm: { kind: web ? "WEB" : "ORDER", code: codeInMessage ? codeInMessage.toUpperCase() : "" } },
    };
  }
  if (codeInMessage || RE.order.test(m)) {
    if (codeInMessage) {
      const result = await orderStatusAnswer({ code: codeInMessage, name: nameFromMessage(raw), sessionEmail });
      if (result.ok) return { text: result.text, actions: { links: result.links }, followUps: [] };
      // Con código pero sin nombre válido: se pide el nombre en el formulario (con el código ya escrito).
      return { text: result.reason === "mismatch" && nameFromMessage(raw) ? ORDER_FAIL : ORDER_ASK, actions: { orderForm: { code: codeInMessage.toUpperCase() }, links: [ASSISTANT_LINKS.myOrders] } };
    }
    return { text: ORDER_ASK, actions: { orderForm: { code: "" }, links: [ASSISTANT_LINKS.myOrders] } };
  }
  if (RE.plans.test(m)) return done(await plansAnswer(), ["¿Cómo vender?", "¿Cómo verifico mi tienda?", "Estado de mi pedido"]);
  if (RE.verification.test(m)) return done(await verificationAnswer(), ["¿Qué planes ofrecen?", "¿Cómo vender?"]);
  if (RE.sell.test(m)) return done(await sellAnswer(), ["¿Qué planes ofrecen?", "¿Cómo verifico mi tienda?"]);
  if (RE.login.test(m)) return done(loginAnswer({ vendor: wantsVendor(m) }));
  if (RE.register.test(m)) return done(registerAnswer({ vendor: wantsVendor(m) }));
  if (RE.buy.test(m)) return done(buyAnswer(), ["Estado de mi pedido", "¿Qué tiendas están verificadas?"]);
  return null;
}

export { ORDER_ASK, ORDER_FAIL };
