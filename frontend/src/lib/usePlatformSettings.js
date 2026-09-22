import { useQuery } from "@tanstack/react-query";
import { api } from "./api.js";
// Bloque 46 (pedido explícito — "vamos a eliminar esta parte del panel de
// admin de configuración y el logo lo cargaremos automáticamente desde la
// carpeta frontend, src, assets, images"): el logo de la PLATAFORMA (no el
// de cada tienda, ese sigue siendo Vendor.logoUrl, editable por el vendedor
// — sin cambios) deja de ser un archivo subido/link pegado desde Admin →
// Marca. Motivo real, no solo de comodidad: el logo subido se guardaba en
// SiteSettings.logoUrl y el propio backend tenía que volver a descargárselo
// a sí mismo por HTTP para incrustarlo en cada correo (ver antes
// inlineIfSmall() en templates/_shared.js) — ese fetch fallaba en silencio
// apenas el backend no podía alcanzarse a sí mismo por esa URL (típico en
// producción sin BACKEND_URL público todavía), y el correo caía al círculo
// con la inicial en vez del logo real, aunque estuviera bien configurado en
// Admin. Un asset estático empaquetado con el código nunca depende de una
// descarga en runtime — ni acá ni en el backend (ver _shared.js, que ahora
// lee el mismo archivo directo del disco).
import logo from "../assets/images/logo.png";

// Bloque 212 (pedido explícito, bug real reportado en vivo — el fallback
// decía "ZeuDin", la marca de la empresa de desarrollo de software del
// dueño, nunca el nombre de esta plataforma): "Baznova" es el nombre real
// configurado en SiteSettings — esto solo se ve en el instante antes de que
// la primera respuesta de /settings llegue, o si falla del todo.
const DEFAULT_SITE_NAME = "Baznova";

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
    logoUrl: logo,
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
