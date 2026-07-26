import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

// Bloque 54: "Compartir carrito" — genera un link público de un solo
// vendedor (mismo carrito de un solo vendedor que el resto del sitio) que
// cualquiera (logueado o no) puede abrir para agregarlo al suyo. A
// diferencia de CartSnapshot (que sí guarda precio/nombre, porque es del
// dueño de la cuenta y se restaura tal cual), acá NUNCA se guarda precio ni
// nombre — se resuelven contra el Product real recién al leerse (ver
// getSharedCart), así un link compartido hace tiempo nunca muestra un
// precio vencido ni deja "comprar" más de lo que hay de stock hoy.

const createSharedCartSchema = z.object({
  vendorId: z.string(),
  items: z
    .array(
      z.object({
        productId: z.string(),
        quantity: z.number().int().positive(),
        size: z.string().optional(),
      })
    )
    .min(1, "El carrito está vacío."),
});

export async function createSharedCart(req, res) {
  const data = createSharedCartSchema.parse(req.body);

  const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId } });
  if (!vendor || vendor.isBlocked) throw new AppError("Tienda no encontrada.", 404);

  const shared = await prisma.sharedCart.create({
    data: {
      vendorId: data.vendorId,
      items: data.items.map((i) => ({ productId: i.productId, quantity: i.quantity, size: i.size ?? null })),
    },
  });
  res.status(201).json({ id: shared.id });
}

// Público — se resuelve SIEMPRE contra el catálogo vigente: productos
// borrados/desactivados se descartan, la cantidad se topea al stock actual
// (por talla si aplica). `droppedCount` le avisa al frontend si algo del
// carrito original ya no está disponible, para poder mostrar un aviso.
export async function getSharedCart(req, res) {
  const { id } = req.params;

  const shared = await prisma.sharedCart.findUnique({ where: { id } });
  if (!shared) throw new AppError("Este carrito compartido ya no existe.", 404);

  const vendor = await prisma.vendor.findUnique({ where: { id: shared.vendorId } });
  if (!vendor || vendor.isBlocked) throw new AppError("Esta tienda ya no está disponible.", 404);

  const productIds = [...new Set(shared.items.map((i) => i.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, isActive: true } });
  const productById = Object.fromEntries(products.map((p) => [p.id, p]));

  const items = shared.items
    .map((i) => {
      const product = productById[i.productId];
      if (!product) return null;
      const availableStock = i.size ? Number(product.sizeStock?.[i.size] ?? 0) : product.stock;
      if (availableStock <= 0) return null;
      return {
        productId: product.id,
        name: product.name,
        image: product.images?.[0] ?? null,
        price: product.price,
        currency: product.currency,
        size: i.size ?? null,
        quantity: Math.min(i.quantity, availableStock),
        stock: availableStock,
      };
    })
    .filter(Boolean);

  res.json({
    vendor: {
      id: vendor.id,
      slug: vendor.slug,
      companyName: vendor.companyName,
      color: vendor.color,
      isVerified: vendor.isVerified,
      whatsapp: vendor.whatsapp,
    },
    items,
    droppedCount: shared.items.length - items.length,
  });
}
