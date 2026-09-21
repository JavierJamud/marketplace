// Bloque 118: texto del límite de reseñas armado a partir de la política
// REAL configurada por el admin (AdminReviews.jsx → reviewDedupHours/
// maxReviewsPerProductPerPeriod/maxReviewsPerStorePerPeriod) — usado por
// Product.jsx (scope "producto") y Store.jsx (scope "tienda") para que el
// texto nunca quede desactualizado si el admin cambia cualquiera de los 2
// valores desde su panel.
export function describeReviewLimit(hours, max, scope) {
  const plural = max === 1 ? "comentario" : "comentarios";
  const period = hours === 24 ? "por día" : hours % 24 === 0 ? `cada ${hours / 24} días` : `cada ${hours} horas`;
  return `${max} ${plural} ${period} por ${scope}`;
}
