import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { logActivity } from "../lib/activityLog.js";
import { pruneSectionPermissions } from "../constants/vendorSections.js";

// Bloque 198 (pedido explícito — "una nueva sección... con el objetivo para
// darle acceso a los usuarios a ella... podrán agregar ventas que se
// hicieron manualmente sin registrarse en la página... cada usuario podrá
// controlar su stock por usuario... la tienda podrá controlar todos los
// stock generales"): "Ventas manuales" — cada VendorStaff reclama una
// porción de Product.stock (VendorStaffAllocation), registra ventas
// puerta-a-puerta contra esa porción (VendorStaffSale, que descuenta a la
// vez su propia allocation Y el stock real), y el dueño/admin supervisa
// todo. `Product.stock` sigue siendo SIEMPRE la única verdad — el reclamo es
// solo un reparto/anotación sobre ese mismo número, nunca un stock aparte
// (ver el comentario largo en VendorStaffAllocation, schema.prisma).

// Bloque 198: solo tiene sentido para quien de verdad tiene una fila propia
// en VendorStaff (un usuario de sistema) — el dueño/admin nunca "reclama"
// ni "vende" para sí mismo, usa las acciones de supervisión de más abajo.
function requireStaffActor(req) {
  if (!req.vendorStaff) throw new AppError("Esta acción es solo para usuarios de sistema con acceso a Agentes de Ventas.", 400);
  return req.vendorStaff;
}

// Bloque 198: el reverso — reasignar stock entre usuarios, ver el log
// completo de ventas de todos, configurar el cuadre de caja, etc. son
// acciones de supervisión — nunca para un usuario de sistema sobre sus
// compañeros, aunque tenga "manage" en la sección (esa sección le da
// acceso a SU PROPIO inventario/ventas, no al de los demás).
function assertOwnerOrAdmin(req) {
  if (req.user.role === "VENDOR_STAFF") throw new AppError("Esta acción es solo para el dueño de la tienda.", 403);
}

function periodSince(period) {
  const now = new Date();
  if (period === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "week") {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // lunes de esta semana
    return d;
  }
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  return null;
}

// Bloque 198: límites del período de cuadre de caja VIGENTE, según la
// frecuencia configurada por el vendedor (Vendor.cashCloseFrequency) — se
// exporta porque cashCloseReminder.job.js necesita el mismo cálculo exacto
// para saber "hoy es el día" antes de mandar el recordatorio.
export function periodBounds(frequency, refDate = new Date()) {
  const d = new Date(refDate);
  if (frequency === "DAILY") {
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }
  if (frequency === "MONTHLY") {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return { start, end };
  }
  // WEEKLY (default) — lunes a lunes.
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

// Bloque 198 (pedido explícito — "si a uno de los usuarios se le agota el
// inventario, se le puede sugerir... que hay otro usuario de la misma
// tienda... mostrarle los datos de ese usuario"): otros usuarios ACTIVOS del
// mismo vendedor que todavía tienen stock reclamado de este producto —
// nunca incluye al que hizo el intento fallido.
async function getSuggestedTeammates(vendorId, productId, excludeStaffId) {
  const rows = await prisma.vendorStaffAllocation.findMany({
    where: {
      productId,
      remainingQty: { gt: 0 },
      vendorStaffId: { not: excludeStaffId },
      vendorStaff: { vendorId, isActive: true },
    },
    include: { vendorStaff: { include: { user: { select: { fullName: true } } } } },
    orderBy: { remainingQty: "desc" },
    take: 3,
  });
  return rows.map((r) => ({
    fullName: r.vendorStaff.user.fullName,
    phone: r.vendorStaff.phone,
    remainingQty: r.remainingQty,
  }));
}

// --- Catálogo / reclamo (usuario de sistema) --------------------------------

// Bloque 199 (bug real reportado en vivo — "en reasignar stock no me salen
// todos los productos disponibles de esa tienda, deben salir todo, veo que
// Tamales Cubanos no sale aunque sea siempre disponible, debe salir y
// asignar un stock para cada vendedor o ponerlo como siempre disponible"):
// ANTES excluía unlimitedStock (Bloque 198 original) — un producto "siempre
// disponible" también se reparte para trackear ventas por usuario, solo que
// sin techo real que respetar (unclaimedQty null = "sin límite", en vez de
// un número). Ver claimAllocation/registerManualSale más abajo — para estos
// productos ninguna de las 2 acciones valida contra ningún pool.
export async function listClaimableProducts(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const products = await prisma.product.findMany({
    where: { vendorId: vendor.id, isActive: true },
    select: { id: true, name: true, images: true, price: true, currency: true, stock: true, unlimitedStock: true },
    orderBy: { name: "asc" },
  });
  if (products.length === 0) return res.json({ products: [] });

  const trackedIds = products.filter((p) => !p.unlimitedStock).map((p) => p.id);
  const allocSums = trackedIds.length
    ? await prisma.vendorStaffAllocation.groupBy({
        by: ["productId"],
        where: { productId: { in: trackedIds } },
        _sum: { remainingQty: true },
      })
    : [];
  const claimedByProduct = new Map(allocSums.map((a) => [a.productId, a._sum.remainingQty ?? 0]));

  res.json({
    products: products.map((p) => ({
      ...p,
      unclaimedQty: p.unlimitedStock ? null : Math.max(p.stock - (claimedByProduct.get(p.id) ?? 0), 0),
    })),
  });
}

const claimSchema = z.object({ productId: z.string(), quantity: z.coerce.number().int().positive() });

// Bloque 202 (pedido explícito — "no quiero que los usuarios vean o puedan
// reclamar stock de los productos que no tienen asignados en ese panel, es
// exclusivo solo para los productos que su tienda le asignó a ellos"):
// reemplaza el Bloque 198 original ("los usuarios van a poder buscar entre
// los productos... agregar un producto a su sección") — el auto-servicio
// se elimina del todo. Ahora el ÚNICO camino para que un usuario de sistema
// tenga stock reclamado es que el dueño/admin se lo reasigne (ver
// reassignAllocation, más abajo). Bloqueado acá server-side, no solo
// ocultando el botón en la UI — mismo criterio de todo este proyecto: la
// UI nunca es la única barrera real.
export async function claimAllocation(req, res) {
  if (req.user.role === "VENDOR_STAFF") {
    throw new AppError("Ya no puedes reclamar stock por tu cuenta — pídele al dueño que te asigne los productos desde Usuarios.", 403);
  }
  const staff = requireStaffActor(req);
  const vendor = await resolveMyVendor(req.user.id);
  const { productId, quantity } = claimSchema.parse(req.body);

  const allocation = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT "vendorId", name, stock, "unlimitedStock" FROM "Product" WHERE id = ${productId} FOR UPDATE`;
    const product = rows[0];
    if (!product || product.vendorId !== vendor.id) throw new AppError("Producto no encontrado.", 404);

    // Bloque 199: "siempre disponible" reparte sin techo — nunca hay un pool
    // real que se pueda agotar entre usuarios para este producto.
    if (!product.unlimitedStock) {
      const agg = await tx.vendorStaffAllocation.aggregate({ where: { productId }, _sum: { remainingQty: true } });
      const unclaimed = product.stock - (agg._sum.remainingQty ?? 0);
      if (quantity > unclaimed) {
        throw new AppError(`Solo quedan ${Math.max(unclaimed, 0)} unidades sin reclamar de "${product.name}".`, 409, {
          unclaimed: Math.max(unclaimed, 0),
        });
      }
    }

    return tx.vendorStaffAllocation.upsert({
      where: { vendorStaffId_productId: { vendorStaffId: staff.id, productId } },
      create: { vendorStaffId: staff.id, productId, allocatedQty: quantity, remainingQty: quantity },
      update: { allocatedQty: { increment: quantity }, remainingQty: { increment: quantity } },
      include: { product: { select: { id: true, name: true, images: true, price: true, currency: true } } },
    });
  });

  logActivity({
    actorId: req.user.id,
    actorRole: "VENDOR_STAFF",
    vendorId: vendor.id,
    action: "staff_allocation_claimed",
    description: `Reclamó ${quantity} unidad(es) de "${allocation.product.name}" para vender por su cuenta.`,
    meta: { productId, quantity },
  });

  res.status(201).json({ allocation });
}

const releaseSchema = z.object({ productId: z.string(), quantity: z.coerce.number().int().positive() });

// Bloque 198: devuelve stock reclamado al pool común, sin tocar
// Product.stock — nunca se vendió de verdad, solo deja de estar "apartado"
// para este usuario.
export async function releaseAllocation(req, res) {
  const staff = requireStaffActor(req);
  const { productId, quantity } = releaseSchema.parse(req.body);

  const result = await prisma.vendorStaffAllocation.updateMany({
    where: { vendorStaffId: staff.id, productId, remainingQty: { gte: quantity } },
    data: { remainingQty: { decrement: quantity } },
  });
  if (result.count === 0) throw new AppError("No tienes esa cantidad reclamada para liberar.", 409);
  res.json({ ok: true });
}

// Bloque 206 (pedido explícito — "elimina que los usuarios deban aceptar
// lotes... automáticamente pasa al inventario de ese usuario sin tomar
// acción"): ya no hace falta el OR con pendingQty (Bloque 199, revertido) —
// reassignAllocation ahora escribe directo en remainingQty.
export async function listMyAllocations(req, res) {
  const staff = requireStaffActor(req);
  const allocations = await prisma.vendorStaffAllocation.findMany({
    where: { vendorStaffId: staff.id, remainingQty: { gt: 0 } },
    include: { product: { select: { id: true, name: true, images: true, price: true, currency: true, unlimitedStock: true } } },
    orderBy: { updatedAt: "desc" },
  });
  res.json({ allocations });
}

// --- Ventas manuales (usuario de sistema) -----------------------------------

const saleSchema = z.object({
  productId: z.string(),
  quantity: z.coerce.number().int().positive(),
  note: z.string().trim().max(280).optional(),
});

// Bloque 198 (pedido explícito — "los usuarios podrán registrar sus ventas
// diarias manualmente... y así su inventario para ese usuario se va
// rebajando. Y la tienda va rebajando el inventario general también"): UNA
// transacción, 2 decrementos atómicos con guardia (mismo patrón
// updateMany+WHERE gte que confirmOrderSale/updateOrderStatus,
// orders.controller.js) — si CUALQUIERA de los dos no alcanza, se revierte
// todo (Prisma hace rollback solo si algo dentro del callback tira).
// Bloque 199 (pedido explícito — "si se queda sin stock de un producto se
// le notifica al admin"): dedupe simple — VendorNotification no tiene un
// campo `meta` (ver schema.prisma), así que en vez de una fila de control
// aparte se busca si ya existe un aviso reciente que mencione a este mismo
// usuario Y este mismo producto en el cuerpo, para no crear uno nuevo por
// cada reintento seguido.
async function notifyOwnerOfShortage(vendorId, staffName, productName) {
  const recentWindow = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const recent = await prisma.vendorNotification.findFirst({
    where: {
      vendorId,
      type: "VENDOR_STAFF_OUT_OF_STOCK",
      createdAt: { gte: recentWindow },
      body: { contains: staffName },
      AND: [{ body: { contains: productName } }],
    },
  });
  if (recent) return;
  await prisma.vendorNotification.create({
    data: {
      vendorId,
      type: "VENDOR_STAFF_OUT_OF_STOCK",
      title: "Un usuario se quedó sin stock",
      body: `${staffName} intentó vender "${productName}" pero ya no tiene stock reclamado — reasignale más desde Agentes de Ventas.`,
    },
  });
}

// Bloque 198/199 (pedido explícito — "los usuarios podrán registrar sus
// ventas diarias manualmente... y así su inventario para ese usuario se va
// rebajando. Y la tienda va rebajando el inventario general también";
// Bloque 199 — "siempre disponible" nunca tiene techo real que revisar):
// para un producto CON seguimiento real, una transacción con 2 decrementos
// atómicos con guardia (mismo patrón updateMany+WHERE gte que
// confirmOrderSale/updateOrderStatus, orders.controller.js) — si CUALQUIERA
// de los dos no alcanza, se revierte todo. Para "siempre disponible"
// (unlimitedStock), ninguno de los 2 ledgers se toca — el producto en sí ya
// declara que no le lleva la cuenta a nadie, la venta manual solo queda
// registrada para el tracking por usuario.
export async function registerManualSale(req, res) {
  const staff = requireStaffActor(req);
  const vendor = await resolveMyVendor(req.user.id);
  const { productId, quantity, note } = saleSchema.parse(req.body);

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || product.vendorId !== vendor.id) throw new AppError("Producto no encontrado.", 404);

  if (product.unlimitedStock) {
    const sale = await prisma.vendorStaffSale.create({
      data: {
        vendorId: vendor.id,
        vendorStaffId: staff.id,
        productId,
        productName: product.name,
        quantity,
        unitPrice: product.price,
        total: Number(product.price) * quantity,
        note: note?.trim() || null,
      },
    });
    logActivity({
      actorId: req.user.id,
      actorRole: "VENDOR_STAFF",
      vendorId: vendor.id,
      action: "staff_manual_sale_registered",
      description: `Registró una venta manual: ${quantity} × "${product.name}" (${sale.total} ${product.currency}).`,
      meta: { saleId: sale.id, productId, quantity },
    });
    return res.status(201).json({ sale });
  }

  const allocation = await prisma.vendorStaffAllocation.findUnique({
    where: { vendorStaffId_productId: { vendorStaffId: staff.id, productId } },
  });
  if (!allocation || allocation.remainingQty < quantity) {
    const [suggestedTeammates, staffUser] = await Promise.all([
      getSuggestedTeammates(vendor.id, productId, staff.id),
      prisma.user.findUnique({ where: { id: staff.userId }, select: { fullName: true } }),
    ]);
    // Bloque 199: local a Postgres, no una llamada externa lenta (a
    // diferencia del email) — se espera antes de responder, así el aviso ya
    // existe de verdad cuando el usuario ve el error (nunca "fire and
    // forget" acá, sin motivo real para no esperarlo).
    await notifyOwnerOfShortage(vendor.id, staffUser?.fullName ?? "Un usuario", product.name);
    throw new AppError(`No tienes suficiente stock reclamado de "${product.name}".`, 409, {
      yourRemaining: allocation?.remainingQty ?? 0,
      suggestedTeammates,
    });
  }

  const sale = await prisma.$transaction(async (tx) => {
    const allocUpdate = await tx.vendorStaffAllocation.updateMany({
      where: { vendorStaffId: staff.id, productId, remainingQty: { gte: quantity } },
      data: { remainingQty: { decrement: quantity } },
    });
    if (allocUpdate.count === 0) throw new AppError(`No tienes suficiente stock reclamado de "${product.name}".`, 409);

    // Bloque 198: "el inventario real seguirá siendo el mismo disponible
    // para todos" (pedido explícito) — el stock real es compartido con la
    // tienda online, así que puede haberse agotado ahí aunque el ledger
    // propio del usuario todavía diga que tiene. Este chequeo es el que de
    // verdad protege que Product.stock nunca quede negativo.
    const stockUpdate = await tx.product.updateMany({
      where: { id: productId, stock: { gte: quantity } },
      data: { stock: { decrement: quantity } },
    });
    if (stockUpdate.count === 0) {
      throw new AppError(
        `"${product.name}" no tiene suficiente stock real disponible en este momento — puede que se haya vendido en línea. Avisale al dueño de la tienda para reconciliar.`,
        409
      );
    }

    return tx.vendorStaffSale.create({
      data: {
        vendorId: vendor.id,
        vendorStaffId: staff.id,
        productId,
        productName: product.name,
        quantity,
        unitPrice: product.price,
        total: Number(product.price) * quantity,
        note: note?.trim() || null,
      },
    });
  });

  logActivity({
    actorId: req.user.id,
    actorRole: "VENDOR_STAFF",
    vendorId: vendor.id,
    action: "staff_manual_sale_registered",
    description: `Registró una venta manual: ${quantity} × "${product.name}" (${sale.total} ${product.currency}).`,
    meta: { saleId: sale.id, productId, quantity },
  });

  res.status(201).json({ sale });
}

const batchSaleSchema = z.object({
  items: z
    .array(z.object({ productId: z.string(), quantity: z.coerce.number().int().positive(), note: z.string().trim().max(280).optional() }))
    .min(1)
    .max(50),
});

// Bloque 199 (pedido explícito — "podrá filtrar productos uno a uno o
// inclusive varios a la vez, eso irá sumando el total en ventas... para
// llevar un cuadre de caja perfecto y correcto sin que se queden datos
// relevantes sueltos"): registra VARIAS líneas de una sola vez (una ronda de
// ventas del día) — TODO en una única transacción: o se registran todas, o
// ninguna, nunca un estado a medias que después haya que reconciliar a
// mano. Cada producto sigue siendo su propia fila VendorStaffSale (no se
// mergea en una sola) para que el tracking por producto siga siendo exacto.
export async function registerManualSalesBatch(req, res) {
  const staff = requireStaffActor(req);
  const vendor = await resolveMyVendor(req.user.id);
  const { items } = batchSaleSchema.parse(req.body);

  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, vendorId: vendor.id } });
  const productById = new Map(products.map((p) => [p.id, p]));
  for (const item of items) {
    if (!productById.has(item.productId)) throw new AppError("Uno de los productos no fue encontrado.", 404);
  }

  // Bloque 199: varias líneas del MISMO producto en un solo batch se suman
  // antes de chequear el ledger — si no, 2 líneas de 3 unidades cada una
  // podrían pasar el chequeo individual aunque juntas superen lo que el
  // usuario tiene reclamado.
  const neededByProduct = new Map();
  for (const item of items) {
    if (productById.get(item.productId).unlimitedStock) continue;
    neededByProduct.set(item.productId, (neededByProduct.get(item.productId) ?? 0) + item.quantity);
  }

  if (neededByProduct.size > 0) {
    const allocations = await prisma.vendorStaffAllocation.findMany({
      where: { vendorStaffId: staff.id, productId: { in: [...neededByProduct.keys()] } },
    });
    const remainingByProduct = new Map(allocations.map((a) => [a.productId, a.remainingQty]));
    for (const [productId, needed] of neededByProduct) {
      const have = remainingByProduct.get(productId) ?? 0;
      if (have < needed) {
        const suggestedTeammates = await getSuggestedTeammates(vendor.id, productId, staff.id);
        const staffUser = await prisma.user.findUnique({ where: { id: staff.userId }, select: { fullName: true } });
        await notifyOwnerOfShortage(vendor.id, staffUser?.fullName ?? "Un usuario", productById.get(productId).name);
        throw new AppError(`No tienes suficiente stock reclamado de "${productById.get(productId).name}".`, 409, {
          productId,
          yourRemaining: have,
          suggestedTeammates,
        });
      }
    }
  }

  const sales = await prisma.$transaction(async (tx) => {
    const created = [];
    for (const item of items) {
      const product = productById.get(item.productId);
      if (!product.unlimitedStock) {
        const allocUpdate = await tx.vendorStaffAllocation.updateMany({
          where: { vendorStaffId: staff.id, productId: item.productId, remainingQty: { gte: item.quantity } },
          data: { remainingQty: { decrement: item.quantity } },
        });
        if (allocUpdate.count === 0) throw new AppError(`No tienes suficiente stock reclamado de "${product.name}".`, 409);
        const stockUpdate = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (stockUpdate.count === 0) {
          throw new AppError(`"${product.name}" no tiene suficiente stock real disponible — puede que se haya vendido en línea.`, 409);
        }
      }
      created.push(
        await tx.vendorStaffSale.create({
          data: {
            vendorId: vendor.id,
            vendorStaffId: staff.id,
            productId: item.productId,
            productName: product.name,
            quantity: item.quantity,
            unitPrice: product.price,
            total: Number(product.price) * item.quantity,
            note: item.note?.trim() || null,
          },
        })
      );
    }
    return created;
  });

  const total = sales.reduce((sum, s) => sum + Number(s.total), 0);
  logActivity({
    actorId: req.user.id,
    actorRole: "VENDOR_STAFF",
    vendorId: vendor.id,
    action: "staff_manual_sale_registered",
    description: `Registró ${sales.length} venta(s) manuales en un lote (${total} total).`,
    meta: { saleIds: sales.map((s) => s.id) },
  });

  res.status(201).json({ sales, total });
}

export async function listMySales(req, res) {
  const staff = requireStaffActor(req);
  const since = periodSince(req.query.period);
  const sales = await prisma.vendorStaffSale.findMany({
    where: { vendorStaffId: staff.id, ...(since ? { createdAt: { gte: since } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({ sales, total: sales.reduce((sum, s) => sum + Number(s.total), 0) });
}

// Bloque 199 (pedido explícito — "sí podrá registrar ventas, devoluciones y
// todo lo que debería llevar un vendedor desde esa sección... sin que se
// queden datos relevantes sueltos"): a diferencia de updateManualSale
// (dueño, corrige cualquier campo), esto SOLO puede achicar la cantidad de
// una venta PROPIA — nunca agrandarla ni tocar otros campos — y devuelve la
// diferencia a los 2 ledgers (si el producto lleva stock real). Deja
// registrado el motivo en ActivityLog en vez de una tabla nueva, para no
// duplicar el concepto de "corrección de venta" con updateManualSale.
const returnSaleSchema = z.object({
  quantity: z.coerce.number().int().positive().optional(), // ausente = devolución total
  reason: z.string().trim().max(280).optional(),
});

export async function returnManualSale(req, res) {
  const staff = requireStaffActor(req);
  const vendor = await resolveMyVendor(req.user.id);
  const sale = await prisma.vendorStaffSale.findUnique({ where: { id: req.params.id } });
  if (!sale || sale.vendorStaffId !== staff.id) throw new AppError("Venta no encontrada.", 404);

  const { quantity, reason } = returnSaleSchema.parse(req.body);
  const returnQty = quantity ?? sale.quantity;
  if (returnQty > sale.quantity) throw new AppError("No puedes devolver más de lo que vendiste en este registro.", 400);

  const unitPrice = Number(sale.unitPrice);
  const remainingQuantity = sale.quantity - returnQty;

  const updated = await prisma.$transaction(async (tx) => {
    if (sale.productId) {
      const product = await tx.product.findUnique({ where: { id: sale.productId }, select: { unlimitedStock: true } });
      // Bloque 199: mismo criterio que el resto del archivo — "siempre
      // disponible" nunca movió ningún ledger al vender, así que tampoco al
      // devolver (si el producto se borró después, product es null — nada
      // que devolver tampoco, igual que en deleteManualSale/updateManualSale).
      if (product && !product.unlimitedStock) {
        await tx.vendorStaffAllocation.updateMany({
          where: { vendorStaffId: sale.vendorStaffId, productId: sale.productId },
          data: { remainingQty: { increment: returnQty } },
        });
        await tx.product.updateMany({ where: { id: sale.productId }, data: { stock: { increment: returnQty } } });
      }
    }

    if (remainingQuantity === 0) {
      await tx.vendorStaffSale.delete({ where: { id: sale.id } });
      return null;
    }
    return tx.vendorStaffSale.update({
      where: { id: sale.id },
      data: { quantity: remainingQuantity, total: unitPrice * remainingQuantity },
    });
  });

  logActivity({
    actorId: req.user.id,
    actorRole: "VENDOR_STAFF",
    vendorId: vendor.id,
    action: "staff_manual_sale_returned",
    description: `Registró una devolución: ${returnQty} × "${sale.productName}"${reason ? ` — ${reason}` : ""}.`,
    meta: { saleId: sale.id, productId: sale.productId, quantity: returnQty, reason: reason ?? null },
  });

  res.json({ sale: updated, returned: returnQty });
}

// --- Cuadre de caja (usuario de sistema) ------------------------------------

export async function getMyCashCloseStatus(req, res) {
  const staff = requireStaffActor(req);
  const vendor = await resolveMyVendor(req.user.id);
  const frequency = vendor.cashCloseFrequency ?? "WEEKLY";
  const { start, end } = periodBounds(frequency);

  const [agg, existing] = await Promise.all([
    prisma.vendorStaffSale.aggregate({ where: { vendorStaffId: staff.id, createdAt: { gte: start, lt: end } }, _sum: { total: true } }),
    prisma.vendorStaffCashClose.findFirst({ where: { vendorStaffId: staff.id, periodStart: start, periodEnd: end } }),
  ]);

  res.json({
    periodStart: start,
    periodEnd: end,
    frequency: vendor.cashCloseFrequency, // null = el dueño nunca configuró recordatorio
    cashCloseDayOfWeek: vendor.cashCloseDayOfWeek,
    cashCloseDayOfMonth: vendor.cashCloseDayOfMonth,
    totalSales: Number(agg._sum.total ?? 0),
    reported: !!existing,
  });
}

// Bloque 198 (pedido explícito — "los usuarios tienen que tener en cuenta
// que ese día es el día que deben ir y depositar ese dinero"): el usuario
// marca el período vigente como ya reportado/depositado — congela el total
// en ese momento (una venta cargada DESPUÉS de marcarlo no debe mover un
// cuadre ya cerrado).
export async function markMyCashClose(req, res) {
  const staff = requireStaffActor(req);
  const vendor = await resolveMyVendor(req.user.id);
  const frequency = vendor.cashCloseFrequency ?? "WEEKLY";
  const { start, end } = periodBounds(frequency);

  const existing = await prisma.vendorStaffCashClose.findFirst({ where: { vendorStaffId: staff.id, periodStart: start, periodEnd: end } });
  if (existing) throw new AppError("Ya reportaste este período.", 409);

  const agg = await prisma.vendorStaffSale.aggregate({
    where: { vendorStaffId: staff.id, createdAt: { gte: start, lt: end } },
    _sum: { total: true },
  });

  const cashClose = await prisma.vendorStaffCashClose.create({
    data: {
      vendorStaffId: staff.id,
      periodStart: start,
      periodEnd: end,
      totalSales: agg._sum.total ?? 0,
      note: typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 280) || null : null,
    },
  });

  logActivity({
    actorId: req.user.id,
    actorRole: "VENDOR_STAFF",
    vendorId: vendor.id,
    action: "staff_cash_close_reported",
    description: `Reportó su cuadre de caja: ${cashClose.totalSales} en el período.`,
    meta: { cashCloseId: cashClose.id },
  });

  res.status(201).json({ cashClose });
}

// --- Supervisión (dueño / admin) --------------------------------------------

export async function listStaffRoster(req, res) {
  assertOwnerOrAdmin(req);
  const vendor = await resolveMyVendor(req.user.id);
  const staff = await prisma.vendorStaff.findMany({
    where: { vendorId: vendor.id },
    include: { user: { select: { fullName: true, email: true } }, allocations: true },
    orderBy: { createdAt: "asc" },
  });

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const salesAgg = staff.length
    ? await prisma.vendorStaffSale.groupBy({
        by: ["vendorStaffId"],
        where: { vendorId: vendor.id, createdAt: { gte: monthStart } },
        _sum: { total: true, quantity: true },
      })
    : [];
  const salesByStaff = new Map(salesAgg.map((s) => [s.vendorStaffId, s]));

  res.json({
    staff: staff.map((s) => ({
      id: s.id,
      fullName: s.user.fullName,
      email: s.user.email,
      phone: s.phone,
      photoUrl: s.photoUrl,
      isActive: s.isActive,
      allocatedTotal: s.allocations.reduce((sum, a) => sum + a.allocatedQty, 0),
      remainingTotal: s.allocations.reduce((sum, a) => sum + a.remainingQty, 0),
      productsClaimed: s.allocations.filter((a) => a.remainingQty > 0).length,
      salesThisMonth: Number(salesByStaff.get(s.id)?._sum.total ?? 0),
      unitsSoldThisMonth: salesByStaff.get(s.id)?._sum.quantity ?? 0,
    })),
  });
}

// Bloque 198 (pedido explícito — "el administrador vendedor de la tienda
// podrá tener una referencia y podrá ver qué tanto está vendiendo uno de
// los usuarios diariamente, semanalmente o mensualmente en una gráfica por
// usuario... cuáles son los productos que más vende cada usuario"): mismo
// criterio que getDashboardAnalytics (vendors.controller.js) pero MUCHO más
// simple — VendorStaffSale es una tabla real con FKs reales, no hace falta
// ningún UNION ALL con TableOrder.
export async function getStaffAnalytics(req, res) {
  assertOwnerOrAdmin(req);
  const vendor = await resolveMyVendor(req.user.id);
  const staff = await prisma.vendorStaff.findFirst({ where: { id: req.params.staffId, vendorId: vendor.id } });
  if (!staff) throw new AppError("Usuario no encontrado.", 404);

  const eightWeeksAgo = new Date(Date.now() - 56 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [dailyRows, bestProducts] = await Promise.all([
    prisma.$queryRaw`
      SELECT DATE_TRUNC('day', "createdAt") AS day, COALESCE(SUM(total), 0)::numeric AS total
      FROM "VendorStaffSale"
      WHERE "vendorStaffId" = ${staff.id} AND "createdAt" >= ${eightWeeksAgo}
      GROUP BY day ORDER BY day ASC
    `,
    prisma.vendorStaffSale.groupBy({
      by: ["productId", "productName"],
      where: { vendorStaffId: staff.id, createdAt: { gte: monthStart } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    }),
  ]);

  res.json({
    salesByDay: dailyRows.map((r) => ({ day: r.day, total: Number(r.total) })),
    bestProducts: bestProducts.map((p) => ({ productId: p.productId, name: p.productName, soldCount: p._sum.quantity ?? 0 })),
  });
}

// Bloque 199 (pedido explícito — "los productos que más se venden y menos
// se venden en una tabla de seguimiento"): a diferencia de getStaffAnalytics
// (un usuario puntual), esto agrega TODAS las ventas manuales de la tienda
// por producto — una sola lista ordenada de mayor a menor; el frontend
// puede mostrar el principio (más vendidos) y el final (menos vendidos) de
// la misma lista sin pedir 2 endpoints distintos.
export async function getProductsTracking(req, res) {
  assertOwnerOrAdmin(req);
  const vendor = await resolveMyVendor(req.user.id);
  const since = periodSince(req.query.period) ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const rows = await prisma.vendorStaffSale.groupBy({
    by: ["productId", "productName"],
    where: { vendorId: vendor.id, createdAt: { gte: since } },
    _sum: { quantity: true, total: true },
    orderBy: { _sum: { quantity: "desc" } },
  });

  res.json({
    products: rows.map((r) => ({
      productId: r.productId,
      name: r.productName,
      soldCount: r._sum.quantity ?? 0,
      totalSales: Number(r._sum.total ?? 0),
    })),
  });
}

export async function listAllSales(req, res) {
  assertOwnerOrAdmin(req);
  const vendor = await resolveMyVendor(req.user.id);
  const { staffId } = req.query;
  const since = periodSince(req.query.period);

  const sales = await prisma.vendorStaffSale.findMany({
    where: { vendorId: vendor.id, ...(staffId ? { vendorStaffId: staffId } : {}), ...(since ? { createdAt: { gte: since } } : {}) },
    include: { vendorStaff: { include: { user: { select: { fullName: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  res.json({ sales: sales.map((s) => ({ ...s, staffName: s.vendorStaff.user.fullName })) });
}

const updateSaleSchema = z.object({
  quantity: z.coerce.number().int().positive().optional(),
  unitPrice: z.coerce.number().positive().optional(),
  note: z.string().trim().max(280).optional(),
});

// Bloque 198 (pedido explícito — "el administrador podrá verificar,
// modificar, eliminar y supervisar todo este contenido"): corrige una venta
// mal cargada — el AJUSTE (delta de cantidad, si cambia) es lo único que
// mueve los 2 ledgers, nunca el valor absoluto nuevo directo.
export async function updateManualSale(req, res) {
  assertOwnerOrAdmin(req);
  const vendor = await resolveMyVendor(req.user.id);
  const sale = await prisma.vendorStaffSale.findUnique({ where: { id: req.params.id } });
  if (!sale || sale.vendorId !== vendor.id) throw new AppError("Venta no encontrada.", 404);

  const data = updateSaleSchema.parse(req.body);
  const newQuantity = data.quantity ?? sale.quantity;
  const newUnitPrice = data.unitPrice ?? Number(sale.unitPrice);
  const qtyDelta = newQuantity - sale.quantity;

  const updated = await prisma.$transaction(async (tx) => {
    if (qtyDelta !== 0 && sale.productId) {
      if (qtyDelta > 0) {
        const allocUpdate = await tx.vendorStaffAllocation.updateMany({
          where: { vendorStaffId: sale.vendorStaffId, productId: sale.productId, remainingQty: { gte: qtyDelta } },
          data: { remainingQty: { decrement: qtyDelta } },
        });
        if (allocUpdate.count === 0) throw new AppError("El usuario no tiene suficiente stock reclamado para este ajuste.", 409);
        const stockUpdate = await tx.product.updateMany({
          where: { id: sale.productId, stock: { gte: qtyDelta } },
          data: { stock: { decrement: qtyDelta } },
        });
        if (stockUpdate.count === 0) throw new AppError("No hay suficiente stock real para este ajuste.", 409);
      } else {
        await tx.vendorStaffAllocation.updateMany({
          where: { vendorStaffId: sale.vendorStaffId, productId: sale.productId },
          data: { remainingQty: { increment: -qtyDelta } },
        });
        await tx.product.updateMany({ where: { id: sale.productId }, data: { stock: { increment: -qtyDelta } } });
      }
    }

    return tx.vendorStaffSale.update({
      where: { id: sale.id },
      data: {
        quantity: newQuantity,
        unitPrice: newUnitPrice,
        total: newUnitPrice * newQuantity,
        ...(data.note !== undefined ? { note: data.note?.trim() || null } : {}),
      },
    });
  });

  res.json({ sale: updated });
}

// Bloque 198: borrar SIEMPRE devuelve lo vendido a los 2 ledgers primero —
// nunca un borrado silencioso que deje inventario "perdido".
export async function deleteManualSale(req, res) {
  assertOwnerOrAdmin(req);
  const vendor = await resolveMyVendor(req.user.id);
  const sale = await prisma.vendorStaffSale.findUnique({ where: { id: req.params.id } });
  if (!sale || sale.vendorId !== vendor.id) throw new AppError("Venta no encontrada.", 404);

  await prisma.$transaction(async (tx) => {
    if (sale.productId) {
      await tx.vendorStaffAllocation.updateMany({
        where: { vendorStaffId: sale.vendorStaffId, productId: sale.productId },
        data: { remainingQty: { increment: sale.quantity } },
      });
      await tx.product.updateMany({ where: { id: sale.productId }, data: { stock: { increment: sale.quantity } } });
    }
    await tx.vendorStaffSale.delete({ where: { id: sale.id } });
  });

  res.json({ ok: true });
}

const reassignSchema = z.object({
  productId: z.string(),
  fromVendorStaffId: z.string().nullable().optional(),
  toVendorStaffId: z.string(),
  quantity: z.coerce.number().int().positive(),
});

// Bloque 198/199/206 (pedido explícito — "elimina que los usuarios deban
// aceptar lotes al vendedor o tienda asignarlos a un usuario automáticamente
// pasa al inventario de ese usuario sin tomar acción"): acción del DUEÑO —
// mueve stock reclamado directo de un usuario a otro (o del pool sin
// reclamar a un usuario), sin los límites de self-service. Entra DIRECTO a
// allocatedQty/remainingQty — ya no pasa por pendingQty/"aceptar lote"
// (Bloque 199 original, revertido acá; ver la migración de datos que
// convirtió cualquier pendingQty viejo). Para un producto "siempre
// disponible", ninguna cantidad de origen se valida (nunca hay un pool real
// que agotar).
export async function reassignAllocation(req, res) {
  assertOwnerOrAdmin(req);
  const vendor = await resolveMyVendor(req.user.id);
  const { productId, fromVendorStaffId, toVendorStaffId, quantity } = reassignSchema.parse(req.body);

  const toStaff = await prisma.vendorStaff.findFirst({ where: { id: toVendorStaffId, vendorId: vendor.id } });
  if (!toStaff) throw new AppError("Usuario destino no encontrado.", 404);

  await prisma.$transaction(async (tx) => {
    const productRows = await tx.$queryRaw`SELECT stock, name, "unlimitedStock" FROM "Product" WHERE id = ${productId} FOR UPDATE`;
    const product = productRows[0];
    if (!product) throw new AppError("Producto no encontrado.", 404);

    if (!product.unlimitedStock) {
      if (fromVendorStaffId) {
        const fromStaff = await tx.vendorStaff.findFirst({ where: { id: fromVendorStaffId, vendorId: vendor.id } });
        if (!fromStaff) throw new AppError("Usuario de origen no encontrado.", 404);
        const dec = await tx.vendorStaffAllocation.updateMany({
          where: { vendorStaffId: fromVendorStaffId, productId, remainingQty: { gte: quantity } },
          data: { remainingQty: { decrement: quantity } },
        });
        if (dec.count === 0) throw new AppError("El usuario de origen no tiene esa cantidad disponible.", 409);
      } else {
        const agg = await tx.vendorStaffAllocation.aggregate({ where: { productId }, _sum: { remainingQty: true } });
        const unclaimed = product.stock - (agg._sum.remainingQty ?? 0);
        if (quantity > unclaimed) throw new AppError(`Solo hay ${Math.max(unclaimed, 0)} unidades sin reclamar de "${product.name}".`, 409);
      }
    } else if (fromVendorStaffId) {
      // "Siempre disponible" no tiene ceiling, pero si se mueve DE otro
      // usuario, ese usuario sí necesita tener esa cantidad reclamada.
      const dec = await tx.vendorStaffAllocation.updateMany({
        where: { vendorStaffId: fromVendorStaffId, productId, remainingQty: { gte: quantity } },
        data: { remainingQty: { decrement: quantity } },
      });
      if (dec.count === 0) throw new AppError("El usuario de origen no tiene esa cantidad disponible.", 409);
    }

    await tx.vendorStaffAllocation.upsert({
      where: { vendorStaffId_productId: { vendorStaffId: toVendorStaffId, productId } },
      create: { vendorStaffId: toVendorStaffId, productId, allocatedQty: quantity, remainingQty: quantity },
      update: { allocatedQty: { increment: quantity }, remainingQty: { increment: quantity } },
    });

    // Bloque 200 (bug real reportado en vivo — "tengo un usuario asignado
    // con stock pero cuando accedo al panel del usuario solo veo la
    // sección perfil"; pedido explícito original — "cuando se asigna un
    // stock a un usuario automáticamente el usuario debe ver una nueva
    // sección en su panel"): reasignar stock desde acá es justamente el
    // disparador que el pedido original describía — si el destino todavía
    // no tenía acceso a "ventas-manuales", se lo agrega ahora, nunca
    // reemplazando el resto de sus secciones/permisos ya configurados.
    if (!toStaff.allowedSections.includes("ventas-manuales")) {
      const nextSections = [...toStaff.allowedSections, "ventas-manuales"];
      const nextPermissions = { ...(toStaff.sectionPermissions ?? {}), "ventas-manuales": "manage" };
      await tx.vendorStaff.update({
        where: { id: toVendorStaffId },
        data: { allowedSections: nextSections, sectionPermissions: pruneSectionPermissions(nextSections, nextPermissions) },
      });
    }
  });

  logActivity({
    actorId: req.user.id,
    // Bloque 198: ActivityActorRole no tiene un valor propio para "admin de
    // la plataforma" (ver schema.prisma) — mismo criterio que el resto del
    // proyecto, se registra como VENDOR (quien reasigna siempre actúa "a
    // nombre" del negocio, sea el dueño o soporte).
    actorRole: "VENDOR",
    vendorId: vendor.id,
    action: "staff_allocation_reassigned",
    description: `Reasignó ${quantity} unidad(es) a un usuario de sistema.`,
    meta: { productId, fromVendorStaffId: fromVendorStaffId ?? null, toVendorStaffId, quantity },
  });

  res.json({ ok: true });
}

// Bloque 204 (pedido explícito — "poder ver también el stock asignado,
// también poder modificar ese stock, poder eliminar productos asignados a
// un usuario"): la tarjeta de VendorUsers.jsx ya no muestra todo esto suelto
// — se mudó a un detalle por usuario, y este es el desglose producto por
// producto que ese detalle necesita (listStaffRoster de arriba solo trae
// totales agregados). Trae TODAS las filas, incluso con remainingQty=0 — el
// dueño también necesita poder ver/borrar una asignación ya vacía.
export async function getStaffAllocations(req, res) {
  assertOwnerOrAdmin(req);
  const vendor = await resolveMyVendor(req.user.id);
  const staff = await prisma.vendorStaff.findFirst({ where: { id: req.params.staffId, vendorId: vendor.id } });
  if (!staff) throw new AppError("Usuario no encontrado.", 404);

  const allocations = await prisma.vendorStaffAllocation.findMany({
    where: { vendorStaffId: staff.id },
    include: { product: { select: { id: true, name: true, images: true, price: true, currency: true, unlimitedStock: true } } },
    orderBy: { updatedAt: "desc" },
  });
  res.json({ allocations });
}

const setAllocationSchema = z.object({ remainingQty: z.coerce.number().int().min(0) });

// Bloque 204: "modificar el stock" de un usuario puntual — a diferencia de
// reassignAllocation (mueve entre 2 partes, un producto a la vez), esto
// corrige el número directo, sin el paso de "aceptar el lote" (es el dueño
// arreglando un número, no mandándole mercancía nueva). Igual respeta la
// misma regla de siempre: si el número SUBE, esa diferencia tiene que salir
// del pool sin reclamar real (nunca se inventa stock que no existe), con el
// mismo lock FOR UPDATE que claim/reassign. Si BAJA, la diferencia vuelve
// sola al pool (ningún chequeo hace falta ahí). allocatedQty (total
// histórico) solo sube cuando remainingQty sube — nunca baja, mismo
// criterio que el resto del archivo (ver el comentario en schema.prisma).
export async function setStaffAllocationQuantity(req, res) {
  assertOwnerOrAdmin(req);
  const vendor = await resolveMyVendor(req.user.id);
  const staff = await prisma.vendorStaff.findFirst({ where: { id: req.params.staffId, vendorId: vendor.id } });
  if (!staff) throw new AppError("Usuario no encontrado.", 404);
  const { remainingQty: nextQty } = setAllocationSchema.parse(req.body);

  const allocation = await prisma.vendorStaffAllocation.findFirst({ where: { id: req.params.id, vendorStaffId: staff.id } });
  if (!allocation) throw new AppError("Asignación no encontrada.", 404);

  const delta = nextQty - allocation.remainingQty;
  if (delta === 0) return res.json({ allocation });

  const updated = await prisma.$transaction(async (tx) => {
    if (delta > 0) {
      const productRows = await tx.$queryRaw`SELECT stock, name, "unlimitedStock" FROM "Product" WHERE id = ${allocation.productId} FOR UPDATE`;
      const product = productRows[0];
      if (!product) throw new AppError("Producto no encontrado.", 404);
      if (!product.unlimitedStock) {
        const agg = await tx.vendorStaffAllocation.aggregate({ where: { productId: allocation.productId }, _sum: { remainingQty: true } });
        const unclaimed = product.stock - (agg._sum.remainingQty ?? 0);
        if (delta > unclaimed) throw new AppError(`Solo hay ${Math.max(unclaimed, 0)} unidades sin reclamar de "${product.name}".`, 409);
      }
      return tx.vendorStaffAllocation.update({
        where: { id: allocation.id },
        data: { allocatedQty: { increment: delta }, remainingQty: nextQty },
        include: { product: { select: { id: true, name: true, images: true, price: true, currency: true, unlimitedStock: true } } },
      });
    }
    return tx.vendorStaffAllocation.update({
      where: { id: allocation.id },
      data: { remainingQty: nextQty },
      include: { product: { select: { id: true, name: true, images: true, price: true, currency: true, unlimitedStock: true } } },
    });
  });

  logActivity({
    actorId: req.user.id,
    actorRole: "VENDOR",
    vendorId: vendor.id,
    action: "staff_allocation_adjusted",
    description: `Ajustó el stock de "${updated.product.name}" asignado a un usuario de sistema a ${nextQty} unidad(es).`,
    meta: { allocationId: allocation.id, productId: allocation.productId, remainingQty: nextQty },
  });

  res.json({ allocation: updated });
}

// Bloque 204: "eliminar productos asignados a un usuario" — a diferencia de
// releaseAllocation (el propio usuario devuelve una CANTIDAD puntual al
// pool), esto borra la fila entera (cualquier remainingQty/pendingQty que
// tuviera vuelve solo al pool sin reclamar, nunca toca Product.stock — nunca
// se vendió de verdad).
export async function deleteStaffAllocation(req, res) {
  assertOwnerOrAdmin(req);
  const vendor = await resolveMyVendor(req.user.id);
  const staff = await prisma.vendorStaff.findFirst({ where: { id: req.params.staffId, vendorId: vendor.id } });
  if (!staff) throw new AppError("Usuario no encontrado.", 404);

  const allocation = await prisma.vendorStaffAllocation.findFirst({
    where: { id: req.params.id, vendorStaffId: staff.id },
    include: { product: { select: { name: true } } },
  });
  if (!allocation) throw new AppError("Asignación no encontrada.", 404);

  await prisma.vendorStaffAllocation.delete({ where: { id: allocation.id } });

  logActivity({
    actorId: req.user.id,
    actorRole: "VENDOR",
    vendorId: vendor.id,
    action: "staff_allocation_removed",
    description: `Quitó "${allocation.product.name}" de los productos asignados a un usuario de sistema.`,
    meta: { allocationId: allocation.id, productId: allocation.productId },
  });

  res.json({ ok: true });
}

export async function getCashCloseStatus(req, res) {
  assertOwnerOrAdmin(req);
  const vendor = await resolveMyVendor(req.user.id);
  const frequency = vendor.cashCloseFrequency ?? "WEEKLY";
  const { start, end } = periodBounds(frequency);

  const staff = await prisma.vendorStaff.findMany({ where: { vendorId: vendor.id, isActive: true }, include: { user: { select: { fullName: true } } } });
  const [salesAgg, closes] = await Promise.all([
    staff.length
      ? prisma.vendorStaffSale.groupBy({ by: ["vendorStaffId"], where: { vendorId: vendor.id, createdAt: { gte: start, lt: end } }, _sum: { total: true } })
      : [],
    staff.length
      ? prisma.vendorStaffCashClose.findMany({ where: { periodStart: start, periodEnd: end, vendorStaffId: { in: staff.map((s) => s.id) } } })
      : [],
  ]);
  const salesByStaff = new Map(salesAgg.map((s) => [s.vendorStaffId, Number(s._sum.total ?? 0)]));
  const reportedSet = new Set(closes.map((c) => c.vendorStaffId));

  res.json({
    periodStart: start,
    periodEnd: end,
    frequency: vendor.cashCloseFrequency,
    staff: staff.map((s) => ({
      id: s.id,
      fullName: s.user.fullName,
      totalSales: salesByStaff.get(s.id) ?? 0,
      reported: reportedSet.has(s.id),
    })),
  });
}

export async function getCashCloseSettings(req, res) {
  assertOwnerOrAdmin(req);
  const vendor = await resolveMyVendor(req.user.id);
  res.json({
    cashCloseFrequency: vendor.cashCloseFrequency,
    cashCloseDayOfWeek: vendor.cashCloseDayOfWeek,
    cashCloseDayOfMonth: vendor.cashCloseDayOfMonth,
  });
}

const settingsSchema = z.object({
  cashCloseFrequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).nullable(),
  cashCloseDayOfWeek: z.number().int().min(1).max(7).nullable().optional(),
  cashCloseDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
});

// Bloque 198 (pedido explícito — "se podrán enviar recordatorios a los
// usuarios en caso de que el vendedor asigne un día que sea el día para
// cuadrar la caja"): frequency null = recordatorio desactivado.
export async function updateCashCloseSettings(req, res) {
  assertOwnerOrAdmin(req);
  const vendor = await resolveMyVendor(req.user.id);
  const data = settingsSchema.parse(req.body);
  const updated = await prisma.vendor.update({
    where: { id: vendor.id },
    data: {
      cashCloseFrequency: data.cashCloseFrequency,
      cashCloseDayOfWeek: data.cashCloseDayOfWeek ?? null,
      cashCloseDayOfMonth: data.cashCloseDayOfMonth ?? null,
    },
  });
  res.json({
    cashCloseFrequency: updated.cashCloseFrequency,
    cashCloseDayOfWeek: updated.cashCloseDayOfWeek,
    cashCloseDayOfMonth: updated.cashCloseDayOfMonth,
  });
}
