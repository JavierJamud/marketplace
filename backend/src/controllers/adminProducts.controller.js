import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { productSchema, reconcileStock, assertPaymentMethodsAllowed } from "./products.controller.js";

// Bloque 52 (pedido explícito): "todo lo que agrega el vendedor debe tener
// supervisión y conexión visual o de edición para el administrador en todo
// momento" — antes no existía NINGUNA pantalla admin para ver/editar
// productos individuales (solo estadísticas agregadas por tienda en
// AdminVendors.jsx). Mismo criterio de moderación que adminOffers.controller.js:
// el admin puede tocar el producto de CUALQUIER vendedor, sin los límites de
// plan que sí aplican en products.controller.js (ese gate es para que el
// propio vendedor no se pase de su cupo, no tiene sentido para el admin).

const listQuerySchema = z.object({
  q: z.string().trim().optional(),
  vendorId: z.string().optional(),
});

export async function listAllProducts(req, res) {
  const { q, vendorId } = listQuerySchema.parse(req.query);
  const products = await prisma.product.findMany({
    where: {
      vendorId: vendorId || undefined,
      name: q ? { contains: q, mode: "insensitive" } : undefined,
    },
    include: {
      vendor: { select: { id: true, companyName: true, slug: true, isVerified: true } },
      category: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({ products });
}

// Mismo schema/reglas de forma que el propio vendedor (products.controller.js),
// pero sin resolveMyVendor: el :id de la URL manda, no hay dueño implícito.
export async function updateAdminProduct(req, res) {
  const { id } = req.params;
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw new AppError("Producto no encontrado.", 404);

  const data = reconcileStock(productSchema.partial().parse(req.body));
  await assertPaymentMethodsAllowed(data.paymentMethods);

  const product = await prisma.product.update({
    where: { id },
    data,
    include: { vendor: { select: { companyName: true, slug: true } }, category: { select: { name: true } } },
  });
  res.json({ product });
}

export async function deleteAdminProduct(req, res) {
  const { id } = req.params;
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw new AppError("Producto no encontrado.", 404);

  await prisma.product.delete({ where: { id } });
  res.json({ ok: true });
}
