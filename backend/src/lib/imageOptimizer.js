import multer from "multer";
import sharp from "sharp";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

// Bloque 51 (pedido explícito — "cuando el cliente suba una imagen, que se
// optimice para ahorrar espacio, que se siga mostrando clara y de calidad
// pero con tamaño reducido"): hasta ahora NINGÚN middleware de subida tocaba
// el archivo — se guardaba tal cual lo mandó el navegador, con límites de
// hasta 8 MB. Una foto sacada con el teléfono (4000×3000, ~4 MB) terminaba
// servida entera a una tarjeta de catálogo que la muestra a 300 px: ~40 veces
// más datos de los necesarios, pagados por el cliente en cada carga (y en
// Cuba, con datos móviles caros, eso se siente de verdad).
//
// Acá vive TODO el procesamiento, una sola vez, y cada middleware de imagen
// lo arma con sus propias medidas (ver los `createImageUpload` de
// middleware/*.js) — nunca una copia de esta lógica por archivo.
//
// Qué NO pasa por acá a propósito:
// - kycUpload.js: documentos de identidad y el video de liveness. El admin
//   tiene que poder leer un número de carnet y ver una cara con detalle para
//   aprobar/rechazar — degradar eso puede hacer que se rechace un trámite
//   legítimo. Además ese middleware recibe un VIDEO, que sharp ni siquiera
//   puede procesar.
// - chatAudioUpload / assistantDocUpload / vendorAiDocUpload: audio y
//   documentos, no imágenes.

// Guarda el buffer ya procesado en disco y devuelve el nombre final.
async function writeVariant(buffer, dir, name) {
  await writeFile(join(dir, name), buffer);
  return name;
}

// `.rotate()` sin argumentos aplica la orientación EXIF de la foto ANTES de
// recortar/convertir. Es obligatorio: WebP no conserva ese metadato, así que
// sin esto una foto vertical de teléfono quedaría guardada acostada para
// siempre (bug silencioso, solo visible después de subirla).
// `withoutEnlargement` evita agrandar una imagen que ya era más chica que el
// máximo — ampliarla solo sumaría peso sin agregar un solo detalle real.
function pipeline(buffer, width, quality) {
  return sharp(buffer).rotate().resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer();
}

function makeOptimizer({ dir, maxWidth, quality, thumbWidth }) {
  return async function optimizeImages(req, _res, next) {
    // `.single()` deja req.file; `.array()` deja req.files. Se normalizan a
    // una sola lista para no duplicar el cuerpo del bucle.
    const files = req.files?.length ? req.files : req.file ? [req.file] : [];
    if (!files.length) return next();

    try {
      // `dir` puede ser una función del request: las fotos de producto van a
      // una carpeta por tienda (req.uploadVendorSlug), que recién se conoce
      // en tiempo de request.
      const targetDir = typeof dir === "function" ? dir(req) : dir;
      mkdirSync(targetDir, { recursive: true });

      for (const file of files) {
        const base = crypto.randomUUID();
        const name = await writeVariant(await pipeline(file.buffer, maxWidth, quality), targetDir, `${base}.webp`);

        // Miniatura aparte para las grillas (catálogo, tarjetas de tienda):
        // ahí la imagen se ve a ~300 px, no tiene sentido bajar la grande.
        // El nombre es derivable (`<uuid>-thumb.webp`) para que el frontend
        // la encuentre sin guardar una segunda columna en la base — ver
        // thumbUrl() en frontend/src/lib/imgUrl.js.
        if (thumbWidth) {
          await writeVariant(await pipeline(file.buffer, thumbWidth, quality), targetDir, `${base}-thumb.webp`);
        }

        // Los controladores leen `file.filename` para armar la URL que va a
        // la base (ej. addProductImages) — se reemplaza acá por el nombre
        // real del archivo optimizado, así ninguno de ellos necesita cambiar.
        file.filename = name;
        file.path = join(targetDir, name);
        // El buffer ya no hace falta: liberarlo evita que un request con 6
        // fotos quede reteniendo decenas de MB hasta que pase el GC.
        file.buffer = undefined;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Reemplaza al multer.diskStorage que tenía cada middleware por su cuenta:
// ahora el archivo entra a memoria (nunca toca el disco sin optimizar) y el
// optimizador de arriba es quien escribe el único archivo final.
//
// Devuelve un objeto con la MISMA forma que un multer (`.single()`/`.array()`),
// pero cada uno devuelve el par [multer, optimizador] — Express acepta
// arrays de middlewares, así que las ~18 rutas que ya los usan no cambian
// ni una línea.
export function createImageUpload({ dir, maxWidth, quality = 80, thumbWidth = null, allowedExt, fileSize, maxFiles }) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: maxFiles ? { fileSize, files: maxFiles } : { fileSize },
    fileFilter: (_req, file, cb) => {
      // Mismo criterio de siempre: se valida la extensión declarada, y el
      // nombre final lo genera el servidor (nunca el del cliente) — ver el
      // crypto.randomUUID() de arriba.
      const ext = extname(file.originalname).toLowerCase();
      cb(null, allowedExt.has(ext));
    },
  });
  const optimize = makeOptimizer({ dir, maxWidth, quality, thumbWidth });

  return {
    single: (field) => [upload.single(field), optimize],
    array: (field, maxCount) => [upload.array(field, maxCount), optimize],
  };
}
