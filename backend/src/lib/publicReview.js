// Campos de una reseña que se publican (página de la tienda y ficha del producto). Antes iba la fila completa (include), y
// una reseña que el admin mantuvo tras un reporte (reportStatus KEPT) vuelve a ser visible con reportedById, reportReason y
// reportResolvedById llenos: cualquier visitante veía quién la denunció, con qué texto y qué admin lo resolvió. Lista
// cerrada de lo que usa ReviewsList.jsx; userId se queda porque marca la reseña propia (no se puede reportar). Un campo
// nuevo de Review no sale al público hasta que se agregue aquí.
export const PUBLIC_REVIEW_SELECT = {
  id: true,
  productId: true,
  userId: true,
  authorName: true,
  rating: true,
  title: true,
  comment: true,
  images: true,
  isVerifiedPurchase: true,
  createdAt: true,
  vendorReply: true,
  vendorRepliedAt: true,
  adminReply: true,
  adminRepliedAt: true,
  productName: true,
  product: { select: { id: true, name: true, slug: true, images: true } },
};
