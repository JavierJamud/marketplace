// Descarga, optimiza y guarda en la propia tienda las fotos de producto que hoy se muestran desde enlaces de otros sitios.
// Es seguro repetirlo: solo toca las imágenes que empiezan con http(s) y, si una no se puede descargar, la deja como estaba.
// Uso:  node prisma/localizar-imagenes-externas.mjs            (aplica)
//       node prisma/localizar-imagenes-externas.mjs --simular   (solo cuenta, no cambia nada)
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/lib/prisma.js";
import { importRemoteImage } from "../src/lib/importRemoteImage.js";

const simular = process.argv.includes("--simular");
const base = join(dirname(fileURLToPath(import.meta.url)), "..", "uploads", "products");

const products = await prisma.product.findMany({
  where: { images: { isEmpty: false } },
  select: { id: true, name: true, images: true, vendor: { select: { slug: true } } },
});

let cambiados = 0;
let fallidos = 0;
for (const p of products) {
  if (!p.images.some((u) => /^https?:\/\//i.test(u))) continue;
  const nuevas = [];
  let huboCambio = false;
  for (const url of p.images) {
    if (!/^https?:\/\//i.test(url)) {
      nuevas.push(url);
      continue;
    }
    if (simular) {
      console.log(`[simulación] ${p.name}: ${url}`);
      nuevas.push(url);
      continue;
    }
    try {
      const file = await importRemoteImage(url, join(base, p.vendor.slug));
      nuevas.push(`/uploads/products/${p.vendor.slug}/${file}`);
      huboCambio = true;
      console.log(`OK    ${p.name}: ${url.slice(0, 80)}`);
    } catch (err) {
      nuevas.push(url);
      fallidos++;
      console.log(`SIGUE ${p.name}: ${url.slice(0, 80)} (${err.message})`);
    }
  }
  if (huboCambio) {
    await prisma.product.update({ where: { id: p.id }, data: { images: nuevas } });
    cambiados++;
  }
}
console.log(simular ? "Simulación terminada." : `Listo: ${cambiados} producto(s) actualizados, ${fallidos} imagen(es) no se pudieron descargar.`);
await prisma.$disconnect();
process.exit(0);
