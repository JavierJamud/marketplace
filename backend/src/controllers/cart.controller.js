import { z } from "zod";
import { prisma } from "../lib/prisma.js";

// Bloque 54: carrito persistente por cuenta — una sola fila por usuario
// (upsert), pisada en cada cambio (ver PUT). Solo tiene sentido para
// clientes logueados; el carrito de un invitado sigue siendo 100%
// localStorage (CartContext.jsx), nunca toca este endpoint.

// GET — al iniciar sesión (en cualquier dispositivo), CartContext.jsx pide
// esto para restaurar lo que había en la cuenta. null = nunca se guardó nada
// (cliente nuevo o que nunca tuvo carrito logueado).
export async function getMyCart(req, res) {
  const snapshot = await prisma.cartSnapshot.findUnique({ where: { userId: req.user.id } });
  if (!snapshot) return res.json({ cart: null });
  res.json({ cart: { vendorMeta: snapshot.vendorMeta, items: snapshot.items, discount: snapshot.discount } });
}

const saveCartSchema = z.object({
  vendorMeta: z.record(z.any()),
  items: z.array(z.record(z.any())),
  discount: z.record(z.any()).nullable().optional(),
});

// PUT — CartContext.jsx llama esto (debounced) en cada cambio mientras hay
// sesión activa: agregar/quitar/cambiar cantidad, aplicar código, etc.
export async function saveMyCart(req, res) {
  const data = saveCartSchema.parse(req.body);
  await prisma.cartSnapshot.upsert({
    where: { userId: req.user.id },
    update: { vendorMeta: data.vendorMeta, items: data.items, discount: data.discount ?? null },
    create: { userId: req.user.id, vendorMeta: data.vendorMeta, items: data.items, discount: data.discount ?? null },
  });
  res.status(204).send();
}

// DELETE — el carrito local queda vacío (se confirmó un pedido, o el
// cliente vació todo a mano) — sin esto, la próxima vez que inicie sesión
// en otro dispositivo revivirían productos que ya compró o que ya no quiere.
export async function deleteMyCart(req, res) {
  await prisma.cartSnapshot.deleteMany({ where: { userId: req.user.id } });
  res.status(204).send();
}
