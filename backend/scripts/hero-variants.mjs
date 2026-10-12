// Crea la versión pequeña de las imágenes del Hero que ya estaban subidas (las nuevas la generan solas al subirse).
// Uso, desde backend/:  node scripts/hero-variants.mjs
import { prisma } from "../src/lib/prisma.js";
import { SITE_UPLOAD_DIR } from "../src/controllers/settings.controller.js";
import { createHeroVariant } from "../src/lib/heroVariants.js";

const s = await prisma.siteSettings.findFirst({ select: { heroImages: true } });
let made = 0;
for (const url of s?.heroImages ?? []) {
  try {
    if (await createHeroVariant(SITE_UPLOAD_DIR, url.split("/").pop())) made++;
  } catch (err) {
    console.error(`No se pudo procesar ${url}: ${err.message}`);
  }
}
console.log(`Imágenes del Hero: ${s?.heroImages?.length ?? 0}, versiones nuevas: ${made}`);
await prisma.$disconnect();
