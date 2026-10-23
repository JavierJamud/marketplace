import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { unlink } from "node:fs/promises";

// Una sola forma de borrar fotos subidas. Cada foto se guarda como `<id>.webp` más su miniatura `<id>-thumb.webp` (y, en las
// imágenes del sitio, una variante `<id>.w720.webp`), pero en la base solo queda la URL de la principal. Borrar solo esa dejaba
// la miniatura huérfana en el disco, y por eso todo borrado de fotos pasa por aquí.
const __dirname = dirname(fileURLToPath(import.meta.url));
export const UPLOADS_ROOT = join(__dirname, "..", "..", "uploads");

// Todos los archivos que forman una foto, a partir del nombre de la principal.
export function variantsOf(filePath) {
  if (!filePath.endsWith(".webp")) return [filePath];
  const base = filePath.slice(0, -".webp".length);
  return [filePath, `${base}-thumb.webp`, `${base}.w720.webp`];
}

// Convierte "/uploads/..." en una ruta del disco, o null si no es una foto nuestra (un enlace externo, por ejemplo) o si intenta
// salir de la carpeta de subidas.
function toDiskPath(url) {
  if (typeof url !== "string" || !url.startsWith("/uploads/")) return null;
  let rel;
  try {
    rel = decodeURIComponent(url.slice("/uploads/".length).split("?")[0]);
  } catch {
    return null;
  }
  const full = resolve(UPLOADS_ROOT, rel);
  return full.startsWith(UPLOADS_ROOT + sep) ? full : null;
}

// Logo de tienda subido al servidor: solo "/uploads/vendor-branding/<archivo>", sin subcarpetas. Devuelve la ruta del disco o
// null. Borrar o leer un logo pasa por aquí porque logoUrl lo escribe la tienda, y una ruta de otra carpeta de uploads
// (fotos de otras tiendas, documentos de identidad) nunca es su logo (auditoría run-2).
export const BRANDING_LOGO_PATTERN = /^\/uploads\/vendor-branding\/[A-Za-z0-9._-]+$/;
export function brandingLogoDiskPath(url) {
  if (typeof url !== "string" || !BRANDING_LOGO_PATTERN.test(url) || url.includes("..")) return null;
  return toDiskPath(url);
}

// Borra las fotos (con miniatura y variantes) de una lista de URLs. No falla nunca: lo que ya no existe se ignora.
export async function deleteUploadedImages(urls) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  const files = list.map(toDiskPath).filter(Boolean).flatMap(variantsOf);
  await Promise.all(files.map((f) => unlink(f).catch(() => {})));
  return files.length;
}
