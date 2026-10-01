import { api } from "./api.js";

// Resuelve la URL final de una imagen guardada en la base: las rutas propias
// se guardan relativas (`/uploads/products/...`) y hay que anteponerles la
// del backend; un link externo (http/https, ej. un logo pegado a mano por el
// vendedor) se usa tal cual.
export function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

// Bloque 51 (pedido explícito — "generar una miniatura aparte para las
// grillas"): desde el Bloque 51, cada foto de producto / venta rápida se
// guarda en DOS tamaños (ver lib/imageOptimizer.js del backend): la grande
// `<uuid>.webp` y la miniatura `<uuid>-thumb.webp`. El nombre es derivable a
// propósito — así la grilla puede pedir la chica sin que haga falta una
// segunda columna en la base ni cambiar ningún endpoint.
//
// Las fotos subidas ANTES de ese bloque no tienen miniatura (y no terminan en
// .webp, porque se guardaban con su extensión original) — por eso solo se
// deriva cuando la ruta ya es .webp; cualquier otra se sigue mostrando tal
// cual. Aun así, quien use esto debería dejar un onError que caiga a la
// grande (ver ProductCard.jsx): si por lo que sea la miniatura no está, se ve
// la foto igual, nunca un hueco.
export function thumbUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return imgUrl(path);
  if (!path.endsWith(".webp")) return imgUrl(path);
  return imgUrl(path.replace(/\.webp$/, "-thumb.webp"));
}
