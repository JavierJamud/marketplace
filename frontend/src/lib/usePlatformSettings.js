import { useQuery } from "@tanstack/react-query";
import { api } from "./api.js";

// Bloque 212 (pedido explícito, bug real reportado en vivo — el fallback
// decía "ZeuDin", la marca de la empresa de desarrollo de software del
// dueño, nunca el nombre de esta plataforma): "Baznova" es el nombre real
// configurado en SiteSettings — esto solo se ve en el instante antes de que
// la primera respuesta de /settings llegue, o si falla del todo.
const DEFAULT_SITE_NAME = "Baznova";

function resolveLogoUrl(logoUrl) {
  if (!logoUrl) return null;
  return /^https?:\/\//.test(logoUrl) ? logoUrl : `${api.defaults.baseURL}${logoUrl}`;
}

// Bloque 49: nombre y logo de la plataforma — antes "ZeuDin" hardcodeado en
// decenas de archivos, ahora vienen de SiteSettings (editable sin redeploy
// desde "Marca de la plataforma" en el admin). Mismo queryKey ["site-settings"]
// que ya usan AdminLocations/AdminSubscriptions/VendorVerification/etc., así
// que react-query comparte una sola copia en caché en vez de pedir /settings
// una vez por componente. El default acá solo cubre el instante antes de que
// la primera respuesta llegue (o un fallo de red) — no es una marca fija.
export function usePlatformSettings() {
  const { data } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
    staleTime: 5 * 60 * 1000,
  });
  return {
    siteName: data?.siteName || DEFAULT_SITE_NAME,
    logoUrl: resolveLogoUrl(data?.logoUrl),
    // Bloque 75: número crudo (E.164) para el botón "Contactar soporte" del
    // vendedor bloqueado/suspendido — null si el admin nunca lo cargó.
    supportWhatsapp: data?.supportWhatsapp || null,
    // Bloque 118: política de comentarios/reseñas configurable desde el
    // admin (AdminReviews.jsx) — Product.jsx/Store.jsx la usan para mostrar
    // el texto real del límite en vez de un "1 por día" fijo que se
    // desactualiza si el admin lo cambia. Defaults = mismo comportamiento
    // de siempre (24h, 1 por producto, 1 por tienda) mientras no llega la
    // primera respuesta real.
    reviewDedupHours: data?.reviewDedupHours ?? 24,
    maxReviewsPerProductPerPeriod: data?.maxReviewsPerProductPerPeriod ?? 1,
    maxReviewsPerStorePerPeriod: data?.maxReviewsPerStorePerPeriod ?? 1,
  };
}
