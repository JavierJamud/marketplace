// Carga el catálogo mundial de países (apagados) para que el admin elija cuáles habilitar. Se corre en cada despliegue y es
// idempotente: solo agrega los que faltan. Uso: node prisma/seed-countries.mjs
import { seedWorldCountries } from "../src/lib/countryCatalog.js";
import { prisma } from "../src/lib/prisma.js";

try {
  const r = await seedWorldCountries();
  console.log(`Países: ${r.created} agregados, ${r.total} en total.`);
} finally {
  await prisma.$disconnect();
}
