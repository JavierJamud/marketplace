import { prisma } from "./prisma.js";
import { isWithinFreeQuota } from "./aiQuota.js";

// Bloque 238 (pedido explícito — "antes de mostrar el chatbot, verificar que
// la IA funciona"), reescrito en el Bloque 245 para guardar la salud POR
// MODELO (provider + model) en vez de por proveedor: un proveedor puede tener
// varios modelos activos y cada uno puede caer por separado. Archivo hoja a
// propósito (solo depende de prisma.js) — ai.js ya es importado POR
// settings.controller.js, así que ninguno de los dos puede importar al otro
// sin crear un ciclo; este archivo es la pieza neutral que ambos consumen.

export async function getModelHealthRows() {
  return prisma.aiModelHealth.findMany();
}

export async function getModelHealth(provider, model) {
  return prisma.aiModelHealth.findUnique({ where: { provider_model: { provider, model } } });
}

export async function upsertModelHealth(provider, model, data) {
  return prisma.aiModelHealth.upsert({
    where: { provider_model: { provider, model } },
    create: { provider, model, ...data },
    update: data,
  });
}

// Actualización PARCIAL de una fila que ya existe (marcar que el aviso salió,
// la fecha del último intento de reparación, etc.). No usa upsert a propósito:
// Prisma valida también el `create` del upsert y exigiría `status` aunque la
// fila ya exista; y si la fila ya no existe (la borró un cambio del admin)
// no hay nada que parchear, no se debe crear una a medias.
export async function patchModelHealth(provider, model, data) {
  await prisma.aiModelHealth.updateMany({ where: { provider, model }, data });
}

export async function deleteModelHealth(provider, model) {
  await prisma.aiModelHealth.deleteMany({ where: { provider, model } });
}

// true si al menos un modelo está "healthy", o si todavía no corrió ningún
// chequeo (tabla vacía — recién desplegado, antes del primer tick del cron)
// — mismo criterio optimista que ya usa showChatWidget mientras /settings no
// cargó en el frontend. "Algún modelo sano" y no "todos": con varios modelos
// por proveedor, uno caído no apaga el chat si otro sigue respondiendo.
//
// Bloque 280 (pedido explícito): además tiene que quedarle cupo gratis. Si TODOS
// los modelos sanos están cerca de su límite, el chatbot se oculta en la tienda,
// en el panel del admin y en el de los vendedores hasta que alguno se renueve.
export async function isChatbotHealthy() {
  const rows = await getModelHealthRows();
  if (rows.length === 0) return true;
  for (const r of rows) {
    if (r.status === "healthy" && r.model && (await isWithinFreeQuota(r.provider, r.model))) return true;
  }
  return false;
}
