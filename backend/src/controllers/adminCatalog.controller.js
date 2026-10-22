import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { KINDS, usageOf, usageTotal, catalogChanged } from "../lib/catalog.js";

// Admin > Marca > Tiendas y productos: monedas y formas de pago editables. Reglas:
//  - El código (lo que guardan productos, tiendas y pedidos) se fija al crear y no cambia; el nombre sí.
//  - En uso = no se elimina. Se puede renombrar o desactivar (deja de ofrecerse para lo nuevo, lo existente sigue igual).
//  - Tiene que quedar al menos una moneda y una forma de cobro activas, y siempre una forma de pago universal.

export const ICONS = ["banknote", "dollar", "euro", "coins", "message", "truck", "wallet", "card", "send", "phone", "bank", "store", "clock"];

const KIND_TEXT = {
  CURRENCY: "moneda",
  PRODUCT_PAYMENT: "forma de pago",
  CHECKOUT_PAYMENT: "forma de cobro",
  STORE_PAYMENT: "método de pago",
};

const labelField = z.string().trim().min(1, "Escribe un nombre.").max(60, "Máximo 60 caracteres.");
const descriptionField = z.string().trim().max(160, "Máximo 160 caracteres.").nullable().optional();
const iconField = z.enum(ICONS).nullable().optional();

const createSchema = z.object({
  kind: z.enum(KINDS),
  // Moneda: código corto (CAD); `label` es lo que se ve junto al precio y `description` el nombre completo.
  // Las demás: el código se arma del nombre.
  code: z.string().trim().max(12).optional(),
  label: labelField,
  description: descriptionField,
  icon: iconField,
});

const updateSchema = z.object({
  label: labelField.optional(),
  description: descriptionField,
  icon: iconField,
  isActive: z.boolean().optional(),
  isUniversal: z.literal(true).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

// Siempre de la base (no de la copia en memoria): las reglas de "al menos una activa" dependen del estado real.
const optionsOfKind = (kind) => prisma.catalogOption.findMany({ where: { kind } });

function codeFrom(kind, text) {
  const base = String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, kind === "CURRENCY" ? "" : "_")
    .replace(/^_+|_+$/g, "");
  return kind === "CURRENCY" ? base.toUpperCase().slice(0, 12) : base.toLowerCase().slice(0, 40);
}

async function withUsage(option) {
  const usage = await usageOf(option);
  return { ...option, usage, inUse: usageTotal(usage) > 0 };
}

export async function listCatalog(req, res) {
  const rows = await prisma.catalogOption.findMany({ orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] });
  const options = await Promise.all(rows.map(withUsage));
  res.json({ options, icons: ICONS });
}

export async function createCatalogOption(req, res) {
  const data = createSchema.parse(req.body);
  const code = codeFrom(data.kind, data.kind === "CURRENCY" ? data.code || data.label : data.label);
  if (!code) throw new AppError(data.kind === "CURRENCY" ? "Escribe el código de la moneda (por ejemplo, CAD)." : "El nombre necesita al menos una letra o número.", 400);
  // La forma de cobro TABLE es la de los pedidos de mesa; no se puede usar como código nuevo.
  if (data.kind === "CHECKOUT_PAYMENT" && code.toUpperCase() === "TABLE") throw new AppError("Ese nombre está reservado para los pedidos de mesa.", 400);
  if (data.kind === "PRODUCT_PAYMENT" && code === "table") throw new AppError("Ese nombre está reservado para el menú de mesas.", 400);
  const rows = await optionsOfKind(data.kind);
  const clash = rows.find((r) => r.code.toLowerCase() === code.toLowerCase() || r.label.toLowerCase() === data.label.toLowerCase());
  if (clash) throw new AppError(`Ya existe la ${KIND_TEXT[data.kind]} "${clash.label}".`, 409);
  const created = await prisma.catalogOption.create({
    data: {
      kind: data.kind,
      code,
      label: data.label,
      description: data.description || null,
      icon: data.icon ?? null,
      sortOrder: rows.length ? Math.max(...rows.map((r) => r.sortOrder)) + 1 : 0,
    },
  });
  await catalogChanged();
  res.status(201).json({ option: await withUsage(created) });
}

export async function updateCatalogOption(req, res) {
  const data = updateSchema.parse(req.body);
  const option = await prisma.catalogOption.findUnique({ where: { id: req.params.id } });
  if (!option) throw new AppError("Esa opción ya no existe.", 404);
  const siblings = (await optionsOfKind(option.kind)).filter((r) => r.id !== option.id);

  if (data.label && siblings.some((r) => r.label.toLowerCase() === data.label.toLowerCase())) {
    throw new AppError(`Ya existe otra ${KIND_TEXT[option.kind]} con el nombre "${data.label}".`, 409);
  }
  if (data.isUniversal && option.kind !== "PRODUCT_PAYMENT") throw new AppError("Solo una forma de pago de producto puede ser la universal.", 400);
  if (data.isActive === false) {
    if (option.isUniversal) throw new AppError("La forma de pago universal no se puede desactivar. Elige otra como universal primero.", 400);
    if ((option.kind === "CURRENCY" || option.kind === "CHECKOUT_PAYMENT") && !siblings.some((r) => r.isActive)) {
      throw new AppError(`Tiene que quedar al menos una ${KIND_TEXT[option.kind]} activa.`, 400);
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Rotar la universal: la nueva queda activa y la anterior deja de serlo (sigue disponible como una más).
    if (data.isUniversal) {
      await tx.catalogOption.updateMany({ where: { kind: "PRODUCT_PAYMENT", isUniversal: true }, data: { isUniversal: false } });
    }
    return tx.catalogOption.update({
      where: { id: option.id },
      data: {
        label: data.label,
        description: data.description === undefined ? undefined : data.description || null,
        icon: data.icon === undefined ? undefined : data.icon,
        isActive: data.isUniversal ? true : data.isActive,
        isUniversal: data.isUniversal,
        sortOrder: data.sortOrder,
      },
    });
  });
  await catalogChanged();
  res.json({ option: await withUsage(updated) });
}

export async function deleteCatalogOption(req, res) {
  const option = await prisma.catalogOption.findUnique({ where: { id: req.params.id } });
  if (!option) throw new AppError("Esa opción ya no existe.", 404);
  if (option.isUniversal) throw new AppError("La forma de pago universal no se puede eliminar. Elige otra como universal primero.", 400);
  const usage = await usageOf(option);
  if (usageTotal(usage) > 0) {
    throw new AppError(`"${option.label}" está en uso y no se puede eliminar. Puedes cambiarle el nombre o desactivarla para que no se use en lo nuevo.`, 409);
  }
  const siblings = (await optionsOfKind(option.kind)).filter((r) => r.id !== option.id);
  if ((option.kind === "CURRENCY" || option.kind === "CHECKOUT_PAYMENT") && option.isActive && !siblings.some((r) => r.isActive)) {
    throw new AppError(`Tiene que quedar al menos una ${KIND_TEXT[option.kind]} activa.`, 400);
  }
  await prisma.catalogOption.delete({ where: { id: option.id } });
  await catalogChanged();
  res.json({ ok: true });
}
