import { prisma } from "./prisma.js";

// Bloque 238 (pedido explícito — "antes de mostrar el chatbot, verificar que
// la IA funciona"): estado cacheado de salud de cada proveedor de IA,
// refrescado cada 2 minutos por aiChatbotAvailability.job.js. Archivo hoja a
// propósito (solo depende de prisma.js) — ai.js ya es importado POR
// settings.controller.js, así que ninguno de los dos puede importar al otro
// sin crear un ciclo; este archivo es la pieza neutral que ambos consumen.

export async function getProviderHealthRows() {
  return prisma.aiProviderHealth.findMany();
}

export async function getProviderHealth(provider) {
  return prisma.aiProviderHealth.findUnique({ where: { provider } });
}

export async function upsertProviderHealth(provider, data) {
  return prisma.aiProviderHealth.upsert({
    where: { provider },
    create: { provider, ...data },
    update: data,
  });
}

// true si al menos un proveedor está "healthy", o si todavía no corrió
// ningún chequeo (tabla vacía — recién desplegado, antes del primer tick
// del cron) — mismo criterio optimista que ya usa showChatWidget mientras
// /settings no cargó en el frontend.
export async function isChatbotHealthy() {
  const rows = await getProviderHealthRows();
  if (rows.length === 0) return true;
  return rows.some((r) => r.status === "healthy");
}
