import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { api } from "./api.js";

// Cuenta las visitas al sitio público por zona (inicio, catálogo, tienda...) para el resumen semanal del admin. Solo se
// manda la zona: nada de quién visita. Los paneles (admin, tienda, socio) y las pantallas de caja no cuentan: el uso del
// panel de la tienda ya se mide aparte.
const PRIVATE = /^\/(admin|vendedor|socio|caja|correos)(\/|$)/;

export function areaFor(pathname) {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/" || p === "/index.html") return "inicio";
  if (p.startsWith("/catalogo")) return "catalogo";
  if (p === "/tiendas") return "tiendas";
  if (p.startsWith("/tienda/")) return "tienda";
  if (p.startsWith("/producto/")) return "producto";
  if (p.startsWith("/ventas-rapidas")) return "ventas-rapidas";
  if (p.startsWith("/carrito") || p.startsWith("/checkout")) return "carrito";
  if (p.startsWith("/cuenta")) return "cuenta";
  if (p.startsWith("/planes") || p.startsWith("/vender") || p.startsWith("/socios") || p.startsWith("/api-socios")) return "planes";
  if (/^\/(ayuda|faq|contacto|privacidad|terminos)/.test(p)) return "ayuda";
  if (p.startsWith("/rastrear-pedido")) return "rastreo";
  if (p.startsWith("/mesa/")) return "mesa";
  return "otras";
}

const SESSION_KEY = "baznova_visit_started";

export function useSiteTraffic() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (PRIVATE.test(pathname)) return;
    let newSession = false;
    try {
      // La primera pantalla de cada pestaña es el comienzo de una visita.
      newSession = !sessionStorage.getItem(SESSION_KEY);
      if (newSession) sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* sin almacenamiento (modo privado estricto): se cuenta solo la vista */
    }
    api.post("/traffic/view", { area: areaFor(pathname), newSession }).catch(() => {});
  }, [pathname]);
}
