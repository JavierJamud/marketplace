import { z } from "zod";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { sendTableOrderStatusEmail } from "../lib/email.js";
import { logActivity, actorRoleForVendorAction } from "../lib/activityLog.js";
import { isVendorOpenNow } from "../services/schedule.service.js";
import { env } from "../config/env.js";

// Bloque 185 (pedido explícito — "se podrán identificar tanto para el
// restaurante como para el cliente cuáles de los pedidos se realizaron
// desde la mesa y cuáles se agregaron manualmente desde el asociado de la
// tienda"): cada línea de `items` (JSON) lleva desde ahora un `id` propio
// (para poder targetear UNA línea puntual al editarla/quitarla — antes solo
// se podía reemplazar el array entero) y un `source`:
// "customer" = lo pidió quien escaneó el QR de la mesa (createTableOrder).
// "staff" = lo cargó el negocio desde el panel (Agregar consumo, o un
// pedido manual armado de punta a punta).
// Los pedidos de mesa VIEJOS (de antes de este bloque) simplemente no
// traen `id`/`source` en sus items — el frontend trata su ausencia como
// "customer" (el comportamiento de siempre, sin badge) y como "sin id
// editable" (no se les puede aplicar quitar/ajustar puntual, ver
// removeTableOrderItem/updateTableOrderItemQuantity más abajo).
//
// Bloque 186 (bug real reportado en vivo — "cuando el pedido lo agrega un
// camarero de atención a mesa, en vez de decir 'agregado por el local'
// debe decir 'agregado por' y la persona que lo agregó con su nombre"):
// `addedByName` es el nombre real de QUIEN estaba logueado en ese momento
// (dueño o un usuario de sistema) — nunca el nombre de la tienda. Solo
// tiene sentido para `source: "staff"` (el cliente ya se identifica solo
// con `customerName` a nivel del pedido).
//
// Bloque 190 (pedido explícito — "el cliente, luego de ya servida su mesa y
// en espera del cierre de la cuenta, sigue agregando cosas... esos nuevos
// productos deben empezar en el estado de revisando pedido, luego
// preparando, y así cada paso, así que cada producto dentro de su pedido
// debe mostrar el estado"): antes había un único `kitchenStatus` para TODA
// la cuenta — no alcanzaba en cuanto la cuenta podía tener más de una
// "ronda" de consumo en distinto punto de avance a la vez (el plato
// principal ya Listo, el postre recién pedido). Cada línea ahora lleva su
// propio `status` (mismos 3 valores que KITCHEN_TRANSITIONS/
// KITCHEN_STATUS_LABEL, reutilizados a propósito — es el mismo concepto,
// solo que por producto en vez de por cuenta entera). `updateKitchenStatus`
// sigue siendo el que avanza la cuenta recién creada (arrastra consigo los
// items de esa primera ronda, ver más abajo); una ronda agregada DESPUÉS
// arranca su propio contador en RECEIVED y se avanza por separado con
// updateTableOrderItemStatus, sin tocar ni depender del resto de la cuenta.
function makeOrderItem({ productId = null, name, price, quantity, source, addedByName = null, status = "RECEIVED" }) {
  return { id: randomUUID(), productId, name, price, quantity, source, addedByName, status };
}

// Bloque 186: el JWT solo trae {id, role} (ver middleware/auth.js) — el
// nombre real hay que resolverlo contra la DB. Se resuelve una sola vez por
// request (nunca se guarda en el token) así que si el vendedor le cambia el
// nombre a un usuario después, los items YA agregados quedan con el nombre
// de ese momento — es un registro histórico, no un valor que deba
// actualizarse solo con retroactividad.
async function resolveActorFullName(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
  return user?.fullName ?? null;
}

// Estado de cocina: solo se puede avanzar un paso a la vez, nunca saltar
// (ej. de "received" directo a "ready") ni retroceder.
const KITCHEN_STATUS_LABEL = { RECEIVED: "Recibido", PREPARING: "Preparando", READY: "Listo" };

const KITCHEN_TRANSITIONS = {
  RECEIVED: ["PREPARING"],
  PREPARING: ["READY"],
  READY: [],
};

// Bloque 190: mismos 3 valores/transiciones de arriba, aplicados a UNA
// línea (`item.status`) en vez de a la cuenta entera — texto distinto a
// propósito ("Revisando" en vez de "Recibido"): tiene más sentido leído
// junto al nombre del producto ("Mojito — Revisando") que la etiqueta de
// cuenta completa, pensada para leerse sola.
const ITEM_STATUS_LABEL = { RECEIVED: "Revisando", PREPARING: "Preparando", READY: "Listo" };

// Bloque 188 (pedido explícito — "agregar alertas al sistema... cuando a un
// usuario o vendedor se le olvida cerrar una mesa o un pedido, es decir el
// pedido está aún en estado de preparando pero ya se entregó en la
// mesa"): "olvidado" = lleva más de este tiempo SIN avanzar de estado real
// (ver statusChangedAt, schema.prisma) — nunca un valor exacto verificable
// (el sistema no puede saber si en la realidad ya cambió), por eso la
// alerta siempre PREGUNTA en vez de asumir. Umbrales pensados para el ritmo
// normal de un restaurante — más cortos cuanto antes en el flujo (un
// pedido sin ni siquiera confirmar molesta más rápido al cliente que uno
// ya entregado esperando la cuenta).
// RECEIVED a propósito NO tiene umbral acá — un pedido sin aceptar YA tiene
// su propia alerta persistente y bloqueante (NewOrderPopup.jsx, "pedido
// nuevo"), que no desaparece hasta que se acepta o se cancela. Duplicarlo
// acá haría aparecer 2 modales encima uno del otro sobre el mismo pedido.
const STALE_THRESHOLD_MS = {
  PREPARING: 25 * 60 * 1000, // 25 min preparando sin pasar a Listo
  READY: 20 * 60 * 1000, // 20 min Listo sin marcar entregado
  DELIVERED: 45 * 60 * 1000, // 45 min entregado sin cobrar/liberar la mesa
};

// Nivel numérico de "qué tan avanzado" está un pedido — CLEARED nunca
// aparece acá porque un pedido cobrado/liberado ya sale de todo chequeo de
// "olvidado" (clearedAt != null). Se usa tanto para decidir el umbral que
// corresponde (listStaleTableOrders) como para "adelantar" un pedido varios
// pasos de una sola vez (catchUpTableOrderStatus, cuando la realidad avanzó
// más de lo que el sistema registró).
const STATUS_LEVEL = { RECEIVED: 0, PREPARING: 1, READY: 2, DELIVERED: 3, CLEARED: 4 };
const STATUS_LEVEL_LABEL = {
  RECEIVED: "Recibido",
  PREPARING: "Preparando",
  READY: "Listo (sin entregar)",
  DELIVERED: "Entregado (sin cobrar)",
  CLEARED: "Cobrado y mesa liberada",
};

function tableOrderLevel(tableOrder) {
  if (tableOrder.clearedAt) return STATUS_LEVEL.CLEARED;
  if (tableOrder.deliveredAt) return STATUS_LEVEL.DELIVERED;
  return STATUS_LEVEL[tableOrder.kitchenStatus];
}

// Bloque 189 (pedido explícito — "el cliente no verá el nombre en la mesa,
// solo verá 'pedido agregado por el mesero'"): sacar `addedByName` del
// lado del cliente (Store.jsx / TableOrder.jsx) SOLO en el frontend no
// alcanza — la respuesta cruda del endpoint público seguiría trayendo el
// nombre real, visible con solo abrir las herramientas de red del
// navegador. `getTableOrderStatus` (GET /tables/order/:id) es un caso
// particular: la usa TANTO el cliente sin login (TableOrder.jsx) COMO el
// panel del vendedor (TableOrderDetailModal.jsx, que sí necesita el
// nombre) — mismo endpoint, misma URL. `resolveOptionalRequester` intenta
// leer un JWT válido del header (sin exigirlo, a diferencia de
// `authenticate`) para distinguir un caso del otro; si no hay token válido,
// o no pertenece a ESTE vendedor, se trata como cliente y se oculta.
async function resolveOptionalRequester(req) {
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null;
  if (!token) return null;
  try {
    // Mismo criterio que middleware/auth.js (auditoría de seguridad): fija
    // el algoritmo esperado en vez de confiar en el "alg" que declare el
    // propio token.
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] });
    return { id: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

async function isVendorSideRequester(req, vendorId) {
  const requester = await resolveOptionalRequester(req);
  if (!requester || !["VENDOR", "VENDOR_STAFF", "ADMIN"].includes(requester.role)) return false;
  if (requester.role === "ADMIN") return true;
  try {
    const vendor = await resolveMyVendor(requester.id);
    return vendor.id === vendorId;
  } catch {
    return false;
  }
}

function hideStaffNamesFromCustomer(tableOrder) {
  if (!tableOrder) return tableOrder;
  return { ...tableOrder, items: tableOrder.items.map(({ addedByName, ...item }) => item) };
}

// --- Panel de vendedor (restaurantes) --------------------------------------

export async function listMyTables(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  if (!vendor.isRestaurant) throw new AppError("Esta función es solo para tiendas tipo restaurante.", 403);

  // "Ocupada" ya no es "todavía no llegó a Listo" — el cliente puede seguir
  // en la mesa después de que el pedido está Listo (comiendo, esperando la
  // cuenta). La mesa recién se libera cuando el vendedor marca a mano que
  // el cliente pagó y se fue (ver clearTableOrder).
  const tables = await prisma.table.findMany({
    where: { vendorId: vendor.id },
    // Bloque 167: un pedido cancelado no "ocupa" la mesa — se saca de esta
    // lista igual que uno liberado (sigue existiendo, visible en Pedidos,
    // solo no cuenta para ocupar la mesa).
    include: { tableOrders: { where: { clearedAt: null, cancelledAt: null }, orderBy: { createdAt: "desc" } } },
    orderBy: { tableNumber: "asc" },
  });
  res.json({ tables });
}

// Bloque 164 (pedido explícito — "cuando entra un pedido nuevo el popup
// suena y aparece en medio de la pantalla... si entran más en el mismo
// momento se espera aceptar uno para confirmar el otro"): endpoint chico y
// dedicado (no reusa listMyTables/GET orders/me, que traen mucho más de lo
// que este popup necesita) — solo los pedidos RECEIVED, con lo justo para
// mostrar el aviso completo. NewOrderPopup.jsx lo consulta con polling; en
// cuanto un pedido deja RECEIVED (se acepta/cancela) desaparece solo de acá,
// así que "esperar a aceptar uno para ver el otro" no necesita ningún
// estado de "ya visto" — el simple hecho de ordenar por createdAt asc y
// mostrar solo el primero ya lo resuelve.
// Bloque 177 (bug real reportado en vivo — "agregó productos a su cuenta
// pero eso no se notificó en el panel del vendedor... debe notificarse
// igual siempre que se pida desde la mesa, aunque la cuenta ya esté
// abierta"): además de los RECEIVED de siempre (pedido nuevo, necesita
// aceptar), ahora también trae las cuentas YA aceptadas donde el cliente
// sumó consumo sin que el vendedor lo haya visto todavía
// (customerUpdatedAt, ver createTableOrder). `needsAccept` le dice al
// frontend cuál de los 2 casos es, para mostrar los botones correctos
// (Aceptar/Cancelar vs. solo "Visto"). Se ordenan juntos por el momento
// real del evento (createdAt para uno, customerUpdatedAt para el otro) —
// mismo criterio de cola de siempre, el más viejo esperando atención va
// primero.
export async function listPendingTableOrders(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  if (!vendor.isRestaurant) throw new AppError("Esta función es solo para tiendas tipo restaurante.", 403);

  const [newOrders, updatedOrders] = await Promise.all([
    prisma.tableOrder.findMany({
      where: { table: { vendorId: vendor.id }, kitchenStatus: "RECEIVED", cancelledAt: null },
      include: { table: true },
    }),
    prisma.tableOrder.findMany({
      where: { table: { vendorId: vendor.id }, customerUpdatedAt: { not: null }, cancelledAt: null, clearedAt: null },
      include: { table: true },
    }),
  ]);

  const orders = [
    ...newOrders.map((o) => ({ ...o, needsAccept: true, eventAt: o.createdAt })),
    ...updatedOrders.map((o) => ({ ...o, needsAccept: false, eventAt: o.customerUpdatedAt })),
  ].sort((a, b) => new Date(a.eventAt) - new Date(b.eventAt));

  res.json({ orders });
}

// Bloque 188 (pedido explícito — "le debe salir una alerta que notifique
// que tiene pedidos... recuerda que se debe actualizar el estado del
// pedido en la sección de pedidos"): un pedido "olvidado" es el que lleva
// más del umbral de su estado actual sin haber avanzado de verdad
// (statusChangedAt) — nunca los que ya están cancelados o liberados, y
// nunca los que el vendedor ya pospuso hace poco (staleReminderSnoozedUntil).
// Se resuelve en JS (no en el WHERE de Prisma) porque el umbral depende de
// CUÁL es el estado de cada fila — un solo query trae candidatos baratos
// (excluye lo ya resuelto/pospuesto) y el filtro fino queda acá.
export async function listStaleTableOrders(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  if (!vendor.isRestaurant) throw new AppError("Esta función es solo para tiendas tipo restaurante.", 403);

  const now = Date.now();
  const candidates = await prisma.tableOrder.findMany({
    where: {
      table: { vendorId: vendor.id },
      cancelledAt: null,
      clearedAt: null,
      // RECEIVED sin aceptar queda afuera de este query — ya tiene su
      // propia alerta permanente (NewOrderPopup.jsx), ver el comentario en
      // STALE_THRESHOLD_MS.
      kitchenStatus: { not: "RECEIVED" },
      OR: [{ staleReminderSnoozedUntil: null }, { staleReminderSnoozedUntil: { lt: new Date() } }],
    },
    include: { table: true },
  });

  const stale = candidates
    .map((o) => {
      const reasonStatus = o.deliveredAt ? "DELIVERED" : o.kitchenStatus;
      const thresholdMs = STALE_THRESHOLD_MS[reasonStatus];
      const minutesInStatus = Math.floor((now - new Date(o.statusChangedAt).getTime()) / 60000);
      return { order: o, reasonStatus, thresholdMs, minutesInStatus };
    })
    .filter(({ thresholdMs, minutesInStatus }) => minutesInStatus * 60000 >= thresholdMs)
    .sort((a, b) => b.minutesInStatus - a.minutesInStatus) // el más atrasado primero
    .map(({ order, reasonStatus, minutesInStatus }) => ({
      ...order,
      reasonStatus,
      reasonLabel: STATUS_LEVEL_LABEL[reasonStatus],
      minutesInStatus,
    }));

  res.json({ orders: stale });
}

// Bloque 188 (pedido explícito — "se le preguntará si el pedido cambió ya
// de estado o aún se mantiene"): el vendedor confirma que todavía sigue
// igual — pospone el próximo aviso 15 minutos en vez de mostrarlo de nuevo
// en el siguiente poll (StaleOrderAlert.jsx, frontend).
export async function snoozeStaleReminder(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { tableOrderId } = req.params;

  const tableOrder = await prisma.tableOrder.findUnique({ where: { id: tableOrderId }, include: { table: true } });
  if (!tableOrder || tableOrder.table.vendorId !== vendor.id) throw new AppError("Pedido de mesa no encontrado.", 404);

  const updated = await prisma.tableOrder.update({
    where: { id: tableOrderId },
    data: { staleReminderSnoozedUntil: new Date(Date.now() + 15 * 60 * 1000) },
  });
  res.json({ tableOrder: updated });
}

const catchUpSchema = z.object({ target: z.enum(["PREPARING", "READY", "DELIVERED", "CLEARED"]) });

// Bloque 188 (pedido explícito — "en caso de que haya cambiado se le pedirá
// cuál es el estado del pedido en esa mesa y se seleccionará uno para
// cambiar el estado del pedido en la sección de pedidos"): a diferencia de
// updateKitchenStatus (un paso por vez, para el uso normal del día a día),
// esto "pone al día" un pedido que la realidad ya dejó atrás — el vendedor
// puede elegir directamente "ya se cobró y liberó la mesa" aunque el
// sistema todavía lo tuviera en Recibido, sin tener que pasar por cada
// paso intermedio a mano. Aplica TODOS los efectos secundarios que se
// habrían disparado en el camino (descuento de stock si nunca se aceptó,
// deliveredAt, clearedAt) en una sola transacción atómica.
export async function catchUpTableOrderStatus(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { tableOrderId } = req.params;
  const { target } = catchUpSchema.parse(req.body);

  const tableOrder = await prisma.tableOrder.findUnique({ where: { id: tableOrderId }, include: { table: true } });
  if (!tableOrder || tableOrder.table.vendorId !== vendor.id) throw new AppError("Pedido de mesa no encontrado.", 404);
  if (tableOrder.cancelledAt) throw new AppError("Este pedido está cancelado.", 400);
  if (tableOrder.clearedAt) throw new AppError("Esta cuenta ya se cobró y cerró.", 400);

  const currentLevel = tableOrderLevel(tableOrder);
  const targetLevel = STATUS_LEVEL[target];
  if (targetLevel <= currentLevel) {
    throw new AppError(`Este pedido ya está en "${STATUS_LEVEL_LABEL[tableOrder.deliveredAt ? "DELIVERED" : tableOrder.kitchenStatus]}" o más adelante.`, 400);
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    // Descuento de stock: mismo criterio atómico que updateKitchenStatus —
    // solo aplica si el pedido NUNCA pasó por la aceptación real (seguía en
    // RECEIVED) y el destino lo deja en PREPARING o más allá.
    if (currentLevel < STATUS_LEVEL.PREPARING && targetLevel >= STATUS_LEVEL.PREPARING) {
      const tableProductIds = [...new Set(tableOrder.items.map((i) => i.productId).filter(Boolean))];
      const tableProducts = await tx.product.findMany({ where: { id: { in: tableProductIds } }, select: { id: true, unlimitedStock: true } });
      const isUnlimited = new Map(tableProducts.map((p) => [p.id, p.unlimitedStock]));
      for (const item of tableOrder.items) {
        if (!item.productId || isUnlimited.get(item.productId)) continue;
        const result = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (result.count === 0) {
          const fresh = await tx.product.findUnique({ where: { id: item.productId } });
          throw new AppError(`Stock insuficiente para "${item.name}" — disponible ${fresh?.stock ?? 0}.`, 409);
        }
      }
    }

    const nextKitchenStatus = targetLevel >= STATUS_LEVEL.READY ? "READY" : targetLevel >= STATUS_LEVEL.PREPARING ? "PREPARING" : "RECEIVED";
    // Bloque 190: "poner al día" el pedido entero (la realidad ya pasó al
    // vendedor de largo) implica que TODAS las líneas quedan al menos en
    // ese mismo punto — incluida una ronda más nueva que seguía en
    // "Revisando" por su cuenta. Nunca las retrocede si ya estaban más
    // adelante (no debería pasar, pero por las dudas).
    const itemLevel = (item) => STATUS_LEVEL[item.status ?? "RECEIVED"] ?? STATUS_LEVEL.RECEIVED;
    const cascadedItems = tableOrder.items.map((item) => (itemLevel(item) < STATUS_LEVEL[nextKitchenStatus] ? { ...item, status: nextKitchenStatus } : item));
    return tx.tableOrder.update({
      where: { id: tableOrderId },
      data: {
        kitchenStatus: nextKitchenStatus,
        items: cascadedItems,
        deliveredAt: targetLevel >= STATUS_LEVEL.DELIVERED ? tableOrder.deliveredAt ?? now : tableOrder.deliveredAt,
        clearedAt: targetLevel >= STATUS_LEVEL.CLEARED ? tableOrder.clearedAt ?? now : tableOrder.clearedAt,
        statusChangedAt: now,
        staleReminderSnoozedUntil: null,
      },
    });
  });

  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "table_order_caught_up",
    description: `Puso al día el pedido #${tableOrder.orderNumber} de la mesa #${tableOrder.table.tableNumber} a "${STATUS_LEVEL_LABEL[target]}" desde una alerta de recordatorio`,
    meta: { tableOrderId, tableId: tableOrder.tableId, from: tableOrder.kitchenStatus, target },
  });

  res.json({ tableOrder: updated });
}

// Bloque 177: el vendedor ya vio que el cliente sumó consumo a una cuenta
// abierta — apaga la señal para que deje de aparecer en el popup/sonido de
// "pedido nuevo" (a diferencia de aceptar un pedido RECEIVED, esto no
// avanza ningún estado de cocina, solo reconoce el aviso).
export async function ackCustomerTableOrderUpdate(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { tableOrderId } = req.params;

  const tableOrder = await prisma.tableOrder.findUnique({ where: { id: tableOrderId }, include: { table: true } });
  if (!tableOrder || tableOrder.table.vendorId !== vendor.id) throw new AppError("Pedido de mesa no encontrado.", 404);

  const updated = await prisma.tableOrder.update({
    where: { id: tableOrderId },
    data: { customerUpdatedAt: null, lastCustomerAddCount: null },
  });
  res.json({ tableOrder: updated });
}

// Bloque 167 (pedido explícito — "cuando se cancela un pedido no se debe
// borrar del todo, siempre los movimientos deben quedar registrados... se
// debe insertar un motivo y los clientes pueden ver ese motivo y quedará
// registrado en el panel del vendedor"): reemplaza el borrado real de
// Bloque 164 — ahora es un estado más (cancelledAt/cancelReason, ver
// schema.prisma), nunca se borra la fila.
// Bloque 197 (pedido explícito — "quiero poder agregar una función para
// eliminar pedido, eso [en realidad] no elimina el pedido, lo marca como
// tachado... no se elimina y sigue quedando registrado pero no marcará
// diferencia de ventas ni inventario... y si lo había hecho lo libera
// nuevamente, esto se puede hacer para pedidos erróneos"): antes solo se
// podía cancelar mientras seguía RECEIVED (nunca se había descontado stock
// todavía) — desde NewOrderPopup.jsx, el único punto de entrada que existía.
// Ahora se puede en cualquier momento ANTES de que la cuenta se cobre y
// cierre (clearedAt) — un pedido erróneo puede notarse recién después de
// marcarlo Listo o incluso Entregado. Se sigue "liberando la mesa" solo
// (cancelledAt excluye la fila de getTableByToken/createTableOrder, ver
// esos comentarios), y si ya se había aceptado, se devuelve el stock real
// que se había descontado.
const cancelTableOrderSchema = z.object({
  reason: z.string().trim().min(3, "Escribe el motivo de la cancelación."),
});

export async function cancelTableOrder(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { tableOrderId } = req.params;
  const { reason } = cancelTableOrderSchema.parse(req.body);

  const tableOrder = await prisma.tableOrder.findUnique({ where: { id: tableOrderId }, include: { table: true } });
  if (!tableOrder || tableOrder.table.vendorId !== vendor.id) throw new AppError("Pedido de mesa no encontrado.", 404);
  if (tableOrder.cancelledAt) throw new AppError("Este pedido ya estaba cancelado.", 409);
  if (tableOrder.clearedAt) throw new AppError("Esta cuenta ya fue cobrada y cerrada — no se puede cancelar.", 400);

  // Solo si ya se había aceptado (kitchenStatus !== RECEIVED) hay stock real
  // que devolver — mientras sigue RECEIVED, createTableOrder nunca lo
  // descontó (ver ese comentario), nada que revertir acá.
  const shouldRestock = tableOrder.kitchenStatus !== "RECEIVED";

  const updated = await prisma.$transaction(async (tx) => {
    if (shouldRestock) {
      const productIds = [...new Set(tableOrder.items.map((i) => i.productId).filter(Boolean))];
      const products = await tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, unlimitedStock: true } });
      const productById = new Map(products.map((p) => [p.id, p]));
      for (const item of tableOrder.items) {
        if (!item.productId) continue;
        const product = productById.get(item.productId);
        if (!product || product.unlimitedStock) continue; // producto borrado después, o "disponible siempre" — nada que devolver.
        await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
      }
    }
    return tx.tableOrder.update({
      where: { id: tableOrderId },
      data: { cancelledAt: new Date(), cancelReason: reason },
    });
  });

  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "table_order_cancelled",
    description: `Canceló el pedido #${tableOrder.orderNumber} de la mesa #${tableOrder.table.tableNumber} — ${reason}`,
    meta: { tableOrderId, reason },
  });
  res.json({ tableOrder: updated });
}

// Bloque 168 (pedido explícito — "también se debe poder agregar cuentas a
// la mesa... el camarero puede agregar a su mesa productos manualmente...
// se calculará el total y se irá agregando en tiempo real a la cuenta y al
// pedido del cliente"): a diferencia de updateTableOrderItems (arriba, que
// REEMPLAZA todo y solo mientras sigue RECEIVED), esto AGREGA una línea más
// sobre lo que ya había, en cualquier momento mientras la cuenta siga
// abierta (ni cancelada ni ya cobrada/liberada) — así el mesero puede
// seguir sumando consumo (rondas de bebidas, etc.) durante toda la visita,
// no solo antes de que la cocina acepte el pedido. Dos modos: `productId`
// (un producto real del catálogo — se descuenta stock de verdad, mismo
// criterio que updateKitchenStatus) o `name`+`price` libres (algo que no
// está cargado como producto, ej. un cobro puntual) — nunca ambos ni
// ninguno.
const addTableOrderItemSchema = z
  .object({
    productId: z.string().optional(),
    name: z.string().trim().min(1).optional(),
    price: z.number().positive().optional(),
    quantity: z.number().int().positive(),
  })
  .refine((d) => !!d.productId !== !!(d.name && d.price != null), {
    message: "Elige un producto del catálogo O escribe un nombre y precio — no ambos ni ninguno.",
  });

export async function addTableOrderItem(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { tableOrderId } = req.params;
  const data = addTableOrderItemSchema.parse(req.body);

  const tableOrder = await prisma.tableOrder.findUnique({ where: { id: tableOrderId }, include: { table: true } });
  if (!tableOrder || tableOrder.table.vendorId !== vendor.id) throw new AppError("Pedido de mesa no encontrado.", 404);
  if (tableOrder.cancelledAt) throw new AppError("Este pedido está cancelado.", 400);
  if (tableOrder.clearedAt) throw new AppError("Esta cuenta ya se cobró y cerró.", 400);

  const addedByName = await resolveActorFullName(req.user.id);
  let newItem;
  const updated = await prisma.$transaction(async (tx) => {
    if (data.productId) {
      const product = await tx.product.findUnique({ where: { id: data.productId } });
      if (!product || product.vendorId !== vendor.id) throw new AppError("Producto no encontrado.", 404);
      if (!product.unlimitedStock) {
        // Mismo criterio atómico que updateKitchenStatus — nunca se
        // descuenta más de lo que hay, sin importar cuántos pedidos/
        // agregados estén corriendo a la vez sobre el mismo producto.
        const result = await tx.product.updateMany({
          where: { id: product.id, stock: { gte: data.quantity } },
          data: { stock: { decrement: data.quantity } },
        });
        if (result.count === 0) {
          throw new AppError(`Stock insuficiente para "${product.name}" — disponible ${product.stock}.`, 409);
        }
      }
      // Bloque 190: "PREPARING" y no el default "RECEIVED" — el mesero ya
      // decidió sumar esto a la cuenta, no hace falta un paso de "revisar"
      // que él mismo se saltearía igual (mismo criterio que
      // createManualTableOrder, que arranca la cuenta entera en PREPARING).
      newItem = makeOrderItem({ productId: product.id, name: product.name, price: Number(product.price), quantity: data.quantity, source: "staff", addedByName, status: "PREPARING" });
    } else {
      newItem = makeOrderItem({ name: data.name, price: data.price, quantity: data.quantity, source: "staff", addedByName, status: "PREPARING" });
    }

    const nextItems = [...tableOrder.items, newItem];
    const nextTotal = nextItems.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);
    return tx.tableOrder.update({ where: { id: tableOrderId }, data: { items: nextItems, total: nextTotal } });
  });

  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "table_order_item_added",
    description: `Agregó "${newItem.quantity} × ${newItem.name}" a la cuenta de la mesa #${tableOrder.table.tableNumber}`,
    meta: { tableOrderId, item: newItem },
  });

  res.json({ tableOrder: updated });
}

// Bloque 185 (pedido explícito — "en la vista de los pedidos se podrá
// modificar como eliminar un producto de la mesa o del pedido o incluso
// cambiarle la cantidad"): a diferencia de updateTableOrderItems (reemplazo
// completo, solo mientras sigue RECEIVED) y addTableOrderItem (solo suma),
// esto apunta a UNA línea puntual por su `id` estable — funciona sobre una
// cuenta YA aceptada (PREPARING/READY). Se restringe a partir de ahí a
// propósito: mientras sigue RECEIVED, el stock de esos items todavía NO se
// descontó (se descuenta recién al aceptar, ver updateKitchenStatus) —
// tocar cantidades acá con la lógica de abajo (pensada para revertir/sumar
// contra un stock YA descontado) rompería esa cuenta; para ese caso ya
// existe "Modificar" (EditTableOrderModal → updateTableOrderItems), que
// reemplaza el pedido entero sin tocar stock porque todavía no hace falta.
function findEditableItem(tableOrder, itemId) {
  if (tableOrder.cancelledAt) throw new AppError("Este pedido está cancelado.", 400);
  if (tableOrder.clearedAt) throw new AppError("Esta cuenta ya se cobró y cerró.", 400);
  if (tableOrder.kitchenStatus === "RECEIVED") {
    throw new AppError('Este pedido todavía no fue aceptado — usá "Modificar" para cambiarlo antes de aceptarlo.', 400);
  }
  const index = tableOrder.items.findIndex((i) => i.id === itemId);
  if (index === -1) throw new AppError("Ese producto ya no está en la cuenta — puede que ya lo hayan quitado.", 404);
  return index;
}

export async function removeTableOrderItem(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { tableOrderId, itemId } = req.params;

  const tableOrder = await prisma.tableOrder.findUnique({ where: { id: tableOrderId }, include: { table: true } });
  if (!tableOrder || tableOrder.table.vendorId !== vendor.id) throw new AppError("Pedido de mesa no encontrado.", 404);
  const index = findEditableItem(tableOrder, itemId);
  const item = tableOrder.items[index];

  if (tableOrder.items.length === 1) {
    throw new AppError("No puedes dejar la cuenta sin productos — si es el único, cancela o gestiona el pedido completo.", 400);
  }

  const updated = await prisma.$transaction(async (tx) => {
    // El stock de este item ya se descontó (la cuenta está aceptada, ver
    // findEditableItem) — quitarlo lo devuelve. unlimitedStock se vuelve a
    // chequear en el momento (no en el item viejo) por si cambió desde
    // entonces.
    if (item.productId) {
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (product && !product.unlimitedStock) {
        await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
      }
    }
    const nextItems = tableOrder.items.filter((i) => i.id !== itemId);
    const nextTotal = nextItems.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);
    return tx.tableOrder.update({ where: { id: tableOrderId }, data: { items: nextItems, total: nextTotal } });
  });

  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "table_order_item_removed",
    description: `Quitó "${item.quantity} × ${item.name}" de la cuenta de la mesa #${tableOrder.table.tableNumber}`,
    meta: { tableOrderId, item },
  });

  res.json({ tableOrder: updated });
}

const updateItemQuantitySchema = z.object({ quantity: z.number().int().positive() });

export async function updateTableOrderItemQuantity(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { tableOrderId, itemId } = req.params;
  const { quantity } = updateItemQuantitySchema.parse(req.body);

  const tableOrder = await prisma.tableOrder.findUnique({ where: { id: tableOrderId }, include: { table: true } });
  if (!tableOrder || tableOrder.table.vendorId !== vendor.id) throw new AppError("Pedido de mesa no encontrado.", 404);
  const index = findEditableItem(tableOrder, itemId);
  const item = tableOrder.items[index];
  const delta = quantity - item.quantity;

  const updated = await prisma.$transaction(async (tx) => {
    if (delta !== 0 && item.productId) {
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (product && !product.unlimitedStock) {
        if (delta > 0) {
          // Subir la cantidad = descontar la diferencia — mismo chequeo
          // atómico de siempre, nunca de más de lo que hay.
          const result = await tx.product.updateMany({
            where: { id: item.productId, stock: { gte: delta } },
            data: { stock: { decrement: delta } },
          });
          if (result.count === 0) {
            throw new AppError(`Stock insuficiente para "${item.name}" — disponible ${product.stock}.`, 409);
          }
        } else {
          await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: -delta } } });
        }
      }
    }
    const nextItems = [...tableOrder.items];
    nextItems[index] = { ...item, quantity };
    const nextTotal = nextItems.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);
    return tx.tableOrder.update({ where: { id: tableOrderId }, data: { items: nextItems, total: nextTotal } });
  });

  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "table_order_item_quantity_changed",
    description: `Cambió "${item.name}" de ${item.quantity} a ${quantity} en la cuenta de la mesa #${tableOrder.table.tableNumber}`,
    meta: { tableOrderId, itemId, from: item.quantity, to: quantity },
  });

  res.json({ tableOrder: updated });
}

const updateItemStatusSchema = z.object({ status: z.enum(["PREPARING", "READY"]) });

// Bloque 190 (pedido explícito — "el cliente, ya servida su mesa y en
// espera del cierre de la cuenta, sigue agregando cosas... esos nuevos
// productos deben empezar en revisando pedido, luego preparando, y así
// cada paso"): avanza UNA línea puntual por su propio `status` — a
// diferencia de updateKitchenStatus (avanza la cuenta entera y arrastra
// consigo la ronda que sigue en el estado viejo, ver el comentario largo
// ahí), esto es lo que mueve una ronda agregada DESPUÉS, que arrancó su
// propio contador en "Revisando" independiente del resto de la cuenta.
// Mismas transiciones de un paso a la vez (KITCHEN_TRANSITIONS,
// reutilizado) — nunca saltar de Revisando a Listo sin pasar por
// Preparando.
export async function updateTableOrderItemStatus(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { tableOrderId, itemId } = req.params;
  const { status } = updateItemStatusSchema.parse(req.body);

  const tableOrder = await prisma.tableOrder.findUnique({ where: { id: tableOrderId }, include: { table: true } });
  if (!tableOrder || tableOrder.table.vendorId !== vendor.id) throw new AppError("Pedido de mesa no encontrado.", 404);
  const index = findEditableItem(tableOrder, itemId);
  const item = tableOrder.items[index];
  const currentStatus = item.status ?? "RECEIVED";

  if (!KITCHEN_TRANSITIONS[currentStatus].includes(status)) {
    throw new AppError(`No se puede pasar "${item.name}" de "${ITEM_STATUS_LABEL[currentStatus]}" a "${ITEM_STATUS_LABEL[status]}".`, 400);
  }

  const nextItems = [...tableOrder.items];
  nextItems[index] = { ...item, status };
  const updated = await prisma.tableOrder.update({ where: { id: tableOrderId }, data: { items: nextItems } });

  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "table_order_item_status_changed",
    description: `Pasó "${item.name}" a "${ITEM_STATUS_LABEL[status]}" en la cuenta de la mesa #${tableOrder.table.tableNumber}`,
    meta: { tableOrderId, itemId, from: currentStatus, to: status },
  });

  res.json({ tableOrder: updated });
}

// Bloque 173 (pedido explícito — "el camarero puede crear un nuevo pedido
// asignado para una mesa en específico ya que a lo mejor nadie pide
// escaneando el código, así el camarero solo crea el pedido en el sistema y
// lo asigna a la mesa y así se abre una cuenta y se empiezan a mostrar datos
// en el QR"): a diferencia de createTableOrder (público, vía QR), acá el
// que arma la cuenta es el propio mesero desde el panel — ya habló con el
// cliente en persona, así que no tiene sentido pasar por RECEIVED
// ("esperando a que el mesero lo confirme": el mesero YA lo está
// confirmando en este mismo momento) — arranca directo en PREPARING, con el
// mismo descuento atómico de stock que updateKitchenStatus aplica en esa
// transición. Una vez creada, es una cuenta más — cualquiera que escanee el
// QR de esa mesa la ve en vivo (getTableByToken) y le puede seguir sumando
// consumo, igual que si hubiera arrancado desde el QR.
const manualItemSchema = z
  .object({
    productId: z.string().optional(),
    name: z.string().trim().min(1).optional(),
    price: z.number().positive().optional(),
    quantity: z.number().int().positive(),
  })
  .refine((d) => !!d.productId !== !!(d.name && d.price != null), {
    message: "Elige un producto del catálogo O escribe un nombre y precio — no ambos ni ninguno.",
  });
const createManualTableOrderSchema = z.object({
  items: z.array(manualItemSchema).min(1, "Agrega al menos un producto."),
  customerName: z.string().trim().max(60).optional(),
});

export async function createManualTableOrder(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;
  const data = createManualTableOrderSchema.parse(req.body);

  const table = await prisma.table.findUnique({ where: { id } });
  if (!table || table.vendorId !== vendor.id) throw new AppError("Mesa no encontrada.", 404);

  const existingOrder = await prisma.tableOrder.findFirst({ where: { tableId: table.id, cancelledAt: null, clearedAt: null } });
  if (existingOrder) {
    throw new AppError("Esta mesa ya tiene una cuenta abierta — usá \"Agregar consumo\" para sumarle productos.", 409);
  }

  const productIds = data.items.filter((i) => i.productId).map((i) => i.productId);
  const products = productIds.length
    ? await prisma.product.findMany({ where: { id: { in: productIds }, vendorId: vendor.id } })
    : [];
  if (products.length !== productIds.length) throw new AppError("Uno o más productos no fueron encontrados.", 404);
  const productById = Object.fromEntries(products.map((p) => [p.id, p]));
  const addedByName = await resolveActorFullName(req.user.id);

  const tableOrder = await prisma.$transaction(async (tx) => {
    const orderItems = [];
    for (const item of data.items) {
      if (item.productId) {
        const product = productById[item.productId];
        if (!product.unlimitedStock) {
          const result = await tx.product.updateMany({
            where: { id: product.id, stock: { gte: item.quantity } },
            data: { stock: { decrement: item.quantity } },
          });
          if (result.count === 0) throw new AppError(`Stock insuficiente para "${product.name}" — disponible ${product.stock}.`, 409);
        }
        // Bloque 190: la cuenta entera arranca en PREPARING (ver más abajo,
        // kitchenStatus: "PREPARING") — cada item nace en ese mismo estado,
        // nunca en "Revisando".
        orderItems.push(makeOrderItem({ productId: product.id, name: product.name, price: Number(product.price), quantity: item.quantity, source: "staff", addedByName, status: "PREPARING" }));
      } else {
        orderItems.push(makeOrderItem({ name: item.name, price: item.price, quantity: item.quantity, source: "staff", addedByName, status: "PREPARING" }));
      }
    }
    const total = orderItems.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);
    return tx.tableOrder.create({
      data: {
        tableId: table.id,
        items: orderItems,
        total,
        kitchenStatus: "PREPARING",
        customerName: data.customerName?.trim() || `Mesa #${table.tableNumber}`,
      },
    });
  });

  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "table_order_created_manually",
    description: `Abrió una cuenta manual en la mesa #${table.tableNumber}`,
    meta: { tableId: table.id, tableOrderId: tableOrder.id },
  });

  res.status(201).json({ tableOrder });
}

export async function createTable(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  if (!vendor.isRestaurant) throw new AppError("Esta función es solo para tiendas tipo restaurante.", 403);

  const last = await prisma.table.findFirst({ where: { vendorId: vendor.id }, orderBy: { tableNumber: "desc" } });
  const tableNumber = (last?.tableNumber ?? 0) + 1;

  // qrToken se autogenera (cuid único) — nunca un valor adivinable del cliente.
  const table = await prisma.table.create({ data: { vendorId: vendor.id, tableNumber } });
  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "table_created",
    description: `Agregó la mesa #${tableNumber}`,
    meta: { tableId: table.id },
  });
  res.status(201).json({ table });
}

// Bloque 141 (pedido explícito): el vendedor puede ponerle un nombre propio
// a la mesa (ej. "Terraza 1") — puramente cosmético, tableNumber sigue
// siendo la identidad real (orden, unicidad por tienda).
const updateTableSchema = z.object({ label: z.string().trim().max(40).optional().nullable() });

export async function updateTable(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;
  const { label } = updateTableSchema.parse(req.body);

  const table = await prisma.table.findUnique({ where: { id } });
  if (!table || table.vendorId !== vendor.id) throw new AppError("Mesa no encontrada.", 404);

  const updated = await prisma.table.update({ where: { id }, data: { label: label?.trim() || null } });
  res.json({ table: updated });
}

// Bloque 141 (pedido explícito — "busca una alternativa para cuando le
// hacen una foto al QR y lo usan desde afuera para perjudicar el
// negocio"): la defensa real y accionable es que el vendedor pueda
// INVALIDAR el QR viejo apenas sospeche que se filtró — el token es un
// cuid random (no una URL adivinable, ver createTable), así que cualquier
// copia/foto del QR anterior deja de servir en el momento mismo en que se
// regenera: cualquier pedido contra el token viejo pasa a dar 404 en
// getTableByToken/createTableOrder de acá abajo. El vendedor reimprime el
// QR nuevo (VendorTables.jsx) y listo — no hace falta tocar tableNumber
// ni ningún pedido ya existente (tableId no cambia).
export async function regenerateTableQr(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;

  const table = await prisma.table.findUnique({ where: { id } });
  if (!table || table.vendorId !== vendor.id) throw new AppError("Mesa no encontrada.", 404);

  // El `@default(cuid())` de schema.prisma solo aplica en el INSERT
  // inicial — un `update` normal no lo vuelve a disparar, así que el
  // token nuevo se genera acá a mano. No hace falta que sea un cuid
  // específicamente, solo random y único — mismo generador ya usado en
  // todo el resto del backend para nombres de archivo (siteUpload.js,
  // productUpload.js, vendorBrandingUpload.js).
  const newToken = randomUUID();

  const updated = await prisma.table.update({ where: { id }, data: { qrToken: newToken } });
  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "table_qr_regenerated",
    description: `Regeneró el QR de la mesa #${table.tableNumber} (el anterior dejó de funcionar)`,
    meta: { tableId: table.id },
  });
  res.json({ table: updated });
}

export async function deleteTable(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;

  const table = await prisma.table.findUnique({
    where: { id },
    include: { tableOrders: { where: { clearedAt: null } } },
  });
  if (!table || table.vendorId !== vendor.id) throw new AppError("Mesa no encontrada.", 404);
  if (table.tableOrders.length > 0) {
    throw new AppError("Esta mesa tiene un pedido sin liberar todavía — marcalo como pagado/liberado antes de eliminarla.", 409);
  }

  await prisma.table.delete({ where: { id } });
  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "table_deleted",
    description: `Eliminó la mesa #${table.tableNumber}`,
    meta: { tableId: table.id },
  });
  res.status(204).end();
}

export async function updateKitchenStatus(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { tableOrderId } = req.params;
  const { status } = z.object({ status: z.enum(["RECEIVED", "PREPARING", "READY"]) }).parse(req.body);

  const tableOrder = await prisma.tableOrder.findUnique({ where: { id: tableOrderId }, include: { table: true } });
  if (!tableOrder || tableOrder.table.vendorId !== vendor.id) throw new AppError("Pedido de mesa no encontrado.", 404);

  if (!KITCHEN_TRANSITIONS[tableOrder.kitchenStatus].includes(status)) {
    throw new AppError(`No se puede pasar de "${tableOrder.kitchenStatus}" a "${status}".`, 400);
  }

  // Bloque 190 (pedido explícito — "cada producto dentro de su pedido debe
  // mostrar el estado"): esta acción avanza la cuenta ENTERA (el botón
  // "Aceptar"/"Marcar Listo" de siempre) — arrastra consigo únicamente los
  // items que todavía están en el estado VIEJO de la cuenta (la ronda
  // "original", la que efectivamente motivó este cambio). Un item sin
  // `status` (pedidos de mesa viejos, de antes de este bloque) se trata
  // como si estuviera en el estado viejo — nunca queda huérfano sin
  // avanzar solo por faltarle el campo. Una ronda agregada DESPUÉS (ya con
  // su propio `status` más atrasado, ej. "RECEIVED" mientras la cuenta ya
  // está en PREPARING) queda afuera a propósito — esa se avanza aparte,
  // con updateTableOrderItemStatus, sin que este botón la toque de rebote.
  const oldStatus = tableOrder.kitchenStatus;
  const cascadedItems = tableOrder.items.map((item) => ((item.status ?? oldStatus) === oldStatus ? { ...item, status } : item));

  // Bloque 185 (pedido explícito — "todo será en tiempo real hasta si el
  // usuario acepta un pedido se debe cerrar en tiempo real para no cometer
  // duplicados"): bug real de condición de carrera que esto reemplaza — si
  // 2 usuarios (dos camareros logueados a la vez) tocaban "Aceptar" casi
  // en el mismo instante, ambos leían RECEIVED arriba, ambos pasaban el
  // chequeo de transición, y el `update` de acá abajo (sin condición) los
  // dejaba avanzar a los DOS: el segundo volvía a descontar el stock de
  // cada item (doble descuento real sobre Product.stock) aunque el pedido
  // ya estuviera aceptado. El `updateMany` de abajo "reclama" la transición
  // de forma atómica — WHERE incluye el estado que se leyó arriba, así que
  // solo uno de los dos requests simultáneos puede ganar la carrera; el que
  // pierde recibe result.count===0 y un 409 claro en vez de ejecutar la
  // acción una segunda vez.
  const updated = await prisma.$transaction(async (tx) => {
    // Bloque 188: `statusChangedAt` se resetea acá — a propósito NUNCA con
    // `updatedAt` (que cambia con cualquier edición, incluida agregar un
    // item) — es lo que listStaleTableOrders usa para saber hace cuánto
    // este pedido está de verdad en su estado actual. `staleReminderSnoozedUntil`
    // se limpia porque el estado real acaba de cambiar — cualquier "posponer"
    // anterior ya no aplica a este estado nuevo.
    const claimed = await tx.tableOrder.updateMany({
      where: { id: tableOrderId, kitchenStatus: tableOrder.kitchenStatus },
      data: { kitchenStatus: status, items: cascadedItems, statusChangedAt: new Date(), staleReminderSnoozedUntil: null },
    });
    if (claimed.count === 0) {
      throw new AppError("Este pedido ya fue actualizado por otro usuario — recarga para ver el estado actual.", 409);
    }

    // Bloque 29: RECEIVED -> PREPARING es el momento en que la cocina
    // "acepta" el pedido — recién ahí se descuenta el stock real de cada
    // producto (mismo criterio atómico que confirmOrderSale en
    // orders.controller.js para pedidos normales). Va DESPUÉS de reclamar
    // la transición de arriba — si esto falla por falta de stock, la
    // transacción entera se revierte, incluida la reclamación (el pedido
    // vuelve a quedar en RECEIVED, sin ningún efecto secundario a medias).
    if (tableOrder.kitchenStatus === "RECEIVED" && status === "PREPARING") {
      const tableProductIds = [...new Set(tableOrder.items.map((i) => i.productId).filter(Boolean))];
      const tableProducts = await tx.product.findMany({ where: { id: { in: tableProductIds } }, select: { id: true, unlimitedStock: true } });
      const isUnlimited = new Map(tableProducts.map((p) => [p.id, p.unlimitedStock]));

      for (const item of tableOrder.items) {
        if (!item.productId || isUnlimited.get(item.productId)) continue; // Bloque 56: "disponible siempre" — sin seguimiento de stock.
        const result = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (result.count === 0) {
          const fresh = await tx.product.findUnique({ where: { id: item.productId } });
          throw new AppError(`Stock insuficiente para "${item.name}" — pedido ${item.quantity}, disponible ${fresh?.stock ?? 0}.`, 409, {
            insufficientStock: [{ productId: item.productId, name: item.name, requested: item.quantity, available: fresh?.stock ?? 0 }],
          });
        }
      }
    }
    return tx.tableOrder.findUnique({ where: { id: tableOrderId } });
  });

  // Bloque 141 (pedido explícito — visibilidad del admin sobre "todo lo
  // que hacen los vendedores"): antes NINGÚN cambio de estado de un
  // pedido de mesa quedaba registrado acá (a diferencia de un pedido
  // normal, ver confirmOrderSale en orders.controller.js) — con esto,
  // Admin > Actividad también refleja RECEIVED->PREPARING (el momento
  // real de "el vendedor confirmó el pedido con el cliente en la mesa
  // antes de empezar a prepararlo") y PREPARING->READY.
  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "table_order_status_changed",
    // Bloque 181 (auditoría): el vendedor lee esto en "Registro de esta
    // cuenta" — etiqueta en español, nunca el valor crudo del enum.
    description: `Pedido #${tableOrder.orderNumber} de la mesa #${tableOrder.table.tableNumber} pasó a "${KITCHEN_STATUS_LABEL[status] ?? status}"`,
    meta: { tableOrderId, tableId: tableOrder.tableId, status },
  });

  // "Tiempo real" = disparado en el momento del cambio, no un cron/batch —
  // mismo criterio que sendOrderStatusEmail en orders.controller.js. Los
  // pedidos de mesa viejos sin customerEmail simplemente no mandan nada
  // (sendTableOrderStatusEmail ya hace ese chequeo).
  await sendTableOrderStatusEmail({
    to: tableOrder.customerEmail,
    vendorId: vendor.id,
    vendorName: vendor.companyName,
    tableNumber: tableOrder.table.tableNumber,
    kitchenStatus: status,
  });

  res.json({ tableOrder: updated });
}

// Bloque 163 (pedido explícito — "el camarero ponga en el sistema que el
// pedido fue entregado a la mesa"): momento distinto y ANTERIOR a "liberar
// mesa" (clearTableOrder, más abajo). Solo se puede marcar sobre un pedido
// Listo. Desde Bloque 172, deliveredAt YA NO bloquea ni desbloquea pedidos
// nuevos del cliente (eso lo decide solo kitchenStatus === RECEIVED, ver
// createTableOrder) — es puramente el paso previo obligatorio a cobrar.
export async function markTableOrderDelivered(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { tableOrderId } = req.params;

  const tableOrder = await prisma.tableOrder.findUnique({ where: { id: tableOrderId }, include: { table: true } });
  if (!tableOrder || tableOrder.table.vendorId !== vendor.id) throw new AppError("Pedido de mesa no encontrado.", 404);
  if (tableOrder.kitchenStatus !== "READY") {
    throw new AppError("Solo se puede marcar como entregado un pedido en estado Listo.", 400);
  }
  if (tableOrder.deliveredAt) throw new AppError("Este pedido ya fue marcado como entregado.", 409);

  // Bloque 188: mismo criterio que updateKitchenStatus — resetea el reloj
  // de "olvidado" y cualquier posposición vieja.
  const updated = await prisma.tableOrder.update({
    where: { id: tableOrderId },
    data: { deliveredAt: new Date(), statusChangedAt: new Date(), staleReminderSnoozedUntil: null },
  });
  // Bloque 175 (pedido explícito — "ver los detalles de cada pedido y
  // registro en ese pedido en esa mesa"): antes NINGÚN paso de "entregado"/
  // "cobrado y liberado" quedaba en el historial de actividad — a
  // diferencia de RECEIVED->PREPARING/READY (updateKitchenStatus), que sí
  // se registraban, estos 2 pasos finales se guardaban en el pedido mismo
  // (deliveredAt/clearedAt) pero nunca en el timeline de actividad que ve
  // el vendedor en el detalle del pedido.
  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "table_order_delivered",
    description: `Marcó como entregado el pedido #${tableOrder.orderNumber} de la mesa #${tableOrder.table.tableNumber}`,
    meta: { tableOrderId, tableId: tableOrder.tableId },
  });
  res.json({ tableOrder: updated });
}

// El cliente ya pagó y se retiró de la mesa — recién acá se libera de
// verdad (ver listMyTables). Solo se puede marcar sobre un pedido que ya
// llegó a Listo (no tiene sentido "liberar" una mesa con comida sin
// terminar de preparar).
export async function clearTableOrder(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { tableOrderId } = req.params;

  const tableOrder = await prisma.tableOrder.findUnique({ where: { id: tableOrderId }, include: { table: true } });
  if (!tableOrder || tableOrder.table.vendorId !== vendor.id) throw new AppError("Pedido de mesa no encontrado.", 404);
  if (tableOrder.kitchenStatus !== "READY") {
    throw new AppError("Solo se puede liberar una mesa con el pedido en estado Listo.", 400);
  }
  // Bloque 163: no tiene sentido liberar del todo la mesa (pago + cliente
  // se fue) sin haber marcado antes que el pedido de verdad le llegó.
  if (!tableOrder.deliveredAt) {
    throw new AppError("Primero marca el pedido como entregado.", 400);
  }
  if (tableOrder.clearedAt) throw new AppError("Esta mesa ya fue liberada.", 409);

  const updated = await prisma.tableOrder.update({ where: { id: tableOrderId }, data: { clearedAt: new Date() } });
  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "table_order_cleared",
    description: `Cobró y liberó la mesa #${tableOrder.table.tableNumber} — pedido #${tableOrder.orderNumber}`,
    meta: { tableOrderId, tableId: tableOrder.tableId },
  });
  res.json({ tableOrder: updated });
}

// Bloque 175 (pedido explícito — "habrá un botón en cada pedido para ver
// pedido y ver los detalles de cada pedido y registro en ese pedido en esa
// mesa"): expone el ActivityLog (hasta ahora solo visible en Admin >
// Actividad) filtrado a UN pedido de mesa puntual — cada acción del
// vendedor sobre este pedido (aceptar, agregar consumo, entregar, cobrar y
// liberar, cancelar) ya se registraba ahí (ver logActivity en cada función
// de arriba); esto solo la hace consultable desde el propio panel del
// vendedor, sin necesitar ser admin.
export async function getTableOrderActivity(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { tableOrderId } = req.params;

  const tableOrder = await prisma.tableOrder.findUnique({ where: { id: tableOrderId }, include: { table: true } });
  if (!tableOrder || tableOrder.table.vendorId !== vendor.id) throw new AppError("Pedido de mesa no encontrado.", 404);

  const entries = await prisma.activityLog.findMany({
    where: { vendorId: vendor.id, meta: { path: ["tableOrderId"], equals: tableOrderId } },
    orderBy: { createdAt: "asc" },
  });
  res.json({ entries });
}

// --- Público (cliente escaneando el QR de su mesa) -------------------------

export async function getTableByToken(req, res) {
  const { qrToken } = req.params;
  const table = await prisma.table.findUnique({
    where: { qrToken },
    include: {
      vendor: {
        select: {
          companyName: true,
          description: true,
          logoUrl: true,
          slug: true,
          whatsapp: true,
          color: true,
          isBlocked: true,
          status: true,
          // Bloque 16: solo los productos que el vendedor marcó para el menú
          // QR (VendorProducts.jsx) — antes se mostraban TODOS los activos,
          // sin distinguir de la tienda normal.
          // Bloque 157 (pedido explícito — restricción por mesa específica):
          // tableRestricted:false = todas las mesas, así que ni se consulta
          // restrictedTables en ese caso; tableRestricted:true = solo si
          // ESTA mesa (por qrToken, ya lo tenemos de req.params, sin
          // necesitar el id todavía) está en la lista.
          products: {
            where: {
              isActive: true,
              availableForTableMenu: true,
              OR: [{ tableRestricted: false }, { restrictedTables: { some: { qrToken } } }],
            },
            include: { options: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
  // Bloque 62: hueco real que había acá — este endpoint (QR de mesa) nunca
  // chequeó isBlocked/status del vendedor, a diferencia de cualquier otro
  // punto público (Store.jsx, Product.jsx, etc). Una tienda bloqueada o
  // suspendida seguía siendo 100% accesible vía su QR.
  if (!table || table.vendor.isBlocked || table.vendor.status !== "ACTIVE") throw new AppError("Mesa no encontrada.", 404);

  // Bloque 172 (pedido explícito — "todos los que escaneen el QR de la mesa
  // podrán ver la cuenta de la mesa en tiempo real mientras están en la
  // mesa"): reemplaza el modelo anterior (cada dispositivo guardaba SUS
  // propios ids en localStorage + un formulario de recuperación para
  // "otros" dispositivos) — ahora la cuenta ES de la mesa, no de quien la
  // pidió: cualquiera que escanee ve exactamente el mismo pedido activo, en
  // vivo, sin necesitar recuperar nada. "Activo" = ni cancelado ni ya
  // cobrado/liberado — deliveredAt YA NO decide si se muestra (antes sí,
  // cuando el modelo era "ocultar del que no lo pidió"); ahora decide otra
  // cosa (ver createTableOrder: si ya se aprobó, un pedido nuevo se SUMA a
  // este mismo en vez de bloquearse).
  const activeOrder = await prisma.tableOrder.findFirst({
    where: { tableId: table.id, cancelledAt: null, clearedAt: null },
    orderBy: { createdAt: "desc" },
  });

  // Bloque 197 (bug real reportado en vivo — "cuando un pedido es cancelado
  // y el vendedor pone el motivo, ese motivo debe mostrarse al cliente en
  // su página, nunca debe quedar en blanco"): `activeOrder` de arriba
  // EXCLUYE a propósito los cancelados (no deben seguir bloqueando la
  // mesa para un pedido nuevo, ver createTableOrder) — pero eso significa
  // que un pedido recién cancelado desaparecía de la vista del cliente de
  // un momento a otro, sin mostrar el motivo jamás salvo que su pestaña
  // siguiera abierta en el instante exacto del cambio (ver justClosed en
  // TableOrder.jsx). Se resuelve aparte: si el pedido MÁS RECIENTE de la
  // mesa (sin filtrar por estado) resulta ser justo el cancelado, se manda
  // separado para que el cliente lo siga viendo hasta que haga un pedido
  // nuevo — que pasa a ser el más reciente y reemplaza este aviso solo,
  // sin necesitar que el cliente lo cierre a mano.
  let lastCancelledOrder = null;
  if (!activeOrder) {
    const mostRecentOrder = await prisma.tableOrder.findFirst({
      where: { tableId: table.id },
      orderBy: { createdAt: "desc" },
    });
    if (mostRecentOrder?.cancelledAt) lastCancelledOrder = mostRecentOrder;
  }

  res.json({
    table: {
      ...table,
      activeOrder: hideStaffNamesFromCustomer(activeOrder),
      lastCancelledOrder: hideStaffNamesFromCustomer(lastCancelledOrder),
    },
  });
}

// Bloque 141 (pedido explícito — "el cliente solo debe poner su nombre y
// más nada, ya que lo demás no es necesario, esto es un pedido a la mesa"):
// customerName pasa a ser el único dato obligatorio del cliente;
// customerEmail pasa de obligatorio a 100% opcional (dejó de pedirse en el
// formulario público, TableOrder.jsx — si de todas formas llega uno, se
// sigue usando para avisar por correo, ver sendTableOrderStatusEmail).
// Bloque 172: customerName solo es obligatorio cuando se ABRE la cuenta —
// una vez que la mesa ya tiene una activa, sumar una ronda más no necesita
// pedir el nombre de nuevo (createTableOrder valida esto a mano según cuál
// de las 2 ramas corresponda).
const createTableOrderSchema = z.object({
  items: z
    .array(z.object({ productId: z.string(), name: z.string(), quantity: z.number().int().positive(), price: z.number().positive() }))
    .min(1, "El pedido necesita al menos un producto"),
  customerName: z.string().trim().max(60).optional().or(z.literal("")),
  customerEmail: z.string().email("Ingresa un correo válido.").optional().or(z.literal("")),
});

export async function createTableOrder(req, res) {
  const { qrToken } = req.params;
  const table = await prisma.table.findUnique({
    where: { qrToken },
    include: {
      vendor: {
        select: { id: true, companyName: true, isBlocked: true, status: true, schedules: true, timezone: true },
      },
    },
  });
  // Bloque 62: mismo hueco que getTableByToken — sin esto, se podía seguir
  // haciendo pedidos reales a una tienda bloqueada o suspendida vía el QR.
  if (!table || table.vendor.isBlocked || table.vendor.status !== "ACTIVE") throw new AppError("Mesa no encontrada.", 404);

  // Bloque 169 (pedido explícito — "si la tienda está cerrada... no se
  // podrá ordenar hasta que esté en horario de abierto"): mismo cálculo
  // real de horario que ya usa getVendorBySlug (isVendorOpenNow,
  // schedule.service.js) — nunca alcanza con que el frontend deshabilite el
  // botón, un request directo a este endpoint tiene que rechazarse igual.
  // isOpen === null significa "esta tienda nunca cargó un horario semanal"
  // — eso NO es lo mismo que "está cerrada ahora", así que nunca bloquea
  // (mismo criterio ya implícito en el badge de Store.jsx). Solo bloquea
  // cuando el horario real dice que está cerrada EN ESTE momento.
  const { isOpen, nextOpenLabel } = isVendorOpenNow(table.vendor.schedules, table.vendor.timezone);
  if (isOpen === false) {
    throw new AppError(
      nextOpenLabel ? `Este local está cerrado ahora — ${nextOpenLabel.toLowerCase()}.` : "Este local está cerrado ahora — prueba más tarde.",
      409
    );
  }

  // Bloque 172 (pedido explícito — "puede hacer otro pedido si la mesa no
  // tiene ninguno en proceso de aprobación... todos los que escaneen el QR
  // verán la cuenta de la mesa en tiempo real"): reemplaza el bloqueo del
  // Bloque 163/167 (que frenaba TODO pedido nuevo hasta que el mesero
  // marcara "entregado") — ahora la cuenta es UNA sola por mesa: mientras
  // siga RECEIVED (el mesero todavía no la revisó/aceptó), no se puede
  // mandar nada más — evita que se acumulen 2 pedidos sin confirmar a la
  // vez. Una vez aceptada (PREPARING en adelante, sin importar si ya se
  // entregó o no), un pedido nuevo ya NO crea una cuenta aparte: se SUMA a
  // la misma (ver más abajo), como una ronda más de consumo.
  const existingOrder = await prisma.tableOrder.findFirst({ where: { tableId: table.id, cancelledAt: null, clearedAt: null } });
  if (existingOrder && existingOrder.kitchenStatus === "RECEIVED") {
    throw new AppError(
      "Esta mesa ya tiene un pedido esperando a que el mesero lo confirme — espera un momento y prueba de nuevo.",
      409
    );
  }

  const { items, customerName, customerEmail } = createTableOrderSchema.parse(req.body);

  // El precio se toma del producto en DB (no del cliente).
  // Bloque 157 (bug real de seguridad encontrado al agregar la restricción
  // por mesa — sin esto, tenerla en el frontend no alcanzaba: cualquiera
  // podía seguir pidiendo un producto restringido a OTRA mesa llamando este
  // endpoint directo con el productId a mano): mismos 3 filtros que ya
  // aplica getTableByToken para decidir qué se MUESTRA en el menú de esta
  // mesa — acá se vuelven a exigir para decidir qué se ACEPTA en el pedido.
  const products = await prisma.product.findMany({
    where: {
      id: { in: items.map((i) => i.productId) },
      vendorId: table.vendorId,
      isActive: true,
      availableForTableMenu: true,
      OR: [{ tableRestricted: false }, { restrictedTables: { some: { qrToken } } }],
    },
  });
  if (products.length !== items.length) throw new AppError("Uno o más productos ya no están disponibles en este menú.", 400);

  const productById = Object.fromEntries(products.map((p) => [p.id, p]));

  const orderItems = items.map((i) =>
    makeOrderItem({ productId: i.productId, name: productById[i.productId].name, price: Number(productById[i.productId].price), quantity: i.quantity, source: "customer" })
  );

  let tableOrder;
  if (existingOrder) {
    // Bloque 172: la cuenta ya fue aceptada — esto es una ronda más de
    // consumo, no un pedido nuevo. Mismo criterio ATÓMICO que
    // addTableOrderItem (descuenta stock real de una, nunca de más aunque
    // varias personas de la misma mesa agreguen algo casi al mismo tiempo)
    // en vez del chequeo solo informativo de abajo, que acá no alcanza —
    // el stock de estos items SÍ se descuenta ahora mismo, no en un futuro
    // paso de "aceptar" que ya pasó.
    tableOrder = await prisma.$transaction(async (tx) => {
      for (const item of orderItems) {
        if (productById[item.productId].unlimitedStock) continue;
        const result = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (result.count === 0) {
          throw new AppError(`Stock insuficiente para "${item.name}" — disponible ${productById[item.productId].stock}.`, 409);
        }
      }
      const mergedItems = [...existingOrder.items, ...orderItems];
      const mergedTotal = mergedItems.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);
      // Bloque 177 (bug real reportado en vivo — "agregó productos a su
      // cuenta pero eso no se notificó en el panel del vendedor... debe
      // notificarse igual siempre que se pida desde la mesa, aunque la
      // cuenta ya esté abierta"): esta rama nunca toca kitchenStatus (a
      // propósito, no vuelve a bloquear la mesa) así que listPendingTableOrders
      // nunca la veía — customerUpdatedAt es la señal aparte que la hace
      // aparecer en el popup/sonido de "pedido nuevo" igual, sin reabrir el
      // paso de aceptar.
      return tx.tableOrder.update({
        where: { id: existingOrder.id },
        // Bloque 178: `orderItems.length` es cuántos items van al FINAL del
        // array — el frontend resalta `items.slice(-lastCustomerAddCount)`
        // para marcar exactamente esta ronda, sin ambigüedad con lo que ya
        // estaba en la cuenta antes.
        data: { items: mergedItems, total: mergedTotal, customerUpdatedAt: new Date(), lastCustomerAddCount: orderItems.length },
      });
    });
  } else {
    // Bloque 29: chequeo informativo — igual que createOrder, NO reserva ni
    // descuenta nada (eso pasa recién cuando la cocina acepta el pedido, ver
    // updateKitchenStatus). Solo evita registrar un pedido de mesa obviamente
    // imposible con el stock de este instante.
    const insufficientStock = items
      .map((i) => {
        if (productById[i.productId].unlimitedStock) return null; // Bloque 56: "disponible siempre" — nunca entra a este chequeo.
        return { productId: i.productId, requested: i.quantity, available: productById[i.productId].stock, name: productById[i.productId].name };
      })
      .filter((i) => i && i.requested > i.available);
    if (insufficientStock.length > 0) {
      throw new AppError("Algunos productos ya no tienen suficiente stock.", 409, { insufficientStock });
    }

    if (!customerName?.trim()) throw new AppError("Ingresa tu nombre para identificar el pedido.", 400);

    const total = orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
    tableOrder = await prisma.tableOrder.create({
      data: { tableId: table.id, items: orderItems, total, kitchenStatus: "RECEIVED", customerName: customerName.trim(), customerEmail: customerEmail || null },
    });

    // Confirmación al cliente — best-effort, nunca bloquea ni revierte el
    // pedido si el email falla (mismo criterio que sendOrderConfirmationEmail).
    // customerEmail ahora es opcional (Bloque 141) — sendTableOrderStatusEmail
    // ya no hace nada si `to` viene vacío/undefined. Solo tiene sentido en la
    // creación (una "ronda más" no reinicia el ciclo de avisos de estado).
    await sendTableOrderStatusEmail({
      to: customerEmail || null,
      vendorId: table.vendor.id,
      vendorName: table.vendor.companyName,
      tableNumber: table.tableNumber,
      kitchenStatus: "RECEIVED",
    });
  }

  res.status(201).json({ tableOrder });
}

// Bloque 158 (pedido explícito — "los pedidos se rastrearán por un número de
// pedido único... si se actualiza en el sistema del vendedor también se
// actualiza en la página del cliente"): público, sin login (el cliente de
// mesa nunca tiene cuenta) — el `id` (cuid, no adivinable) hace de token de
// acceso, mismo criterio de seguridad que ya usa qrToken en toda esta misma
// función. TableOrder.jsx lo consulta primero después de enviar el pedido, y
// después en un polling liviano mientras el cliente se queda viendo su
// pedido — así, si el vendedor lo modifica (updateTableOrderItems) o avanza
// el estado (updateKitchenStatus), el cliente lo ve solo, sin recargar.
export async function getTableOrderStatus(req, res) {
  const { id } = req.params;
  const tableOrder = await prisma.tableOrder.findUnique({
    where: { id },
    include: { table: { select: { tableNumber: true, label: true, vendorId: true, vendor: { select: { companyName: true } } } } },
  });
  if (!tableOrder) throw new AppError("Pedido no encontrado.", 404);

  // Bloque 189: mismo endpoint para el cliente sin login (TableOrder.jsx) y
  // para el panel del vendedor (TableOrderDetailModal.jsx) — el nombre real
  // de quién agregó cada línea solo viaja para quien de verdad pertenece a
  // ESTE negocio (ver resolveOptionalRequester/isVendorSideRequester
  // arriba); para cualquier otro caso (cliente, o incluso un vendedor/
  // usuario de OTRA tienda con su propio token válido) se oculta.
  const isVendorSide = await isVendorSideRequester(req, tableOrder.table.vendorId);
  res.json({ tableOrder: isVendorSide ? tableOrder : hideStaffNamesFromCustomer(tableOrder) });
}

// Bloque 158 (pedido explícito — "si el vendedor modifica su pedido, el
// cliente podrá ver el pedido modificado con los productos que se le
// cambiaron o agregaron"): mismo criterio que updateOrderItems
// (orders.controller.js) para pedidos normales — reemplazo COMPLETO de
// items, precio siempre retomado del catálogo actual (nunca del que ya
// traía el pedido), solo mientras sigue RECEIVED (una vez que la cocina ya
// empezó a prepararlo — PREPARING, que además ya descontó stock real, ver
// updateKitchenStatus — modificarlo a mano rompería esa contabilidad).
const updateTableOrderItemsSchema = z.object({
  items: z
    .array(z.object({ productId: z.string(), quantity: z.number().int().positive() }))
    .min(1, "El pedido necesita al menos un producto."),
});

export async function updateTableOrderItems(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { tableOrderId } = req.params;
  const { items } = updateTableOrderItemsSchema.parse(req.body);

  const tableOrder = await prisma.tableOrder.findUnique({ where: { id: tableOrderId }, include: { table: true } });
  if (!tableOrder || tableOrder.table.vendorId !== vendor.id) throw new AppError("Pedido de mesa no encontrado.", 404);
  if (tableOrder.kitchenStatus !== "RECEIVED") {
    throw new AppError("Solo se puede modificar un pedido todavía sin aceptar (Recibido).", 400);
  }

  const uniqueProductIds = [...new Set(items.map((i) => i.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: uniqueProductIds }, vendorId: vendor.id } });
  if (products.length !== uniqueProductIds.length) throw new AppError("Uno o más productos ya no están disponibles.", 400);
  const productById = Object.fromEntries(products.map((p) => [p.id, p]));

  const orderItems = items.map((i) =>
    makeOrderItem({
      productId: i.productId,
      name: productById[i.productId].name,
      price: Number(productById[i.productId].price),
      quantity: i.quantity,
      // Bloque 185: esto es el vendedor AJUSTANDO el pedido que el cliente
      // ya había mandado (botón "Modificar" en VendorOrders.jsx/mesas, solo
      // mientras sigue RECEIVED) — sigue siendo, de cara al cliente, SU
      // pedido original, no algo que el local le sumó por su cuenta.
      source: "customer",
    })
  );
  const total = orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const updated = await prisma.tableOrder.update({ where: { id: tableOrderId }, data: { items: orderItems, total } });

  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "table_order_items_modified",
    description: `Modificó el pedido de la mesa #${tableOrder.table.tableNumber}`,
    meta: { tableOrderId },
  });

  res.json({ tableOrder: updated });
}
