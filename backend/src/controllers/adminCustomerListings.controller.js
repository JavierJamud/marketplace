import { listingVisibility, LISTING_OWNER_VISIBILITY_SELECT } from "../lib/publicVisibility.js";
import { deleteUploadedImages } from "../lib/uploadFiles.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

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
      ...LISTING_OWNER_VISIBILITY_SELECT,
      // Correo real de una cuenta eliminada (el de `email` pasa a deleted+id@zeudin.invalid).
      deletedEmail: true,
      customerListings: { orderBy: { createdAt: "desc" } },
    },
    orderBy: { fullName: "asc" },
  });
  // Cada anuncio con `visibility`: si el público lo ve y, si no, por qué (cuenta eliminada, período vencido, suspendido...).
  const now = new Date();
  res.json({
    owners: owners.map((o) => ({ ...o, customerListings: o.customerListings.map((l) => ({ ...l, visibility: listingVisibility(l, o, now) })) })),
  });
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

  await deleteUploadedImages(existing.images);
  await prisma.customerListing.delete({ where: { id } });
  res.json({ ok: true });
}
