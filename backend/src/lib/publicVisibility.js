// Por qué el público NO ve un producto o un anuncio de venta rápida, en palabras para el admin. Repite, campo por campo, los
// filtros de las páginas públicas (search.controller.js PUBLIC_PRODUCT_WHERE / PUBLIC_VENDOR_WHERE y
// customerListings.controller.js listPublicListings). Antes el admin marcaba "Activo" mirando solo isActive, y un anuncio de
// una cuenta eliminada o un producto de una tienda bloqueada aparecía activo en el panel pero no existía en el sitio.
// Si cambia un filtro público, cambia también aquí.

const fmtDay = (d) => new Date(d).toLocaleDateString("es-CU", { day: "numeric", month: "short", year: "numeric" });

// Campos que necesita productHiddenReasons (para los select de Prisma).
export const PRODUCT_VISIBILITY_SELECT = {
  isActive: true,
  suspendedAt: true,
  hiddenFromStore: true,
  availableForTableMenu: true,
  overQuota: true,
  stock: true,
  unlimitedStock: true,
};
export const VENDOR_VISIBILITY_SELECT = { isBlocked: true, status: true, isPrivate: true, deletedAt: true, menuPublic: true };

// `hidden`: no sale en ningún lado público. `partial`: sale en su tienda pero no en portada, catálogo ni búsqueda.
export function productVisibility(p, vendor) {
  const hidden = [];
  const partial = [];
  if (vendor?.deletedAt) hidden.push("La tienda fue eliminada");
  else if (vendor?.isBlocked) hidden.push("La tienda está bloqueada o suspendida");
  else if (vendor && vendor.status !== "ACTIVE") hidden.push("La tienda no está activa");
  if (p.suspendedAt) hidden.push("Suspendido por un reporte");
  if (!p.isActive) hidden.push("Pausado");
  if (p.overQuota) hidden.push("Fuera del cupo de productos del plan");
  if (p.hiddenFromStore) hidden.push("Solo para pedidos de mesa");
  // La ficha pública da 404 en este caso (getProductBySlug): para el admin es oculto, no "se ve en parte".
  if (p.availableForTableMenu && vendor?.menuPublic === false) hidden.push("Plato del menú de mesa con el menú oculto: solo se ve con el QR");
  if (vendor?.isPrivate) partial.push("Tienda privada: no sale en el catálogo");
  if (!p.unlimitedStock && Number(p.stock) <= 0) partial.push("Agotado: solo se ve en su tienda");
  return { visible: hidden.length === 0, hidden, partial };
}

// Campos del dueño que necesita listingVisibility.
export const LISTING_OWNER_VISIBILITY_SELECT = { isSuspended: true, deletedAt: true };

export function listingVisibility(l, owner, now = new Date()) {
  const hidden = [];
  if (owner?.deletedAt) hidden.push("La cuenta del dueño fue eliminada");
  else if (owner?.isSuspended) hidden.push("La cuenta del dueño está bloqueada");
  if (l.suspendedAt) hidden.push("Suspendido por un reporte");
  if (l.isSold) hidden.push("Marcado como vendido");
  if (!l.isActive) hidden.push(l.images?.length ? "Pausado" : "Pausado o sin fotos");
  if (l.publicVisibleUntil && new Date(l.publicVisibleUntil) < now) hidden.push(`Dejó de mostrarse al público el ${fmtDay(l.publicVisibleUntil)}`);
  return { visible: hidden.length === 0, hidden, partial: [] };
}
