// Bloque 228 (pedido explícito — Fase 1 del blindaje del ranking, "barato,
// hazlo de paso ya que estás tocando constantes"): antes este mismo número
// vivía escrito a mano en 3 archivos por separado (jobs/lowStock.job.js,
// controllers/vendors.controller.js, services/vendorDailyTips.service.js) —
// sin nada que los obligara a seguir de acuerdo, cambiar el umbral algún día
// significaba acordarse de tocar los 3, o peor, tocar solo 1 y dejar a los
// otros 2 desincronizados en silencio.
export const LOW_STOCK_THRESHOLD = 3;
