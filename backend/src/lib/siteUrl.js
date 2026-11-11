import { env } from "../config/env.js";

// Dirección del sitio por la que entró el visitante (baznova.com, baznova.cu o www.baznova.cu). Se usa para devolverlo al
// mismo dominio después de pagar en Stripe: la sesión se guarda en cada dominio por separado, y volver a otro lo dejaría
// fuera de su cuenta. Solo se acepta un origen de la lista FRONTEND_URL; si no viene o no está, se usa el principal.
export function siteUrlFor(req) {
  const origin = req?.headers?.origin;
  return origin && env.frontendUrls.includes(origin) ? origin : env.frontendUrl;
}
