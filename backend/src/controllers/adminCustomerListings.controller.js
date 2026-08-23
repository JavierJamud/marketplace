import { join } from "node:path";
import { unlink } from "node:fs/promises";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { CUSTOMER_LISTING_UPLOAD_DIR } from "./customerListings.controller.js";

// Supervisión de admin sobre la venta rápida — mismo criterio de moderación
// que adminProducts.controller.js: el admin puede editar/eliminar el
// anuncio de CUALQUIER cliente. Pedido explícito: "el admin debe poder ver
// qué clientes sin tienda tienen productos en venta" — se agrupa por dueño
// para responder exactamente esa pregunta, no solo listar anuncios sueltos.

export async function listCustomerListingsByOwner(_req, res) {
  const owners = await prisma.user.findMany({
    where: { customerListings: { some: {} } },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      customerListings: { orderBy: { createdAt: "desc" } },
    },
    orderBy: { fullName: "asc" },
  });
  res.json({ owners });
}

export async function updateAdminCustomerListing(req, res) {
  const { id } = req.params;
  const existing = await prisma.customerListing.findUnique({ where: { id } });
  if (!existing) throw new AppError("Anuncio no encontrado.", 404);

  // Solo lo que el admin realmente necesita tocar acá: suspenderlo
  // (isActive) — editar nombre/precio/descripción sigue siendo del dueño.
  const { isActive } = req.body;
  const listing = await prisma.customerListing.update({
    where: { id },
    data: { isActive: !!isActive },
  });
  res.json({ listing });
}

export async function deleteAdminCustomerListing(req, res) {
  const { id } = req.params;
  const existing = await prisma.customerListing.findUnique({ where: { id } });
  if (!existing) throw new AppError("Anuncio no encontrado.", 404);

  await Promise.all(
    existing.images.map((url) => unlink(join(CUSTOMER_LISTING_UPLOAD_DIR, existing.ownerId, url.split("/").pop())).catch(() => {}))
  );
  await prisma.customerListing.delete({ where: { id } });
  res.json({ ok: true });
}
