import DOMPurify from "isomorphic-dompurify";

// Carga de preguntas frecuentes por lote desde HTML. Acepta dos formas, que se pueden mezclar:
//   <details><summary>Pregunta</summary> respuesta </details>
//   <h2>Pregunta</h2> respuesta en párrafos, listas o lo que siga hasta el siguiente título (h1 a h4)
// Todo se sanitiza antes de leerlo: lo que queda guardado nunca trae scripts ni atributos de evento.

export const FAQ_BATCH_MAX_ITEMS = 100;
export const FAQ_QUESTION_MAX = 300;
export const FAQ_ANSWER_MAX = 5000;

const SANITIZE_OPTIONS = {
  ALLOWED_TAGS: ["details", "summary", "h1", "h2", "h3", "h4", "p", "br", "ul", "ol", "li", "strong", "b", "em", "i", "u", "a", "code", "blockquote", "span"],
  ALLOWED_ATTR: ["href", "target", "rel"],
};

export function sanitizeFaqHtml(html) {
  return DOMPurify.sanitize(String(html ?? ""), SANITIZE_OPTIONS);
}

export function hasMarkup(text) {
  return /<\/?[a-z][^>]*>/i.test(String(text ?? ""));
}

const decode = (s) =>
  s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

function toText(html) {
  return decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function cleanAnswer(html) {
  const clean = html.trim();
  if (!toText(clean)) return "";
  // Los enlaces externos abren en pestaña nueva sin dar acceso a la ventana de origen.
  return clean.replace(/<a\s+([^>]*?)>/gi, (_m, attrs) => {
    const href = /href\s*=\s*"[^"]*"/i.exec(attrs)?.[0];
    return href ? `<a ${href} target="_blank" rel="noopener noreferrer">` : "<a>";
  });
}

// Devuelve { items: [{ question, answer }], skipped: [{ question, reason }] }.
export function parseFaqBatch(rawHtml) {
  const html = sanitizeFaqHtml(rawHtml);
  const found = [];

  const withoutDetails = html.replace(/<details\b[^>]*>([\s\S]*?)<\/details>/gi, (_m, inner) => {
    const s = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(inner);
    if (s) found.push({ at: _m, question: toText(s[1]), answer: cleanAnswer(inner.replace(s[0], "")) });
    return "\u0000";
  });

  // Títulos con su contenido hasta el siguiente título o bloque <details> ya extraído.
  const parts = withoutDetails.split(/(<h[1-4]\b[^>]*>[\s\S]*?<\/h[1-4]>)/i);
  for (let i = 1; i < parts.length; i += 2) {
    const body = (parts[i + 1] ?? "").replace(/\u0000/g, "");
    found.push({ question: toText(parts[i]), answer: cleanAnswer(body) });
  }

  const items = [];
  const skipped = [];
  for (const f of found) {
    if (f.question.length < 3) skipped.push({ question: f.question || "(sin pregunta)", reason: "La pregunta es muy corta." });
    else if (f.question.length > FAQ_QUESTION_MAX) skipped.push({ question: f.question.slice(0, 60) + "...", reason: `La pregunta pasa de ${FAQ_QUESTION_MAX} caracteres.` });
    else if (!f.answer) skipped.push({ question: f.question, reason: "No tiene respuesta." });
    else if (f.answer.length > FAQ_ANSWER_MAX) skipped.push({ question: f.question, reason: `La respuesta pasa de ${FAQ_ANSWER_MAX} caracteres.` });
    else items.push({ question: f.question, answer: f.answer });
  }
  return { items, skipped };
}
