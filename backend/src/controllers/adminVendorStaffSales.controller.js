import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

// Bloque 198 (pedido explícito — "el administrador podrá verificar,
// modificar, eliminar y supervisar todo este contenido"): mismo criterio de
// moderación que adminProducts.controller.js/adminOffers.controller.js — el
// admin toca ventas manuales de CUALQUIER vendedor, sin pasar por
// resolveMyVendor (acá el :id/query manda, no hay dueño implícito). La
// lógica de ajuste de stock (delta de cantidad mueve los 2 ledgers) es la
// MISMA que updateManualSale/deleteManualSale en vendorStaffSales.controller.js
// — duplicada a propósito en vez de reexportada, porque acá NUNCA se valida
// `sale.vendorId === vendor.id de quien llama` (el admin no tiene un
// "vendor propio"), así que compartir la función haría más frágil, no más
// simple, distinguir los 2 casos de autorización.

const listQuerySchema = z.object({
  vendorId: z.string().optional(),
  vendorStaffId: z.string().optional(),
  q: z.string().trim().optional(),
});

export async function listAllStaffSales(req, res) {
  const { vendorId, vendorStaffId, q } = listQuerySchema.parse(req.query);
  const sales = await prisma.vendorStaffSale.findMany({
    where: {
      vendorId: vendorId || undefined,
      vendorStaffId: vendorStaffId || undefined,
      productName: q ? { contains: q, mode: "insensitive" } : undefined,
    },
    include: {
      vendor: { select: { id: true, companyName: true, slug: true } },
      vendorStaff: { include: { user: { select: { fullName: true, email: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  res.json({
    sales: sales.map((s) => ({ ...s, staffName: s.vendorStaff.user.fullName, staffEmail: s.vendorStaff.user.email })),
  });
}

const updateSaleSchema = z.object({
  quantity: z.coerce.number().int().positive().optional(),
  unitPrice: z.coerce.number().positive().optional(),
  note: z.string().trim().max(280).optional(),
});

export async function updateStaffSale(req, res) {
  const sale = await prisma.vendorStaffSale.findUnique({ where: { id: req.params.id } });
  if (!sale) throw new AppError("Venta no encontrada.", 404);

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

export async function deleteStaffSale(req, res) {
  const sale = await prisma.vendorStaffSale.findUnique({ where: { id: req.params.id } });
  if (!sale) throw new AppError("Venta no encontrada.", 404);

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

// Bloque 198: lista de vendedores con ventas manuales activas — para el
// filtro por tienda del panel de admin, sin tener que traer las 300 ventas
// completas solo para armar un <select>.
export async function listVendorsWithStaffSales(req, res) {
  const rows = await prisma.vendorStaffSale.findMany({
    distinct: ["vendorId"],
    select: { vendor: { select: { id: true, companyName: true, slug: true } } },
    orderBy: { vendorId: "asc" },
  });
  res.json({ vendors: rows.map((r) => r.vendor) });
}
