import { prisma } from "./prisma.js";

// Catálogo de funciones de los planes (tabla PlanFeature). Antes cada pantalla tenía su propia lista de límites e
// interruptores (AdminSubscriptions, PlansCatalog, buildPlanIncludes, platformFacts) y se desfasaban entre sí. Ahora la
// lista sale de aquí y de la base:
//  - FEATURE_REGISTRY (este archivo) dice qué funciones sabe HACER CUMPLIR el servidor y en qué columna de PlanConfig
//    vive el valor de cada plan. El admin no puede inventar una función que el código no conoce: un interruptor sin su
//    punto de cumplimiento sería una promesa que nadie cumple.
//  - La tabla PlanFeature guarda los textos (nombre, descripción, texto público, grupo y orden). El admin los cambia sin
//    desplegar. La migración 20261129000000_dynamic_plans siembra una fila por cada entrada del registro con estos mismos
//    textos por defecto.
//  - Las funciones 'custom' las crea el admin: son casillas que se MUESTRAN (en /planes, en la ficha del plan y en "Tu plan
//    incluye") pero el servidor no las hace cumplir. Su valor por plan vive en PlanConfig.customFeatures ({ clave: true }).

export const FEATURE_GROUPS = ["Ventas", "Equipo", "Marketing", "Visibilidad", "Cobro", "Otras"];
export const FEATURE_KINDS = ["flag", "limit", "custom"];

// kind 'flag' = interruptor (columna Boolean de PlanConfig); 'limit' = tope (columna Int?, null = ilimitado, 0 = nada).
// governedBy: el interruptor del que depende un tope (con el interruptor apagado el tope vale 0, como en publicPlan).
// Los textos son los valores por defecto: los mismos que siembra la migración y los que se usan si la tabla todavía no
// tiene la fila. publicLabel admite {n} (el número) y {uno|varios} (singular o plural según el número).
export const FEATURE_REGISTRY = {
  maxProducts: {
    column: "maxProducts",
    kind: "limit",
    group: "Ventas",
    sortOrder: 10,
    label: "Productos publicados",
    description:
      "Cuántos productos puede tener visibles al público a la vez. Se cumple al crear un producto y cada vez que uno se activa: los que pasan del tope quedan en el panel como 'Fuera del cupo' y no se ven en la tienda. Al cambiar el tope se recalcula el cupo de todas las tiendas del plan. Vacío = ilimitado, 0 = ninguno.",
    publicLabel: "Hasta {n} {producto publicado|productos publicados}",
    unlimitedLabel: "Productos ilimitados",
  },
  maxProvinces: {
    column: "maxProvinces",
    kind: "limit",
    group: "Ventas",
    sortOrder: 20,
    label: "Provincias donde vende",
    description:
      "En cuántas provincias distintas puede tener zonas de venta. Se cumple al agregar una zona en una provincia nueva; las que ya tenía no se quitan. Vacío = todas las provincias.",
    publicLabel: "Vende en hasta {n} {provincia|provincias}",
    unlimitedLabel: "Vende en todas las provincias",
  },
  maxDeliveryCountries: {
    column: "maxDeliveryCountries",
    kind: "limit",
    group: "Ventas",
    sortOrder: 30,
    label: "Países de entrega",
    description:
      "A cuántos países puede enviar pedidos. Se cumple al agregar un país de entrega. Vacío = sin tope (y no se anuncia en la página de planes).",
    publicLabel: "Envíos a hasta {n} {país|países}",
    unlimitedLabel: null,
  },
  allowWhatsappOrders: {
    column: "allowWhatsappOrders",
    kind: "flag",
    group: "Ventas",
    sortOrder: 40,
    label: "Pedido también por WhatsApp",
    description:
      "Todo pedido entra al panel en cualquier plan. Con esto encendido la tienda puede ofrecer además el botón para que el cliente le mande el pedido por WhatsApp. Al apagarlo, las tiendas del plan pasan a recibir solo en el panel.",
    publicLabel: "Pedido también por WhatsApp",
  },
  allowPos: {
    column: "allowPos",
    kind: "flag",
    group: "Ventas",
    sortOrder: 50,
    label: "Caja (punto de venta)",
    description:
      "Caja con código de barras: ventas de mostrador, pantalla para el cliente, tablero de pedidos y movimientos de dinero. Sin esto la caja no abre y los enlaces de las pantallas dejan de funcionar.",
    publicLabel: "Caja con código de barras",
  },
  allowAiChatbot: {
    column: "allowAiChatbot",
    kind: "flag",
    group: "Ventas",
    sortOrder: 60,
    requiresBadge: true,
    label: "Chat con IA en la tienda",
    description:
      "Asistente con IA que responde a los clientes en la tienda y en sus productos. Solo funciona si además la tienda está verificada.",
    publicLabel: "Chat con IA en tu tienda",
  },
  allowStaffUsers: {
    column: "allowStaffUsers",
    kind: "flag",
    group: "Equipo",
    sortOrder: 70,
    label: "Usuarios del equipo",
    description:
      "La tienda puede crear usuarios para su personal. Si se apaga, el personal ya creado tampoco puede entrar al panel de la tienda.",
    publicLabel: null,
  },
  maxStaffUsers: {
    column: "maxStaffUsers",
    kind: "limit",
    governedBy: "allowStaffUsers",
    group: "Equipo",
    sortOrder: 71,
    label: "Tope de usuarios del equipo",
    description: "Cuántos usuarios del equipo puede crear. Se cumple al crear uno nuevo. Vacío = ilimitado.",
    publicLabel: "Hasta {n} {usuario del sistema|usuarios del sistema}",
    unlimitedLabel: "Usuarios del sistema ilimitados",
  },
  allowQrTables: {
    column: "allowQrTables",
    kind: "flag",
    group: "Ventas",
    sortOrder: 80,
    label: "Mesas con QR (restaurantes)",
    description:
      "Mesas con código QR: el cliente pide desde su mesa y la caja puede pasar ventas a una mesa. Sin esto no se crean mesas y los QR ya impresos dejan de aceptar pedidos.",
    publicLabel: null,
  },
  maxTables: {
    column: "maxTables",
    kind: "limit",
    governedBy: "allowQrTables",
    group: "Ventas",
    sortOrder: 81,
    label: "Tope de mesas",
    description: "Cuántas mesas puede tener. Se cumple al crear una mesa y al registrar un restaurante. Vacío = ilimitado.",
    publicLabel: "Menú con QR para hasta {n} {mesa|mesas}",
    unlimitedLabel: "Menú con QR para mesas",
  },
  allowDiscountCodes: {
    column: "allowDiscountCodes",
    kind: "flag",
    group: "Marketing",
    sortOrder: 90,
    label: "Códigos de descuento",
    description:
      "La tienda puede crear códigos de descuento. Si se apaga, el carrito rechaza sus códigos (se conservan, sin aplicarse) y sus ofertas de tienda se apagan, porque cada oferta usa un código.",
    publicLabel: null,
  },
  maxDiscountCodes: {
    column: "maxDiscountCodes",
    kind: "limit",
    governedBy: "allowDiscountCodes",
    group: "Marketing",
    sortOrder: 91,
    label: "Tope de códigos de descuento",
    description: "Cuántos códigos activos (encendidos, sin suspender y sin vencer) puede tener a la vez. Se cumple al crear uno y al volver a activarlo. Vacío = ilimitado.",
    publicLabel: "Hasta {n} {código de descuento|códigos de descuento}",
    unlimitedLabel: "Códigos de descuento",
  },
  allowStoreOffers: {
    column: "allowStoreOffers",
    kind: "flag",
    group: "Marketing",
    sortOrder: 100,
    requiresBadge: true,
    label: "Ofertas de tienda",
    description:
      "Ofertas visibles en la tienda pública, cada una con su código. Exige también 'Códigos de descuento' y que la tienda esté verificada. Si se apaga, las ofertas encendidas de las tiendas del plan se apagan.",
    publicLabel: null,
  },
  maxActiveStoreOffers: {
    column: "maxActiveStoreOffers",
    kind: "limit",
    governedBy: "allowStoreOffers",
    group: "Marketing",
    sortOrder: 101,
    label: "Tope de ofertas encendidas",
    description:
      "Cuántas ofertas de tienda puede tener encendidas a la vez. Se cumple al encender una; si se baja el tope, se apagan las más viejas. Vacío = ilimitado.",
    publicLabel: "Hasta {n} {oferta de tienda activa|ofertas de tienda activas}",
    unlimitedLabel: "Ofertas de tienda",
  },
  allowLoyalty: {
    column: "allowLoyalty",
    kind: "flag",
    group: "Marketing",
    sortOrder: 110,
    label: "Programa de puntos",
    description:
      "La tienda puede encender su programa de puntos para clientes. Si el plan no lo incluye, los clientes no ganan ni canjean puntos en esa tienda.",
    publicLabel: "Programa de puntos para tus clientes",
  },
  allowCustomerEmails: {
    column: "allowCustomerEmails",
    kind: "flag",
    group: "Marketing",
    sortOrder: 120,
    label: "Correos a clientes",
    description:
      "Correos con el nombre de la tienda a sus clientes (pedidos, mensajes, facturas, garantías, reseñas, recordatorios) y avisos automáticos de gestión (stock bajo, cierre de caja). Los correos de seguridad y de cuenta salen siempre.",
    publicLabel: null,
  },
  maxMonthlyOrderEmails: {
    column: "maxMonthlyOrderEmails",
    kind: "limit",
    governedBy: "allowCustomerEmails",
    group: "Marketing",
    sortOrder: 121,
    label: "Correos escritos a mano por mes",
    description:
      "Cuántos correos puede escribir la tienda a mano desde un pedido cada mes. Los correos automáticos no cuentan. Vacío = ilimitado.",
    // Mismo texto que deja la migración 20261130000005 en la base: solo cuentan los escritos a mano.
    publicLabel: "Hasta {n} {correo escrito|correos escritos} a mano al mes a tus clientes (los automáticos no cuentan)",
    unlimitedLabel: "Correos a tus clientes con el nombre de tu tienda",
  },
  allowSchedules: {
    column: "allowSchedules",
    kind: "flag",
    group: "Visibilidad",
    sortOrder: 130,
    label: "Horario de atención",
    description: "La tienda puede guardar su horario de atención para que los clientes lo vean.",
    publicLabel: "Horario de atención",
  },
  allowReviewPhotos: {
    column: "allowReviewPhotos",
    kind: "flag",
    group: "Visibilidad",
    sortOrder: 140,
    requiresBadge: true,
    label: "Fotos en las reseñas",
    description: "Los clientes pueden adjuntar fotos a las reseñas de la tienda. Solo funciona si además la tienda está verificada.",
    publicLabel: "Reseñas con fotos",
  },
  allowAdminChat: {
    column: "allowAdminChat",
    kind: "flag",
    group: "Otras",
    sortOrder: 150,
    requiresBadge: true,
    label: "Chat con el equipo de la plataforma",
    description: "La tienda puede escribir al equipo de la plataforma desde su panel. Solo funciona si además la tienda está verificada.",
    publicLabel: "Chat con el equipo de la plataforma",
  },
  featuredInHome: {
    column: "featuredInHome",
    kind: "flag",
    group: "Visibilidad",
    sortOrder: 160,
    requiresBadge: true,
    label: "Destacada en la portada",
    description:
      "Los productos de la tienda reciben un empujón en la portada y en la búsqueda (menor que el destacado a mano del admin). Solo funciona si además la tienda está verificada.",
    publicLabel: "Destacada en la portada",
  },
  allowPublicProfile: {
    column: "allowPublicProfile",
    kind: "flag",
    group: "Visibilidad",
    sortOrder: 170,
    label: "Opción de tienda privada",
    description:
      "La tienda puede marcarse como privada: no aparece en búsquedas ni listados y solo se entra con su enlace. Sin esto, al guardar su perfil queda siempre pública.",
    publicLabel: "Opción de tienda privada (solo con tu enlace)",
  },
  // Ya no se usa: todo pedido entra al panel en cualquier plan (ver updatePlanConfig). Se conserva la columna y la fila
  // del catálogo apagada para no romper datos viejos; nunca se muestra ni se edita.
  allowPanelOrders: {
    column: "allowPanelOrders",
    kind: "flag",
    group: "Ventas",
    sortOrder: 900,
    isActive: false,
    label: "Pedidos en el panel (sin uso)",
    description: "Ya no se usa: todo pedido entra al panel de la tienda en cualquier plan.",
    publicLabel: null,
  },
};

export const REGISTRY_KEYS = Object.keys(FEATURE_REGISTRY);

// Fila de catálogo armada solo con el registro (se usa si la base todavía no tiene la fila, por ejemplo antes de migrar).
function registryRow(key) {
  const r = FEATURE_REGISTRY[key];
  return {
    key,
    label: r.label,
    description: r.description ?? "",
    group: r.group ?? "Otras",
    kind: r.kind,
    column: r.column,
    requiresBadge: !!r.requiresBadge,
    publicLabel: r.publicLabel ?? null,
    unlimitedLabel: r.unlimitedLabel ?? null,
    sortOrder: r.sortOrder ?? 0,
    isActive: r.isActive ?? true,
  };
}

// Lo que el código decide siempre (columna, tipo e interruptor del que depende) gana sobre lo que diga la base: así una
// fila editada a mano no puede apuntar a otra columna ni cambiar un tope por un interruptor.
// pairedLimit: en un interruptor con tope propio, la clave de ese tope. Las pantallas muestran el par en una sola fila (la
// del tope, con "Incluida" + "Hasta") y saltan el interruptor, que no tiene texto público propio.
const PAIRED_LIMIT = Object.fromEntries(
  Object.entries(FEATURE_REGISTRY)
    .filter(([, f]) => f.kind === "limit" && f.governedBy)
    .map(([key, f]) => [f.governedBy, key])
);

function decorate(row) {
  const r = FEATURE_REGISTRY[row.key];
  if (!r) {
    return { ...row, kind: "custom", column: null, governedBy: null, pairedLimit: null, enforced: false, isCustom: true };
  }
  return { ...row, kind: r.kind, column: r.column, governedBy: r.governedBy ?? null, pairedLimit: PAIRED_LIMIT[row.key] ?? null, enforced: true, isCustom: false };
}

const bySort = (a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key);

// Caché igual que la de PlanConfig (5 s, ver planConfig.js): se lee en cada página de planes y en cada "Tu plan incluye".
let cache = null;
let cacheAt = 0;
const CACHE_MS = 5000;
// Última versión leída, sin vencimiento: la usan las funciones que no pueden esperar a la base (buildPlanIncludes es
// síncrona). Empieza con el registro, así nunca está vacía.
let snapshot = REGISTRY_KEYS.map((k) => decorate(registryRow(k))).sort(bySort);

// Todo el catálogo, en su orden: funciones del registro (con los textos de la base) y funciones personalizadas.
// Incluye las inactivas: cada pantalla filtra por isActive según lo que muestre.
export async function getPlanFeatureCatalog() {
  if (cache && Date.now() - cacheAt < CACHE_MS) return cache;
  let rows = [];
  try {
    rows = await prisma.planFeature.findMany();
  } catch (err) {
    // Sin la tabla (base sin migrar) se sigue con el registro: nada deja de funcionar por el catálogo.
    console.warn("[planes] no se pudo leer el catálogo de funciones:", err?.message);
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const key of REGISTRY_KEYS) if (!byKey.has(key)) byKey.set(key, registryRow(key));
  cache = [...byKey.values()].map(decorate).sort(bySort);
  cacheAt = Date.now();
  snapshot = cache;
  return cache;
}

// Versión síncrona: la última lectura (o el registro si nunca se leyó). Solo para código que no puede ser async.
export function getPlanFeatureCatalogSync() {
  return snapshot;
}

// Se llama después de crear, editar o borrar una función del catálogo.
export function invalidatePlanFeatureCatalogCache() {
  cache = null;
}

// Clave estable para una función personalizada nueva a partir de su nombre: "Soporte prioritario" -> "custom_soporte_prioritario".
// Única contra todo el catálogo; si ya existe se agrega _2, _3...
export function featureKeyFromLabel(label, existingKeys = []) {
  const slug =
    String(label ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32)
      .replace(/_+$/g, "") || "funcion";
  const base = `custom_${slug}`;
  const taken = new Set([...existingKeys, ...REGISTRY_KEYS]);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

// Texto público de una función con su número: {n} se cambia por el número y {uno|varios} elige singular o plural.
export function formatFeatureText(template, n) {
  if (!template) return null;
  return String(template)
    .replace(/\{n\}/g, String(n))
    .replace(/\{([^{}|]*)\|([^{}]*)\}/g, (_m, one, many) => (Number(n) === 1 ? one : many));
}

// Valor de una función del catálogo en un plan: { enabled, limit }.
//  - flag: enabled = el interruptor; limit = null.
//  - limit: enabled = su interruptor (o true si no depende de ninguno); limit = el tope (null = ilimitado). Con el
//    interruptor apagado el tope efectivo es 0, igual que en publicPlan y planFeaturesOf.
//  - custom: enabled = PlanConfig.customFeatures[clave] === true; limit = null.
export function featureValue(config, feature) {
  if (!config || !feature) return { enabled: false, limit: null };
  if (feature.kind === "custom") return { enabled: customFeaturesOf(config)[feature.key] === true, limit: null };
  if (feature.kind === "flag") return { enabled: !!config[feature.column], limit: null };
  const governedOn = feature.governedBy ? !!config[FEATURE_REGISTRY[feature.governedBy]?.column] : true;
  return { enabled: governedOn, limit: governedOn ? config[feature.column] ?? null : 0 };
}

// PlanConfig.customFeatures limpio: solo claves con true.
export function customFeaturesOf(config) {
  const raw = config?.customFeatures;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v === true));
}

// Funciones de un plan para mostrar (página de planes, ficha del plan, panel): solo las activas del catálogo, en su orden,
// con su valor en el plan y el texto público ya armado (null si no se anuncia).
export function planFeatureList(config, catalog = getPlanFeatureCatalogSync()) {
  return catalog
    .filter((f) => f.isActive)
    .map((f) => {
      const { enabled, limit } = featureValue(config, f);
      return {
        key: f.key,
        label: f.label,
        group: f.group,
        kind: f.kind,
        governedBy: f.governedBy,
        pairedLimit: f.pairedLimit,
        requiresBadge: f.requiresBadge,
        enforced: f.enforced,
        enabled,
        limit,
        publicText: publicTextOf(f, enabled, limit),
      };
    });
}

function publicTextOf(feature, enabled, limit) {
  if (!enabled) return null;
  if (feature.kind === "limit") return limit == null ? feature.unlimitedLabel || null : formatFeatureText(feature.publicLabel, limit);
  return feature.publicLabel || (feature.kind === "custom" ? feature.label : null);
}

// Líneas de "Tu plan incluye" a partir del catálogo, en el mismo orden que tenían antes del catálogo: primero los topes
// sueltos (productos, provincias, países), después "Pedidos en tu panel" (lo tiene todo plan), después interruptores y
// topes con su interruptor en el orden del catálogo, la insignia y al final las funciones personalizadas.
// Un interruptor con tope propio (usuarios, mesas, códigos, ofertas, correos) se anuncia con el texto de su tope.
export function renderPlanIncludes(config, catalog = getPlanFeatureCatalogSync()) {
  if (!config) return [];
  const active = catalog.filter((f) => f.isActive);
  const governedFlags = new Set(active.filter((f) => f.kind === "limit" && f.governedBy).map((f) => f.governedBy));
  const lines = [];
  for (const f of active) {
    if (f.kind !== "limit" || f.governedBy) continue;
    const text = publicTextOf(f, true, config[f.column] ?? null);
    if (text) lines.push(text);
  }
  lines.push("Pedidos en tu panel");
  for (const f of active) {
    if (f.kind === "custom" || (f.kind === "limit" && !f.governedBy) || governedFlags.has(f.key)) continue;
    // Una función que exige la insignia no se anuncia en un plan que no la da: sus tiendas nunca podrían usarla (la tabla
    // comparativa de /planes la marca igual, "Requiere un plan con insignia").
    // Un tope con interruptor (ofertas de tienda) la exige por su interruptor.
    const needsBadge = f.requiresBadge || (!!f.governedBy && !!active.find((x) => x.key === f.governedBy)?.requiresBadge);
    if (needsBadge && !config.grantsBadge) continue;
    const { enabled, limit } = featureValue(config, f);
    const text = publicTextOf(f, enabled, limit);
    if (text) lines.push(text);
  }
  if (config.grantsBadge) lines.push("Insignia de tienda verificada");
  for (const f of active) {
    if (f.kind !== "custom") continue;
    const { enabled } = featureValue(config, f);
    const text = publicTextOf(f, enabled, null);
    if (text) lines.push(text);
  }
  return lines;
}

// Revisión al arrancar: avisa por consola si el catálogo de la base y el registro del código no coinciden. No corta el
// arranque: una función sin fila usa los textos del registro, y una fila de la base sin registro se trata como personalizada.
export async function checkFeatureCatalog() {
  const result = { ok: true, missingInDb: [], unknownInDb: [], badColumns: [] };
  let rows;
  try {
    rows = await prisma.planFeature.findMany({ select: { key: true, kind: true, column: true } });
  } catch (err) {
    console.warn("[planes] no se pudo revisar el catálogo de funciones:", err?.message);
    return { ...result, ok: false, error: err?.message };
  }
  const inDb = new Map(rows.map((r) => [r.key, r]));
  for (const key of REGISTRY_KEYS) {
    const row = inDb.get(key);
    if (!row) result.missingInDb.push(key);
    else if (row.kind !== FEATURE_REGISTRY[key].kind || row.column !== FEATURE_REGISTRY[key].column) result.badColumns.push(key);
  }
  // Una fila 'flag' o 'limit' que el código no conoce no la cumple nadie: el admin creería que limita algo.
  for (const row of rows) if (row.kind !== "custom" && !FEATURE_REGISTRY[row.key]) result.unknownInDb.push(row.key);
  // Cada columna del registro tiene que existir en PlanConfig (si alguien la renombra en el esquema y no aquí, se avisa).
  try {
    const { Prisma } = await import("@prisma/client");
    const fields = new Set(Prisma.dmmf?.datamodel?.models?.find((m) => m.name === "PlanConfig")?.fields?.map((f) => f.name) ?? []);
    if (fields.size) for (const key of REGISTRY_KEYS) if (!fields.has(FEATURE_REGISTRY[key].column)) result.badColumns.push(key);
  } catch {
    // Sin el modelo de datos de Prisma a mano no se comprueban las columnas; lo demás sigue valiendo.
  }
  result.badColumns = [...new Set(result.badColumns)];
  result.ok = !result.missingInDb.length && !result.unknownInDb.length && !result.badColumns.length;
  if (result.missingInDb.length) console.warn(`[planes] funciones del código sin fila en PlanFeature: ${result.missingInDb.join(", ")}`);
  if (result.unknownInDb.length) console.warn(`[planes] funciones en PlanFeature que el servidor no hace cumplir: ${result.unknownInDb.join(", ")}`);
  if (result.badColumns.length) console.warn(`[planes] funciones con tipo o columna distinta entre la base y el código: ${result.badColumns.join(", ")}`);
  return result;
}
