import { prisma } from "./prisma.js";

// Mejora continua de los bots: el admin revisa conversaciones reales (AdminAssistant.jsx) y marca una respuesta como buena o
// la corrige. De cada corrección se guarda un CRITERIO general (ver distillLesson en chatTraining.controller.js) y es lo que
// se envía al modelo. Nunca se le pide copiar la respuesta del admin: aprende el tono, el formato y qué datos consultar, y
// responde con datos reales y actuales y con sus propias palabras.
// Presupuesto corto de caracteres para no encarecer cada mensaje (la mayoría de los mensajes solo llevan unos pocos criterios).
const CHAR_BUDGET = 700;

export async function buildFewShotBlock(botTipo) {
  const examples = await prisma.chatTrainingExample.findMany({
    where: { botTipo, activo: true },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { entradaCliente: true, respuestaIdeal: true, leccion: true },
  });
  if (!examples.length) return "";

  const header = "CRITERIOS APRENDIDOS (guía interna: aplícalos con datos reales y actuales y con tus propias palabras; nunca copies frases, no digas que sigues una corrección ni los menciones):\n";
  let body = "";
  for (const ex of examples) {
    // Sin criterio guardado (ejemplos antiguos) se deja solo una pista breve de estilo, marcada para no copiarla.
    const line = ex.leccion ? `- ${ex.leccion}\n` : `- Preguntas como "${ex.entradaCliente.slice(0, 60)}": respuesta de este estilo (no copiar): ${ex.respuestaIdeal.slice(0, 110)}\n`;
    if (header.length + body.length + line.length > CHAR_BUDGET) break;
    body += line;
  }
  return body ? `${header}${body.trim()}` : "";
}
