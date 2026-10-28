import { listingVisibility, LISTING_OWNER_VISIBILITY_SELECT } from "../lib/publicVisibility.js";
import { deleteUploadedImages } from "../lib/uploadFiles.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { z } from "zod";
import { customerListingSchema, validateTiers } from "./customerListings.controller.js";
import { assertActiveCurrency } from "../lib/catalog.js";
import { logActivity } from "../lib/activityLog.js";

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

// Lo que el admin puede corregir de un anuncio (por ejemplo, un precio mal escrito o un título engañoso), con las mismas
// reglas que tiene el dueño. El lugar y las fotos nuevas siguen siendo cosa del dueño; el admin sí puede quitar una foto.
const adminListingSchema = customerListingSchema
  .pick({ name: true, description: true, price: true, currency: true, condition: true, quantity: true, tags: true })
  .partial()
  .extend({ isActive: z.boolean().optional() });

export async function updateAdminCustomerListing(req, res) {
  const { id } = req.params;
  const existing = await prisma.customerListing.findUnique({ where: { id } });
  if (!existing) throw new AppError("Anuncio no encontrado.", 404);

  const data = adminListingSchema.parse(req.body);
  if (data.currency && data.currency !== existing.currency) await assertActiveCurrency(data.currency);
  // Si cambia el precio, los precios por cantidad que ya tenía se validan contra el nuevo.
  if (data.price !== undefined && existing.priceTiers) data.priceTiers = validateTiers(data.price, existing.priceTiers) ?? undefined;
  const listing = await prisma.customerListing.update({ where: { id }, data });
  const edited = Object.keys(data).filter((k) => k !== "isActive");
  if (edited.length) {
    logActivity({ actorId: req.user.id, actorRole: "ADMIN", action: "admin_listing_edited", description: `Editó el anuncio de venta rápida "${listing.name}"`, meta: { listingId: id, fields: edited } });
  }
  res.json({ listing });
}

const removeImageSchema = z.object({ url: z.string().min(1) });

// DELETE /admin/customer-listings/:id/images: quitar una foto (por ejemplo, una que no corresponde). Sin fotos, el anuncio
// deja de mostrarse, igual que cuando lo hace el dueño.
export async function removeAdminListingImage(req, res) {
  const { url } = removeImageSchema.parse(req.body);
  const existing = await prisma.customerListing.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError("Anuncio no encontrado.", 404);
  if (!existing.images.includes(url)) throw new AppError("Esa imagen no pertenece a este anuncio.", 404);
  const nextImages = existing.images.filter((u) => u !== url);
  const listing = await prisma.customerListing.update({ where: { id: existing.id }, data: { images: nextImages, ...(nextImages.length === 0 ? { isActive: false } : {}) } });
  await deleteUploadedImages([url]);
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
