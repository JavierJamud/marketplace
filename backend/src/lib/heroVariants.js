import { join } from "node:path";
import { access } from "node:fs/promises";
import sharp from "sharp";

// Versión pequeña (720 px de ancho) de cada imagen del Hero para celulares: la original (hasta 1200-1600 px) es demasiado
// para una pantalla de 390 px y retrasa la carga. El navegador elige con srcset (HeroImageSlider.jsx). Mismo nombre con
// ".w720" antes de la extensión, en la misma carpeta.
export const HERO_SMALL_WIDTH = 720;
export const smallVariantName = (filename) => filename.replace(/\.(webp|png|jpe?g)$/i, ".w720.webp");

export async function createHeroVariant(dir, filename) {
  const out = join(dir, smallVariantName(filename));
  try {
    await access(out);
    return false; // ya existe
  } catch {
    // no existe: se crea
  }
  await sharp(join(dir, filename)).resize({ width: HERO_SMALL_WIDTH, withoutEnlargement: true }).webp({ quality: 78, alphaQuality: 90 }).toFile(out);
  return true;
}
