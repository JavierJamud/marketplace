import { prisma } from "./prisma.js";

// Bloque 37 (Parte E): Groq no permite fine-tuning propio, así que la
// mejora continua de ambos bots pasa por acá — el admin revisa
// conversaciones reales (AdminAssistant.jsx) y marca una respuesta como
// buena (se guarda tal cual salió) o mala (escribe la ideal), creando una
// fila ChatTrainingExample. Esta función arma el bloque de few-shot real
// que se inyecta en el prompt de cada bot — mismo criterio anti-alucinación
// de siempre: son EJEMPLOS de estilo/contenido, nunca datos que reemplacen
// al catálogo/TIENDAS/ZONAS reales de esa consulta puntual.
// Presupuesto de caracteres (no de tokens exactos, pero correlaciona bien
// para texto en español) para no inflar el prompt sin límite a medida que
// el admin acumula ejemplos — los más recientes entran primero, se corta
// apenas se llegaría a pasar el presupuesto.
// Bloque 42 (optimización de consumo de tokens): bajado de 3900 a 1500 —
// ~4-6 ejemplos recientes siguen entrando, de sobra como guía de estilo; los
// ejemplos curados por el admin no dejan de funcionar, solo entran menos a
// la vez en cada mensaje.
const CHAR_BUDGET = 1500;

export async function buildFewShotBlock(botTipo) {
  const examples = await prisma.chatTrainingExample.findMany({
    where: { botTipo, activo: true },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  if (!examples.length) return "";

  const header = "EJEMPLOS REALES REVISADOS POR EL ADMIN (guía de estilo/contenido real — aprendé el tono y el nivel de detalle, pero nunca copies uno literal si no responde exactamente lo que pide ESTE cliente; los datos reales de esta consulta puntual son siempre CANDIDATOS/TIENDAS/ZONAS/catálogo de arriba, no estos ejemplos):\n";
  let body = "";
  for (const ex of examples) {
    const block = `Cliente: "${ex.entradaCliente}"\nRespuesta ideal: "${ex.respuestaIdeal}"\n\n`;
    if (header.length + body.length + block.length > CHAR_BUDGET) break;
    body += block;
  }
  if (!body) return "";
  return `${header}\n${body.trim()}`;
}
