// Carga los municipios (Cuba) y las ciudades (demás países) de cada provincia o estado del catálogo, desde
// prisma/catalogos-ciudades.json ({ "código de la provincia o estado": ["nombre", ...] }). Se corre en cada despliegue y es
// idempotente: solo agrega los que faltan; nunca borra, renombra ni reactiva uno existente (el admin puede haberlo apagado).
// Uso: node prisma/seed-ciudades.mjs
//
// Origen de los datos: los 168 municipios de Cuba son la División Político-Administrativa vigente; las ciudades de los demás
// países salen de countries-states-cities-database (https://github.com/dr5hn/countries-states-cities-database), publicada
// bajo la licencia ODbL 1.0, sin barrios ni colonias.
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma.js";

const catalog = JSON.parse(readFileSync(new URL("./catalogos-ciudades.json", import.meta.url), "utf8"));

try {
  const provinces = await prisma.province.findMany({ where: { code: { in: Object.keys(catalog) } }, select: { id: true, code: true } });
  let added = 0;
  for (const { id, code } of provinces) {
    const names = catalog[code] ?? [];
    for (let i = 0; i < names.length; i += 2000) {
      const r = await prisma.municipality.createMany({ data: names.slice(i, i + 2000).map((name) => ({ provinceId: id, name })), skipDuplicates: true });
      added += r.count;
    }
  }
  const missing = Object.keys(catalog).length - provinces.length;
  console.log(`Ciudades y municipios: ${added} agregados en ${provinces.length} provincias o estados${missing ? ` (${missing} códigos sin provincia en la base)` : ""}.`);
} finally {
  await prisma.$disconnect();
}
