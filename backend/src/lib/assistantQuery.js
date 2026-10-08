import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

// Bloque 262 (pedido explícito — "el asistente debe tener acceso total a todo lo
// de la base de datos del negocio, desde registros de acceso hasta cada
// detalle"): una herramienta de consulta GENÉRICA y de solo lectura sobre todas
// las tablas del negocio. El modelo elige una tabla de una lista blanca, filtros,
// orden, conteo o agrupación; el servidor traduce eso a una consulta de Prisma.
// Garantías:
//   - Solo existen las tablas y campos de este registro: nunca contraseñas,
//     tokens, hashes, claves, documentos de verificación ni correos de nadie.
//   - En el ámbito VENDOR cada tabla lleva SIEMPRE su filtro de tienda (el
//     vendorId sale de la sesión, nunca de un argumento) combinado con AND: el
//     modelo no puede salirse de su negocio.
//   - El modelo nunca recorre relaciones ni escribe SQL: solo nombra campos del
//     registro, y cada valor se convierte según el tipo del campo.
//   - Tope de filas y de largo de texto: el resultado llega al modelo como DATO.
//
// Tipos de campo: s=texto o valor de lista, n=número, d=fecha, b=sí/no.

const MAX_ROWS = 15;
const OPS = ["=", "!=", ">", ">=", "<", "<=", "contiene"];
const OPS_BY_TYPE = { s: ["=", "!=", "contiene"], n: ["=", "!=", ">", ">=", "<", "<="], d: [">", ">=", "<", "<="], b: ["="] };

// `scope(ctx)`: filtro obligatorio de la tabla en el ámbito VENDOR (null = la
// tabla no existe para vendedores). `vendorRel`: ruta a la tienda para mostrar
// su nombre al admin. `adminScope`: filtro fijo en el ámbito ADMIN.
const T = {
  pedidos: { model: "order", label: "pedidos normales", vendorRel: ["vendor"], scope: (c) => ({ vendorId: c.vendorId }), fields: { code: "s", customerName: "s", total: "n", status: "s", channel: "s", cancelReason: "s", discountAmount: "n", createdAt: "d" } },
  pedidos_de_mesa: { model: "tableOrder", label: "pedidos de mesa", vendorRel: ["table", "vendor"], scope: (c) => ({ table: { vendorId: c.vendorId } }), fields: { orderNumber: "n", total: "n", kitchenStatus: "s", customerName: "s", cancelReason: "s", createdAt: "d", deliveredAt: "d", cancelledAt: "d" } },
  productos: { model: "product", label: "productos", vendorRel: ["vendor"], scope: (c) => ({ vendorId: c.vendorId }), fields: { name: "s", price: "n", oldPrice: "n", currency: "s", stock: "n", unlimitedStock: "b", isActive: "b", isFeatured: "b", hiddenFromStore: "b", overQuota: "b", salesCount: "n", viewCount: "n", clickCount: "n", searchClickCount: "n", rating: "n", reviewCount: "n", badge: "s", createdAt: "d", lastActivityAt: "d" } },
  resenas: { model: "review", label: "reseñas de la tienda y de sus productos", vendorRel: ["vendor"], scope: (c) => ({ OR: [{ vendorId: c.vendorId }, { product: { vendorId: c.vendorId } }] }), fields: { authorName: "s", rating: "n", comment: "s", isVerifiedPurchase: "b", isHidden: "b", vendorReply: "s", createdAt: "d" } },
  actividad_registrada: { model: "activityLog", label: "registro de actividad del panel (quién hizo qué)", vendorRel: ["vendor"], scope: (c) => ({ vendorId: c.vendorId }), fields: { action: "s", description: "s", actorRole: "s", createdAt: "d" } },
  sesiones_del_dueno: { model: "session", label: "inicios de sesión del dueño (dispositivo y fechas)", scope: (c) => ({ userId: c.userId }), fields: { createdAt: "d", lastUsedAt: "d", expiresAt: "d", revokedAt: "d", userAgent: "s" } },
  mensajes_con_la_plataforma: { model: "vendorMessage", label: "mensajes con el equipo de la plataforma", vendorRel: ["vendor"], scope: (c) => ({ vendorId: c.vendorId }), fields: { senderRole: "s", body: "s", readAt: "d", createdAt: "d" } },
  notificaciones: { model: "vendorNotification", label: "notificaciones del panel", vendorRel: ["vendor"], scope: (c) => ({ vendorId: c.vendorId }), fields: { type: "s", title: "s", body: "s", readAt: "d", createdAt: "d" } },
  ofertas_del_home: { model: "offer", label: "ofertas del Home", vendorRel: ["vendor"], scope: (c) => ({ vendorId: c.vendorId }), fields: { title: "s", status: "s", contentType: "s", discountLabel: "s", startsAt: "d", expiresAt: "d", createdAt: "d" } },
  codigos_de_descuento: { model: "discountCode", label: "códigos de descuento", vendorRel: ["vendor"], scope: (c) => ({ vendorId: c.vendorId }), fields: { code: "s", type: "s", value: "n", usesCount: "n", maxUses: "n", active: "b", startsAt: "d", expiresAt: "d", createdAt: "d" } },
  ofertas_de_tienda: { model: "storeOffer", label: "ofertas de la tienda", vendorRel: ["vendor"], scope: (c) => ({ vendorId: c.vendorId }), fields: { title: "s", active: "b", isLimitedTime: "b", startsAt: "d", expiresAt: "d", createdAt: "d" } },
  reportes_de_fraude: { model: "report", label: "reportes de fraude recibidos", vendorRel: ["vendor"], scope: (c) => ({ vendorId: c.vendorId }), fields: { status: "s", message: "s", evidenceDueAt: "d", createdAt: "d" } },
  chat_de_la_tienda: { model: "chatMessage", label: "mensajes del chat de la tienda con clientes", vendorRel: ["vendor"], scope: (c) => ({ vendorId: c.vendorId }), fields: { role: "s", content: "s", createdAt: "d" } },
  clics_de_productos: { model: "productClickEvent", label: "clics en productos (origen y fecha)", scope: (c) => ({ product: { vendorId: c.vendorId } }), fields: { source: "s", createdAt: "d" } },
  visitas_y_carritos: { model: "vendorEngagement", label: "visitas y productos agregados al carrito por clientes con sesión", vendorRel: ["vendor"], scope: (c) => ({ vendorId: c.vendorId }), fields: { type: "s", createdAt: "d" } },
  favoritos: { model: "favorite", label: "favoritos de la tienda y de sus productos", scope: (c) => ({ OR: [{ vendorId: c.vendorId }, { product: { vendorId: c.vendorId } }] }), fields: { createdAt: "d" } },
  pagos_de_suscripcion: { model: "subscriptionPayment", label: "pagos de renovación de la suscripción", vendorRel: ["vendor"], scope: (c) => ({ vendorId: c.vendorId }), fields: { paymentMethod: "s", months: "n", amount: "n", currency: "s", claimedAt: "d", confirmedAt: "d", periodStart: "d", periodEnd: "d", createdAt: "d" } },
  cambios_de_estado_de_la_tienda: { model: "vendorStatusLog", label: "cambios de estado (suspensión, reactivación)", vendorRel: ["vendor"], scope: (c) => ({ vendorId: c.vendorId }), fields: { fromStatus: "s", toStatus: "s", reason: "s", at: "d" } },
  cambios_de_verificacion: { model: "verificationStatusLog", label: "historial de verificación y plan", vendorRel: ["vendor"], scope: (c) => ({ vendorId: c.vendorId }), fields: { fromStatus: "s", toStatus: "s", reason: "s", source: "s", at: "d" } },
  personal_del_negocio: { model: "vendorStaff", label: "usuarios de sistema de la tienda (agentes de ventas y meseros)", vendorRel: ["vendor"], scope: (c) => ({ vendorId: c.vendorId }), fields: { staffType: "s", isActive: "b", receivesOrderNotifications: "b", createdAt: "d" } },
  ventas_de_agentes: { model: "vendorStaffSale", label: "ventas manuales de los agentes de ventas", vendorRel: ["vendor"], scope: (c) => ({ vendorId: c.vendorId }), fields: { productName: "s", quantity: "n", unitPrice: "n", total: "n", note: "s", createdAt: "d" } },
  cierres_de_caja_de_agentes: { model: "vendorStaffCashClose", label: "cierres de caja de los agentes", scope: (c) => ({ vendorStaff: { vendorId: c.vendorId } }), fields: { periodStart: "d", periodEnd: "d", totalSales: "n", reportedAt: "d", note: "s" } },
  solicitudes_de_producto: { model: "productRequest", label: "productos que clientes pidieron a la tienda", vendorRel: ["vendor"], scope: (c) => ({ vendorId: c.vendorId }), fields: { createdAt: "d" } },
  productos_de_los_pedidos: { model: "orderItem", label: "productos dentro de cada pedido (qué se compró)", scope: (c) => ({ order: { vendorId: c.vendorId } }), fields: { name: "s", quantity: "n", price: "n", size: "s", currency: "s" } },
  mesas: { model: "table", label: "mesas con QR", vendorRel: ["vendor"], scope: (c) => ({ vendorId: c.vendorId }), fields: { tableNumber: "n", label: "s" } },
};

// Bloque 276 (pedido explícito — "el asistente del admin debe tener acceso total a la base de
// datos, poder leer y visualizar todo"): en el ámbito ADMIN las tablas ya no son una lista
// escrita a mano. Se generan desde el propio esquema de Prisma, así que TODA tabla del sistema
// (ventas rápidas, agentes de ventas, personas, clientes, tiendas...) existe para el asistente y
// cualquier tabla nueva que se agregue en el futuro aparece sola. Siguen fuera, siempre:
// contraseñas, hashes, claves, secretos, códigos de verificación, números de identificación,
// documentos y fotos de verificación, enlaces a archivos y las conversaciones privadas de otros.
const DENY_MODELS = new Set(["Integration", "AdminActionCode", "TrustedDevice", "PendingRegistration", "AssistantMessage", "AssistantConversation", "VerificationRequest", "VerificationArchive"]);
const SECRET_FIELD = /(hash|secret|token|password|totp|twofactor|resetcode|emailchangecode|apikey|passphrase|otp|cvv|iban|stripe|idnumber|taxid|selfie|signature|encrypted|enc$|url$|urls$|ipaddress)/i;
const PRISMA_TYPE = { String: "s", Int: "n", Float: "n", Decimal: "n", BigInt: "n", DateTime: "d", Boolean: "b" };
// Relaciones que se muestran con un nombre legible en vez de un id.
const RELATION_PICK = { Vendor: "companyName", User: "fullName", Product: "name" };
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// Nombres cortos en español para las tablas que más se preguntan; el resto se llama por el
// nombre del modelo (ej. "customerListing").
const ADMIN_ALIASES = {
  tiendas: { model: "Vendor", label: "todas las tiendas (suspendidas: status=SUSPENDED; bloqueadas: isBlocked=true)", adminScope: { deletedAt: null } },
  clientes: { model: "User", label: "clientes registrados con su perfil", adminScope: { role: "CUSTOMER", deletedAt: null } },
  usuarios: { model: "User", label: "TODAS las personas con cuenta (clientes, dueños de tienda, administradores y usuarios de sistema) y su perfil", adminScope: { deletedAt: null } },
  ventas_rapidas: { model: "CustomerListing", label: "anuncios de venta rápida publicados por clientes", adminScope: {} },
  agentes_de_ventas: { model: "VendorStaff", label: "usuarios de sistema de las tiendas (agentes de ventas y meseros); staffType=SALES_AGENT son los agentes de ventas", adminScope: {} },
  ventas_de_agentes: { model: "VendorStaffSale", label: "ventas manuales hechas por los agentes de ventas", adminScope: {} },
  cierres_de_caja_de_agentes: { model: "VendorStaffCashClose", label: "cierres de caja de los agentes de ventas", adminScope: {} },
  solicitudes_de_producto: { model: "ProductRequest", label: "productos que los clientes pidieron a las tiendas", adminScope: {} },
  errores: { model: "ErrorLog", label: "errores del sistema", adminScope: {} },
  sesiones: { model: "Session", label: "sesiones de toda la plataforma", adminScope: {} },
  anomalias_del_ranking: { model: "RankingAnomaly", label: "anomalías del ranking", adminScope: {} },
  solicitudes_de_ubicacion: { model: "LocationSuggestion", label: "ubicaciones escritas a mano pendientes de revisar", adminScope: {} },
};

function autoTable(modelName, label, adminScope = {}, described = true) {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === modelName);
  if (!m) return null;
  const fields = {};
  for (const f of m.fields) {
    if (f.kind === "object" || f.isList || SECRET_FIELD.test(f.name)) continue;
    const type = PRISMA_TYPE[f.type] ?? (f.kind === "enum" ? "s" : null);
    if (type) fields[f.name] = type;
  }
  const rels = m.fields
    .filter((f) => f.kind === "object" && !f.isList && f.relationFromFields?.length && RELATION_PICK[f.type])
    .map((f) => ({ key: f.name === "vendor" ? "tienda" : f.name, path: [f.name], pick: RELATION_PICK[f.type] }));
  const vendorPath = m.fields.some((f) => f.name === "vendor" && f.kind === "object") ? ["vendor"] : null;
  return { model: lowerFirst(modelName), label, adminScope, fields, rels, vendorPath, described };
}

function adminRegistry() {
  const out = {};
  const covered = new Set();
  for (const [name, a] of Object.entries(ADMIN_ALIASES)) {
    const t = autoTable(a.model, a.label, a.adminScope);
    if (t) {
      out[name] = t;
      covered.add(a.model);
    }
  }
  for (const [name, t] of Object.entries(T)) {
    if (name === "sesiones_del_dueno") continue;
    out[name] = { ...t, adminScope: {}, rels: t.vendorRel ? [{ key: "tienda", path: t.vendorRel, pick: "companyName" }] : [], vendorPath: t.vendorRel ?? null, described: true };
    covered.add(t.model.charAt(0).toUpperCase() + t.model.slice(1));
  }
  for (const m of Prisma.dmmf.datamodel.models) {
    if (DENY_MODELS.has(m.name) || covered.has(m.name)) continue;
    const t = autoTable(m.name, m.name, {}, false);
    if (t && Object.keys(t.fields).length) out[t.model] = t;
  }
  return out;
}

function registryFor(scope) {
  if (scope === "VENDOR") {
    const out = {};
    for (const [name, t] of Object.entries(T)) out[name] = { ...t, rels: [], vendorPath: null, described: true };
    return out;
  }
  return adminRegistry();
}

const clip = (v) => (typeof v === "string" && v.length > 140 ? `${v.slice(0, 140)}...` : v);

function coerce(type, value) {
  if (type === "n") {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error("número inválido");
    return n;
  }
  if (type === "d") {
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) throw new Error("fecha inválida (usa AAAA-MM-DD)");
    return d;
  }
  if (type === "b") return value === true || value === "true" || value === "sí" || value === "si";
  return String(value);
}

function condition(type, op, value) {
  const v = coerce(type, value);
  if (op === "=") return v;
  if (op === "!=") return { not: v };
  if (op === "contiene") return { contains: String(v), mode: "insensitive" };
  return { [{ ">": "gt", ">=": "gte", "<": "lt", "<=": "lte" }[op]]: v };
}

function nestedSelect(path, pick = "companyName") {
  return path.reduceRight((inner, key, i) => ({ [key]: i === path.length - 1 ? { select: { [pick]: true } } : { select: inner } }), null);
}
const nestedWhere = (path, leaf) => path.reduceRight((inner, key) => ({ [key]: inner }), leaf);
const dig = (row, path) => path.reduce((acc, k) => acc?.[k], row);

function cleanRow(row, fieldTypes, rels) {
  const out = {};
  for (const key of Object.keys(fieldTypes)) {
    let v = row[key];
    if (v == null) {
      out[key] = null;
      continue;
    }
    if (v instanceof Date) v = v.toISOString();
    else if (typeof v === "object" && typeof v.toNumber === "function") v = Math.round(v.toNumber() * 100) / 100;
    out[key] = clip(v);
  }
  for (const r of rels ?? []) out[r.key] = dig(row, r.path)?.[r.pick] ?? null;
  return out;
}

// Versión corta para el prompt: solo nombre y etiqueta de cada tabla. Los campos
// completos pesaban ~2.000 tokens en CADA pedido a la IA (y el plan gratis de Groq
// da 8.000 por minuto); la IA los ve al hacer una consulta con limite 1, o en el
// mensaje de error si pide un campo que no existe.
export function describeQueryTablesShort(scope) {
  return Object.entries(registryFor(scope))
    .map(([name, t]) => (t.described ? `${name} (${t.label})` : name))
    .join(", ");
}

export function describeQueryTables(scope) {
  return Object.entries(registryFor(scope))
    .map(([name, t]) => (t.described ? `${name} (${t.label}): ${Object.entries(t.fields).map(([f, ty]) => `${f}:${ty}`).join(", ")}` : name))
    .join("\n    ");
}

export function makeQueryTool(scope) {
  const registry = registryFor(scope);
  const tables = Object.keys(registry);
  return {
    description:
      "Consulta CUALQUIER tabla del negocio (solo lectura) cuando ninguna otra herramienta da el dato. Filtros con operadores (=, !=, >, >=, <, <=, contiene; fechas AAAA-MM-DD), orden, contar:true o agrupar_por (+ sumar). Para filtrar por tienda usa \"tienda\":\"nombre\". Si no conoces los campos de una tabla, haz una consulta con limite 1 y los verás. Tablas: " + describeQueryTablesShort(scope) + ".",
    args: '{ "tabla": "...", "filtros": [{"campo":"...","op":"=","valor":...}] (opcional), "orden": {"campo":"...","dir":"asc"|"desc"} (opcional), "tienda": "nombre de la tienda" (opcional), "limite": 1-15, "campos": ["..."] (opcional), "contar": true (opcional), "agrupar_por": "campo" (opcional), "sumar": "campo numérico" (opcional) }',
    schema: z.object({
      tabla: z.enum(tables),
      filtros: z.array(z.object({ campo: z.string().max(40), op: z.enum(OPS), valor: z.union([z.string().max(120), z.number(), z.boolean()]) })).max(5).default([]),
      orden: z.object({ campo: z.string().max(40), dir: z.enum(["asc", "desc"]).default("desc") }).optional(),
      tienda: z.string().max(60).optional(),
      limite: z.number().int().min(1).max(MAX_ROWS).default(8),
      campos: z.array(z.string().max(40)).max(12).optional(),
      contar: z.boolean().optional(),
      agrupar_por: z.string().max(40).optional(),
      sumar: z.string().max(40).optional(),
    }),
    async run(args, ctx) {
      const table = registry[args.tabla];
      const fields = table.fields;
      const must = (campo) => {
        if (!fields[campo]) throw new Error(`El campo "${campo}" no existe en ${args.tabla}. Campos: ${Object.keys(fields).join(", ")}`);
        return fields[campo];
      };
      try {
        const base = scope === "VENDOR" ? table.scope(ctx) : table.adminScope ?? {};
        const mine = args.filtros.map((f) => {
          const type = must(f.campo);
          if (!OPS_BY_TYPE[type].includes(f.op)) throw new Error(`El operador "${f.op}" no sirve con el campo ${f.campo} (tipo ${type}). Usa: ${OPS_BY_TYPE[type].join(", ")}`);
          return { [f.campo]: condition(type, f.op, f.valor) };
        });
        // Filtro por NOMBRE de tienda (la persona nunca conoce el id).
        const byStore = args.tienda && scope === "ADMIN" && table.vendorPath ? [nestedWhere(table.vendorPath, { companyName: { contains: args.tienda, mode: "insensitive" } })] : [];
        const where = { AND: [base, ...mine, ...byStore] };
        const delegate = prisma[table.model];

        if (args.agrupar_por) {
          must(args.agrupar_por);
          if (fields[args.agrupar_por] === "d") throw new Error("No se puede agrupar por una fecha: filtra por rango de fechas.");
          const sum = args.sumar ? (must(args.sumar) === "n" ? { _sum: { [args.sumar]: true } } : (() => { throw new Error("'sumar' solo acepta campos numéricos (n)."); })()) : {};
          const rows = await delegate.groupBy({ by: [args.agrupar_por], where, _count: { _all: true }, ...sum, orderBy: { _count: { [args.agrupar_por]: "desc" } }, take: MAX_ROWS });
          return {
            tabla: args.tabla,
            agrupadoPor: args.agrupar_por,
            grupos: rows.map((r) => ({ valor: r[args.agrupar_por] instanceof Date ? r[args.agrupar_por].toISOString() : r[args.agrupar_por], cantidad: r._count._all, ...(args.sumar ? { [`suma_${args.sumar}`]: Math.round(Number(r._sum?.[args.sumar] ?? 0) * 100) / 100 } : {}) })),
          };
        }

        if (args.contar) return { tabla: args.tabla, cantidad: await delegate.count({ where }) };

        const shown = args.campos?.length ? args.campos.filter((c) => fields[c]) : Object.keys(fields);
        const fieldTypes = Object.fromEntries(shown.map((c) => [c, fields[c]]));
        if (args.orden) must(args.orden.campo);
        const orderBy = args.orden ? { [args.orden.campo]: args.orden.dir } : undefined;
        const select = Object.fromEntries(shown.map((c) => [c, true]));
        if (scope === "ADMIN") for (const r of table.rels ?? []) Object.assign(select, nestedSelect(r.path, r.pick));
        const [total, rows] = await Promise.all([delegate.count({ where }), delegate.findMany({ where, select, orderBy, take: args.limite })]);
        return { tabla: args.tabla, totalQueCoincide: total, mostrando: rows.length, filas: rows.map((r) => cleanRow(r, fieldTypes, scope === "ADMIN" ? table.rels : null)) };
      } catch (err) {
        return { error: `Consulta inválida: ${String(err?.message ?? err).slice(0, 200)}` };
      }
    },
  };
}
