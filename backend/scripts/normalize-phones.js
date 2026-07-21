// Migración de datos (Bloque 9): normaliza a E.164 cualquier teléfono que
// haya quedado sin "+" (datos sembrados antes de este bloque, o creados a
// mano en pruebas anteriores). Asume Cuba (+53) por default, sin tocar los
// que ya tienen "+". No es una migración de schema — se corre a mano una vez.
// Uso: node scripts/normalize-phones.js
import { prisma } from "../src/lib/prisma.js";

async function normalize(model, field) {
  // Sin filtro por el campo en el WHERE: whatsapp es NOT NULL en Vendor, así
  // que un filtro "not: null" ahí es inválido para Prisma (redundante en un
  // campo requerido). Se filtra en memoria en vez de en la query.
  const rows = await model.findMany();
  let fixed = 0;
  for (const row of rows) {
    const value = row[field];
    if (!value || value.startsWith("+")) continue;
    const digits = value.replace(/\D/g, "");
    if (!digits) continue;
    await model.update({ where: { id: row.id }, data: { [field]: `+53${digits}` } });
    fixed++;
  }
  return fixed;
}

async function main() {
  const userFixed = await normalize(prisma.user, "phone");
  console.log(`User.phone normalizados: ${userFixed}`);

  const vendorFixed = await normalize(prisma.vendor, "whatsapp");
  console.log(`Vendor.whatsapp normalizados: ${vendorFixed}`);

  const orderFixed = await normalize(prisma.order, "customerPhone");
  console.log(`Order.customerPhone normalizados: ${orderFixed}`);
}

main()
  .catch((err) => {
    console.error("Error normalizando teléfonos:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
