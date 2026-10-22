import { z } from "zod";
import crypto from "node:crypto";
import { activeCodes, assertActiveCurrency, currencyLabel } from "../lib/catalog.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { logActivity, actorRoleForVendorAction } from "../lib/activityLog.js";
import { assertPlanAllows, getPlanLimit, planAllows } from "../lib/planConfig.js";
import { resolveUnitPrice } from "../lib/pricing.js";

// Solo las monedas que el admin tiene activas (las mismas que se ofrecen al cargar un producto).
const assertCurrencyAvailable = (currency) => assertActiveCurrency(currency);
const currencyField = z.string().trim().min(1).max(12);

// Bloque 52: códigos de descuento del vendedor, aplicables por el cliente en
// el carrito (ver resolveDiscountForOrder/createOrder en orders.controller.js).
// Sin gate de isVerified — a diferencia de Offer (Bloque 50), no hace falta
// estar verificado. Sí pasa a estar gateado por PLAN (allowDiscountCodes/
// maxDiscountCodes en PlanConfig) — ver createDiscountCode más abajo.

function generateCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

async function uniqueCodeForVendor(vendorId, requested) {
  if (requested) {
    const code = requested.trim().toUpperCase();
    const existing = await prisma.discountCode.findUnique({ where: { vendorId_code: { vendorId, code } } });
    if (existing) throw new AppError(`Ya tienes un código "${code}". Elige otro o déjalo vacío para generar uno automático.`, 409);
    return code;
  }
  // Reintenta si el generado al azar choca (muy improbable con 8 hex chars).
  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    const existing = await prisma.discountCode.findUnique({ where: { vendorId_code: { vendorId, code } } });
    if (!existing) return code;
  }
  throw new AppError("No se pudo generar un código único. Intenta de nuevo.", 500);
}

export const discountCodeSummarySelect = {
  id: true,
  code: true,
  type: true,
  value: true,
  currency: true,
  minPurchase: true,
  maxPurchase: true,
  maxUses: true,
  usesCount: true,
  startsAt: true,
  expiresAt: true,
  active: true,
  createdAt: true,
};

export async function listMyDiscountCodes(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const codes = await prisma.discountCode.findMany({
    where: { vendorId: vendor.id },
    orderBy: { createdAt: "desc" },
    select: discountCodeSummarySelect,
  });
  res.json({ discountCodes: codes });
}

// Multipart no hace falta acá (sin imagen) — JSON plano.
const createDiscountCodeSchema = z
  .object({
    code: z.string().trim().min(2).max(24).optional(),
    type: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
    value: z.number().positive(),
    currency: currencyField.optional(),
    minPurchase: z.number().nonnegative().optional(),
    maxPurchase: z.number().positive().optional(),
    maxUses: z.number().int().positive().optional(),
    hasExpiry: z.boolean().default(false),
    startsAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .refine((d) => d.type !== "PERCENTAGE" || d.value <= 100, {
    message: "El porcentaje de descuento no puede superar 100%.",
    path: ["value"],
  })
  .refine((d) => !(d.minPurchase != null && d.maxPurchase != null) || d.maxPurchase > d.minPurchase, {
    message: "El máximo de compra debe ser mayor que el mínimo.",
    path: ["maxPurchase"],
  })
  .refine((d) => !d.hasExpiry || (d.startsAt && d.expiresAt), {
    message: "Indica fecha/hora de inicio y de fin, o desmarca la vigencia con vencimiento.",
    path: ["expiresAt"],
  })
  .refine((d) => !d.hasExpiry || new Date(d.expiresAt) > new Date(d.startsAt), {
    message: "La fecha de fin debe ser posterior a la de inicio.",
    path: ["expiresAt"],
  });

export async function createDiscountCode(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  await assertPlanAllows(vendor, "allowDiscountCodes", "Tu plan actual no incluye códigos de descuento.");
  const maxDiscountCodes = await getPlanLimit(vendor, "maxDiscountCodes");
  if (maxDiscountCodes !== null) {
    const currentCount = await prisma.discountCode.count({ where: { vendorId: vendor.id } });
    if (currentCount >= maxDiscountCodes) throw new AppError(`Tu plan permite hasta ${maxDiscountCodes} código(s) de descuento.`, 403);
  }
  const data = createDiscountCodeSchema.parse(req.body);
  data.currency = data.currency ?? vendor.currency ?? (await activeCodes("CURRENCY"))[0];
  await assertCurrencyAvailable(data.currency);

  const code = await uniqueCodeForVendor(vendor.id, data.code);

  const discountCode = await prisma.discountCode.create({
    data: {
      vendorId: vendor.id,
      code,
      type: data.type,
      value: data.value,
      currency: data.currency,
      minPurchase: data.minPurchase ?? null,
      maxPurchase: data.maxPurchase ?? null,
      maxUses: data.maxUses ?? null,
      startsAt: data.hasExpiry ? new Date(data.startsAt) : new Date(),
      expiresAt: data.hasExpiry ? new Date(data.expiresAt) : null,
      active: true,
    },
    select: discountCodeSummarySelect,
  });
  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "discount_code_created",
    description: `Creó el código de descuento "${discountCode.code}"`,
    meta: { discountCodeId: discountCode.id },
  });
  res.status(201).json({ discountCode });
}

const updateDiscountCodeSchema = z
  .object({
    type: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]).optional(),
    value: z.number().positive().optional(),
    currency: currencyField.optional(),
    minPurchase: z.number().nonnegative().optional().nullable(),
    maxPurchase: z.number().positive().optional().nullable(),
    maxUses: z.number().int().positive().optional().nullable(),
    hasExpiry: z.boolean().optional(),
    startsAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime().optional().nullable(),
    // Toggle de activar/desactivar — siempre permitido, incluso con usos.
    active: z.boolean().optional(),
  })
  .refine((d) => d.type !== "PERCENTAGE" || d.value == null || d.value <= 100, {
    message: "El porcentaje de descuento no puede superar 100%.",
    path: ["value"],
  });

// Editar condiciones solo si usesCount === 0 (para no alterar códigos ya
// usados) — activar/desactivar siempre se permite, sin importar los usos.
export async function updateDiscountCode(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;
  const data = updateDiscountCodeSchema.parse(req.body);

  const existing = await prisma.discountCode.findUnique({ where: { id } });
  if (!existing || existing.vendorId !== vendor.id) throw new AppError("Código de descuento no encontrado.", 404);

  const wantsConditionChange = Object.keys(data).some((k) => k !== "active");
  if (wantsConditionChange && existing.usesCount > 0) {
    throw new AppError("Este código ya fue usado — solo puedes activarlo o desactivarlo, no editar sus condiciones.", 409);
  }

  const patch = {};
  if (data.active !== undefined) patch.active = data.active;
  if (data.type !== undefined) patch.type = data.type;
  if (data.value !== undefined) patch.value = data.value;
  if (data.currency !== undefined) {
    await assertCurrencyAvailable(data.currency);
    patch.currency = data.currency;
  }
  if (data.minPurchase !== undefined) patch.minPurchase = data.minPurchase;
  if (data.maxPurchase !== undefined) patch.maxPurchase = data.maxPurchase;
  if (data.maxUses !== undefined) patch.maxUses = data.maxUses;
  if (data.hasExpiry !== undefined) {
    if (data.hasExpiry) {
      if (!data.startsAt || !data.expiresAt) throw new AppError("Indica fecha/hora de inicio y de fin.", 400);
      patch.startsAt = new Date(data.startsAt);
      patch.expiresAt = new Date(data.expiresAt);
    } else {
      patch.expiresAt = null;
    }
  }

  const minPurchase = patch.minPurchase !== undefined ? patch.minPurchase : existing.minPurchase != null ? Number(existing.minPurchase) : null;
  const maxPurchase = patch.maxPurchase !== undefined ? patch.maxPurchase : existing.maxPurchase != null ? Number(existing.maxPurchase) : null;
  if (minPurchase != null && maxPurchase != null && maxPurchase <= minPurchase) {
    throw new AppError("El máximo de compra debe ser mayor que el mínimo.", 400);
  }

  const discountCode = await prisma.discountCode.update({ where: { id }, data: patch, select: discountCodeSummarySelect });
  res.json({ discountCode });
}

// Solo si nunca se usó — y solo si ninguna StoreOffer activa lo referencia
// (la FK es RESTRICT, pero se chequea antes para devolver un mensaje claro).
export async function deleteDiscountCode(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;

  const existing = await prisma.discountCode.findUnique({ where: { id } });
  if (!existing || existing.vendorId !== vendor.id) throw new AppError("Código de descuento no encontrado.", 404);
  if (existing.usesCount > 0) throw new AppError("Este código ya fue usado y no se puede eliminar — solo desactivarlo.", 409);

  const linkedOffer = await prisma.storeOffer.findFirst({ where: { discountCodeId: id } });
  if (linkedOffer) throw new AppError("Este código está asignado a una oferta de tienda — quita la oferta primero.", 409);

  await prisma.discountCode.delete({ where: { id } });
  res.status(204).send();
}

// --- Resolución/validación de un código contra un carrito ------------------
// Reusado por el endpoint público de preview (validateDiscountCode) y por
// createOrder (orders.controller.js) al confirmar el pedido — mismos checks
// en ambos puntos para que nunca se muestre un descuento en el carrito que
// después el backend rechace al pagar por una razón distinta.
// `items` son los ítems del pedido con el precio unitario ya resuelto en el servidor: [{ price, quantity, currency }].
// El código solo descuenta los de su misma moneda: un monto en CUP nunca se resta de un precio en USD.
export async function resolveDiscountForOrder(client, { vendorId, code, items }) {
  const normalizedCode = (code ?? "").trim().toUpperCase();
  if (!normalizedCode) throw new AppError("Escribe un código de descuento.", 400);

  const discountCode = await client.discountCode.findUnique({ where: { vendorId_code: { vendorId, code: normalizedCode } }, include: { vendor: { select: { planType: true } } } });
  if (!discountCode) throw new AppError("Código de descuento inválido para esta tienda.", 404);
  // Los códigos son del plan de pago: si la tienda bajó de plan, los que ya tenía se conservan pero no se aplican.
  if (!(await planAllows(discountCode.vendor.planType, "allowDiscountCodes"))) throw new AppError("Esta tienda no acepta códigos de descuento por ahora.", 409);
  if (!discountCode.active) throw new AppError("Este código de descuento ya no está activo.", 409);

  const now = new Date();
  if (discountCode.startsAt > now) throw new AppError("Este código de descuento todavía no está vigente.", 409);
  if (discountCode.expiresAt && discountCode.expiresAt < now) throw new AppError("Este código de descuento ya venció.", 409);
  if (discountCode.maxUses != null && discountCode.usesCount >= discountCode.maxUses) {
    throw new AppError("Este código de descuento ya alcanzó su límite de usos.", 409);
  }

  const cur = discountCode.currency;
  const matching = (items ?? []).filter((i) => (i.currency ?? "CUP") === cur);
  if (matching.length === 0) {
    const others = [...new Set((items ?? []).map((i) => i.currency ?? "CUP"))].join(" y ");
    throw new AppError(`Este código es para productos en ${cur} y tu carrito tiene productos en ${others || "otra moneda"}. Solo se puede usar con productos en ${cur}.`, 409);
  }
  const subtotal = matching.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);
  if (discountCode.minPurchase != null && subtotal < Number(discountCode.minPurchase)) {
    throw new AppError(`Este código requiere una compra mínima de ${Number(discountCode.minPurchase).toLocaleString("es-CU")} ${currencyLabel(cur)} en productos en ${currencyLabel(cur)}.`, 409);
  }
  if (discountCode.maxPurchase != null && subtotal > Number(discountCode.maxPurchase)) {
    throw new AppError(`Este código no aplica a compras mayores a ${Number(discountCode.maxPurchase).toLocaleString("es-CU")} ${currencyLabel(cur)}.`, 409);
  }

  const rawAmount =
    discountCode.type === "PERCENTAGE" ? (subtotal * Number(discountCode.value)) / 100 : Number(discountCode.value);
  const discountAmount = Math.min(rawAmount, subtotal);

  return { discountCode, discountAmount: Math.round(discountAmount * 100) / 100 };
}

// Se mandan los productos (no un subtotal): los precios y la moneda salen de la base, igual que al crear el pedido.
const validateDiscountCodeSchema = z.object({
  vendorId: z.string(),
  code: z.string().trim().min(1),
  items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })).min(1).max(100),
});

// Público — preview desde el carrito, ANTES de confirmar el pedido. Nunca
// incrementa usesCount (eso solo pasa al confirmar de verdad, ver
// createOrder), así que el mismo código se puede "previsualizar" varias veces
// sin gastar usos.
export async function validateDiscountCode(req, res) {
  const data = validateDiscountCodeSchema.parse(req.body);
  const products = await prisma.product.findMany({
    where: { id: { in: data.items.map((i) => i.productId) }, vendorId: data.vendorId },
    select: { id: true, price: true, priceTiers: true, currency: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const items = data.items
    .filter((i) => byId.has(i.productId))
    .map((i) => {
      const p = byId.get(i.productId);
      return { price: resolveUnitPrice(p.price, p.priceTiers, i.quantity), quantity: i.quantity, currency: p.currency };
    });
  if (items.length === 0) throw new AppError("Los productos del carrito no son de esta tienda.", 400);
  const { discountCode, discountAmount } = await resolveDiscountForOrder(prisma, { vendorId: data.vendorId, code: data.code, items });
  res.json({
    discount: {
      code: discountCode.code,
      type: discountCode.type,
      value: Number(discountCode.value),
      currency: discountCode.currency,
      amount: discountAmount,
    },
  });
}

// --- Admin (auditoría de seguridad) -----------------------------------------
// Antes no existía ninguna supervisión de admin sobre códigos de descuento —
// el único recurso para desactivar uno abusivo era entrar a Prisma Studio a
// mano. Mismas reglas que el vendedor (activar/desactivar siempre permitido;
// eliminar solo si nunca se usó), solo que sobre CUALQUIER vendedor.

export async function listAllDiscountCodesAdmin(_req, res) {
  const codes = await prisma.discountCode.findMany({
    orderBy: { createdAt: "desc" },
    select: { ...discountCodeSummarySelect, vendor: { select: { id: true, companyName: true, slug: true } } },
  });
  res.json({ discountCodes: codes });
}

const adminSetActiveSchema = z.object({ active: z.boolean() });

export async function setDiscountCodeActiveAdmin(req, res) {
  const { id } = req.params;
  const { active } = adminSetActiveSchema.parse(req.body);

  const existing = await prisma.discountCode.findUnique({ where: { id } });
  if (!existing) throw new AppError("Código de descuento no encontrado.", 404);

  const discountCode = await prisma.discountCode.update({ where: { id }, data: { active }, select: discountCodeSummarySelect });
  res.json({ discountCode });
}

export async function deleteDiscountCodeAdmin(req, res) {
  const { id } = req.params;
  const existing = await prisma.discountCode.findUnique({ where: { id } });
  if (!existing) throw new AppError("Código de descuento no encontrado.", 404);
  if (existing.usesCount > 0) throw new AppError("Este código ya fue usado y no se puede eliminar — solo desactivarlo.", 409);

  const linkedOffer = await prisma.storeOffer.findFirst({ where: { discountCodeId: id } });
  if (linkedOffer) throw new AppError("Este código está asignado a una oferta de tienda — el vendedor debe quitar la oferta primero.", 409);

  await prisma.discountCode.delete({ where: { id } });
  res.status(204).send();
}
